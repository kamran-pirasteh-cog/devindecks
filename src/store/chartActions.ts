'use client';

/**
 * Chart mutations, factored out of the store so `editorStore.ts` stays a list
 * of commands rather than a chart engine.
 *
 * Everything here takes a slide (an immer draft is fine — these return new
 * element arrays rather than splicing) and is otherwise pure, so the same
 * helpers serve the store, migration and any future headless caller.
 */
import { nanoid } from 'nanoid';
import {
  isGridSpec,
  isInsideLegend,
  isPointRef,
  isSankeySpec,
  isWaterfallSpec,
  type ChartInstance,
  type ChartRef,
  type ChartSpec,
  type DesignSystem,
  type EMU,
  type Fill,
  type LabelFont,
  type LabelSpec,
  type Outline,
  type PointOverride,
  type Rect,
  type Slide,
  type SlideElement,
  type TextRun,
} from '@/model';
import { compileChart } from '@/chart/compile';
import {
  detachChartElements,
  liftChartParts,
  reconcileChartElements,
  stripChartElements,
} from '@/chart/reconcile';
import { defaultMeasurer } from '@/render/measureText';

export const newChartId = () => `chart-${nanoid(8)}`;
export const newChartGroupId = () => `cg-${nanoid(8)}`;

/**
 * One measurer for the session. Building a canvas measurer per recompile would
 * throw away its width cache — the thing that makes typing in the datasheet
 * cheap.
 */
let sharedMeasurer: ReturnType<typeof defaultMeasurer> | null = null;
const measurer = () => (sharedMeasurer ??= defaultMeasurer());

export const chartById = (slide: Slide, chartId: string): ChartInstance | undefined =>
  slide.charts?.find((c) => c.id === chartId);

/** The chart an element belongs to, if any. */
export function chartOfElement(slide: Slide, elementId: string): ChartInstance | undefined {
  const el = slide.elements.find((e) => e.id === elementId);
  const chartId = el?.chartRef?.chartId;
  return chartId ? chartById(slide, chartId) : undefined;
}

/** Every chart touched by a set of element ids. */
export function chartsForElements(slide: Slide, ids: string[]): ChartInstance[] {
  const wanted = new Set(ids);
  const chartIds = new Set<string>();
  for (const el of slide.elements) {
    if (wanted.has(el.id) && el.chartRef) chartIds.add(el.chartRef.chartId);
  }
  return (slide.charts ?? []).filter((c) => chartIds.has(c.id));
}

/* ------------------------------------------------------------------ */
/* Recompile                                                          */
/* ------------------------------------------------------------------ */

/** Recompile one chart and splice it back in, leaving everything else alone. */
export function recompileInto(slide: Slide, chartId: string, ds: DesignSystem): void {
  const chart = chartById(slide, chartId);
  if (!chart) return;
  // The draft is a proxy; compile against a plain snapshot so nothing in the
  // engine can accidentally hold a revoked reference after the mutation ends.
  const snapshot: ChartInstance = JSON.parse(JSON.stringify(chart));
  const { elements } = compileChart(snapshot, ds, measurer());
  slide.elements = reconcileChartElements(slide.elements, chartId, elements);
  // A legend that has just moved inside the plot has to come up with it: it
  // kept the z-slot it held out in a gutter, and down there it paints under the
  // bars it names. See `liftChartParts`.
  if (snapshot.spec.legend.show && isInsideLegend(snapshot.spec.legend.position)) {
    slide.elements = liftChartParts(
      slide.elements,
      chartId,
      elements.filter((e) => e.role === 'chart.legend').map((e) => e.id),
    );
  }
}

/**
 * The box the legend would occupy at a given position, without moving it.
 *
 * The drop indicator has to promise something true: a legend snapped inside the
 * plot lands in a box the size of its own entries, tucked into a corner of the
 * chart BODY — nowhere near the corner of the chart's frame, which is what a
 * zone drawn from the frame would suggest. Rather than reimplement that
 * arithmetic in the canvas and watch the two drift, this asks the compiler.
 *
 * One compile per position, once, when the drag starts — the same cost as any
 * other recompile, and it buys an indicator that cannot lie.
 */
export function legendBoxAt(
  chart: ChartInstance,
  ds: DesignSystem,
  position: ChartSpec['legend']['position'],
): Rect | undefined {
  const snapshot: ChartInstance = JSON.parse(JSON.stringify(chart));
  snapshot.spec.legend = { ...snapshot.spec.legend, show: true, position };
  const { elements } = compileChart(snapshot, ds, measurer());
  return elements.find((e) => e.chartRef?.part === 'legend.box')?.rect;
}

/** Every element id a chart currently owns, in z-order. */
export const chartElementIds = (slide: Slide, chartId: string): string[] =>
  slide.elements.filter((e) => e.chartRef?.chartId === chartId).map((e) => e.id);

/** Snapshot of which ids each chart owned, to repair a selection against. */
export function chartElementIdsBefore(slide: Slide, chartIds: string[]): Map<string, string[]> {
  return new Map(chartIds.map((id) => [id, chartElementIds(slide, id)]));
}

/**
 * Repair a selection after a recompile changed which elements exist.
 *
 * A chart's ids are deterministic but its element SET is not: a relayout adds a
 * tick, drops a suppressed label, splits a wrapped title. Whole-chart selection
 * is "every id of this chart" (see `insertChart`), so any recompile under a
 * live selection left it holding ids that no longer exist and — because the
 * count no longer matched — no longer reading as the whole chart. The canvas
 * then treated it as a drill-in of whatever parts survived, which is how
 * resizing a chart could leave the control box collapsed onto a lone axis rule.
 *
 * So: a selection that was the whole chart stays the whole chart, and a drilled
 * selection keeps the parts that are still there, falling back to the whole
 * chart if every one of them went away.
 */
