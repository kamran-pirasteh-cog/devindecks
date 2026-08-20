/**
 * Slide margins — the invisible frame every deck lays out against.
 *
 * These are the brand's safe area: the left/right edge where titles, body and
 * charts line up, the top edge titles hang from, and the bottom edge nothing
 * should cross.
 *
 * NOTE: the built-in templates still place their content at x = 0.9in (see
 * `templates/registry.ts`), a wider side margin than the 0.45in guide here — so
 * template content sits inside the guide until those layouts are re-authored.
 *
 * Absolute inches, not fractions of the slide: a margin is a physical breathing
 * distance from the paper edge, and it shouldn't shrink because the deck is 4:3.
 */
import type { EMU } from './units';
import { inchesToEmu } from './units';
import type { Insets, Rect } from './types';

export interface SlideMargins {
  left: EMU;
  right: EMU;
  top: EMU;
  bottom: EMU;
  /**
   * Where body content starts on a content slide — below the title band that
   * hangs off `top`. A secondary guide rather than a margin proper: crossing it
   * is fine on full-bleed or title slides.
   */
  contentTop: EMU;
}

export const DEFAULT_MARGINS: SlideMargins = {
  left: inchesToEmu(0.45),
  right: inchesToEmu(0.45),
  top: inchesToEmu(0.45),
  bottom: inchesToEmu(0.6),
  /*
   * Sits just clear of a two-line title rather than through it: a 26pt Geist
   * title (1.3 line factor) hung from `top` renders two lines down to 1.39in,
   * and the imported decks hang theirs ~0.14in lower still. At 1.3in the guide
   * fell on the second line's baseline and clipped its descenders.
   */
  contentTop: inchesToEmu(1.55),
};

/**
 * The padding between a shape's edge and the text inside it, for a shape with
 * `body.insets` unset.
 *
 * Zero, deliberately — unlike PowerPoint's 0.1in/0.05in body insets. Text sits
 * flush with the box it's in, so a box's rect *is* where its text starts and
 * two boxes aligned on the canvas have their text aligned too. Decks that want
 * PowerPoint's inset carry it explicitly on `body.insets`.
 *
 * Shared so the renderer's padding and the canvas's snap lines are the SAME
 * distance: a text box dropped on a shape's inner guide lands exactly where
 * that shape's own text would sit, which is what makes placement consistent
 * across every shape on the deck.
 */
export const DEFAULT_TEXT_INSETS: Insets = { l: 0, t: 0, r: 0, b: 0 };

/** A shape's text area: its rect pulled in by its insets. */
export function textInsetBox(rect: Rect, insets?: Insets): Rect {
  const i = insets ?? DEFAULT_TEXT_INSETS;
  return {
    x: rect.x + i.l,
    y: rect.y + i.t,
    w: Math.max(0, rect.w - i.l - i.r),
    h: Math.max(0, rect.h - i.t - i.b),
  };
}

export interface MarginGuides {
  /** x positions, in EMU. */
  vertical: EMU[];
  /** y positions, in EMU. */
  horizontal: EMU[];
}

/**
 * The safe area as a rect — the box the margin lines enclose.
 *
 * Uses `top`, not `contentTop`: the title band is inside the safe area, so
 * fitting content to this box never pushes a title down out of its band.
 */
export function marginBox(
  slideSize: { w: EMU; h: EMU },
  m: SlideMargins = DEFAULT_MARGINS,
): Rect {
  return {
    x: m.left,
    y: m.top,
    w: Math.max(0, slideSize.w - m.left - m.right),
    h: Math.max(0, slideSize.h - m.top - m.bottom),
  };
}

/**
 * The title band — the strip a slide's title hangs in, from the top-left corner
 * of the safe area down to the `contentTop` guide and across to the right
 * margin.
 *
 * Shared geometry: it's where `fitToMargins` parks a title, where a title the
 * editor inserts lands, and the region the canvas watches for the hover that
 * offers to add one.
 */
export function titleBand(
  slideSize: { w: EMU; h: EMU },
  m: SlideMargins = DEFAULT_MARGINS,
): Rect {
  return {
    x: m.left,
    y: m.top,
    w: Math.max(0, slideSize.w - m.left - m.right),
    h: Math.max(0, m.contentTop - m.top),
  };
}

/**
 * Roles that behave as the slide's title for layout purposes — the one line
 * that hangs off the top-left corner of the safe area. 'heading' counts: on a
 * content slide it IS the title, just a smaller type role.
 */
export function isTitleRole(role: string | undefined): boolean {
  return role === 'title' || role === 'heading';
}

/** The margin lines for a slide, as absolute EMU coordinates. */
export function marginGuides(
  slideSize: { w: EMU; h: EMU },
  m: SlideMargins = DEFAULT_MARGINS,
): MarginGuides {
  return {
    vertical: [m.left, slideSize.w - m.right],
    horizontal: [m.top, m.contentTop, slideSize.h - m.bottom],
  };
}

/**
 * A `roundRect`'s corner radius, as a fraction of its shorter side.
 *
 * The model records a preset, not a radius, so both renderers have to agree on
 * one number — and OOXML's own default for the preset is `adj = 16667` (1/6),
 * a heavier rounding than the deck's look. An exported shape that leaves the
 * radius unset therefore arrives in PowerPoint and Google Slides visibly
 * rounder than the canvas drew it, which reads as the shape having been
 * redrawn on import. Shared between `ShapeGeom` and the exporter's
 * `rectRadius` so it can't drift again.
 */
export const ROUND_RECT_RADIUS_RATIO = 0.12;
