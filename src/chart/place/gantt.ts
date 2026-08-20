/**
 * Gantt — the schedule.
 *
 * The one placer here whose value axis is TIME. Its geometry is a band scale
 * down the rows and a `TimeScale` across, so `proj.value(day)` is an x
 * coordinate and `proj.category(t)` walks down the plot exactly as it does on
 * every other horizontal chart — the same calls `placeColumnBar` and
 * `placeDotPlot` make, which is what lets a reference line or an annotation
 * land in the right place without knowing a calendar is involved.
 *
 * Two invariants worth stating before the code:
 *
 * 1. **Marks are emitted ROW-MAJOR, items in time order within a row.**
 *    `partsInReadingOrder` ranks a mark by the first-appearance index of its
 *    point key, so emission order IS reading order — and a shift-click across
 *    two rows scrambles the moment this stops being true. `deriveGantt` sorts;
 *    this file must not resort.
 * 2. **No new `Mark` primitive.** Chevrons, summaries, brackets and rounded
 *    bars go out as `path`, milestones as `marker`, everything else as `rect`,
 *    `line` or `text` — so `emit.ts`, `render/geometry.tsx` and `export/pptx.ts`
 *    are untouched by this kind. `ShapePreset` does carry `'chevron'`, but a
 *    preset only reaches emit through `kind: 'marker'`, whose `shape` is
 *    `MarkerShape` — a MODEL type consumed by every chart's marker picker.
 *    Widening it would put a chevron in a scatter's dropdown.
 */