export function repairChartSelection(
  slide: Slide,
  before: Map<string, string[]>,
  selectedIds: string[],
): string[] {
  let out = selectedIds;
  for (const [chartId, beforeIds] of before) {
    const was = new Set(beforeIds);
    const mine = out.filter((id) => was.has(id));
    if (!mine.length) continue;

    const after = chartElementIds(slide, chartId);
    const alive = new Set(after);
    const whole = mine.length === beforeIds.length;
    const next = whole ? after : mine.filter((id) => alive.has(id));
    const replacement = next.length ? next : after;

    // Splice in place, so the chart's parts keep their position in the
    // selection rather than being shuffled to the end.
    const rebuilt: string[] = [];
    let done = false;
    for (const id of out) {
      if (!was.has(id)) {
        rebuilt.push(id);
      } else if (!done) {
        rebuilt.push(...replacement);
        done = true;
      }
    }
    out = rebuilt;
  }
  return out;
}

export function insertChartInto(
  slide: Slide,
  spec: ChartSpec,
  frame: Rect,
  ds: DesignSystem,
): ChartInstance {
  const chart: ChartInstance = {
    id: newChartId(),
    groupId: newChartGroupId(),
    frame,
    spec,
  };
  slide.charts = [...(slide.charts ?? []), chart];
  recompileInto(slide, chart.id, ds);
  return chart;
}

export function removeChartFrom(slide: Slide, chartId: string): void {
  slide.elements = stripChartElements(slide.elements, chartId);
  slide.charts = (slide.charts ?? []).filter((c) => c.id !== chartId);
}

/** Keep the primitives, drop the spec. One-way — see `reconcile.ts`. */
export function detachChartFrom(slide: Slide, chartId: string): void {
  slide.elements = detachChartElements(slide.elements, chartId);
  slide.charts = (slide.charts ?? []).filter((c) => c.id !== chartId);
}

/* ------------------------------------------------------------------ */
/* Deleting a part                                                    */
/* ------------------------------------------------------------------ */

export interface ChartPartDeletion {
  /**
   * Element ids this took ownership of. The caller must NOT delete them —
   * either their chart is already gone, or the part was hidden in the spec and
   * the recompile has removed whatever elements it used to emit.
   */
  handled: Set<string>;
  /** Charts removed outright. */
  removed: string[];
}

/**
 * Delete, addressed at a chart PART.
 *
 * Delete used to mean "remove the whole chart" no matter which of its thirty
 * primitives was selected, on the reasoning that a chart missing its axis is a
 * chart that grows the axis back on the next recompile. That reasoning is right
 * about the ELEMENT and wrong about the gesture: pressing Delete on a legend
 * means "I don't want a legend", which the spec can say (`legend.show = false`)
 * and a recompile therefore honours. So the part is hidden in the spec, exactly
 * as the popover's own Visible/Show toggles do it, and only a whole-chart
 * selection — or the plot backdrop, which IS the chart — deletes the chart.
 *
 * A part with nothing to hide (a bar on a waterfall, which keeps no override
 * map) is left alone rather than escalating to deleting the chart: a Delete
 * that does nothing is recoverable, and one that eats the chart isn't.
 */
export function deleteChartParts(
  slide: Slide,
  ids: string[],
  ds: DesignSystem,
): ChartPartDeletion {
  const wanted = new Set(ids);
  const handled = new Set<string>();
  const removed: string[] = [];

  for (const chart of chartsForElements(slide, ids)) {
    const owned = chartElementIds(slide, chart.id);
    const mine = owned.filter((id) => wanted.has(id));
    const refs = slide.elements
      .filter((el) => wanted.has(el.id) && el.chartRef?.chartId === chart.id)
      .map((el) => el.chartRef!);

    const whole = mine.length === owned.length || refs.some((r) => r.part === 'plot');
    if (whole) {
      removeChartFrom(slide, chart.id);
      removed.push(chart.id);
      for (const id of mine) handled.add(id);
      continue;
    }

    if (!hideChartParts(chart.spec, refs)) continue;
    for (const id of mine) handled.add(id);
    recompileInto(slide, chart.id, ds);
  }

  return { handled, removed };
}

/** Write "don't draw this" for each selected part. Returns true if anything changed. */
function hideChartParts(spec: ChartSpec, refs: ChartRef[]): boolean {
  let wrote = false;

  for (const ref of refs) {
    switch (ref.part) {
      case 'title':
        if (spec.title !== undefined) {
          spec.title = undefined;
          wrote = true;
        }
        break;

      // Either half of a legend entry, or the box itself, means the legend.
      // There is no spec for "this series but not that one in the key", and a
      // legend with a hole in it isn't what anyone is asking for anyway.
      case 'legend.box':
      case 'legend.item':
        if (spec.legend.show) {
          spec.legend.show = false;
          wrote = true;
        }
        break;

      case 'total':
        if (spec.decorations.totals?.show) {
          // show:false rather than undefined, so the font and format survive
          // being switched back on.
          spec.decorations.totals = { ...spec.decorations.totals, show: false };
          wrote = true;
        }
        break;

      case 'axis':
        if (hideAxisPart(spec, ref)) wrote = true;
        break;

      case 'decoration':
        if (removeDecoration(spec, ref.decoId)) wrote = true;
        break;

      // 'plot' never reaches here — the caller reads it as the whole chart.
      // 'mark' and 'label' are grouped by series below.
      default:
        break;
    }
  }

  return hidePointParts(spec, refs) || wrote;
}

