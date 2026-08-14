/**
 * The reverse map from a compiled primitive back to the spec node that made it.
 *
 * This is what lets every gesture on the canvas write to the SPEC rather than
 * to the element. Recoloring a bar has to become a `PointOverride`, not a fill
 * on that rect — the next recompile would erase the fill, and the datasheet and
 * the canvas would disagree about what the chart says. One address type, one
 * command surface.
 */
import type { AxisId } from './spec';

export type ChartRef =
  | { chartId: string; part: 'plot' | 'title' | 'legend.box' }
  | { chartId: string; part: 'mark'; series: string; point: string }
  | { chartId: string; part: 'label'; series: string; point: string }
  | { chartId: string; part: 'total'; point: string }
  | {
      chartId: string;
      part: 'axis';
      axis: AxisId;
      sub: 'line' | 'title' | 'tick' | 'grid' | 'unitNote';
      i?: number;
    }
  | { chartId: string; part: 'legend.item'; series: string }
  | { chartId: string; part: 'decoration'; decoId: string; sub?: string };

export type ChartPart = ChartRef['part'];

/**
 * The deterministic element id for a part. Ids MUST be stable across
 * recompiles: `reconcileChartElements` diffs on them, and a fresh id every
 * keystroke would blow away z-order, selection and React's reconciliation.
 */
export function partKey(ref: ChartRef): string {
  switch (ref.part) {
    case 'plot':
    case 'title':
    case 'legend.box':
      return ref.part;
    case 'mark':
      return `mark.${ref.series}.${ref.point}`;
    case 'label':
      return `label.${ref.series}.${ref.point}`;
    case 'total':
      return `total.${ref.point}`;
    case 'axis':
      return ref.i === undefined
        ? `axis.${ref.axis}.${ref.sub}`
        : `axis.${ref.axis}.${ref.sub}.${ref.i}`;
    case 'legend.item':
      return `legend.item.${ref.series}`;
    case 'decoration':
      return ref.sub ? `deco.${ref.decoId}.${ref.sub}` : `deco.${ref.decoId}`;
  }
}

export const elementIdFor = (ref: ChartRef): string =>
  `${ref.chartId}::${partKey(ref)}`;

/** The chart an element belongs to, from its id alone. */
export function chartIdOfElementId(id: string): string | null {
  const i = id.indexOf('::');
  return i > 0 ? id.slice(0, i) : null;
}

/**
 * The data series a legend entry stands for.
 *
 * A legend entry is TWO marks — the swatch and its text — and their ids have to
 * differ, so the text's ref carries a `.label`-suffixed series key (see
 * `legendMarks`). That suffix is an id device, not a series: anything asking
 * "which series did the user just click?" must strip it, or it looks up a series
 * that doesn't exist and silently finds nothing.
 */
export const legendSeriesKey = (
  ref: Extract<ChartRef, { part: 'legend.item' }>,
): string => (ref.series.endsWith('.label') ? ref.series.slice(0, -'.label'.length) : ref.series);

/** True when this ref addresses a single data point (bar, marker, slice). */
export const isPointRef = (
  ref: ChartRef,
): ref is Extract<ChartRef, { part: 'mark' | 'label' }> =>
  ref.part === 'mark' || ref.part === 'label';
