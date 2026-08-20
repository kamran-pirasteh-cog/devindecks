'use client';

/**
 * Model -> .pptx exporter.
 *
 * This is the payoff of the constrained model: because every element is already
 * a safe OOXML primitive, export is a near-mechanical mapping — no lossy
 * "best effort" translation. Geometry comes straight from EMU (converted to the
 * inches pptxgenjs wants), colors resolve through the design system, and fonts
 * are emitted by their exact Google Fonts names so Google Slides renders them
 * natively on import.
 *
 * FONT EMBEDDING (desktop PowerPoint without the fonts installed) is the one
 * remaining step — pptxgenjs can't embed, so we post-process the zip. Tracked as
 * a follow-up; named-font export already gives full Google Slides fidelity.
 */
import PptxGenJS from 'pptxgenjs';
import {
  cropScale,
  isCropped,
  DEFAULT_TEXT_INSETS,
  emuToInches,
  emuToPoints,
  FONTS,
  inchesToEmu,
  ROUND_RECT_RADIUS_RATIO,
  pageNumberInk,
  pageNumberLabel,
  resolveColor,
  type Deck,
  type DesignSystem,
  type Fill,
  type Outline,
  type PathElement,
  type ShapeElement,
  type SlideElement,
  type TextBody,
  type TextElement,
  showsPageNumbers,
} from '@/model';
import { bulletGlyph } from '@/render/bullets';

const hx = (ref: Parameters<typeof resolveColor>[0], ds: DesignSystem) =>
  resolveColor(ref, ds).replace('#', '');

const PRESET_TO_SHAPE: Record<ShapeElement['preset'], string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  rightArrow: 'rightArrow',
  chevron: 'chevron',
  pill: 'roundRect',
};

const dashType = (d: Outline['dash']): 'dash' | 'sysDot' | 'solid' =>
  d === 'dash' ? 'dash' : d === 'dot' ? 'sysDot' : 'solid';

/**
 * Fill opts, with our 0..1 opacity flipped into the transparency percentage
 * PowerPoint speaks. Returns undefined for no fill so callers can pick their
 * own "unfilled" spelling (a text box wants none, a shape wants `type: 'none'`).
 */
function fillOpts(fill: Fill | undefined, ds: DesignSystem) {
  if (!fill || fill.kind !== 'solid') return undefined;
  const alpha = fill.alpha ?? 1;
  return {
    color: hx(fill.color, ds),
    transparency: alpha >= 1 ? undefined : Math.round((1 - alpha) * 100),
  };
}

function outlineOpts(outline: Outline | undefined, ds: DesignSystem) {
  if (!outline) return undefined;
  return {
    color: hx(outline.color, ds),
    width: emuToPoints(outline.widthEmu),
    dashType: dashType(outline.dash),
  };
}

/** Build pptxgenjs text-run array from a TextBody, preserving paragraphs. */
function textRuns(body: TextBody, ds: DesignSystem) {
  const out: { text: string; options: Record<string, unknown> }[] = [];
  body.paragraphs.forEach((p) => {
    const runs = p.runs.length ? p.runs : [{ text: '' }];
    runs.forEach((r, i) => {
      out.push({
        // pptxgenjs has no `cap="all"`, so an all-caps run is uppercased on the
        // way out — the same trick the chart emitter uses (`displayText`).
        text: r.caps ? r.text.toUpperCase() : r.text,
        options: {
          fontFace: r.font,
          fontSize: r.sizePt,
          // OOXML has no weight axis — only b on/off. A Medium (500) run has
          // no PowerPoint equivalent, so it rides as regular rather than
          // silently thickening to bold.
          bold: r.bold || (r.weight ?? 400) >= 600,
          italic: r.italic,
          underline: r.underline ? { style: 'sng' } : undefined,
          color: r.color ? hx(r.color, ds) : undefined,
          align: p.align,
          bullet:
            p.bullet === 'bullet'
              ? // The same square glyph the canvas draws, by code point, so the
                // exported deck doesn't fall back to PowerPoint's round dot.
                // (pptxgenjs has no buSzPct, so the size bump is canvas-only.)
                { characterCode: bulletGlyph(p.level ?? 0).codePointAt(0)!.toString(16).toUpperCase() }
              : p.bullet === 'number'
                ? { type: 'number' }
                : undefined,
          // PowerPoint's own indent ladder, so a demoted item nests natively
          // instead of arriving flush-left with a hand-drawn glyph.
          indentLevel: p.level || undefined,
          lineSpacingMultiple: p.lineSpacingPct ? p.lineSpacingPct / 100 : undefined,
          paraSpaceBefore: p.spaceBeforePt,
          paraSpaceAfter: p.spaceAfterPt,
          // End the paragraph on its last run.
          breakLine: i === runs.length - 1,
        },
      });
    });
  });
  return out;
}

