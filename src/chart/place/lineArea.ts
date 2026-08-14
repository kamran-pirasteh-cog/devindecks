/**
 * Line, area and the line members of a combo chart.
 *
 * Areas are `path` elements rather than stacks of quadrilaterals: a per-interval
 * rectangle approach leaves visible seams between segments and can't follow a
 * smoothed curve at all.
 */
import type { AreaSpec, ComboSpec, LineSpec } from '@/model';
import { pointsToEmu } from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import type { LinearScale } from '../scale/linear';
import { bandScale } from '../scale/band';
import type { ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { rectFromEdges } from '../mark';
import type { GridDerived } from '../derive/grid';
import { areaPath, linePath, type Point } from '../geom/path';
import type { Projector } from './cartesian';
import { textStyle } from './cartesian';

export type LineLikeSpec = LineSpec | AreaSpec | ComboSpec;

export interface LineAreaInput {
  chartId: string;
  spec: LineLikeSpec;
  derived: GridDerived;
  proj: Projector;
  scale: LinearScale;
  theme: ChartTheme;
  measurer: TextMeasurer;
  /** Restrict to these series (combo draws its column members separately). */
  onlySeries?: Set<string>;
}

/**
 * Category centres for a line chart.
 *
 * Lines sit ON the category positions, not in the middle of a band: a
 * three-point line should touch both edges of the plot, not float inside it
 * with half a band of dead space at each end.
 */
export function lineCategoryCenters(count: number): number[] {
  const n = Math.max(1, count);
  return n === 1
    ? [0.5]
    : Array.from({ length: n }, (_, i) => i / (n - 1));
}

/** Area charts share the line's category positions. */
export const areaCategoryCenters = lineCategoryCenters;

const pointsOf = (
  derived: GridDerived,
  seriesKey: string,
  proj: Projector,
  centers: number[],
  useTop: boolean,
): (Point | null)[] =>
  derived.data
    .filter((d) => d.seriesKey === seriesKey)
    .sort((a, b) => a.pointIndex - b.pointIndex)
    .map((d) => {
      if (d.value === null) return null;
      const along = proj.category(centers[d.pointIndex] ?? 0);
      const across = proj.value(useTop ? d.top : d.base);
      return proj.horizontal ? { x: across, y: along } : { x: along, y: across };
    });

/**
 * Split on gaps. A `null` is a break in the line, not a dip to zero — joining
 * across it would draw a trend the data doesn't claim.
 */
function runs(points: (Point | null)[]): Point[][] {
  const out: Point[][] = [];
  let current: Point[] = [];
  for (const p of points) {
    if (p) current.push(p);
    else if (current.length) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

export function placeLineArea(input: LineAreaInput): Mark[] {
  const { chartId, spec, derived, proj, theme, measurer, onlySeries } = input;
  const marks: Mark[] = [];
  const centers = lineCategoryCenters(derived.categoryLabels.length);
  const smooth = spec.kind === 'line' ? (spec.smooth ?? false) : false;
  const isArea = spec.kind === 'area' || spec.kind === 'combo';
  const stacked = 'stack' in spec && spec.stack !== 'clustered';

  const series = derived.series.filter((s) => !onlySeries || onlySeries.has(s.key));

  // Areas paint first, and in reverse so an unstacked chart's later series
  // don't bury the earlier ones.
  if (isArea) {
    for (const s of [...series].reverse()) {
      const si = derived.series.indexOf(s);
      const color =
        s.format?.fill?.kind === 'solid' ? s.format.fill.color : theme.seriesColor(si);
      const tops = pointsOf(derived, s.key, proj, centers, true);

      for (const run of runs(tops)) {
        if (run.length < 2) continue;
        // Stacked areas close on the series below; unstacked ones close on the
        // baseline.
        const baseline = stacked
          ? run.map((_, i) => {
              const d = derived.data.find(
                (x) => x.seriesKey === s.key && x.pointIndex === i,
              );
              const across = proj.value(d?.base ?? 0);
              const along = proj.category(centers[i] ?? 0);
              return proj.horizontal ? { x: across, y: along } : { x: along, y: across };
            })
          : run.map((p) =>
              proj.horizontal
                ? { x: proj.baseline(), y: p.y }
                : { x: p.x, y: proj.baseline() },
            );

        const path = areaPath(run, [...baseline].reverse(), smooth);
        if (!path) continue;
        marks.push({
          kind: 'path',
          ref: { chartId, part: 'mark', series: s.key, point: 'area' },
          name: `${s.name} area`,
          rect: path.box,
          d: path.d,
          fill: { kind: 'solid', color, alpha: spec.kind === 'area' && !stacked ? 0.6 : 1 },
        });
      }
    }
  }

  // Then the lines and their markers, on top.
  for (const s of series) {
    const si = derived.series.indexOf(s);
    const mode = spec.kind === 'combo' ? (spec.render[s.key] ?? 'column') : spec.kind;
    if (spec.kind === 'combo' && mode !== 'line') continue;
    if (spec.kind === 'area') continue;

    const color =
      s.format?.outline?.color ??
      (s.format?.fill?.kind === 'solid' ? s.format.fill.color : theme.seriesColor(si));
    const width = s.format?.lineWidthEmu ?? pointsToEmu(2);
    const tops = pointsOf(derived, s.key, proj, centers, true);

    for (const run of runs(tops)) {
      const path = linePath(run, smooth);
      if (!path) continue;
      marks.push({
        kind: 'path',
        ref: { chartId, part: 'mark', series: s.key, point: 'line' },
        name: `${s.name} line`,
        rect: path.box,
        d: path.d,
        fill: { kind: 'none' },
        outline: { color, widthEmu: width, dash: s.format?.dash ?? 'solid' },
      });
    }

    const marker = s.format?.marker;
    if (marker && marker.shape !== 'none') {
      const size = marker.sizeEmu || pointsToEmu(5);
      tops.forEach((p, i) => {
        if (!p) return;
        const point = derived.data.find(
          (d) => d.seriesKey === s.key && d.pointIndex === i,
        );
        marks.push({
          kind: 'marker',
          ref: { chartId, part: 'mark', series: s.key, point: point?.pointKey ?? `p${i}` },
          shape: marker.shape,
          rect: { x: Math.round(p.x - size / 2), y: Math.round(p.y - size / 2), w: size, h: size },
          fill: marker.fill ?? { kind: 'solid', color },
          outline: marker.outline,
        });
      });
    }

    // think-cell's series labels at the end of each line, which beat a legend
    // for a chart with a handful of lines: no colour-matching required.
    if (spec.kind === 'line' && spec.endLabels) {
      const last = [...tops].reverse().find((p): p is Point => p !== null);
      if (last) {
        const style = textStyle({ ...theme.text.dataLabel, color }, 'left', 'middle');
        const w = measurer.measure(s.name, style).wEmu + pointsToEmu(2);
        const h = lineHeightEmu(style);
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'label', series: s.key, point: 'end' },
          text: s.name,
          style,
          rect: {
            x: Math.round(last.x + theme.sizes.labelGapEmu),
            y: Math.round(last.y - h / 2),
            w,
            h,
          },
        });
      }
    }
  }

  return marks;
}

