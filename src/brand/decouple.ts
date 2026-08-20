/**
 * Take the text OUT of coloured boxes.
 *
 * A `ShapeElement` may carry a `body`, and source decks use that constantly: the
 * KPI card, the pull-quote panel, the coloured callout are all one filled shape
 * with text inside it. It is a perfectly good way to author a slide, and a
 * terrible thing to hand to a refitter.
 *
 * The reason is that the panel and the text share one rect. Refit's whole job is
 * to make text fit after its metrics changed, and its cheapest lever is growing
 * the box — but growing THIS box means growing the coloured panel. A row of four
 * KPI cards where one card's label wrapped to two lines becomes a row of four
 * cards where one is 30% taller than the others. Every card is individually
 * correct and the row is visibly broken. Shrinking has the mirror problem: the
 * panel can't shrink with the text, so it can't help, and refit is left with one
 * lever on an element that has two jobs.
 *
 * So we split them. The panel keeps the geometry and gives up the text; a real
 * `TextElement` takes the text and sits inside it. They share a `groupIds` entry
 * so they still select, drag and delete as one thing — the user sees no
 * difference — but refit can now move the text without touching the panel, and
 * the panel is marked `frozen` so it never tries.
 *
 * This is not a new idea in this codebase: `editor/band.ts` and
 * `editor/callout.ts` both build exactly this shape — a fill rect plus separate
 * text boxes in one group, with the text pinned `autofit: 'none'` — and
 * `band.ts` says why in as many words: "a measure pass must not resize one out
 * from under the next". Conversion makes that the default for imported decks.
 */
import type { Rect, ShapeElement, Slide, SlideElement, TextElement } from '@/model';
import { DEFAULT_TEXT_INSETS, pointsToEmu, textInsetBox } from '@/model';
import { resolveColor, type DesignSystem } from '@/model/tokens';
import { contrastRatio } from '@/chart/color';

/** Role stamped on the panel half of a split, so `refit` knows to leave it be. */
export const PANEL_ROLE = 'brand.panel';

/**
 * Elements refit must not resize.
 *
 * A separate field rather than reusing `locked`: `locked` is an AUTHOR's
 * statement ("don't let me move this by accident") and the editor's UI acts on
 * it. This is the engine's own statement about one element's role in a pair, and
 * conflating them would mean every converted deck arrived with half its shapes
 * locked in the editor for no reason the user could see.
 */
export type RefitPolicy = 'frozen' | 'free';

/** Padding between a panel's edge and the text now sitting inside it. */
const PANEL_PAD_PT = 8;

export interface DecoupleResult {
  slide: Slide;
  /** How many shapes were split, for the conversion report. */
  splits: number;
  /** Element ids that must not be resized: panels and their kin. */
  frozen: Set<string>;
  /**
   * New text element id → the id of the SOURCE shape its text came from.
   *
   * Without this the caller cannot tell what the split text is FOR. It was
   * inferring the link from shared group membership, which fails for the common
   * case: a shape with no group of its own gets a brand-new group here, so there
   * is no source element sharing it and the lookup came back empty. The role
   * then fell back to `body` — and a slide title, correctly classified as
   * `title`, was restyled and refit as body copy. That is exactly the wrong
   * default, since `body` shrinks less far before giving up, so the title
   * overflowed its band instead of fitting.
   */
  textFromShape: Map<string, string>;
}

/**
 * Does this shape's text need separating?
 *
 * Only when there is a PANEL to protect. An unfilled, unstroked shape carrying
 * text is a text box that happens to be a shape — splitting it would produce an
 * invisible frozen rectangle and a text box, which is strictly worse than
 * leaving it alone.
 */
export function needsDecoupling(
  el: SlideElement,
  ground?: { ds: DesignSystem; background: Slide['background'] },
): el is ShapeElement {
  if (el.type !== 'shape') return false;
  if (!el.body || (el.body.paragraphs ?? []).length === 0) return false;
  // A chart's own compiled shapes are recompiled wholesale; never touch them.
  if (el.chartRef) return false;
  const filled = el.fill !== undefined && el.fill.kind !== 'none';
  const stroked = el.outline !== undefined;
  if (!filled && !stroked) return false;

  /*
   * A fill indistinguishable from the slide behind it is not a panel.
   *
   * Real decks are full of text boxes carrying the background colour — an
   * artefact of how they were drawn, not a design decision. Splitting one
   * produces an invisible frozen rectangle and a text box, which is pure cost:
   * an extra element, a frozen geometry that stops refit growing the box, and
   * (before `textFromShape`) a lost role. A slide title drawn this way was the
   * case that surfaced it.
   */
  if (filled && !stroked && ground && el.fill?.kind === 'solid') {
    const bg =
      ground.background?.kind === 'solid'
        ? resolveColor(ground.background.color, ground.ds)
        : (ground.ds.colors.find((c) => c.id === 'surface.base')?.hex ?? '#FFFFFF');
    if (contrastRatio(resolveColor(el.fill.color, ground.ds), bg) < INVISIBLE_PANEL) return false;
  }
  return true;
}

