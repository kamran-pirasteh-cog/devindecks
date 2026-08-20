/**
 * `Mark` is the vocabulary between layout and emit.
 *
 * Placers speak in marks — "a rect here, a tick label there" — and know nothing
 * about `SlideElement`, element ids or roles. `emit` is the single place that
 * turns marks into model elements, which means adding a chart kind never
 * touches the element model, and changing how elements are shaped never touches
 * a placer.
 *
 * All geometry is ABSOLUTE slide EMU. Placers receive the chart's frame and
 * position against it directly, so no coordinate space has to be threaded
 * through emit.
 */
import type {
  ColorRef,
  DashStyle,
  EMU,
  Fill,
  FontFamily,
  Outline,
  ParaAlign,
  Rect,
  VerticalAnchor,
} from '@/model';
import type { ChartRef, MarkerShape, PathOp } from '@/model';

export interface MarkTextStyle {
  font: FontFamily;
  sizePt: number;
  bold?: boolean;
  italic?: boolean;
  /** Face between regular and bold, e.g. Medium 500 for a data label. */
  weight?: number;
  color: ColorRef;
  /** Uppercase the text — see `displayText` in `render/measureText`. */
  caps?: boolean;
  align: ParaAlign;
  anchor: VerticalAnchor;
  /** Clockwise degrees; used for rotated axis titles and tick labels. */
  rotation?: number;
  /**
   * Set `false` for a label whose box is measured to its own text: the chart
   * engine has already decided this string sits on one line, and letting the
   * renderer's real font metrics wrap it — half a point wider than the measure —
   * breaks "Enterprise · 640" across two lines. Defaults to wrapping, which is
   * what a banded category label wants.
   */
  wrap?: boolean;
}

export type Mark =
  | { kind: 'rect'; ref: ChartRef; rect: Rect; fill?: Fill; outline?: Outline; name?: string }
  | {
      kind: 'line';
      ref: ChartRef;
      rect: Rect;
      color: ColorRef;
      widthEmu: EMU;
      dash: DashStyle;
      /** Set when the line runs bottom-left to top-right within its box. */
      flipV?: boolean;
      /**
       * An arrowhead at the far end.
       *
       * `LineElement` has carried `startArrow`/`endArrow` all along; no placer
       * had wanted one until a Gantt's dependency links, where the head IS the
       * direction of the dependency. Passed straight through by `emitMark`.
       */
      endArrow?: boolean;
      name?: string;
    }
  | {
      kind: 'marker';
      ref: ChartRef;
      rect: Rect;
      shape: MarkerShape;
      fill?: Fill;
      outline?: Outline;
      name?: string;
    }
  | {
      kind: 'path';
      ref: ChartRef;
      rect: Rect;
      /** Normalized to `rect`, cubics only — see `model/types.ts`. */
      d: PathOp[];
      fill?: Fill;
      outline?: Outline;
      name?: string;
    }
  | { kind: 'text'; ref: ChartRef; rect: Rect; text: string; style: MarkTextStyle; name?: string };

export type MarkKind = Mark['kind'];

/** Convenience for placers: an EMU rect from edges rather than width/height. */
export const rectFromEdges = (x0: EMU, y0: EMU, x1: EMU, y1: EMU): Rect => ({
  x: Math.round(Math.min(x0, x1)),
  y: Math.round(Math.min(y0, y1)),
  w: Math.round(Math.abs(x1 - x0)),
  h: Math.round(Math.abs(y1 - y0)),
});

/**
 * A bar thinner than this would render as an invisible sliver that still
 * appears in the selection tree and the exported file. Clamp instead.
 */
export const MIN_MARK_EMU: EMU = 1_270; // 0.1pt
