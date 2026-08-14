/**
 * Orientation, as one control across every chart kind.
 *
 * Each kind expressed this differently — a column chart flipped by becoming a
 * different KIND, a waterfall had its own `orientation` field, a scatter had no
 * concept of it at all — so "turn this on its side" meant something different
 * in each corner of the UI, or nothing. This is the one place that knows how
 * each kind flips, so the editor can offer a single control.
 */
import type { ChartKind, ChartSpec, XYData } from './spec';
import { isHorizontal } from './spec';

export type ChartOrientation = 'vertical' | 'horizontal';

/**
 * Can this kind be turned on its side at all?
 *
 * Two kinds can't, for different reasons, and it's worth being exact about
 * both rather than faking a control that does nothing useful:
 *
 * - A PIE has no side to lie on. Rotating it moves where the slices start,
 *   which is a genuinely different control.
 * - A SCATTER has no category axis to flip. Its two axes are two variables,
 *   and the meaningful operation is trading their roles — `swapAxes` — which
 *   changes the data rather than the layout, and has no persistent "which way
 *   round am I" to read back afterwards.
 */
export const supportsOrientation = (kind: ChartKind): boolean =>
  kind === 'column' ||
  kind === 'bar' ||
  kind === 'line' ||
  kind === 'area' ||
  kind === 'combo' ||
  kind === 'waterfall' ||
  kind === 'sankey';

/**
 * Can a chart of this kind be turned as a whole — the quarter-turn rotation
 * handle, as opposed to the orientation control?
 *
 * An x/y plot can't. Both of its axes are continuous variables, so a turned
 * scatter reads as a chart someone knocked over rather than as a chart drawn
 * the other way round: the axis titles go down the side, the value labels lose
 * their baseline, and nothing about the data is easier to read. The operation
 * people actually want there is `swapAxes`, which trades the two variables and
 * leaves the plot upright.
 */
export const supportsTurn = (kind: ChartKind): boolean =>
  kind !== 'scatter' && kind !== 'bubble';

/** Kinds whose "orientation" control is really a swap of the two variables. */
export const canSwapAxes = (kind: ChartKind): boolean =>
  kind === 'scatter' || kind === 'bubble';

export const chartOrientation = (spec: ChartSpec): ChartOrientation =>
  isHorizontal(spec) ? 'horizontal' : 'vertical';

/** Swap x and y on every point, for the kinds whose data IS the geometry. */
const transposeXY = (data: XYData): XYData => ({
  series: data.series.map((s) => ({
    ...s,
    points: s.points.map((p) => ({ ...p, x: p.y, y: p.x })),
  })),
});

/**
 * Return `spec` laid out the requested way.
 *
 * Never mutates: callers are store patches, and a chart type change has to be
 * one undoable step.
 */
export function setChartOrientation(spec: ChartSpec, to: ChartOrientation): ChartSpec {
  if (chartOrientation(spec) === to) return spec;
  const horizontal = to === 'horizontal';

  switch (spec.kind) {
    // A column and a bar are the same chart drawn along a different axis, and
    // OOXML models them as two types — so the flip is a kind change and every
    // other field rides along untouched.
    case 'column':
    case 'bar':
      return { ...spec, kind: horizontal ? 'bar' : 'column' };

    case 'waterfall':
      return { ...spec, orientation: horizontal ? 'bar' : 'column' };

    case 'line':
    case 'area':
    case 'combo':
    case 'sankey':
      return { ...spec, orientation: to };

    default:
      return spec;
  }
}

/**
 * Trade the two variables on a scatter or bubble chart.
 *
 * The axis SETTINGS travel with the values they describe — a title reading
 * "Revenue" belongs to the revenue numbers, not to the left-hand side of the
 * plot — so they swap along with the points.
 */
export function swapAxes(spec: ChartSpec): ChartSpec {
  if (!canSwapAxes(spec.kind) || !('data' in spec) || !('series' in spec.data)) return spec;
  const xy = spec as ChartSpec & { data: XYData };
  return {
    ...xy,
    data: transposeXY(xy.data),
    axes: { ...spec.axes, x: spec.axes.y, y: spec.axes.x },
  } as ChartSpec;
}