/** The axis furniture: its rule and ticks, its title, its unit note, its grid. */
function hideAxisPart(spec: ChartSpec, ref: Extract<ChartRef, { part: 'axis' }>): boolean {
  if (ref.sub === 'grid') {
    const major = spec.decorations.gridlines.major;
    if (!major?.show) return false;
    spec.decorations.gridlines.major = { ...major, show: false };
    return true;
  }

  const axis = spec.axes[ref.axis];
  if (!axis) return false;

  if (ref.sub === 'title') {
    if (axis.title === undefined) return false;
    axis.title = undefined;
    return true;
  }
  if (ref.sub === 'unitNote') {
    if (axis.unitNote === undefined) return false;
    axis.unitNote = undefined;
    return true;
  }
  // The rule and its ticks are one thing to the spec: an axis you can't read
  // the numbers off isn't an axis.
  if (!axis.show) return false;
  axis.show = false;
  return true;
}

/** A decoration is deleted, not hidden — it exists only because someone added it. */
function removeDecoration(spec: ChartSpec, decoId: string): boolean {
  const d = spec.decorations;
  const before =
    d.cagr.length +
    d.differences.length +
    d.trendLines.length +
    d.referenceLines.length +
    d.annotations.length;

  d.cagr = d.cagr.filter((x) => x.id !== decoId);
  d.differences = d.differences.filter((x) => x.id !== decoId);
  d.trendLines = d.trendLines.filter((x) => x.id !== decoId);
  d.referenceLines = d.referenceLines.filter((x) => x.id !== decoId);
  d.annotations = d.annotations.filter((x) => x.id !== decoId);

  return (
    before !==
    d.cagr.length +
      d.differences.length +
      d.trendLines.length +
      d.referenceLines.length +
      d.annotations.length
  );
}

/**
 * Marks and data labels, scoped the way `applyChartFormat` scopes colour: a
 * selection covering every point of a series is about the SERIES, so the label
 * is switched off there and a category added later stays off too. Anything
 * narrower is a per-point override.
 *
 * A mark is always per-point (`hidden`) — there is no series-level "don't draw
 * this", and inventing one would mean teaching every placer about it.
 */
function hidePointParts(spec: ChartSpec, refs: ChartRef[]): boolean {
  const points = refs.filter(isPointRef);
  if (!points.length) return false;

  const series = seriesOf(spec);
  if (!series.length) {
    // A waterfall or a sankey has no series to hang an override on; the only
    // node narrower than the chart is nothing, so a label falls back to the
    // chart-wide one and a bar can't be hidden at all.
    if (!points.some((r) => r.part === 'label')) return false;
    if (!spec.decorations.labels.show) return false;
    spec.decorations.labels.show = false;
    return true;
  }

  const bySeries = new Map<string, { marks: Set<string>; labels: Set<string> }>();
  for (const ref of points) {
    const sel = bySeries.get(ref.series) ?? { marks: new Set(), labels: new Set() };
    (ref.part === 'mark' ? sel.marks : sel.labels).add(ref.point);
    bySeries.set(ref.series, sel);
  }

  let wrote = false;
  for (const [key, sel] of bySeries) {
    const s = series.find((x) => x.key === key);
    if (!s) continue;
    const all = pointKeysOf(spec, key);

    if (sel.labels.size) {
      const whole = all.length > 0 && all.every((k) => sel.labels.has(k));
      if (whole) {
        const base = s.labels ?? spec.decorations.labels;
        s.labels = { ...base, show: false };
        // A per-point label would now shadow the series switch just thrown.
        for (const k of Object.keys(s.pointOverrides ?? {})) {
          delete s.pointOverrides![k]!.label;
        }
      } else {
        s.pointOverrides ??= {};
        for (const k of sel.labels) {
          const prior = s.pointOverrides[k] ?? {};
          const base = prior.label ?? s.labels ?? spec.decorations.labels;
          s.pointOverrides[k] = { ...prior, label: { ...base, show: false } };
        }
      }
      wrote = true;
    }

    if (sel.marks.size) {
      // A line and an area are ONE mark for the whole series, so their refs
      // carry a synthetic point ('line', 'area') that no override map has a
      // slot for. Clicking one means the series, so it expands to every point
      // — which is also what makes the line vanish: an all-gap series draws no
      // run, no marker and no end label.
      const real = [...sel.marks].filter((k) => all.includes(k));
      const keys = real.length ? real : all;
      s.pointOverrides ??= {};
      for (const k of keys) {
        s.pointOverrides[k] = { ...(s.pointOverrides[k] ?? {}), hidden: true };
      }
      wrote = keys.length > 0 || wrote;
    }
  }

  return wrote;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                           */
/* ------------------------------------------------------------------ */

const unionOf = (rects: Rect[]): Rect | null => {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((v) => v.x + v.w));
  const b = Math.max(...rects.map((v) => v.y + v.h));
  return { x, y, w: r - x, h: b - y };
};

export const chartElementRects = (slide: Slide, chartId: string): Rect[] =>
  slide.elements.filter((e) => e.chartRef?.chartId === chartId).map((e) => ({ ...e.rect }));

/** EMU tolerance for "did this actually change size, or just move?" */
const SIZE_EPSILON = 2;