import {
  pointsToEmu,
  type ColorRef,
  type EMU,
  type Fill,
  type GanttColumn,
  type GanttSpec,
  type LabelSpec,
  type MarkerShape,
  type Outline,
  type PathOp,
  type Rect,
} from '@/model';
import { lineHeightEmu, type TextMeasurer } from '@/render/measureText';
import { formatDate } from '../format/date';
import type { TimeScale } from '../scale/time';
import { fontOver, type ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { MIN_MARK_EMU, rectFromEdges } from '../mark';
import { isDateColumn, orderedColumns, type GanttDerived, type GanttDerivedItem } from '../derive/gantt';
import type { GanttFrameLayout } from '../layout/ganttFrame';
import { INDENT_STEP, tableRole } from '../layout/ganttFrame';
import { textStyle, type Projector } from './cartesian';
import { labelRole, labelSpecFor } from './labelSpec';

export interface GanttInput {
  chartId: string;
  spec: GanttSpec;
  derived: GanttDerived;
  layout: GanttFrameLayout;
  scale: TimeScale;
  /** `projector(layout.plot, scale, true)` — a Gantt is always horizontal. */
  proj: Projector;
  theme: ChartTheme;
  measurer: TextMeasurer;
}

/** 0..1 centres of each visible row, for the shared axis furniture. */
export const ganttRowCenters = (count: number): number[] =>
  Array.from({ length: Math.max(0, count) }, (_, i) => (i + 0.5) / Math.max(1, count));

/** How much of a lane a bar fills across. */
const DEFAULT_BAR_PCT = 52;

/**
 * A bar is never taller than this, whatever the row height works out to.
 *
 * Five tasks in a half-slide box gives rows an inch deep, and half of that is a
 * BLOCK, not a bar: the eye starts reading the height as if it meant something,
 * and a plan whose bars are as tall as they are long stops looking like a
 * timeline. Percentage sets the rhythm; this sets the ceiling, so a sparse
 * chart gets air between its rows rather than fatter marks.
 */
const MAX_BAR_EMU: EMU = pointsToEmu(19);
/** How far a summary's feet reach in, as a fraction of its own height. */
const SUMMARY_FOOT = 0.8;
/**
 * A chevron's point, as a fraction of its own height.
 *
 * Under half a height, not most of one. A long head turns a phase bar into a
 * road sign — the arrow becomes the subject and the span it is drawing stops
 * reading as a span at all. It only has to say "and then".
 */
const CHEVRON_HEAD = 0.45;
const DEFAULT_MILESTONE: EMU = pointsToEmu(9);
const WEEKEND_ALPHA = 0.06;
const BANDING_ALPHA = 0.045;

export function placeGantt(input: GanttInput): Mark[] {
  const { chartId, spec, derived, layout, scale, proj, theme, measurer } = input;
  const marks: Mark[] = [];
  const plot = layout.plot;
  const { left: leftCols, right: rightCols } = orderedColumns(spec);
  const colRect = new Map(layout.columns.map((c) => [c.key, c.rect] as const));

  const x = (day: number): EMU => proj.value(day);
  const clampX = (v: EMU): EMU => Math.max(plot.x, Math.min(plot.x + plot.w, v));

  /* ---------------------------------------------------------------- */
  /* Backdrop — shading, banding, dividers, band rules                */
  /* ---------------------------------------------------------------- */

  // Author spans first, so a named period reads under the weekend tint rather
  // than fighting it.
  for (const [i, span] of (spec.shading?.spans ?? []).entries()) {
    const x0 = clampX(x(span.from));
    const x1 = clampX(x(span.to));
    if (x1 - x0 < 1) continue;
    marks.push({
      kind: 'rect',
      ref: { chartId, part: 'gantt.band', sub: 'holiday', i },
      rect: rectFromEdges(x0, plot.y, x1, plot.y + plot.h),
      fill: { kind: 'solid', color: span.color ?? theme.mutedInk, alpha: span.alpha ?? 0.1 },
      name: span.label,
    });
  }

  if (spec.shading?.weekends?.show) {
    const workdays = spec.timescale.workdays ?? [1, 2, 3, 4, 5];
    // Runs, not days: a Saturday and a Sunday side by side are ONE stripe. Two
    // abutting rects show a seam where their edges round, and double the
    // element count for the same picture.
    for (const [i, run] of nonWorkingRuns(scale.min, scale.max, workdays).entries()) {
      marks.push({
        kind: 'rect',
        ref: { chartId, part: 'gantt.band', sub: 'weekend', i },
        rect: rectFromEdges(clampX(x(run[0])), plot.y, clampX(x(run[1])), plot.y + plot.h),
        fill: {
          kind: 'solid',
          color: spec.shading.weekends.color ?? theme.mutedInk,
          alpha: spec.shading.weekends.alpha ?? WEEKEND_ALPHA,
        },
      });
    }
  }

  if (spec.banding?.show) {
    for (const [i, r] of derived.visible.entries()) {
      if (i % 2 === 1) continue;
      const band = layout.rows[i];
      if (!band) continue;
      marks.push({
        kind: 'rect',
        ref: { chartId, part: 'gantt.row', row: r.row.key, sub: 'band' },
        rect: band,
        fill: {
          kind: 'solid',
          color: spec.banding.color ?? theme.mutedInk,
          alpha: spec.banding.alpha ?? BANDING_ALPHA,
        },
      });
    }
  }

  // Vertical rules under the finest timescale band.
  if (spec.ruler?.bands?.show) {
    const rule = spec.ruler.bands;
    for (const [i, day] of scale.ticks.entries()) {
      const at = Math.round(x(day));
      marks.push({
        kind: 'line',
        ref: { chartId, part: 'axis', axis: 'x', sub: 'grid', i },
        rect: { x: at, y: plot.y, w: 0, h: plot.h },
        color: rule.color ?? theme.gridline,
        widthEmu: rule.widthEmu ?? theme.sizes.gridlineWidthEmu,
        dash: rule.dash ?? 'solid',
      });
    }
  }

  // Row dividers, drawn UNDER each row, and never under the last one — a rule
  // along the bottom edge of the chart is a border, not a divider.
  if (spec.ruler?.rows?.show) {
    const rule = spec.ruler.rows;
    for (const [i, r] of derived.visible.entries()) {
      if (i === derived.visible.length - 1) continue;
      const band = layout.rows[i];
      if (!band) continue;
      const y = Math.round(band.y + band.h);
      const leftEdge = leftCols.length ? (colRect.get(leftCols[0]!.key)?.x ?? plot.x) : plot.x;
      const rightEdge = rightCols.length
        ? lastRight(rightCols, colRect, plot.x + plot.w)
        : plot.x + plot.w;
      marks.push({
        kind: 'line',
        ref: { chartId, part: 'gantt.row', row: r.row.key, sub: 'divider' },
        // Across the TABLE as well as the plot: a divider that stops at the
        // plot's edge cuts the row's own name adrift from its bar.
        rect: { x: leftEdge, y, w: Math.max(0, rightEdge - leftEdge), h: 0 },
        color: rule.color ?? theme.gridline,
        widthEmu: rule.widthEmu ?? theme.sizes.gridlineWidthEmu,
        dash: rule.dash ?? 'solid',
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* The timescale header                                             */
  /* ---------------------------------------------------------------- */

  for (const [tier, band] of scale.bands.entries()) {
    const rect = layout.bands[tier];
    if (!rect) continue;
    const wanted = spec.timescale.bands.find((b) => b.grain === band.grain);
    const role = { ...theme.text.tick, ...fontOver(wanted?.font) };
    const style = textStyle(role, 'center', 'middle', undefined, false);

    for (const [i, cell] of band.cells.entries()) {
      const x0 = clampX(x(cell.from));
      const x1 = clampX(x(cell.to));
      const w = x1 - x0;
      if (w < 1) continue;

      if (wanted?.banded && i % 2 === 0) {
        marks.push({
          kind: 'rect',
          // Tier is load-bearing in the id: without it the year band's cell 0
          // and the month band's cell 0 collide and `reconcileChartElements`
          // drops one whole band. See `ChartRef`.
          ref: { chartId, part: 'axis', axis: 'x', sub: 'tickMark', i, tier },
          rect: rectFromEdges(x0, rect.y, x1, rect.y + rect.h),
          fill: { kind: 'solid', color: theme.mutedInk, alpha: 0.07 },
        });
      }

      // Drop the label rather than letting it overhang its neighbour: a header
      // of overlapping month names is worse than a header of some month names.
      const fits = measurer.measure(cell.label, {
        font: role.font,
        sizePt: role.sizePt,
        bold: role.bold,
        caps: role.caps,
      }).wEmu;
      if (fits > w) continue;

      marks.push({
        kind: 'text',
        ref: { chartId, part: 'axis', axis: 'x', sub: 'tick', i, tier },
        rect: rectFromEdges(x0, rect.y, x1, rect.y + rect.h),
        text: cell.label,
        style,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* The bars                                                         */
  /* ---------------------------------------------------------------- */

  const barPct = Math.max(10, Math.min(spec.barHeightPct ?? DEFAULT_BAR_PCT, 100)) / 100;

  /**
   * A mark's box within its row.
   *
   * Colour resolution order is item -> row -> palette, matching every other
   * placer's point -> series -> palette. A row's index in the AUTHORED list is
   * the palette slot, so collapsing a group doesn't recolour what stays visible.
   */
  const laneBox = (d: GanttDerivedItem): { y: EMU; h: EMU } => {
    const band = layout.rows[d.rowIndex];
    if (!band) return { y: plot.y, h: 0 };
    const rowDef = derived.visible[d.rowIndex]!;
    const laneH = band.h / Math.max(1, rowDef.lanes);
    const h = Math.min(laneH * barPct, MAX_BAR_EMU);
    return { y: band.y + laneH * d.lane + (laneH - h) / 2, h };
  };

  /**
   * Item -> row -> ONE accent, in that order.
   *
   * The default is a single colour for every bar, not a palette walked per row,
   * and that is the difference between a plan and a fruit salad. A palette
   * distinguishes things a reader has to tell apart — a set of categories
   * competing on one scale. A Gantt's rows are not that: they are a list of
   * work, already labelled by name down the side, and giving each its own hue
   * invites a comparison between "Research" and "Build" that means nothing.
   * Colour is then free to carry something real when an author spends it — a
   * workstream, a status, the critical path — which is exactly what
   * `row.format` and `item.format` are for.
   */
  const colorOf = (d: GanttDerivedItem): ColorRef => {
    const own = d.item.format?.fill;
    if (own?.kind === 'solid') return own.color;
    const row = d.row.format?.fill;
    if (row?.kind === 'solid') return row.color;
    return theme.seriesColor(0);
  };

  const labelMarks: Mark[] = [];

  for (const d of derived.items) {
    const fillColor = colorOf(d);
    const fill: Fill = { kind: 'solid', color: fillColor };
    const outline = d.item.format?.outline ?? d.row.format?.outline;
    const { y, h } = laneBox(d);
    if (h <= 0) continue;

    const x0 = clampX(x(d.from));
    const x1 = clampX(x(d.to));
    const ref = { chartId, part: 'mark' as const, series: d.row.key, point: d.item.key };
    const shape = d.item.shape;

    let box: Rect;

    switch (shape.form) {
      case 'milestone': {
        const size = markerSize(d, h);
        box = { x: Math.round(x0 - size / 2), y: Math.round(y + (h - size) / 2), w: size, h: size };
        marks.push({
          kind: 'marker',
          ref,
          rect: box,
          shape: (shape.marker ?? 'diamond') as MarkerShape,
          fill,
          outline,
          name: d.item.label,
        });
        break;
      }

      case 'chevron': {
        box = span(x0, x1, y, h);
        const head = Math.min(shape.headEmu ?? h * CHEVRON_HEAD, box.w);
        marks.push({
          kind: 'path',
          ref,
          rect: box,
          d: chevronPath(head / Math.max(1, box.w)),
          fill,
          outline,
          name: d.item.label,
        });
        break;
      }

      case 'summary': {
        // Two thirds of a bar's height, top-aligned with where a bar would sit,
        // so a roll-up reads as a bracket over its children rather than as a
        // fatter task competing with them.
        const sh = h * 0.66;
        box = span(x0, x1, y + (h - sh) / 2, sh);
        marks.push({
          kind: 'path',
          ref,
          rect: box,
          d: summaryPath(Math.min(0.4, (sh * SUMMARY_FOOT) / Math.max(1, box.w))),
          fill,
          outline,
          name: d.item.label,
        });
        break;
      }

      case 'bracket': {
        box = span(x0, x1, y, h);
        const below = shape.side === 'below';
        marks.push({
          kind: 'path',
          ref,
          rect: box,
          d: bracketPath(below),
          // A brace is a stroke. It still carries a transparent fill so the
          // canvas has something to hit-test — the same trick the chart
          // backdrop uses — because an unfilled path is a click-through.
          fill: { kind: 'solid', color: fillColor, alpha: 0 },
          outline: outline ?? {
            color: fillColor,
            widthEmu: theme.sizes.axisWidthEmu,
            dash: 'solid',
          },
          name: d.item.label,
        });
        break;
      }

      default: {
        box = span(x0, x1, y, h);
        marks.push(
          shape.rounded
            ? {
                kind: 'path',
                ref,
                rect: box,
                d: roundedPath(Math.min(0.5, h / 2 / Math.max(1, box.w))),
                fill,
                outline,
                name: d.item.label,
              }
            : { kind: 'rect', ref, rect: box, fill, outline, name: d.item.label },
        );

        // Progress: an inner bar in the same hue, darker. Drawn only where it
        // says something — 0 and 1 both draw nothing, one because there is no
        // progress and the other because a full bar already reads as done.
        const p = d.item.progress;
        if (p !== undefined && p > 0 && p < 1 && box.w > MIN_MARK_EMU) {
          const inner = Math.round(box.h * 0.45);
          marks.push({
            kind: 'rect',
            ref: { chartId, part: 'decoration', decoId: `progress.${d.item.key}` },
            rect: {
              x: box.x,
              y: Math.round(box.y + (box.h - inner) / 2),
              w: Math.max(MIN_MARK_EMU, Math.round(box.w * p)),
              h: inner,
            },
            fill: { kind: 'solid', color: theme.strongInk, alpha: 0.35 },
          });
        }
      }
    }

    const label = labelFor(input, d);
    if (label) labelMarks.push(label);
  }

  /* ---------------------------------------------------------------- */
  /* Links, today, labels, table                                      */
  /* ---------------------------------------------------------------- */

  marks.push(...linkMarks(input, laneBox));

  if (spec.today?.show && spec.today.at >= scale.min && spec.today.at <= scale.max) {
    const at = Math.round(x(spec.today.at));
    const style = spec.today.style;
    marks.push({
      kind: 'line',
      ref: { chartId, part: 'gantt.band', sub: 'today' },
      // Over the bars, deliberately: "where are we now" is the question the
      // reader brought, and a today line under the plan is one nobody can see.
      rect: { x: at, y: layout.header.y, w: 0, h: plot.y + plot.h - layout.header.y },
      color: style?.color ?? theme.strongInk,
      widthEmu: style?.widthEmu ?? theme.sizes.axisWidthEmu,
      dash: style?.dash ?? 'dash',
    });
    if (spec.today.label) {
      const role = theme.text.dataLabel;
      const w = measurer.measure(spec.today.label, {
        font: role.font,
        sizePt: role.sizePt,
        bold: role.bold,
      }).wEmu;
      marks.push({
        kind: 'text',
        ref: { chartId, part: 'gantt.band', sub: 'today', i: 1 },
        rect: {
          x: Math.round(at - w / 2),
          y: layout.header.y,
          w: Math.round(w),
          h: lineHeightEmu(role),
        },
        text: spec.today.label,
        style: textStyle(role, 'center', 'middle'),
      });
    }
  }

  marks.push(...labelMarks);
  marks.push(...tableMarks(input, [...leftCols, ...rightCols], colRect));

  return marks;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

const span = (x0: EMU, x1: EMU, y: EMU, h: EMU): Rect => ({
  x: Math.round(x0),
  y: Math.round(y),
  w: Math.max(MIN_MARK_EMU, Math.round(x1 - x0)),
  h: Math.round(h),
});

const markerSize = (d: GanttDerivedItem, laneH: EMU): EMU => {
  const own = d.item.format?.marker?.sizeEmu;
  return Math.max(MIN_MARK_EMU, own ?? Math.min(DEFAULT_MILESTONE, laneH));
};

/** Paths are normalized 0..1 within their own rect — see `PathOp`. */
const chevronPath = (head: number): PathOp[] => [
  { op: 'M', x: 0, y: 0 },
  { op: 'L', x: 1 - head, y: 0 },
  { op: 'L', x: 1, y: 0.5 },
  { op: 'L', x: 1 - head, y: 1 },
  { op: 'L', x: 0, y: 1 },
  { op: 'Z' },
];

/**
 * The roll-up: a slim spanning bar with a foot dropped at each end.
 *
 * Drawn at 40% of the lane rather than filling it, with short feet. The
 * full-height trapezoid this replaced was the right diagram and the wrong
 * weight — at a bar's own height its tapers read as a rendering fault rather
 * than as a bracket over the work beneath, and it shouted louder than the tasks
 * it was summarising. A summary is a caption for its children; it should be the
 * quietest bar on the row.
 */
const SUMMARY_BODY = 0.4;

const summaryPath = (foot: number): PathOp[] => [
  { op: 'M', x: 0, y: 0 },
  { op: 'L', x: 1, y: 0 },
  { op: 'L', x: 1, y: 1 },
  { op: 'L', x: 1 - foot, y: SUMMARY_BODY },
  { op: 'L', x: foot, y: SUMMARY_BODY },
  { op: 'L', x: 0, y: 1 },
  { op: 'Z' },
];

/** A square brace with a tick in the middle, opening toward the bars. */
const bracketPath = (below: boolean): PathOp[] => {
  const [near, far] = below ? [1, 0] : [0, 1];
  const mid = below ? 0.6 : 0.4;
  return [
    { op: 'M', x: 0, y: near },
    { op: 'L', x: 0, y: far },
    { op: 'L', x: 0.5, y: far },
    { op: 'L', x: 0.5, y: mid },
    { op: 'M', x: 0.5, y: far },
    { op: 'L', x: 1, y: far },
    { op: 'L', x: 1, y: near },
  ];
};

/** A rect with semicircular ends, as cubics. `r` is in x units of the rect. */
const roundedPath = (r: number): PathOp[] => {
  const k = 0.5523;
  return [
    { op: 'M', x: r, y: 0 },
    { op: 'L', x: 1 - r, y: 0 },
    { op: 'C', x1: 1 - r + r * k, y1: 0, x2: 1, y2: 0.5 - 0.5 * k, x: 1, y: 0.5 },
    { op: 'C', x1: 1, y1: 0.5 + 0.5 * k, x2: 1 - r + r * k, y2: 1, x: 1 - r, y: 1 },
    { op: 'L', x: r, y: 1 },
    { op: 'C', x1: r - r * k, y1: 1, x2: 0, y2: 0.5 + 0.5 * k, x: 0, y: 0.5 },
    { op: 'C', x1: 0, y1: 0.5 - 0.5 * k, x2: r - r * k, y2: 0, x: r, y: 0 },
    { op: 'Z' },
  ];
};

/**
 * Maximal runs of non-working days across the domain.
 *
 * Runs rather than days: a Saturday and a Sunday are one stripe, and two
 * abutting rects show a seam where their edges round.
 */
function nonWorkingRuns(min: number, max: number, workdays: number[]): [number, number][] {
  const runs: [number, number][] = [];
  // A domain of decades at day resolution is a mistake upstream, not a reason
  // to emit ten thousand rects.
  if (max - min > 2000) return runs;
  let start: number | null = null;
  for (let day = Math.floor(min); day < max; day++) {
    const dow = ((((day % 7) + 7) % 7) + 4) % 7;
    const off = !workdays.includes(dow);
    if (off && start === null) start = day;
    if (!off && start !== null) {
      runs.push([start, day]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, max]);
  return runs;
}

const lastRight = (
  cols: GanttColumn[],
  rects: Map<string, Rect>,
  fallback: EMU,
): EMU => {
  const last = cols[cols.length - 1];
  const r = last ? rects.get(last.key) : undefined;
  return r ? r.x + r.w : fallback;
};

/* ------------------------------------------------------------------ */
/* Labels                                                             */
/* ------------------------------------------------------------------ */

function labelText(spec: GanttSpec, d: GanttDerivedItem, label: LabelSpec): string {
  switch (label.content.kind) {
    case 'custom':
      return label.content.text;
    case 'category':
      return d.row.label;
    case 'seriesName':
      return d.item.label ?? d.row.label;
    case 'percent':
      return d.item.progress === undefined ? '' : `${Math.round(d.item.progress * 100)}%`;
    case 'composite':
      return label.content.parts
        .map((part) => labelText(spec, d, { ...label, content: part }))
        .filter(Boolean)
        .join(label.content.separator);
    default:
      // A schedule's "value" is its DURATION — the number a reader would work
      // out from the bar's length if it weren't printed.
      return d.to > d.from ? `${d.to - d.from}d` : (d.item.label ?? '');
  }
}

function labelFor(input: GanttInput, d: GanttDerivedItem): Mark | null {
  const { chartId, spec, theme, measurer, proj, layout, derived } = input;
  const label = labelSpecFor(spec.decorations.labels, d.row.labels, d.item.labels);
  if (!label.show) return null;

  const text = labelText(spec, d, label);
  if (!text) return null;

  // A label carrying a NAME drops the brand's caps, the same trade `placeLineArea`
  // makes for an end label and `tableRole` makes for the table: many brands
  // uppercase data labels, which reads as instrumentation on a number and as
  // shouting on "Research". A duration keeps the brand's setting, because that
  // IS a number.
  const named =
    label.content.kind === 'category' ||
    label.content.kind === 'seriesName' ||
    label.content.kind === 'custom';
  const base = labelRole(theme, label.font);
  const role = named ? { ...base, caps: false } : base;
  const w = measurer.measure(text, {
    font: role.font,
    sizePt: role.sizePt,
    bold: role.bold,
    caps: role.caps,
  }).wEmu;
  const h = lineHeightEmu(role);
  const gap = theme.sizes.labelGapEmu;

  const band = layout.rows[d.rowIndex];
  if (!band) return null;
  const rowDef = derived.visible[d.rowIndex]!;
  const laneH = band.h / Math.max(1, rowDef.lanes);
  const midY = band.y + laneH * d.lane + laneH / 2;

  // A milestone has no span, so its ends ARE its centre — and a label placed at
  // `x1 + gap` would sit on top of the diamond. Push both ends out by the
  // marker's half-width so "beside it" means beside the shape, not the point.
  const marker = d.to <= d.from ? markerSize(d, laneH) / 2 : 0;
  const x0 = proj.value(d.from) - marker;
  const x1 = proj.value(d.to) + marker;
  const inside = x1 - x0;

  // `auto` is not a placement, it is a decision: put the label inside when the
  // bar is wide enough to hold it, and beside it when it isn't. A label wider
  // than its own bar is the single commonest way a Gantt turns to soup.
  const placement =
    label.placement === 'auto'
      ? inside > w + gap * 2
        ? 'insideCenter'
        : 'right'
      : label.placement;

  let rect: Rect;
  let align: 'left' | 'center' | 'right' = 'center';
  switch (placement) {
    case 'left':
    case 'outsideEnd':
      rect = { x: Math.round(x0 - w - gap), y: Math.round(midY - h / 2), w: Math.round(w), h };
      align = 'right';
      break;
    case 'right':
      rect = { x: Math.round(x1 + gap), y: Math.round(midY - h / 2), w: Math.round(w), h };
      align = 'left';
      break;
    case 'above':
      rect = { x: Math.round(x0), y: Math.round(midY - laneH / 2 - h), w: Math.round(inside), h };
      break;
    case 'below':
      rect = { x: Math.round(x0), y: Math.round(midY + laneH / 2), w: Math.round(inside), h };
      break;
    case 'insideEnd':
      rect = { x: Math.round(x1 - w - gap), y: Math.round(midY - h / 2), w: Math.round(w), h };
      align = 'right';
      break;
    case 'insideBase':
      rect = { x: Math.round(x0 + gap), y: Math.round(midY - h / 2), w: Math.round(w), h };
      align = 'left';
      break;
    default:
      rect = { x: Math.round(x0), y: Math.round(midY - h / 2), w: Math.round(inside), h };
  }

  // Ink: a label sitting ON its bar takes the readable colour for that fill; one
  // beside it takes the brand's. Only the placer knows which, which is why
  // `labelRole` deliberately leaves the fallback to callers.
  const on = placement === 'insideCenter' || placement === 'insideEnd' || placement === 'insideBase';
  const fillColor =
    d.item.format?.fill?.kind === 'solid'
      ? d.item.format.fill.color
      : d.row.format?.fill?.kind === 'solid'
        ? d.row.format.fill.color
        : theme.seriesColor(0);
  const color = label.font?.color ?? (on ? theme.inkOn(fillColor) : role.color);

  return {
    kind: 'text',
    ref: { chartId, part: 'label', series: d.row.key, point: d.item.key },
    rect,
    text,
    style: textStyle({ ...role, color }, align, 'middle'),
  };
}

/* ------------------------------------------------------------------ */
/* The description table                                              */
/* ------------------------------------------------------------------ */


function tableMarks(
  input: GanttInput,
  columns: GanttColumn[],
  rects: Map<string, Rect>,
): Mark[] {
  const { chartId, spec, derived, layout, theme } = input;
  const out: Mark[] = [];
  const headStyleRole = theme.text.tick;

  // Column-major, top to bottom, so `partsInReadingOrder`'s painted-order
  // fallback makes a shift-range run DOWN a column — the only run that means
  // anything in a table.
  for (const col of columns) {
    const rect = rects.get(col.key);
    if (!rect) continue;
    const align = col.align ?? (isDateColumn(col) ? 'right' : 'left');

    if (col.header) {
      const role = { ...tableRole(theme, headStyleRole), ...fontOver(col.headerFont) };
      out.push({
        kind: 'text',
        ref: { chartId, part: 'gantt.column', column: col.key, sub: 'header' },
        rect: { x: rect.x, y: layout.header.y, w: rect.w, h: layout.header.h || lineHeightEmu(role) },
        text: col.header,
        style: textStyle(role, align, 'bottom'),
      });
    }

    for (const [i, r] of derived.visible.entries()) {
      const band = layout.rows[i];
      if (!band) continue;
      const raw = derived.cells[r.row.key]?.[col.key] ?? '';
      if (!raw) continue;

      // A derived date column holds an epoch day; the pattern lives on the
      // column, so this is the only place that can format it.
      const text =
        isDateColumn(col) && /^-?\d+$/.test(raw)
          ? formatDate(Number(raw), col.dateFormat ?? "d MMM ''yy")
          : col.source === 'duration' && /^-?\d+$/.test(raw)
            ? `${raw}d`
            : raw;

      const role = { ...tableRole(theme), ...fontOver(col.font) };
      // Indent is an x offset, never a text prefix: a prefix breaks alignment,
      // breaks selection of the name itself, and exports as literal spaces.
      const indent = col.source === 'label' ? r.level * INDENT_STEP : 0;
      out.push({
        kind: 'text',
        ref: { chartId, part: 'gantt.column', column: col.key, sub: 'cell', row: r.row.key },
        rect: {
          x: rect.x + (align === 'left' ? indent : 0),
          y: band.y,
          w: Math.max(1, rect.w - indent),
          h: band.h,
        },
        text,
        style: textStyle(
          // A parent row is the heading over its children, so it carries the
          // weight — which is what makes the indent legible without a glyph.
          r.hasChildren ? { ...role, bold: true } : role,
          align,
          'middle',
        ),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Dependency links                                                   */
/* ------------------------------------------------------------------ */

/**
 * Elbow connectors between two items.
 *
 * Three segments at most — out of the predecessor, across, into the successor —
 * which is what a plan's reader expects and what stays legible when a dozen of
 * them cross. Routed around nothing: a link that dodged bars would move every
 * time a date changed, and a schedule's arrows are read as "this follows that",
 * not as a wiring diagram.
 */
function linkMarks(
  input: GanttInput,
  laneBox: (d: GanttDerivedItem) => { y: EMU; h: EMU },
): Mark[] {
  const { chartId, spec, derived, proj, theme } = input;
  if (!spec.links?.length) return [];

  const byKey = new Map(derived.items.map((d) => [d.item.key, d] as const));
  const out: Mark[] = [];
  const stub = theme.sizes.labelGapEmu;

  for (const link of spec.links) {
    const a = byKey.get(link.from);
    const b = byKey.get(link.to);
    if (!a || !b) continue;

    const type = link.type ?? 'FS';
    const ay = laneBox(a);
    const by = laneBox(b);
    const fromEnd = type === 'FS' || type === 'FF';
    const toStart = type === 'FS' || type === 'SS';

    const x0 = Math.round(proj.value(fromEnd ? a.to : a.from));
    const x1 = Math.round(proj.value(toStart ? b.from : b.to));
    const y0 = Math.round(ay.y + ay.h / 2);
    const y1 = Math.round(by.y + by.h / 2);

    // The route, as a polyline. Two shapes, and the second is not an edge case
    // to be tolerated — it is the ordinary one. Tasks in a plan ABUT: one ends
    // the day the next begins, so the successor starts at or before the
    // predecessor's end, and an elbow drawn forward would run backwards
    // through both bars.
    const pts: [EMU, EMU][] =
      x1 >= x0 + stub * 2
        ? // Forward: out, across, in.
          (() => {
            const mid = Math.round((x0 + x1) / 2);
            return [
              [x0, y0],
              [mid, y0],
              [mid, y1],
              [x1, y1],
            ] as [EMU, EMU][];
          })()
        : // Tight or backward: out past the predecessor, down to the lane
          // between the two rows, back to just before the successor, and in.
          (() => {
            const outX = x0 + stub;
            const inX = x1 - stub;
            const midY = Math.round((y0 + y1) / 2);
            return [
              [x0, y0],
              [outX, y0],
              [outX, midY],
              [inX, midY],
              [inX, y1],
              [x1, y1],
            ] as [EMU, EMU][];
          })();

    const color = link.style?.color ?? theme.mutedInk;
    const widthEmu = link.style?.widthEmu ?? theme.sizes.gridlineWidthEmu;
    const dash = link.style?.dash ?? 'solid';

    // Degenerate segments are dropped rather than emitted at zero length: they
    // would still take an element id, a selection slot and a row in the export.
    const segs = pts
      .slice(1)
      .map((q, i) => [pts[i]!, q] as const)
      .filter(([p, q]) => p[0] !== q[0] || p[1] !== q[1]);

    for (const [i, [p, q]] of segs.entries()) {
      out.push({
        kind: 'line',
        ref: { chartId, part: 'decoration', decoId: `link.${link.id}`, sub: `s${i}` },
        rect: {
          x: Math.min(p[0], q[0]),
          y: Math.min(p[1], q[1]),
          w: Math.abs(q[0] - p[0]),
          h: Math.abs(q[1] - p[1]),
        },
        color,
        widthEmu,
        dash,
        // Only the last segment carries the head: an arrow per elbow reads as
        // four dependencies rather than one.
        ...(i === segs.length - 1 ? { endArrow: true } : {}),
      });
    }
  }
  return out;
}