/**
 * The column members of a combo chart, positioned on the same band scale a
 * pure column chart would use so the two placers agree.
 */
export function comboColumnBand(spec: ComboSpec, derived: GridDerived) {
  const columnKeys = derived.series
    .filter((s) => (spec.render[s.key] ?? 'column') === 'column')
    .map((s) => s.key);
  const stacked = spec.stack !== 'clustered';
  return {
    columnKeys,
    band: bandScale({
      count: derived.categoryLabels.length,
      seriesCount: stacked ? 1 : Math.max(1, columnKeys.length),
      gapWidthPct: spec.gapWidthPct,
      overlapPct: stacked ? 100 : spec.overlapPct,
    }),
  };
}

/** A hairline at the value baseline, for area charts that need one. */
export function baselineMark(chartId: string, proj: Projector, theme: ChartTheme): Mark {
  const at = proj.baseline();
  const { plot, horizontal } = proj;
  return {
    kind: 'line',
    ref: { chartId, part: 'axis', axis: horizontal ? 'y' : 'x', sub: 'line' },
    rect: horizontal
      ? rectFromEdges(at, plot.y, at, plot.y + plot.h)
      : rectFromEdges(plot.x, at, plot.x + plot.w, at),
    color: theme.axisLine,
    widthEmu: theme.sizes.axisWidthEmu,
    dash: 'solid',
  };
}
