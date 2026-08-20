/**
 * Solve a Gantt's frame: a description table, a timescale header, and the body
 * between them.
 *
 * Its own solver rather than more fields on `solveFrame`, for the reason
 * `compileSankey` already established — a kind whose layout is a different
 * shape gets its own branch rather than being threaded through the cartesian
 * one behind a third set of `if`s. Three specifics make the case here:
 *
 * - `solveFrame`'s model is ONE text extent per side. A Gantt's left and right
 *   gutters are each a variable number of independently measured columns, and
 *   `FrameInput` would grow two array fields that all eight existing callers
 *   pass `undefined` to forever.
 * - Half of `solveFrame` is the `uprightText` quarter-turn arithmetic. A Gantt
 *   never turns (see `supportsTurn`), so that half is dead weight and live risk.
 * - The convergence differs. The cartesian solve chases *tick label width ↔
 *   plot height*; this one chases *table width ↔ plot width ↔ how fine the
 *   timescale can get*. Same shape, different quantity — and sharing one
 *   function would make one of them read as an exception to the other.
 *
 * What it does NOT reimplement: the title, unit note and legend are solved by
 * `solveChrome` before this is called, and `fitted`, `TEXT_SLACK` and
 * `MIN_PLOT_FRACTION` are shared.
 */
import { pointsToEmu, type EMU, type Rect } from '@/model';
import type { TextMeasurer, TextStyleMetrics } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import { CHART_FONT, type ChartTheme } from '../theme';
import { fitted } from './frame';

/** One column, already reduced to the strings that decide its width. */
export interface GanttColumnInput {
  key: string;
  header: string;
  side: 'left' | 'right';
  order: number;
  /** Author's width. Unset means measured from the widest cell. */
  widthEmu?: EMU;
  /** Formatted cell text, one per VISIBLE row. */
  cells: string[];
  /** Indent depth per visible row. Only a `label` column spends it. */
  indents?: number[];
}

export interface GanttFrameInput {
  frame: Rect;
  theme: ChartTheme;
  measurer: TextMeasurer;
  columns: GanttColumnInput[];
  /** How many header rows the timescale needs, coarsest first. */
  bandCount: number;
  /** One entry per visible row; the value is how many lanes that row needs. */
  rowLanes: number[];
  /** Author's row height. Unset divides the body by the rows. */
  rowHeightEmu?: EMU;
  padding?: { l: EMU; t: EMU; r: EMU; b: EMU };
}

export interface GanttFrameLayout {
  /** The time body: where bars are drawn. */
  plot: Rect;
  /** The timescale header stack, immediately above the plot. */
  header: Rect;
  /** One rect per band, coarsest first, stacked top-down inside `header`. */
  bands: Rect[];
  /** Columns in final left-to-right screen order, full height. */
  columns: { key: string; rect: Rect }[];
  /** One band per visible row, spanning the plot only. */
  rows: Rect[];
  /** Reasons the solve had to give ground; the caller turns them into warnings. */
  clamped: ('columns' | 'rows')[];
}

/** Never let the table eat the schedule — the plot keeps at least this share. */
const MIN_PLOT_FRACTION = 0.35;

/** A row band thinner than this is a stripe, not a row. */
const MIN_ROW_EMU: EMU = pointsToEmu(7);

/** How much an indent level insets a task name. */
export const INDENT_STEP: EMU = pointsToEmu(9);

const styleOf = (r: ChartTheme['text'][keyof ChartTheme['text']]): TextStyleMetrics => ({
  font: r.font,
  sizePt: r.sizePt,
  bold: r.bold,
  caps: r.caps,
});

/**
 * The type the description table is set in: the brand's own face, mixed case.
 *
 * NOT the category role as it comes. That role carries the `ANNOTATION`
 * treatment — Geist Mono, uppercased — which is right for an axis of numbers,
 * where it reads as instrumentation. A Gantt's table is not an axis. Its cells
 * are NAMES ("Research", an owner's initials, a date), and a column of
 * monospaced uppercase names reads as a terminal dump rather than as a plan.
 * `endLabel` makes half of this trade already, and for the same reason — and
 * the legend is already the one role in the set set in the sans.
 *
 * Lives here rather than in the placer because this file is what MEASURES with
 * it, and an uppercased monospace measurement is wider than the sans it would
 * actually draw — measure with one and draw the other and the gutter is wrong
 * by a fifth.
 */
export const tableRole = (
  theme: ChartTheme,
  role: ChartTheme['text'][keyof ChartTheme['text']] = theme.text.category,
): ChartTheme['text'][keyof ChartTheme['text']] => ({
  ...role,
  font: CHART_FONT,
  caps: false,
});

/**
 * The width a column wants: its heading, or its widest cell plus that cell's
 * indent, whichever is greater.
 */
function naturalWidth(col: GanttColumnInput, theme: ChartTheme, m: TextMeasurer): EMU {
  if (col.widthEmu !== undefined) return Math.max(0, col.widthEmu);
  // `tableRole` drops the brand's caps for a table of names — measure the
  // string that will actually be drawn, or the gutter is a fifth too wide.
  const cellStyle = styleOf(tableRole(theme));
  const headStyle = styleOf(tableRole(theme, theme.text.tick));

  let widest = fitted(m.measure(col.header, headStyle).wEmu);
  for (const [i, text] of col.cells.entries()) {
    const indent = (col.indents?.[i] ?? 0) * INDENT_STEP;
    widest = Math.max(widest, indent + fitted(m.measure(text, cellStyle).wEmu));
  }
  return widest;
}

