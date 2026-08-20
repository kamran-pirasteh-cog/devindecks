/**
 * What Devin is told about the deck before it acts.
 *
 * A snapshot, not the deck itself: geometry comes out in inches, colours as
 * token ids, and text as the words rather than the run tree. The model never
 * sees — and so can never hand back — a raw model object, which is what keeps
 * every edit routed through the tools in `tools.ts`.
 *
 * Only the OPEN slide is described element by element. The rest of the deck is
 * one line each, and `read_slide` fills in whichever of them the model needs;
 * describing forty slides in full would be most of a context window spent on
 * slides nobody asked about.
 */
import { emuToInches, type Deck, type Slide, type SlideElement, type TextBody } from '@/model';
import type { ColorRef, Fill, Outline } from '@/model';

const inches = (emu: number) => Math.round(emuToInches(emu) * 100) / 100;

const colorName = (c: ColorRef | undefined) =>
  c ? (c.kind === 'token' ? c.token : c.hex) : undefined;

/** The words in a text body, one line per paragraph. */
export function bodyText(body: TextBody | undefined): string {
  if (!body) return '';
  return body.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}

const fillName = (f: Fill | undefined) =>
  !f ? undefined : f.kind === 'none' ? 'none' : colorName(f.color);

const outlineName = (o: Outline | undefined) =>
  o ? `${colorName(o.color)} ${Math.round(emuToInches(o.widthEmu) * 72 * 10) / 10}pt ${o.dash}` : undefined;

/** Whatever a title-ish element on the slide says, for the deck outline. */
export function slideLabel(slide: Slide): string {
  const titled = slide.elements.find((el) => el.role === 'title' && bodyText(bodyOf(el)));
  const first = slide.elements.find((el) => bodyText(bodyOf(el)));
  const text = bodyText(bodyOf(titled ?? first ?? slide.elements[0]));
  const line = text.split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

function bodyOf(el: SlideElement | undefined): TextBody | undefined {
  if (!el) return undefined;
  return el.type === 'text' || el.type === 'shape' ? el.body : undefined;
}

/** One element, flattened to the handful of facts an edit needs. */
export function describeElement(el: SlideElement) {
  const body = bodyOf(el);
  const run = body?.paragraphs.find((p) => p.runs.length)?.runs[0];
  const para = body?.paragraphs[0];
  return {
    id: el.id,
    type: el.type,
    ...(el.role ? { role: el.role } : {}),
    ...(el.type === 'shape' ? { preset: el.preset } : {}),
    rect: {
      x: inches(el.rect.x),
      y: inches(el.rect.y),
      w: inches(el.rect.w),
      h: inches(el.rect.h),
    },
    ...(el.rotation ? { rotation: el.rotation } : {}),
    ...(body ? { text: bodyText(body) } : {}),
    ...(run?.sizePt ? { sizePt: run.sizePt } : {}),
    ...(run?.bold ? { bold: true } : {}),
    ...(run?.italic ? { italic: true } : {}),
    ...(run?.color ? { color: colorName(run.color) } : {}),
    ...(para?.align ? { align: para.align } : {}),
    ...(fillName('fill' in el ? el.fill : undefined)
      ? { fill: fillName('fill' in el ? el.fill : undefined) }
      : {}),
    ...(outlineName('outline' in el ? el.outline : undefined)
      ? { outline: outlineName('outline' in el ? el.outline : undefined) }
      : {}),
    ...(el.type === 'picture' ? { picture: true } : {}),
    // Chart primitives are compiled output — editing one directly is undone by
    // the next recompile, so they're marked read-only rather than hidden.
    ...(el.chartRef ? { readOnly: 'part of a chart — edit the chart, not this' } : {}),
    ...(el.locked ? { locked: true } : {}),
    ...(el.groupIds?.length ? { groupIds: el.groupIds } : {}),
  };
}

/** Every element on one slide, for `read_slide` and the opening snapshot. */
export function describeSlide(deck: Deck, index: number) {
  const slide = deck.slides[index];
  if (!slide) return { error: `No slide ${index + 1}; the deck has ${deck.slides.length}.` };
  return {
    slide: index + 1,
    ...(slide.charts?.length ? { charts: slide.charts.length } : {}),
    background: fillName(slide.background),
    elements: slide.elements.map(describeElement),
  };
}

/**
 * The block prepended to each thing the user types. Regenerated per message so
 * Devin is never editing against a deck the user has since changed under it.
 */
export function deckSnapshot(deck: Deck, currentSlideId: string, selectedIds: string[]): string {
  const index = Math.max(
    0,
    deck.slides.findIndex((s) => s.id === currentSlideId),
  );
  return JSON.stringify(
    {
      deckTitle: deck.title,
      slideSize: { w_in: inches(deck.slideSize.w), h_in: inches(deck.slideSize.h) },
      outline: deck.slides.map((s, i) => `${i + 1}. ${slideLabel(s) || '(empty)'}`),
      openSlide: describeSlide(deck, index),
      selectedIds,
    },
    null,
    1,
  );
}
