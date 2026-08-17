/**
 * The empty title slot — what the canvas offers when a slide has no title yet.
 *
 * A slide's title is the one object whose place on the page is a brand rule
 * rather than a layout choice (see `fitToMargins`), so an untitled slide has a
 * known empty hole in it. Hovering that hole offers to fill it, and the offer is
 * geometry the canvas already knows: the title band, in canvas pixels.
 *
 * Pure so the hit test and the "does this slide need a title?" question can be
 * tested without a canvas — the component only paints the answer.
 */
import { isText, isTitleRole, titleBand, type Rect, type SlideElement, type TextElement } from '@/model';

/** All the characters in a text element's body, as one string. */
const bodyText = (el: TextElement): string =>
  el.body.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('');

/**
 * The element acting as this slide's title, if it has one — including a title
 * box that carries no words yet, which is what an abandoned "Add title" leaves
 * behind.
 */
export function titleElement(elements: SlideElement[]): TextElement | undefined {
  return elements.find((el): el is TextElement => isText(el) && isTitleRole(el.role));
}

/**
 * What the "Add title" button does: create one, or — when an empty title box is
 * already sitting there — put the caret back in it. Without the second case a
 * title added and abandoned would still read as missing, and clicking again
 * would stack a second empty box on top of the first.
 */
export function titleSlotAction(elements: SlideElement[]): 'add' | 'edit' | 'none' {
  const el = titleElement(elements);
  if (!el) return 'add';
  return bodyText(el).trim() ? 'none' : 'edit';
}

/**
 * The title band in canvas pixels — the region a hover in offers the button,
 * and where the button is drawn (its top-left corner).
 */
export function titleBandPx(slideSize: { w: number; h: number }, scale: number): Rect {
  const band = titleBand(slideSize);
  return { x: band.x * scale, y: band.y * scale, w: band.w * scale, h: band.h * scale };
}

/** Is a point (canvas px, relative to the slide's top-left) inside a rect? */
export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
