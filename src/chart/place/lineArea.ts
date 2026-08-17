/**
 * Line, area and the line members of a combo chart.
 *
 * Areas are `path` elements rather than stacks of quadrilaterals: a per-interval
 * rectangle approach leaves visible seams between segments and can't follow a
 * smoothed curve at all.
 */
import type { AreaSpec, ColorRef, ComboSpec, DashStyle, EMU, LineSpec } from '@/model';
import { hex, pointsToEmu } from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import type { LinearScale } from '../scale/linear';
import { bandScale } from '../scale/band';
import type { ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { rectFromEdges } from '../mark';
import type { GridDerived } from '../derive/grid';
import { areaPath, linePath, type Point } from '../geom/path';
import { shadeOf } from '../color';
import { formatSet } from '../format/number';
import type { Projector } from './cartesian';
import { textStyle } from './cartesian';

export type LineLikeSpec = LineSpec | AreaSpec | ComboSpec;

/** How a combo chart draws a given series; unlisted series are columns. */
export const comboMode = (spec: ComboSpec, seriesKey: string): 'column' | 'line' | 'area' =>
  spec.render[seriesKey] ?? 'column';

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
  /**
   * The chart will be turned and its labels stood back up, so an end label's
   * gutter was cut for it lying on its side — see `uprightText` in `frame.ts`.
   * The box keeps the proportions the words need; only the footprint it is
   * positioned by trades sides.
   */
  uprightText?: boolean;
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
): (Point | null)[] => {
  const overrides = derived.series.find((s) => s.key === seriesKey)?.pointOverrides;
  return derived.data
    .filter((d) => d.seriesKey === seriesKey)
    .sort((a, b) => a.pointIndex - b.pointIndex)
    .map((d) => {
      // A hidden point is a GAP, the same as a null: the line has nothing to
      // say there. Hiding every point is how "delete this line" is written, and
      // it takes the run, the markers and the end label with it.
      if (d.value === null || overrides?.[d.pointKey]?.hidden) return null;
      const along = proj.category(centers[d.pointIndex] ?? 0);
      const across = proj.value(useTop ? d.top : d.base);
      return proj.horizontal ? { x: across, y: along } : { x: along, y: across };
    });
};

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

/* ------------------------------------------------------------------ */
/* The house line treatment                                           */
/* ------------------------------------------------------------------ */

/**
 * Which series is the subject of the chart.
 *
 * Unset emphasis means the first series — see `LineSpec.emphasis`. A key that
 * no longer exists (the series was deleted after someone picked it) degrades to
 * no emphasis rather than to a silently different line.
 */
export function emphasisSeriesKey(spec: LineLikeSpec, seriesKeys: string[]): string | null {
  if (spec.kind !== 'line' || spec.emphasis === null) return null;
  if (spec.emphasis !== undefined) {
    return seriesKeys.includes(spec.emphasis) ? spec.emphasis : null;
  }
  return seriesKeys[0] ?? null;
}

/** Emphasised lines are thick enough to read as the subject; the rest are hairlines. */
const EMPHASIS_WIDTH: EMU = pointsToEmu(2.75);
const RECEDED_WIDTH: EMU = pointsToEmu(1.25);
const PLAIN_WIDTH: EMU = pointsToEmu(2);

/**
 * A receded line needs to be tellable from its neighbours without competing
 * with the subject, so it varies in DASH first and in shade only after the
 * three dash patterns are used up. Dash is the cheaper signal: it survives
 * greyscale printing, and a field of near-identical greys does not.
 */
const RECEDED_DASHES: DashStyle[] = ['solid', 'dash', 'dot'];

export interface LineLook {
  color: ColorRef;
  widthEmu: EMU;
  dash: DashStyle;
  emphasized: boolean;
}

/**
 * How series `si` draws, before its own `format` overrides anything.
 *
 * `recedeIndex` counts only the receded series, so the dash cycle isn't skipped
 * where the emphasised one sits in the order.
 */
export function lineLook(
  theme: ChartTheme,
  si: number,
  emphasized: boolean,
  hasEmphasis: boolean,
  recedeIndex: number,
): LineLook {
  if (!hasEmphasis) {
    return { color: theme.seriesColor(si), widthEmu: PLAIN_WIDTH, dash: 'solid', emphasized: false };
  }
  if (emphasized) {
    return {
      color: theme.seriesColor(0),
      widthEmu: EMPHASIS_WIDTH,
      dash: 'solid',
      emphasized: true,
    };
  }
  const shade = Math.floor(recedeIndex / RECEDED_DASHES.length);
  return {
    color: shade === 0 ? theme.mutedInk : hex(shadeOf(theme.resolve(theme.mutedInk), shade)),
    widthEmu: RECEDED_WIDTH,
    dash: RECEDED_DASHES[recedeIndex % RECEDED_DASHES.length],
    emphasized: false,
  };
}

/** The last drawn value of a series, which is what its end label reports. */
const lastValue = (derived: GridDerived, seriesKey: string): number | null => {
  const points = derived.data
    .filter((d) => d.seriesKey === seriesKey)
    .sort((a, b) => a.pointIndex - b.pointIndex);
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value !== null) return points[i].top;
  }
  return null;
};

/**
 * The text of each end label, aligned with `derived.series`.
 *
 * Exported because the frame solver has to reserve the right-hand gutter for
 * these before any mark exists — and reserving for the NAME while the placer
 * draws "name · value" is how end labels used to run off the slide.
 */