function bodyBoxOpts(body: TextBody) {
  return {
    valign: body.anchor ?? 'top',
    wrap: body.wrap ?? true,
    fit: body.autofit === 'shrink' ? 'shrink' : body.autofit === 'resize' ? 'resize' : 'none',
    // Always explicit: unset insets mean flush text here (DEFAULT_TEXT_INSETS),
    // but PowerPoint's own default is 0.1in/0.05in — leaving `margin` off would
    // let the exported deck re-inset text the editor showed flush.
    //
    // ORDER IS [left, right, bottom, top] — pptxgenjs maps the array straight
    // onto lIns/rIns/bIns/tIns in that sequence (not the CSS order), so a
    // clockwise-from-top array silently swaps a box's left inset with its top.
    margin: [
      emuToPoints(body.insets?.l ?? DEFAULT_TEXT_INSETS.l),
      emuToPoints(body.insets?.r ?? DEFAULT_TEXT_INSETS.r),
      emuToPoints(body.insets?.b ?? DEFAULT_TEXT_INSETS.b),
      emuToPoints(body.insets?.t ?? DEFAULT_TEXT_INSETS.t),
    ],
  };
}

/**
 * A freeform path becomes an OOXML `<a:custGeom>`.
 *
 * pptxgenjs builds one from a `points` array; our ops map onto it directly
 * because both are the same four primitives. Coordinates are normalized to the
 * element box in the model and inches on the wire, so the conversion is a
 * single multiply — and the SVG in `render/geometry.tsx` must stay in lockstep
 * with what's written here, exactly as `ShapeGeom` does with `prstGeom`.
 */
function addPathElement(slide: PptxGenJS.Slide, el: PathElement, ds: DesignSystem) {
  const w = emuToInches(el.rect.w);
  const h = emuToInches(el.rect.h);
  const points = el.d.map((op) => {
    switch (op.op) {
      case 'M':
        return { x: op.x * w, y: op.y * h, moveTo: true as const };
      case 'L':
        return { x: op.x * w, y: op.y * h };
      case 'C':
        return {
          x: op.x * w,
          y: op.y * h,
          curve: {
            type: 'cubic' as const,
            x1: op.x1 * w,
            y1: op.y1 * h,
            x2: op.x2 * w,
            y2: op.y2 * h,
          },
        };
      case 'Z':
        return { close: true as const };
    }
  });

  slide.addShape('custGeom' as PptxGenJS.ShapeType, {
    ...xywh(el),
    points: points as never,
    fill: el.fill?.kind === 'solid' ? { color: hx(el.fill.color, ds) } : { type: 'none' },
    line: el.outline ? outlineOpts(el.outline, ds) : undefined,
  });
}

function xywh(el: SlideElement) {
  return {
    x: emuToInches(el.rect.x),
    y: emuToInches(el.rect.y),
    w: emuToInches(el.rect.w),
    h: emuToInches(el.rect.h),
    rotate: el.rotation || undefined,
    flipH: el.flipH || undefined,
    flipV: el.flipV || undefined,
  };
}