/**
 * The smallest frame a chart can be inferred into — a quarter inch.
 *
 * A backstop, not a design: the frame here is DERIVED from what happened to the
 * elements, so a canvas gesture that reports a degenerate box (Moveable does
 * exactly this on the vertical axis for a group holding a chart) would
 * otherwise write a frame of nearly nothing, and a chart flattened to a strip
 * has no way back — every later gesture scales the flattened frame. Clamping
 * costs a resize its last few percent at sizes no one works at, and takes the
 * unrecoverable failure off the table.
 */
const MIN_FRAME: EMU = 228600;

/**
 * Follow a geometry change that was applied to a chart's elements directly.
 *
 * A drag translates the frame and needs no recompile — the elements are already
 * where they belong, and relaying out would only reshuffle labels for no
 * reason. A resize has to relayout: text can't be scaled affinely (10pt must
 * stay 10pt, and a taller plot wants a different number of gridlines), so the
 * frame is transformed by the same affine the elements got and the chart is
 * recompiled into it.
 */
export function syncChartGeometry(
  slide: Slide,
  chartId: string,
  before: Rect[],
  ds: DesignSystem,
): void {
  const chart = chartById(slide, chartId);
  if (!chart) return;

  const oldUnion = unionOf(before);
  const newUnion = unionOf(chartElementRects(slide, chartId));
  if (!oldUnion || !newUnion) return;

  const moved =
    Math.abs(oldUnion.w - newUnion.w) <= SIZE_EPSILON &&
    Math.abs(oldUnion.h - newUnion.h) <= SIZE_EPSILON;

  if (moved) {
    chart.frame = {
      ...chart.frame,
      x: chart.frame.x + (newUnion.x - oldUnion.x),
      y: chart.frame.y + (newUnion.y - oldUnion.y),
    };
    return;
  }

  if (chart.frozen) return;

  const sx = oldUnion.w ? newUnion.w / oldUnion.w : 1;
  const sy = oldUnion.h ? newUnion.h / oldUnion.h : 1;
  chart.frame = {
    x: Math.round(newUnion.x + (chart.frame.x - oldUnion.x) * sx),
    y: Math.round(newUnion.y + (chart.frame.y - oldUnion.y) * sy),
    w: Math.max(MIN_FRAME, Math.round(chart.frame.w * sx)),
    h: Math.max(MIN_FRAME, Math.round(chart.frame.h * sy)),
  };
  recompileInto(slide, chartId, ds);
}

/** Translate a chart's frame without recompiling — the keyboard-nudge path. */
export function translateChartFrames(slide: Slide, ids: string[], dx: number, dy: number): void {
  for (const chart of chartsForElements(slide, ids)) {
    chart.frame = { ...chart.frame, x: chart.frame.x + dx, y: chart.frame.y + dy };
  }
}

/**
 * Resize a chart's frame by a known delta — the ⇧ + arrow path.
 *
 * Deliberately NOT `syncChartGeometry`. That one infers the frame from what
 * happened to the elements, which is the only option after a Moveable drag but
 * is wrong here in three compounding ways: a keyboard resize inflates every one
 * of the chart's thirty-odd elements by the same ABSOLUTE step rather than
 * scaling them, the union it would measure includes labels that overflow the
 * frame, and each recompile changes which elements exist at all (a tick more, a
 * suppressed label fewer) so the next press measures a union that moved for
 * reasons having nothing to do with the resize. The compounding error is what
 * makes the chart appear to jump around instead of growing by a step.
 *
 * Here the delta is known exactly, so the frame takes it directly and the chart
 * is laid out into it. Idempotent, and one press is always one step.
 */
export function resizeChartFrames(
  slide: Slide,
  ids: string[],
  dw: EMU,
  dh: EMU,
  ds: DesignSystem,
  minSize: EMU,
): void {
  for (const chart of chartsForElements(slide, ids)) {
    // A frozen chart keeps the geometry someone deliberately pinned.
    if (chart.frozen) continue;
    chart.frame = {
      ...chart.frame,
      w: Math.max(minSize, chart.frame.w + dw),
      h: Math.max(minSize, chart.frame.h + dh),
    };
    recompileInto(slide, chart.id, ds);
  }
}

/* ------------------------------------------------------------------ */
/* Formatting routed into the spec                                    */
/* ------------------------------------------------------------------ */

interface SeriesLike {
  key: string;
  format?: { fill?: Fill; outline?: Outline };
  labels?: LabelSpec;
  pointOverrides?: Record<string, PointOverride>;
}

/** The series array a spec keeps its formatting on, whatever its data shape. */
function seriesOf(spec: ChartSpec): SeriesLike[] {
  if (isGridSpec(spec)) return spec.data.series;
  if (isWaterfallSpec(spec)) return [];
  if (spec.kind === 'scatter' || spec.kind === 'bubble') return spec.data.series;
  if (spec.kind === 'butterfly') return [...spec.left, ...spec.right];
  return [];
}

/** Every point key a series can address, for the "is the whole series selected?" test. */
function pointKeysOf(spec: ChartSpec, seriesKey: string): string[] {
  if (isGridSpec(spec)) return spec.data.categories.map((c) => c.key);
  if (spec.kind === 'scatter' || spec.kind === 'bubble') {
    return spec.data.series.find((s) => s.key === seriesKey)?.points.map((p) => p.key) ?? [];
  }
  if (spec.kind === 'butterfly') return spec.categories.map((c) => c.key);
  return [];
}

/* ------------------------------------------------------------------ */
/* Where a data-label edit belongs                                    */
/* ------------------------------------------------------------------ */