/**
 * Contrast below which a fill is indistinguishable from the slide behind it.
 *
 * 1.05:1 is a hair above equal — #FCFCFC on #FFFFFF scores about 1.02 — so this
 * catches "the same colour, near enough" without touching a pale panel that is
 * genuinely meant to read as one.
 */
const INVISIBLE_PANEL = 1.05;

/**
 * The rect the text takes inside its panel.
 *
 * The panel's own insets if it had them, otherwise a small symmetric pad. A
 * shape's text was previously drawn flush to its edges (`DEFAULT_TEXT_INSETS` is
 * zero in this app, deliberately unlike PowerPoint), and a filled panel whose
 * text touches its edge looks like a mistake — so the split is the right moment
 * to give it the breathing room it should always have had.
 */
export function textRectFor(panel: Rect, insets = DEFAULT_TEXT_INSETS): Rect {
  const hasInsets = insets.l > 0 || insets.t > 0 || insets.r > 0 || insets.b > 0;
  if (hasInsets) return textInsetBox(panel, insets);
  const pad = pointsToEmu(PANEL_PAD_PT);
  // Never pad a panel out of existence: a thin coloured bar with a label on it
  // would end up with a zero-height text box.
  const safeX = Math.min(pad, Math.max(0, panel.w / 4));
  const safeY = Math.min(pad, Math.max(0, panel.h / 4));
  return {
    x: panel.x + safeX,
    y: panel.y + safeY,
    w: Math.max(pointsToEmu(1), panel.w - safeX * 2),
    h: Math.max(pointsToEmu(1), panel.h - safeY * 2),
  };
}

/**
 * Split every text-bearing filled shape on a slide.
 *
 * `newId` is injected rather than imported so the caller keeps its own id
 * scheme — the same reason `ingestSlides` takes one.
 */
export function decoupleSlide(
  slide: Slide,
  ds: DesignSystem,
  newId: (prefix: string) => string,
): DecoupleResult {
  const out: SlideElement[] = [];
  const frozen = new Set<string>();
  const textFromShape = new Map<string, string>();
  let splits = 0;

  for (const el of slide.elements) {
    if (!needsDecoupling(el, { ds, background: slide.background })) {
      out.push(el);
      continue;
    }

    const body = el.body!;
    // Reuse the shape's existing group if it has one, so a card already grouped
    // with a heading keeps that relationship and gains this one inside it.
    const gid = el.groupIds?.[0] ?? newId('g');
    const groupIds = el.groupIds?.length ? el.groupIds : [gid];

    const panel: ShapeElement = {
      ...el,
      role: el.role ?? PANEL_ROLE,
      groupIds,
    };
    delete panel.body;

    const text: TextElement = {
      id: newId('text'),
      type: 'text',
      // The text inherits the shape's semantic role — it is the thing that
      // carried the meaning; the panel is now just its ground.
      ...(el.role ? { role: el.role } : {}),
      ...(el.name ? { name: el.name } : {}),
      rect: textRectFor(el.rect, body.insets),
      rotation: el.rotation,
      groupIds,
      body: {
        ...body,
        // Insets are now expressed as the text rect's inset FROM the panel, so
        // carrying them here too would double the padding.
        insets: DEFAULT_TEXT_INSETS,
        // Pinned, for the reason `band.ts` gives: a measure pass must not
        // resize one slot out from under the next. Refit still changes this
        // box's rect when it decides to — `autofit` governs the live editor's
        // own fitting, which must stay out of the way inside a fixed panel.
        autofit: 'none',
        anchor: body.anchor ?? 'middle',
      },
    };

    frozen.add(panel.id);
    textFromShape.set(text.id, el.id);
    out.push(panel, text);
    splits += 1;
  }

  return { slide: { ...slide, elements: out }, splits, frozen, textFromShape };
}

/**
 * Is this panel light enough to want dark type on it?
 *
 * Used by `restyle.ts` to DERIVE the ink for a panel's text rather than mapping
 * it from the source text colour — deliberately, because a derived ink follows
 * the brand automatically. Recolour the palette so a panel goes dark and its
 * label flips to the light token by itself; a mapped colour would have stayed
 * dark and become illegible.
 *
 * Mirrors `isLightFill` in `editor/callout.ts`, including its 0.45 threshold.
 * Duplicated rather than imported because that module pulls in editor concerns
 * this layer has no business depending on.
 */
export function panelIsLight(panel: ShapeElement, ds: DesignSystem): boolean {
  if (!panel.fill || panel.fill.kind !== 'solid') return true;
  return srgbLuminance(resolveColor(panel.fill.color, ds)) > LIGHT_FILL_THRESHOLD;
}

const LIGHT_FILL_THRESHOLD = 0.45;

function srgbLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 1;
  const chan = (i: number) => {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}
