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
  emuToInches,
  emuToPoints,
  resolveColor,
  type Deck,
  type DesignSystem,
  type Outline,
  type ShapeElement,
  type SlideElement,
  type TextBody,
  type TextElement,
} from '@/model';

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
        text: r.text,
        options: {
          fontFace: r.font,
          fontSize: r.sizePt,
          bold: r.bold,
          italic: r.italic,
          underline: r.underline ? { style: 'sng' } : undefined,
          color: r.color ? hx(r.color, ds) : undefined,
          align: p.align,
          bullet:
            p.bullet === 'bullet'
              ? true
              : p.bullet === 'number'
                ? { type: 'number' }
                : undefined,
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
    margin: body.insets
      ? [
          emuToPoints(body.insets.t),
          emuToPoints(body.insets.r),
          emuToPoints(body.insets.b),
          emuToPoints(body.insets.l),
        ]
      : [emuToPoints(45720), emuToPoints(91440), emuToPoints(45720), emuToPoints(91440)],
  };
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

// pptxgenjs slide typing is broad; keep the mapping loosely typed at the seam.
/* eslint-disable @typescript-eslint/no-explicit-any */
function addTextElement(slide: any, el: TextElement, ds: DesignSystem) {
  slide.addText(textRuns(el.body, ds), {
    ...xywh(el),
    ...bodyBoxOpts(el.body),
    fill: el.fill && el.fill.kind === 'solid' ? { color: hx(el.fill.color, ds) } : undefined,
    line: outlineOpts(el.outline, ds),
  });
}

function addShapeElement(slide: any, el: ShapeElement, ds: DesignSystem) {
  const shapeType = PRESET_TO_SHAPE[el.preset];
  const opts: Record<string, unknown> = {
    ...xywh(el),
    fill: el.fill && el.fill.kind === 'solid' ? { color: hx(el.fill.color, ds) } : { type: 'none' },
    line: outlineOpts(el.outline, ds),
    rectRadius: el.preset === 'pill' ? emuToInches(el.rect.h) / 2 : undefined,
  };
  if (el.body) {
    slide.addText(textRuns(el.body, ds), { ...opts, shape: shapeType, ...bodyBoxOpts(el.body) });
  } else {
    slide.addShape(shapeType, opts);
  }
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

  for (const s of deck.slides) {
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
            line: outlineOpts(el.outline, ds),
          });
          break;
        case 'picture':
          slide.addImage(
            el.src.startsWith('data:')
              ? { data: el.src, ...xywh(el), rounding: false }
              : { path: el.src, ...xywh(el), rounding: false },
          );
          break;
      }
    }
  }

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