/**
 * A picture's crop, as pptxgenjs sizing options — which become `<a:srcRect>`.
 *
 * pptxgenjs derives the insets by comparing the sizing box against the image's
 * DECLARED w/h, and then places the picture at the sizing box's size. So the
 * declared size is the whole PLANE (the untrimmed source), and the sizing box is
 * the element's rect on it: that yields exactly our insets, and an extent equal
 * to the rect. No pixel dimensions needed — see `model/crop.ts`.
 *
 * An uncropped picture returns nothing at all, keeping today's plain stretch.
 */
function pictureCrop(el: Extract<SlideElement, { type: 'picture' }>) {
  if (!isCropped(el.crop)) return {};
  const s = cropScale(el.crop);
  const w = emuToInches(el.rect.w);
  const h = emuToInches(el.rect.h);
  return {
    w: w / s.x,
    h: h / s.y,
    sizing: {
      type: 'crop' as const,
      x: (el.crop.left / s.x) * w,
      y: (el.crop.top / s.y) * h,
      w,
      h,
    },
  };
}

// pptxgenjs slide typing is broad; keep the mapping loosely typed at the seam.
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The width a box that must NOT wrap is given over its own measurement.
 *
 * `wrap: false` leaves as `<a:bodyPr wrap="none">`. PowerPoint honours it;
 * Google Slides drops it on import and wraps every text box to its own width.
 * That matters because the boxes carrying it are the ones measured to their
 * string and given a single line of height — chart ticks, data labels, legend
 * entries — so the moment Slides wraps one, the second line lands on top of
 * whatever sits beneath it. A four-series legend paints over its own entries.
 *
 * So a no-wrap box leaves with headroom on the axis its text runs along, grown
 * away from the edge its alignment pins it to (both edges when it's centred, or
 * rotated, where the box turns about its own centre). The box is invisible —
 * this only applies with no fill and no outline — and the text keeps its
 * position on both renderers, so the slack costs nothing and buys a full
 * substituted-font's worth of width error.
 */
const NOWRAP_HEADROOM = inchesToEmu(0.12);

function nowrapHeadroom(el: TextElement) {
  if (el.body.wrap !== false || el.fill || el.outline) return xywh(el);
  const align = el.body.paragraphs[0]?.align ?? 'left';
  const symmetric = el.rotation !== undefined || align === 'center' || align === 'justify';
  const left = symmetric || align === 'right' ? NOWRAP_HEADROOM : 0;
  const right = symmetric || align === 'left' ? NOWRAP_HEADROOM : 0;
  return {
    ...xywh(el),
    x: emuToInches(el.rect.x - left),
    w: emuToInches(el.rect.w + left + right),
  };
}

function addTextElement(slide: any, el: TextElement, ds: DesignSystem) {
  slide.addText(textRuns(el.body, ds), {
    ...nowrapHeadroom(el),
    ...bodyBoxOpts(el.body),
    fill: fillOpts(el.fill, ds),
    line: outlineOpts(el.outline, ds),
  });
}

function addShapeElement(slide: any, el: ShapeElement, ds: DesignSystem) {
  const shapeType = PRESET_TO_SHAPE[el.preset];
  const opts: Record<string, unknown> = {
    ...xywh(el),
    fill: fillOpts(el.fill, ds) ?? { type: 'none' },
    line: outlineOpts(el.outline, ds),
    // Both rounded presets ship their radius. `roundRect` without one takes
    // OOXML's default adj of 1/6 of the shorter side — rounder than the 12% the
    // canvas draws, and the difference reads as the shape having been altered
    // on import.
    rectRadius:
      el.preset === 'pill'
        ? emuToInches(el.rect.h) / 2
        : el.preset === 'roundRect'
          ? emuToInches(Math.min(el.rect.w, el.rect.h)) * ROUND_RECT_RADIUS_RATIO
          : undefined,
  };
  if (el.body) {
    slide.addText(textRuns(el.body, ds), { ...opts, shape: shapeType, ...bodyBoxOpts(el.body) });
  } else {
    slide.addShape(shapeType, opts);
  }
}