/**
 * The node a label edit is written to, resolved from what the user selected.
 *
 * One answer shared by the panel and the keyboard, because a readout and a write
 * that disagree about scope is how "the control does nothing" happens: the panel
 * would show the chart's size while the write landed on a point, or the other way
 * round. `labelSpecAt` reads it and `patchLabelAt` writes it, so there is exactly
 * one place that knows the rules.
 *
 * - `point` — the narrowest node, and the usual one: a `PointOverride` on the
 *   series. What a single data label selected on the canvas becomes.
 * - `series` — every point of the series selected, so the SERIES changed and a
 *   category added later comes back styled to match.
 * - `item` — a waterfall, which has items instead of series and so keeps a
 *   label's settings on `WaterfallItem.labels`.
 * - `chart` — a shape with nothing narrower than itself (a sankey).
 */
export type LabelHome =
  | { scope: 'chart' }
  | { scope: 'series'; seriesKey: string }
  | { scope: 'point'; seriesKey: string; points: string[] }
  | { scope: 'item'; items: string[] };

/**
 * Which node owns the labels of these marks/labels, or null when the selection
 * spans several series and so has no single answer.
 *
 * A point key the series doesn't have — a line chart's `end` label, whose only
 * home is the series — resolves to `series` rather than to an override no placer
 * would ever read.
 */
export function labelHomeFor(spec: ChartSpec, refs: ChartRef[]): LabelHome | null {
  const points = refs.filter(isPointRef);
  if (!points.length) return null;

  if (isWaterfallSpec(spec)) {
    const keys = new Set(spec.data.items.map((i) => i.key));
    const items = [...new Set(points.map((r) => r.point))].filter((k) => keys.has(k));
    return items.length ? { scope: 'item', items } : { scope: 'chart' };
  }

  const seriesKeys = [...new Set(points.map((r) => r.series))];
  if (seriesKeys.length !== 1) return null;
  const seriesKey = seriesKeys[0]!;
  if (!seriesOf(spec).some((s) => s.key === seriesKey)) return { scope: 'chart' };

  const all = pointKeysOf(spec, seriesKey);
  const selected = [...new Set(points.map((r) => r.point))].filter((k) => all.includes(k));
  if (!selected.length) return { scope: 'series', seriesKey };
  if (all.length > 0 && all.every((k) => selected.includes(k))) {
    return { scope: 'series', seriesKey };
  }
  return { scope: 'point', seriesKey, points: selected };
}

/** The chart-wide default a narrower node falls through to. */
const labelBase = (spec: ChartSpec, seriesKey?: string): LabelSpec => {
  const series = seriesKey ? seriesOf(spec).find((s) => s.key === seriesKey) : undefined;
  return series?.labels ?? spec.decorations.labels;
};

/**
 * The label settings in force at a home, for a panel's readout.
 *
 * Resolved over the WHOLE selection rather than its first member: select three
 * bars, turn labels on, and the override lands on all three — reading only one
 * would leave the toggle showing "off" for labels that are visibly on. A
 * selection whose members disagree has no single answer, so it falls back to the
 * node above.
 */
export function labelSpecAt(spec: ChartSpec, home: LabelHome): LabelSpec {
  switch (home.scope) {
    case 'chart':
      return spec.decorations.labels;
    case 'series':
      return labelBase(spec, home.seriesKey);
    case 'point': {
      const series = seriesOf(spec).find((s) => s.key === home.seriesKey);
      const each = home.points.map((k) => series?.pointOverrides?.[k]?.label);
      const first = each[0];
      if (!first || !each.every((l) => l?.show === first.show)) {
        return labelBase(spec, home.seriesKey);
      }
      return first;
    }
    case 'item': {
      const each = home.items.map(
        (k) => (isWaterfallSpec(spec) ? spec.data.items.find((i) => i.key === k)?.labels : undefined),
      );
      const first = each[0];
      if (!first || !each.every((l) => l?.show === first.show)) return spec.decorations.labels;
      return first;
    }
  }
}

/**
 * Write a label patch to its home, seeded from the node above.
 *
 * Seeded rather than written sparse because `LabelSpec` is required-field and the
 * placers resolve it by spreading — see `labelSpecFor`. Writing to a series also
 * drops the per-point labels underneath it, which would otherwise shadow the
 * change the user just made to all of them.
 *
 * Returns true when something was written, so a caller can skip the undo step
 * for a selection with no spec home.
 */
export function patchLabelAt(
  spec: ChartSpec,
  home: LabelHome,
  patch: Partial<LabelSpec>,
): boolean {
  switch (home.scope) {
    case 'chart':
      spec.decorations.labels = { ...spec.decorations.labels, ...patch };
      return true;
    case 'series': {
      const series = seriesOf(spec).find((s) => s.key === home.seriesKey);
      if (!series) return false;
      series.labels = { ...labelBase(spec, home.seriesKey), ...patch };
      for (const key of Object.keys(series.pointOverrides ?? {})) {
        delete series.pointOverrides![key]!.label;
      }
      return true;
    }
    case 'point': {
      const series = seriesOf(spec).find((s) => s.key === home.seriesKey);
      if (!series) return false;
      series.pointOverrides ??= {};
      for (const key of home.points) {
        const prior = series.pointOverrides[key] ?? {};
        series.pointOverrides[key] = {
          ...prior,
          label: { ...(prior.label ?? labelBase(spec, home.seriesKey)), ...patch },
        };
      }
      return true;
    }
    case 'item': {
      if (!isWaterfallSpec(spec)) return false;
      let wrote = false;
      for (const key of home.items) {
        const item = spec.data.items.find((i) => i.key === key);
        if (!item) continue;
        item.labels = { ...(item.labels ?? spec.decorations.labels), ...patch };
        wrote = true;
      }
      return wrote;
    }
  }
}

