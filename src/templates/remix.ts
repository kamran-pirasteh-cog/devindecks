/**
 * "Remix" a slide into a few alternate layouts. Content is preserved — only
 * element positions/sizes (and proportionally, text size) change — by fitting
 * two groups (header-ish roles vs everything else) into different zone rects
 * per variant. Works even on slides with no role tags: everything just falls
 * into the "rest" group and still gets a distinct arrangement per variant.
 */
import { nanoid } from 'nanoid';
import type { EMU, Rect, Slide, SlideElement } from '@/model';

const HEADER_ROLES = new Set(['title', 'subtitle', 'heading']);

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxOf(elements: SlideElement[]): BBox | null {
  if (elements.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.rect.x);
    minY = Math.min(minY, el.rect.y);
    maxX = Math.max(maxX, el.rect.x + el.rect.w);
    maxY = Math.max(maxY, el.rect.y + el.rect.h);
  }
  return { minX, minY, maxX, maxY };
}

function cloneWithNewId(el: SlideElement): SlideElement {
  const copy: SlideElement = JSON.parse(JSON.stringify(el));
  copy.id = `${el.id}-${nanoid(4)}`;
  return copy;
}

function scaleTextRuns(el: SlideElement, scale: number) {
  const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
  if (!body) return;
  for (const p of body.paragraphs) {
    for (const r of p.runs) {
      if (r.sizePt) r.sizePt = Math.max(6, Math.round(r.sizePt * scale));
    }
  }
}

/** Fit a group of elements (preserving their relative arrangement) into `dest`. */
function fitElements(elements: SlideElement[], dest: Rect): SlideElement[] {
  const box = bboxOf(elements);
  if (!box) return [];
  const boxW = Math.max(1, box.maxX - box.minX);
  const boxH = Math.max(1, box.maxY - box.minY);
  const scale = Math.min(dest.w / boxW, dest.h / boxH, 1.3);
  const offsetX = dest.x + (dest.w - boxW * scale) / 2;
  const offsetY = dest.y + (dest.h - boxH * scale) / 2;

  return elements.map((el) => {
    const copy = cloneWithNewId(el);
    copy.rect = {
      x: offsetX + (el.rect.x - box.minX) * scale,
      y: offsetY + (el.rect.y - box.minY) * scale,
      w: el.rect.w * scale,
      h: el.rect.h * scale,
    };
    scaleTextRuns(copy, scale);
    if (copy.outline) {
      copy.outline = { ...copy.outline, widthEmu: copy.outline.widthEmu * scale };
    }
    return copy;
  });
}

type VariantId = 'centered' | 'split' | 'band';

function zonesFor(variant: VariantId, w: EMU, h: EMU): { header: Rect; body: Rect } {
  switch (variant) {
    case 'centered':
      return {
        header: { x: w * 0.15, y: h * 0.08, w: w * 0.7, h: h * 0.32 },
        body: { x: w * 0.1, y: h * 0.44, w: w * 0.8, h: h * 0.48 },
      };
    case 'split':
      return {
        header: { x: w * 0.06, y: h * 0.32, w: w * 0.28, h: h * 0.36 },
        body: { x: w * 0.4, y: h * 0.08, w: w * 0.54, h: h * 0.84 },
      };
    case 'band':
      return {
        header: { x: w * 0.06, y: h * 0.05, w: w * 0.88, h: h * 0.16 },
        body: { x: w * 0.06, y: h * 0.26, w: w * 0.88, h: h * 0.68 },
      };
  }
}

const VARIANTS: VariantId[] = ['centered', 'split', 'band'];

/** Produce a few alternate-layout copies of `slide`, same content, new arrangement. */
export function generateRemixes(slide: Slide, slideSize: { w: EMU; h: EMU }): Slide[] {
  const headerEls = slide.elements.filter((e) => HEADER_ROLES.has(e.role ?? ''));
  const bodyEls = slide.elements.filter((e) => !headerEls.includes(e));

  return VARIANTS.map((variant) => {
    const zones = zonesFor(variant, slideSize.w, slideSize.h);
    const newHeader = fitElements(headerEls, zones.header);
    const newBody = fitElements(bodyEls, zones.body);
    return {
      ...slide,
      id: `s-${nanoid(8)}`,
      elements: [...newHeader, ...newBody],
    };
  });
}
