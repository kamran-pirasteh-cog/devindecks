/**
 * A chart on a slide.
 *
 * A chart is NOT an element type. It's a `groupId` plus a spec: the compiled
 * primitives live in `slide.elements` carrying that group id, so z-order,
 * selection, group drag, align/distribute and all three exporters keep working
 * with zero knowledge that charts exist. Adding `ElementType = 'chart'` would
 * have broken the constrained-OOXML invariant and forced a fallback branch in
 * every export path.
 */
import type { Rect } from '../types';
import type { ChartSpec } from './spec';

export interface ChartInstance {
  id: string;
  /** The group whose members are this chart's compiled primitives. */
  groupId: string;
  /** The chart's box on the slide, in EMU — the source of truth for layout. */
  frame: Rect;
  spec: ChartSpec;
  /**
   * The brand style variant this chart was inserted as, if any.
   *
   * A REFERENCE, not a copy: the variant's formatting resolves at compile time,
   * so an admin editing "Column / gridless" reflows every chart inserted from
   * it. That's the whole difference between a variant and a template — a
   * template pins its formatting into the spec at creation and stops tracking.
   * A dangling id (variant deleted) resolves to the conventions alone rather
   * than failing, so deleting a variant never breaks a deck.
   */
  variantId?: string;
  /**
   * Quarter-turn orientation, clockwise degrees: 0, 90, 180 or 270.
   *
   * A chart at 37° is never what anyone wanted — the axis titles go diagonal
   * and the whole thing reads as a mistake — so the rotate handle snaps to the
   * four orientations and this field only ever holds one of them. Layout still
   * solves in the unrotated `frame`; the turn is applied to the compiled
   * primitives, which is why 9pt type stays 9pt at every orientation.
   */
  rotation?: number;
  /**
   * "Keep the current layout" — a resize moves and scales the group affinely
   * instead of relaying out. Off by default.
   */
  frozen?: boolean;
}
