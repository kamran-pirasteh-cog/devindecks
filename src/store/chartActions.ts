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
  isWaterfallSpec,
  type ChartInstance,
  type ChartRef,
  type ChartSpec,
  type DesignSystem,
  type EMU,
  type Fill,
  type Outline,
  type PointOverride,
  type Rect,
  type Slide,
  type SlideElement,
} from '@/model';
import { compileChart } from '@/chart/compile';
import {
  detachChartElements,
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
    w: Math.round(chart.frame.w * sx),
    h: Math.round(chart.frame.h * sy),
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