export interface ChartFormatPatch {
  fill?: Fill;
  outline?: Outline | undefined;
}

/**
 * Apply a fill/outline change to a chart, addressed by the marks the user had
 * selected.
 *
 * The rule that makes this feel right: if every point of a series is selected,
 * the SERIES is what changed — write it there, so adding a category later
 * inherits the color. Only a partial selection writes per-point overrides.
 * Without this, recoloring a whole chart would litter the spec with an
 * override per bar and the next data edit would look broken.
 *
 * Returns true when something was written, so the caller knows whether to fall
 * through to the ordinary element path.
 */
export function applyChartFormat(
  slide: Slide,
  selectedIds: string[],
  patch: ChartFormatPatch,
): boolean {
  const refs = markRefsIn(slide, selectedIds);
  if (!refs.length) return false;

  let wrote = false;
  for (const chart of slide.charts ?? []) {
    const mine = refs.filter((r) => r.chartId === chart.id);
    if (!mine.length) continue;

    // A waterfall has no series — every bar is an item, and its format lives on
    // the item. `seriesOf` returns nothing for one, so without this branch the
    // loop below has nothing to write to and recoloring a waterfall bar is
    // silently dropped.
    if (isWaterfallSpec(chart.spec)) {
      const wanted = new Set(mine.map((r) => r.point));
      for (const item of chart.spec.data.items) {
        if (!wanted.has(item.key)) continue;
        item.format = { ...item.format, ...definedOnly(patch) };
        wrote = true;
      }
      continue;
    }

    const bySeries = new Map<string, Set<string>>();
    for (const r of mine) {
      const set = bySeries.get(r.series) ?? new Set<string>();
      set.add(r.point);
      bySeries.set(r.series, set);
    }

    for (const [seriesKey, points] of bySeries) {
      const series = seriesOf(chart.spec).find((s) => s.key === seriesKey);
      if (!series) continue;
      const all = pointKeysOf(chart.spec, seriesKey);
      const whole = all.length > 0 && all.every((k) => points.has(k));

      if (whole) {
        series.format = { ...series.format, ...definedOnly(patch) };
        // Per-point fills would now shadow the series color the user just set.
        if (patch.fill && series.pointOverrides) {
          for (const key of Object.keys(series.pointOverrides)) {
            const p = series.pointOverrides[key];
            if (p.format?.fill) delete p.format.fill;
          }
        }
      } else {
        series.pointOverrides ??= {};
        for (const key of points) {
          const existing = series.pointOverrides[key] ?? {};
          series.pointOverrides[key] = {
            ...existing,
            format: { ...existing.format, ...definedOnly(patch) },
          };
        }
      }
      wrote = true;
    }
  }
  return wrote;
}

/**
 * Recolour everything one legend key stands for.
 *
 * A legend key is the only place in a chart where "the whole series" is a single
 * click, so the swatch is where recolouring a series belongs — and it has to
 * write to the SERIES, not to the entry's own rect: the entry takes its colour
 * from the series on every recompile, so a fill on the swatch would be gone the
 * moment anything else moved.
 *
 * Which node that is depends on what the legend is listing. A pie's legend lists
 * SLICES (see `compileChart`), so the key is a point of the only series and the
 * colour belongs to that point's override; a waterfall's is an item. Everywhere
 * else the key is a series key.
 *
 * An undefined `fill` is "back to the palette's colour", which is a deletion —
 * the compiler falls back to `theme.seriesColor` for anything with no fill of its
 * own, so there is nothing to write.
 *
 * Returns true when something was written, so a legend that lists something with
 * no spec home doesn't cost an undo step.
 */
export function recolorLegendEntry(
  spec: ChartSpec,
  entryKey: string,
  fill: Fill | undefined,
): boolean {
  const series = seriesOf(spec).find((s) => s.key === entryKey);
  if (series) {
    series.format = { ...series.format, fill };
    // A line takes its colour from the outline when it has one; leaving the old
    // colour there would repaint the dots and leave the line as it was.
    if (series.format.outline && fill?.kind === 'solid') {
      series.format.outline = { ...series.format.outline, color: fill.color };
    }
    // Per-point fills would now shadow the series colour just set — the same
    // rule `applyChartFormat` follows when a whole series is selected.
    for (const key of Object.keys(series.pointOverrides ?? {})) {
      const p = series.pointOverrides![key]!;
      if (p.format?.fill) delete p.format.fill;
    }
    return true;
  }

  if (isWaterfallSpec(spec)) {
    const item = spec.data.items.find((i) => i.key === entryKey);
    if (!item) return false;
    item.format = { ...item.format, fill };
    return true;
  }

  const owner = seriesOf(spec).find((s) => pointKeysOf(spec, s.key).includes(entryKey));
  if (!owner) return false;
  owner.pointOverrides ??= {};
  const existing = owner.pointOverrides[entryKey] ?? {};
  owner.pointOverrides[entryKey] = {
    ...existing,
    format: { ...existing.format, fill },
  };
  return true;
}

/**
 * Whether a legend key has a spec node to recolour, and the colour it holds now.
 *
 * Two answers from one lookup, because the panel needs both: `null` means the
 * key addresses nothing writable, so no swatch row is offered at all rather than
 * one whose clicks cost an undo step and change nothing. A `fill` of undefined
 * means the entry is on the palette's colour — nothing is selected in the row,
 * rather than a ring around a colour nobody chose.
 */