export function solveGanttFrame(input: GanttFrameInput): GanttFrameLayout {
  const { frame, theme, measurer, columns, bandCount, rowLanes } = input;
  const pad = input.padding ?? { l: 0, t: 0, r: 0, b: 0 };
  const clamped: GanttFrameLayout['clamped'] = [];

  const left = frame.x + pad.l;
  const top = frame.y + pad.t;
  const right = frame.x + frame.w - pad.r;
  const bottom = frame.y + frame.h - pad.b;
  const width = Math.max(1, right - left);
  const gap = theme.sizes.axisGapEmu;

  // --- the header, off the top ---
  const bandH = lineHeightEmu(styleOf(theme.text.tick));
  // A column heading sits on the header's bottom band, level with the finest
  // timescale row, so the table and the calendar share one baseline.
  const headerH = Math.max(0, bandCount) * bandH;
  const bodyTop = top + headerH + (headerH > 0 ? gap : 0);

  // --- the table, off both sides ---
  const wanted = columns.map((c) => ({ col: c, w: naturalWidth(c, theme, measurer) }));
  const total = wanted.reduce((sum, c) => sum + c.w, 0) + wanted.length * gap;
  const allowance = width * (1 - MIN_PLOT_FRACTION);

  // Scale every column by the same factor rather than dropping the last one:
  // a table missing its right-hand column reads as a bug, a narrow one reads as
  // a narrow chart. The caller warns either way.
  let scale = 1;
  if (total > allowance && total > 0) {
    scale = Math.max(0, (allowance - wanted.length * gap) / Math.max(1, total - wanted.length * gap));
    clamped.push('columns');
  }

  const sorted = [...wanted].sort(
    (a, b) =>
      sideRank(a.col.side) - sideRank(b.col.side) || a.col.order - b.col.order,
  );

  const leftCols = sorted.filter((c) => c.col.side === 'left');
  const rightCols = sorted.filter((c) => c.col.side === 'right');
  const widthOf = (w: EMU) => Math.max(0, Math.round(w * scale));

  const out: { key: string; rect: Rect }[] = [];
  let cursor = left;
  for (const c of leftCols) {
    const w = widthOf(c.w);
    out.push({ key: c.col.key, rect: { x: cursor, y: top, w, h: bottom - top } });
    cursor += w + gap;
  }
  const plotLeft = cursor;

  // Right-hand columns are laid left-to-right from the plot's right edge, so
  // `order` reads the same way on both sides of the chart.
  const rightWidth = rightCols.reduce((sum, c) => sum + widthOf(c.w) + gap, 0);
  let rightCursor = right - rightWidth + gap;
  const plotRight = Math.max(plotLeft + 1, right - rightWidth);
  for (const c of rightCols) {
    const w = widthOf(c.w);
    out.push({ key: c.col.key, rect: { x: rightCursor, y: top, w, h: bottom - top } });
    rightCursor += w + gap;
  }

  // --- rows, down the body ---
  // A row with two overlapping bars needs two lanes, so it is twice as tall as
  // one with a single bar. Height is shared out in LANE units rather than
  // equally, or a stacked row squeezes its bars while a sparse one wastes space.
  const laneTotal = rowLanes.reduce((n, l) => n + Math.max(1, l), 0) || 1;
  const bodyH = Math.max(1, bottom - bodyTop);
  let perLane = bodyH / laneTotal;

  if (input.rowHeightEmu !== undefined) {
    perLane = input.rowHeightEmu;
    if (perLane * laneTotal > bodyH) clamped.push('rows');
  }
  if (perLane < MIN_ROW_EMU) {
    perLane = MIN_ROW_EMU;
    if (!clamped.includes('rows')) clamped.push('rows');
  }

  const rows: Rect[] = [];
  let y = bodyTop;
  for (const lanes of rowLanes) {
    const h = perLane * Math.max(1, lanes);
    rows.push({
      x: plotLeft,
      y: Math.round(y),
      w: Math.round(plotRight - plotLeft),
      h: Math.round(h),
    });
    y += h;
  }

  // The plot ends where the rows do, not where the frame does: a chart with
  // three rows in a tall box draws three rows and leaves the rest alone, rather
  // than stretching a timescale over emptiness.
  const plotH = Math.max(1, Math.min(y, bottom) - bodyTop);
  const plot: Rect = {
    x: Math.round(plotLeft),
    y: Math.round(bodyTop),
    w: Math.round(plotRight - plotLeft),
    h: Math.round(plotH),
  };

  const bands: Rect[] = Array.from({ length: Math.max(0, bandCount) }, (_, i) => ({
    x: plot.x,
    y: Math.round(top + i * bandH),
    w: plot.w,
    h: Math.round(bandH),
  }));

  return {
    plot,
    header: { x: plot.x, y: Math.round(top), w: plot.w, h: Math.round(headerH) },
    bands,
    columns: out,
    rows,
    clamped,
  };
}

const sideRank = (side: 'left' | 'right'): number => (side === 'left' ? 0 : 1);
