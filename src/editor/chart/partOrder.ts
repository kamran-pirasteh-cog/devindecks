/**
 * Reading order for the parts of one chart.
 *
 * A shift-click range needs to know what "between" means, and the answer can't
 * come from geometry: a bar chart's bars grow from a shared baseline, so their
 * centres sort by VALUE, and the run between two rows would come out in the
 * order of the numbers rather than the order of the categories. It can't come
 * from the compiled element order either, which is series-major — the run
 * between two bars of one column would leap through every other column.
 *
 * So order is read off the refs, which carry the data address: category first,
 * series within it. That is column-by-column on a column chart and
 * row-by-row on a bar chart without either kind having to be named here, which
 * is the point — orientation, stacking and slice order are all already decided
 * by the order the categories appear in.
 *
 * The category and series orders themselves come from the order the parts were
 * emitted in, not from the spec: the compiler walks the spec to build them, so
 * first appearance IS spec order, for grid, xy, waterfall and sankey alike.
 */
import { legendSeriesKey, partKind, type ChartRef } from '@/model';

/** Just enough of a `SlideElement` to rank it. */
export interface PartEl {
  id: string;
  chartRef?: ChartRef;
}

/** Category and series order, by first appearance among the chart's parts. */
function keyOrder(parts: PartEl[]) {
  const points = new Map<string, number>();
  const series = new Map<string, number>();
  for (const { chartRef: ref } of parts) {
    if (!ref) continue;
    if (ref.part === 'mark' || ref.part === 'label' || ref.part === 'total') {
      if (!points.has(ref.point)) points.set(ref.point, points.size);
    }
    if (ref.part === 'mark' || ref.part === 'label') {
      if (!series.has(ref.series)) series.set(ref.series, series.size);
    }
  }
  return { points, series };
}

const compare = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

/**
 * The chart's parts of one `partKind`, in the order the reader sees them.
 *
 * `series`, when given, narrows the list to one data series — the run along a
 * single line or a single bar colour.
 *
 * Painted order breaks every tie, so the two halves of a legend entry (the
 * swatch and its text share a series) and anything with no ranking of its own
 * still come out stable.
 */
export function partsInReadingOrder(
  parts: PartEl[],
  kind: string,
  series: string | null = null,
): string[] {
  const order = keyOrder(parts);
  const rank = (ref: ChartRef, i: number): number[] => {
    switch (ref.part) {
      case 'mark':
      case 'label':
        return [order.points.get(ref.point) ?? i, order.series.get(ref.series) ?? 0, i];
      case 'total':
        return [order.points.get(ref.point) ?? i, 0, i];
      case 'axis':
        return [ref.i ?? 0, 0, i];
      case 'legend.item':
        return [order.series.get(legendSeriesKey(ref)) ?? i, 0, i];
      default:
        return [i, 0, i];
    }
  };
  return parts
    .map((p, i) => ({ ref: p.chartRef, id: p.id, i }))
    .filter(
      (p): p is { ref: ChartRef; id: string; i: number } =>
        !!p.ref &&
        partKind(p.ref) === kind &&
        (!series ||
          ((p.ref.part === 'mark' || p.ref.part === 'label') && p.ref.series === series)),
    )
    .sort((a, b) => compare(rank(a.ref, a.i), rank(b.ref, b.i)))
    .map((p) => p.id);
}

/**
 * The chart's data series, in the order they were emitted — spec order.
 *
 * Exported for `partSelect`, which needs the RUN of series between two clicks:
 * shift-clicking a label in the first series and one in the third means those
 * three series, and the order the reader sees them in is the one used here.
 */
export function seriesOrder(parts: PartEl[]): string[] {
  return [...keyOrder(parts).series.keys()];
}