export function legendEntryColor(spec: ChartSpec, entryKey: string): { fill?: Fill } | null {
  const series = seriesOf(spec).find((s) => s.key === entryKey);
  if (series) return { fill: series.format?.fill };
  if (isWaterfallSpec(spec)) {
    const item = spec.data.items.find((i) => i.key === entryKey);
    return item ? { fill: item.format?.fill } : null;
  }
  const owner = seriesOf(spec).find((s) => pointKeysOf(spec, s.key).includes(entryKey));
  return owner ? { fill: owner.pointOverrides?.[entryKey]?.format?.fill } : null;
}

/**
 * The chart-spec half of a text-run patch.
 *
 * A run carries more than a chart knows how to keep — italic, underline, a
 * numeric weight — and there is nowhere in the spec to put those. Anything
 * unmappable comes back as `null` so the caller does nothing at all, rather
 * than writing a style onto the emitted element that the next recompile eats.
 */
export function chartFontFromRun(patch: Partial<TextRun>): LabelFont | null {
  const font: LabelFont = {};
  if (patch.sizePt !== undefined) font.sizePt = patch.sizePt;
  if (patch.bold !== undefined) font.bold = patch.bold;
  if (patch.color !== undefined) font.color = patch.color;
  if (patch.font !== undefined) font.font = patch.font;
  return Object.keys(font).length ? font : null;
}

/** The size a compiled part is actually drawn at, to step a font size from. */
export function runSizeOf(el: SlideElement): number | undefined {
  const body = el.type === 'text' ? el.body : el.type === 'shape' ? el.body : undefined;
  return body?.paragraphs[0]?.runs[0]?.sizePt;
}

/**
 * Apply a type change on chart PARTS by writing it to the spec.
 *
 * The same rule `applyChartFormat` follows for colour, and for the same reason:
 * a size set on the emitted text box survives exactly until the next recompile,
 * and a recompile is not a rare event — dragging the chart's handle is one, so
 * is toggling a legend. That is what made a bumped label look like it had been
 * "reset to a smaller font" by an unrelated edit; the edit was never anywhere
 * the chart could keep it.
 *
 * `fontFor` is per element so ⌘⇧> can step each part from its own size.
 * Returns the ids this took ownership of — every chart part in the selection,
 * including the ones with no spec home (a bar has no type) — so the caller
 * leaves them alone instead of writing formatting that cannot last.
 */
export function applyChartTextFormat(
  slide: Slide,
  ids: string[],
  ds: DesignSystem,
  fontFor: (el: SlideElement) => LabelFont | null,
): string[] {
  const wanted = new Set(ids);
  const parts = slide.elements.filter((el) => wanted.has(el.id) && el.chartRef);
  if (!parts.length) return [];

  for (const chart of slide.charts ?? []) {
    const mine = parts.filter((el) => el.chartRef!.chartId === chart.id);
    if (!mine.length) continue;
    const fonts = new Map<ChartRef, LabelFont>();
    for (const el of mine) {
      const font = fontFor(el);
      if (font) fonts.set(el.chartRef!, font);
    }
    if (fonts.size && writeChartFont(chart.spec, fonts)) recompileInto(slide, chart.id, ds);
  }
  return parts.map((el) => el.id);
}

const mergeFont = (prev: LabelFont | undefined, next: LabelFont): LabelFont => ({
  ...prev,
  ...next,
});

/** Route each part's type change to the spec node that owns that part's text. */
function writeChartFont(spec: ChartSpec, fonts: Map<ChartRef, LabelFont>): boolean {
  let wrote = false;

  for (const [ref, font] of fonts) {
    switch (ref.part) {
      case 'title':
        spec.titleFont = mergeFont(spec.titleFont, font);
        wrote = true;
        break;
      case 'legend.item':
      case 'legend.box':
        spec.legend.font = mergeFont(spec.legend.font, font);
        wrote = true;
        break;
      case 'axis': {
        // One node per axis: the ticks, the axis title and the unit note are
        // all "this axis's labels" as far as the spec is concerned.
        const axis = spec.axes[ref.axis];
        if (!axis) break;
        axis.font = mergeFont(axis.font, font);
        wrote = true;
        break;
      }
      case 'total': {
        const totals = spec.decorations.totals;
        if (!totals) break;
        totals.font = mergeFont(totals.font, font);
        wrote = true;
        break;
      }
      default:
        break;
    }
  }

  return writeLabelFonts(spec, fonts) || wrote;
}

/**
 * Data labels, scoped the way the label PANEL scopes everything else about a
 * label — through `labelHomeFor`, so a size stepped from the keyboard lands on
 * the same spec node the panel would write.
 *
 * Grouping by series and calling anything that isn't a full sweep of the
 * categories a per-point override was close, but wrong in the two places where
 * a point key isn't a category:
 *
 * - A line chart's series label is `point: 'end'`, which is not one of the
 *   chart's categories and has no home but the SERIES. The override went to
 *   `pointOverrides.end`, which no placer reads, so ⌘⇧> on a series label did
 *   nothing at all — the change was written and then never drawn.
 * - A waterfall has items rather than series, so every selection fell through
 *   to the chart-wide node: bumping ONE bar's number bumped all of them.
 *
 * `labelHomeFor` already knows both rules — see it for the scopes — so this
 * asks it rather than guessing again. Each label keeps its OWN font, since
 * ⌘⇧> steps every part from the size it is drawn at; only a home that covers
 * several labels at once (a series, the chart) has to settle on one, and there
 * the sizes agree because they all came from the same node.
 */
