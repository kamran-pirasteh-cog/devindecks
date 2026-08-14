/**
 * Fit imported slides to the destination deck.
 *
 * A deck has ONE slide size, so 4:3 slides dropped into a 16:9 deck have to be
 * resolved at import time — deferring it to export is how you end up with a
 * deck that looks right in the editor and letterboxed in PowerPoint. We scale
 * uniformly (never stretch: a stretched logo is worse than a margin) and centre
 * what's left over.
 *
 * Everything sized in EMU scales, and so do point sizes and line weights —
 * otherwise a 4:3 slide shrunk into 16:9 keeps 40pt titles inside a box that is
 * now 75% as wide.
 */
import type { EMU, Slide, SlideElement, TextBody } from '@/model';

export interface Placement {
  scale: number;
  dx: EMU;
  dy: EMU;
}

export function placementFor(
  from: { w: EMU; h: EMU },
  to: { w: EMU; h: EMU },
): Placement {
  const scale = Math.min(to.w / from.w, to.h / from.h);
  return {
    scale,
    dx: Math.round((to.w - from.w * scale) / 2),
    dy: Math.round((to.h - from.h * scale) / 2),
  };
}

export const isIdentity = (p: Placement): boolean =>
  Math.abs(p.scale - 1) < 1e-6 && p.dx === 0 && p.dy === 0;

/** Scale one slide's contents in place-safe fashion (returns a new slide). */
export function fitSlide(slide: Slide, p: Placement): Slide {
  if (isIdentity(p)) return slide;
  return {
    ...slide,
    elements: slide.elements.map((el) => fitElement(el, p)),
    charts: slide.charts?.map((c) => ({
      ...c,
      frame: {
        x: Math.round(c.frame.x * p.scale) + p.dx,
        y: Math.round(c.frame.y * p.scale) + p.dy,
        w: Math.round(c.frame.w * p.scale),
        h: Math.round(c.frame.h * p.scale),
      },
    })),
  };
}

function fitElement(el: SlideElement, p: Placement): SlideElement {
  const scaled: SlideElement = {
    ...el,
    rect: {
      x: Math.round(el.rect.x * p.scale) + p.dx,
      y: Math.round(el.rect.y * p.scale) + p.dy,
      w: Math.round(el.rect.w * p.scale),
      h: Math.round(el.rect.h * p.scale),
    },
  };

  if ('outline' in scaled && scaled.outline) {
    scaled.outline = {
      ...scaled.outline,
      widthEmu: Math.max(1, Math.round(scaled.outline.widthEmu * p.scale)),
    };
  }
  if ('body' in scaled && scaled.body) scaled.body = fitBody(scaled.body, p.scale);

  return scaled;
}

function fitBody(body: TextBody, scale: number): TextBody {
  return {
    ...body,
    insets: body.insets
      ? {
          l: Math.round(body.insets.l * scale),
          t: Math.round(body.insets.t * scale),
          r: Math.round(body.insets.r * scale),
          b: Math.round(body.insets.b * scale),
        }
      : undefined,
    paragraphs: body.paragraphs.map((para) => ({
      ...para,
      spaceBeforePt: para.spaceBeforePt ? round1(para.spaceBeforePt * scale) : undefined,
      spaceAfterPt: para.spaceAfterPt ? round1(para.spaceAfterPt * scale) : undefined,
      runs: para.runs.map((r) => ({
        ...r,
        sizePt: r.sizePt ? round1(r.sizePt * scale) : undefined,
      })),
    })),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