export function endLabelTexts(spec: LineSpec, derived: GridDerived): string[] {
  const names = derived.series.map((s) => s.name);
  if (spec.endLabelValues === false) return names;

  const lasts = derived.series.map((s) => lastValue(derived, s.key));
  // Formatted as a SET, so the end labels agree on decimals and scale with each
  // other the way a column of tick labels does.
  const formatted = formatSet(
    lasts.map((v) => v ?? 0),
    spec.numberFormat,
  );
  return names.map((name, i) =>
    lasts[i] === null ? name : `${name} · ${formatted[i]?.text ?? ''}`,
  );
}

export function placeLineArea(input: LineAreaInput): Mark[] {
  const { chartId, spec, derived, proj, theme, measurer, onlySeries, uprightText } = input;
  const marks: Mark[] = [];
  const centers = lineCategoryCenters(derived.categoryLabels.length);
  const smooth = spec.kind === 'line' ? (spec.smooth ?? false) : false;
  // A combo's members are areas only where they were asked to be. Filling every
  // non-column member is what turns a combo's LINE into an area.
  const fillsArea = (seriesKey: string) =>
    spec.kind === 'area' || (spec.kind === 'combo' && comboMode(spec, seriesKey) === 'area');
  // Only an area chart's own stack applies here; a combo's stack is its
  // columns', and its area members run from the baseline.
  const stacked = spec.kind === 'area' && spec.stack !== 'clustered';

  const series = derived.series.filter((s) => !onlySeries || onlySeries.has(s.key));

  // Areas paint first, and in reverse so an unstacked chart's later series
  // don't bury the earlier ones.
  for (const s of [...series].reverse()) {
    if (!fillsArea(s.key)) continue;
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
        // Unstacked areas overlap — an opaque one hides the series behind it,
        // and a combo's area always has columns behind it.
        fill: { kind: 'solid', color, alpha: stacked ? 1 : 0.6 },
      });
    }
  }

  // The subject of the chart, and the running count of the lines that recede
  // behind it — see `lineLook`.
  const emphasisKey = emphasisSeriesKey(spec, derived.series.map((k) => k.key));
  const endLabels = spec.kind === 'line' ? endLabelTexts(spec, derived) : [];
  let recedeIndex = 0;

  // Then the lines and their markers, on top.
  for (const s of series) {
    const si = derived.series.indexOf(s);
    if (spec.kind === 'combo' && comboMode(spec, s.key) !== 'line') continue;
    if (spec.kind === 'area') continue;

    const look = lineLook(theme, si, s.key === emphasisKey, emphasisKey !== null, recedeIndex);
    if (emphasisKey !== null && !look.emphasized) recedeIndex++;

    const color =
      s.format?.outline?.color ??
      (s.format?.fill?.kind === 'solid' ? s.format.fill.color : look.color);
    const width = s.format?.lineWidthEmu ?? look.widthEmu;
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
        outline: { color, widthEmu: width, dash: s.format?.dash ?? look.dash },
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
    // for a chart with a handful of lines: no colour-matching required. The
    // emphasised line gets its label in the sans face and the value's weight,
    // so the reader's eye lands on the subject before the comparators.
    if (spec.kind === 'line' && spec.endLabels) {
      const last = [...tops].reverse().find((p): p is Point => p !== null);
      if (last) {
        const role = look.emphasized ? theme.text.endLabelEmphasis : theme.text.endLabel;
        // A per-series size beats the brand's. On a line chart the end label IS
        // the data label, so "make this series' numbers bigger" has to reach
        // here or the control writes to the spec and nothing moves.
        const sizePt = s.labels?.font?.sizePt ?? role.sizePt;
        const style = {
          ...textStyle({ ...role, sizePt, color }, 'left', 'middle'),
          wrap: false,
        };
        const text = endLabels[si] ?? s.name;
        // Padded generously. A measured width that's a hair under what the
        // renderer's real font metrics need wraps "Enterprise · 640" onto two
        // lines, and a wrapped end label reads as a bug rather than as a label.
        const w = measurer.measure(text, style).wEmu + pointsToEmu(5);
        const h = lineHeightEmu(style);
        // A dot on the last point ties the label to its line: the label sits a
        // gap away from the data, and on a crowded right-hand edge that gap is
        // enough to make the reader guess which line it belongs to.
        if (look.emphasized && !marker) {
          const size = pointsToEmu(6);
          marks.push({
            kind: 'marker',
            ref: { chartId, part: 'mark', series: s.key, point: 'end' },
            shape: 'circle',
            rect: {
              x: Math.round(last.x - size / 2),
              y: Math.round(last.y - size / 2),
              w: size,
              h: size,
            },
            fill: { kind: 'solid', color },
          });
        }
        // The gutter past the last point is as deep as the label's FOOTPRINT,
        // which is the label on its side once the chart is turned. Positioning
        // by the box instead would run a stood-up name clean off the chart.
        const fw = uprightText ? h : w;
        const cx = last.x + theme.sizes.labelGapEmu * 2 + fw / 2;
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'label', series: s.key, point: 'end' },
          text,
          style,
          rect: {
            x: Math.round(cx - w / 2),
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
 * The combo members that are NOT columns, and so are not part of the column
 * stack — `ComboSpec.stack` covers the columns only. A line stacked on top of
 * the columns it annotates plots a cumulative total nobody asked for.
 */
export function comboUnstackedKeys(spec: ComboSpec): Set<string> {
  return new Set(
    spec.data.series.filter((s) => comboMode(spec, s.key) !== 'column').map((s) => s.key),
  );
}

/**
 * The column members of a combo chart, positioned on the same band scale a
 * pure column chart would use so the two placers agree.
 */
export function comboColumnBand(spec: ComboSpec, derived: GridDerived) {
  const columnKeys = derived.series
    .filter((s) => comboMode(spec, s.key) === 'column')
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