function writeLabelFonts(spec: ChartSpec, fonts: Map<ChartRef, LabelFont>): boolean {
  const labels = [...fonts].filter(
    (entry): entry is [Extract<ChartRef, { part: 'label' }>, LabelFont] =>
      entry[0].part === 'label',
  );
  if (!labels.length) return false;

  // `labelHomeFor` answers for one series at a time — it returns null for a
  // selection spanning several, which is exactly a group boundary here.
  const bySeries = new Map<string, [Extract<ChartRef, { part: 'label' }>, LabelFont][]>();
  for (const entry of labels) {
    const group = bySeries.get(entry[0].series) ?? [];
    group.push(entry);
    bySeries.set(entry[0].series, group);
  }

  /** Merge onto whatever font is in force AT the home, so a step compounds. */
  const writeFont = (home: LabelHome, font: LabelFont): boolean =>
    patchLabelAt(spec, home, { font: mergeFont(labelSpecAt(spec, home).font, font) });

  let wrote = false;
  for (const group of bySeries.values()) {
    const home = labelHomeFor(
      spec,
      group.map(([ref]) => ref),
    );
    if (!home) continue;

    if (home.scope === 'point') {
      // Narrowed back to one point each: the labels of a partial selection are
      // separate nodes and may be stepping from different sizes.
      for (const [ref, font] of group) {
        if (!home.points.includes(ref.point)) continue;
        if (writeFont({ scope: 'point', seriesKey: home.seriesKey, points: [ref.point] }, font)) {
          wrote = true;
        }
      }
    } else if (home.scope === 'item') {
      for (const [ref, font] of group) {
        if (!home.items.includes(ref.point)) continue;
        if (writeFont({ scope: 'item', items: [ref.point] }, font)) wrote = true;
      }
    } else if (writeFont(home, group[0]![1])) {
      wrote = true;
    }
  }
  return wrote;
}

/**
 * Strip every hand-applied look off a chart, leaving the data and the reader's
 * choices — which decorations show, what a label says — alone.
 *
 * This is the way back from `applyChartFormat`/`applyChartTextFormat`: those
 * write colour and type INTO the spec so an edit survives a recompile, which
 * also means a recoloured chart never finds its way back to the brand on its
 * own. Deleting the override rather than writing the brand's current value in
 * its place is what lets a later template change reach the chart again.
 *
 * Kept: data, kind, stacking, axis domains, number formats, show/hide toggles,
 * label content and placement, annotations. Dropped: fills, outlines, markers,
 * dashes, fonts, the palette override, decoration line styles and the manual
 * label nudges.
 *
 * Returns true when something was actually dropped, so a caller can skip an
 * undo step for a chart that was already clean.
 */
export function clearChartFormatting(spec: ChartSpec): boolean {
  let wrote = false;
  const drop = (obj: object | undefined, key: string): void => {
    const rec = obj as Record<string, unknown> | undefined;
    if (!rec || rec[key] === undefined) return;
    delete rec[key];
    wrote = true;
  };

  drop(spec, 'titleFont');
  drop(spec, 'palette');
  drop(spec.legend, 'font');
  for (const axis of [spec.axes.x, spec.axes.y, spec.axes.y2]) drop(axis, 'font');
  drop(spec.decorations.labels, 'font');
  drop(spec.decorations.totals, 'font');
  for (const line of spec.decorations.trendLines) drop(line, 'style');
  for (const line of spec.decorations.referenceLines) drop(line, 'style');

  for (const series of seriesOf(spec)) {
    drop(series, 'format');
    drop(series.labels, 'font');
    for (const [key, point] of Object.entries(series.pointOverrides ?? {})) {
      drop(point, 'format');
      drop(point, 'labelOffset');
      drop(point.label, 'font');
      // An override that only ever carried a colour is noise once the colour is
      // gone; `hidden` is a content decision, so an entry holding one survives.
      if (!Object.keys(point).length) delete series.pointOverrides![key];
    }
    if (series.pointOverrides && !Object.keys(series.pointOverrides).length) {
      delete series.pointOverrides;
    }
  }

  // A waterfall's bars and a sankey's nodes keep their format on the item, not
  // on a series — `seriesOf` has nothing to hand back for either.
  if (isWaterfallSpec(spec)) for (const item of spec.data.items) drop(item, 'format');
  if (isSankeySpec(spec)) for (const node of spec.data.nodes) drop(node, 'format');

  return wrote;
}

/** `outline: undefined` means "clear it", so it can't be dropped by a spread. */
function definedOnly(patch: ChartFormatPatch): { fill?: Fill; outline?: Outline } {
  const out: { fill?: Fill; outline?: Outline } = {};
  if (patch.fill) out.fill = patch.fill;
  if ('outline' in patch) out.outline = patch.outline as Outline;
  return out;
}

type MarkRef = Extract<ChartRef, { part: 'mark' }>;

const markRefsIn = (slide: Slide, ids: string[]): MarkRef[] => {
  const wanted = new Set(ids);
  const out: MarkRef[] = [];
  for (const el of slide.elements) {
    if (wanted.has(el.id) && el.chartRef?.part === 'mark') out.push(el.chartRef);
  }
  return out;
};

/** True when a selection is nothing but chart parts. */
export const isChartSelection = (slide: Slide, ids: string[]): boolean =>
  ids.length > 0 &&
  ids.every((id) => slide.elements.find((e) => e.id === id)?.chartRef !== undefined);

/** The single chart a selection belongs to, or null if it spans zero or many. */
export function soleChartOf(slide: Slide, ids: string[]): ChartInstance | null {
  const charts = chartsForElements(slide, ids);
  return charts.length === 1 ? charts[0] : null;
}

/** Elements that belong to a chart, for callers that must skip them. */
export const isChartOwned = (el: SlideElement): boolean => el.chartRef !== undefined;
