/**
 * A combo chart's per-series render mode, and the order its series are edited in.
 *
 * A combo is the one kind whose rows aren't all the same thing — two of them
 * are columns and the third is a line drawn over them — and a datasheet that
 * doesn't say so is a trap: the row reads like another bar, and the number in
 * it is on a different axis. So the sheet marks the line rows AND sinks them
 * below the columns, which is where the reader's eye already expects the
 * "and also, plotted differently" part of a table to be.
 *
 * Pure, and deliberately not in `spec.ts`: the ordering is a presentation rule
 * the datasheet and the legend share, not part of the spec's shape.
 */
import type { ChartSpec } from './spec';

export type SeriesRender = 'column' | 'line' | 'area';

/** How a combo draws one series. Unlisted series are columns. */
export function comboRenderOf(spec: ChartSpec, seriesKey: string): SeriesRender {
  return spec.kind === 'combo' ? (spec.render[seriesKey] ?? 'column') : 'column';
}

/** "Line" / "Area" for a combo's non-column series; undefined for the rest. */
export function comboSeriesMark(spec: ChartSpec, seriesKey: string): string | undefined {
  const render = comboRenderOf(spec, seriesKey);
  if (spec.kind !== 'combo' || render === 'column') return undefined;
  return render === 'line' ? 'Line' : 'Area';
}

/**
 * The order a combo's series are shown in — columns first, lines and areas
 * last, each group keeping the order it was authored in.
 *
 * `null` when there's nothing to reorder (not a combo, or already in order), so
 * every caller can skip the indirection in the common case.
 */
export function comboDisplayOrder(spec: ChartSpec): number[] | null {
  if (spec.kind !== 'combo') return null;
  const series = spec.data.series;
  const rank = (i: number) => (comboRenderOf(spec, series[i]!.key) === 'column' ? 0 : 1);
  const order = series.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
  return order.some((v, i) => v !== i) ? order : null;
}