/**
 * The page number, exported as a plain text box.
 *
 * Not a PowerPoint slide-number FIELD: a field renumbers itself in PowerPoint
 * but arrives in Google Slides as whatever value was cached, and this deck's
 * numbering rules (skip the title slide) live in our model, not theirs. A
 * literal string is what both engines render identically — the number is
 * already correct at the moment of export, and re-exporting is what updates it.
 */
function addPageNumber(slide: any, deck: Deck, index: number, ds: DesignSystem) {
  const style = ds.pageNumbers;
  const label = pageNumberLabel(style, index, deck.slides.length);
  if (!label) return;
  const bg =
    deck.slides[index].background?.kind === 'solid'
      ? resolveColor(deck.slides[index].background!.color, ds)
      : '#ffffff';
  const lineIn = (style.sizePt * FONTS[style.font].singleLineFactor) / 72;
  const marginX = emuToInches(style.marginXEmu);
  slide.addText([{ text: label, options: {} }], {
    x: marginX,
    y: emuToInches(deck.slideSize.h - style.marginYEmu) - lineIn,
    w: emuToInches(deck.slideSize.w) - marginX * 2,
    h: lineIn,
    fontFace: style.font,
    fontSize: style.sizePt,
    bold: !!style.bold,
    color: pageNumberInk(style, bg).replace('#', ''),
    align:
      style.position === 'bottom-center'
        ? 'center'
        : style.position === 'bottom-left'
          ? 'left'
          : 'right',
    valign: 'bottom',
    margin: 0,
    fit: 'none',
    wrap: false,
  });
}

/** Build the pptxgenjs document from the model (no serialization). */
export function buildPptx(deck: Deck, ds: DesignSystem): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: 'DD',
    width: emuToInches(deck.slideSize.w),
    height: emuToInches(deck.slideSize.h),
  });
  pptx.layout = 'DD';
  pptx.author = 'Devin Decks';
  pptx.title = deck.title;

  deck.slides.forEach((s, slideIndex) => {
    const slide = pptx.addSlide();
    if (s.background && s.background.kind === 'solid') {
      slide.background = { color: hx(s.background.color, ds) };
    }
    for (const el of s.elements) {
      switch (el.type) {
        case 'text':
          addTextElement(slide, el, ds);
          break;
        case 'shape':
          addShapeElement(slide, el, ds);
          break;
        case 'line':
          slide.addShape('line', {
            ...xywh(el),
            line: {
              ...outlineOpts(el.outline, ds),
              // The model has carried these since the line element existed and
              // nothing drew one until a Gantt's dependency links, where the
              // head IS the direction of the dependency — a link exported
              // headless says two tasks are related but not which follows which.
              ...(el.startArrow ? { beginArrowType: 'triangle' as const } : {}),
              ...(el.endArrow ? { endArrowType: 'triangle' as const } : {}),
            },
            flipV: el.flipV || undefined,
          });
          break;
        case 'path':
          addPathElement(slide, el, ds);
          break;
        case 'picture': {
          const source = el.src.startsWith('data:') ? { data: el.src } : { path: el.src };
          slide.addImage({ ...source, ...xywh(el), ...pictureCrop(el), rounding: false });
          break;
        }
      }
    }
    if (showsPageNumbers(deck)) addPageNumber(slide, deck, slideIndex, ds);
  });

  return pptx;
}

export async function exportDeckToPptx(deck: Deck, ds: DesignSystem): Promise<Blob> {
  return (await buildPptx(deck, ds).write({ outputType: 'blob' })) as Blob;
}

/** Export + trigger a browser download. */
export async function downloadDeckPptx(deck: Deck, ds: DesignSystem) {
  const blob = await exportDeckToPptx(deck, ds);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deck.title.replace(/[^\w.-]+/g, '_') || 'deck'}.pptx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
