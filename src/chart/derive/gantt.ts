/**
 * Everything a Gantt's placer needs that isn't geometry.
 *
 * The sibling of `derive/grid.ts`, and it does the same job: turn the authored
 * spec into the rows and data the placer walks, so the placer is about ink and
 * nothing else. Five things are resolved here, all of them the sort that would
 * otherwise be recomputed inconsistently in three places:
 *
 * - the row TREE, from the flat `level` list, including which rows a collapse
 *   hides and which rows have children;
 * - a SUMMARY's span, when it didn't name one, from the tasks beneath it;
 * - LANES, when two items in one row overlap in time and can't share a line;
 * - the DERIVED column values (start / end / duration), so the table beside the
 *   chart is computed from the same bars it sits next to and cannot contradict
 *   them;
 * - the date EXTENT, which is what the timescale is solved against.
 *
 * Pure, as everything under `chart/` is: no clock, no design system, no DOM.
 */
import {
  type EpochDay,
  type GanttColumn,
  type GanttItem,
  type GanttRow,
  type GanttSpec,
} from '@/model';

export interface GanttDerivedRow {
  row: GanttRow;
  /** Index into `GanttSpec.rows` — the authored order, not the visible one. */
  index: number;
  /** Clamped so the tree can always be walked; see `normalizeLevels`. */
  level: number;
  /** Has at least one row indented under it. */
  hasChildren: boolean;
  /** Hidden by an ancestor's `collapsed`. Never true for a top-level row. */
  underCollapsed: boolean;
  /** How many lanes this row's items need. At least 1. */
  lanes: number;
}

export interface GanttDerivedItem {
  item: GanttItem;
  /** The row it belongs to, already resolved — an orphan is dropped, not drawn. */
  row: GanttRow;
  /** Index of the visible row it draws on. */
  rowIndex: number;
  /** Which lane within that row, 0-based. */
  lane: number;
  /** Resolved span. `to` equals `from` for a milestone. */
  from: EpochDay;
  to: EpochDay;
  /** True when `to` was computed from descendants rather than authored. */
  rolledUp: boolean;
}

export interface GanttDerived {
  /** Every row, in authored order, with the tree resolved. */
  all: GanttDerivedRow[];
  /** The rows that DRAW, in order — `all` minus anything under a collapse. */
  visible: GanttDerivedRow[];
  /** The items that draw, ROW-MAJOR and in time order within a row. */
  items: GanttDerivedItem[];
  /** `[min, max)` over everything drawn; `[0, 1)` when there is nothing. */
  extent: [EpochDay, EpochDay];
  /** Cell text per visible row, per column key. Derived columns are filled in. */
  cells: Record<string, Record<string, string>>;
}

/* ------------------------------------------------------------------ */
/* The tree                                                           */
/* ------------------------------------------------------------------ */

/**
 * Clamp indents so the list is always a walkable tree.
 *
 * A level that jumps — 0 straight to 2 — describes a child with no parent, and
 * every consumer of the tree would then have to decide what that means. It is
 * decided once, here: a row may be at most one deeper than the row above it,
 * and the first row is always at the root.
 */
function normalizeLevels(rows: GanttRow[]): number[] {
  const out: number[] = [];
  let prev = -1;
  for (const row of rows) {
    const level = Math.max(0, Math.min(Math.round(row.level || 0), prev + 1));
    out.push(level);
    prev = level;
  }
  return out;
}

/** Whether each row is hidden by a `collapsed` ancestor. */
function collapsedUnder(rows: GanttRow[], levels: number[]): boolean[] {
  const hidden: boolean[] = [];
  // The shallowest level currently being hidden, or Infinity when nothing is.
  let cut = Infinity;
  for (const [i, row] of rows.entries()) {
    const level = levels[i]!;
    if (level <= cut) cut = Infinity;
    hidden.push(level > cut);
    if (row.collapsed && level < cut) cut = level;
  }
  return hidden;
}

/* ------------------------------------------------------------------ */
/* Lanes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Stack items that overlap in time onto separate lines within their row.
 *
 * Interval graph colouring, greedily by start date, which is exact for
 * intervals: an item takes the first lane whose last item has already finished.
 * An authored `lane` is honoured — someone who arranged their own rows meant it.
 *
 * A milestone is a point, so it never forces a lane of its own; it rides the
 * lane of whatever it lands on. Two bars that merely ABUT (one ends the day the
 * next begins) share a lane, which is what half-open ends buy: `to` is
 * exclusive, so `next.from >= prev.to` is genuinely no overlap.
 */
function assignLanes(items: GanttDerivedItem[]): number {
  const ends: EpochDay[] = [];
  for (const d of [...items].sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (d.item.lane !== undefined && d.item.lane >= 0) {
      d.lane = Math.round(d.item.lane);
      ends[d.lane] = Math.max(ends[d.lane] ?? -Infinity, d.to);
      continue;
    }
    // A moment in time displaces nothing.
    if (d.to <= d.from) {
      d.lane = 0;
      continue;
    }
    let lane = ends.findIndex((end) => end <= d.from);
    if (lane < 0) lane = ends.length;
    d.lane = lane;
    ends[lane] = d.to;
  }
  return Math.max(1, ends.length);
}

/* ------------------------------------------------------------------ */
/* Derive                                                             */
/* ------------------------------------------------------------------ */

export function deriveGantt(spec: GanttSpec): GanttDerived {
  const levels = normalizeLevels(spec.rows);
  const hidden = collapsedUnder(spec.rows, levels);

  const all: GanttDerivedRow[] = spec.rows.map((row, i) => ({
    row,
    index: i,
    level: levels[i]!,
    hasChildren: (levels[i + 1] ?? -1) > levels[i]!,
    underCollapsed: hidden[i]!,
    lanes: 1,
  }));

  const visible = all.filter((r) => !r.underCollapsed && !r.row.hidden);
  const rowAt = new Map(visible.map((r, i) => [r.row.key, i] as const));

  // Items in AUTHORED order first, so a roll-up can see its descendants before
  // anything is sorted or dropped.
  const byRow = new Map<string, GanttItem[]>();
  for (const item of spec.items) {
    if (item.hidden) continue;
    (byRow.get(item.row) ?? byRow.set(item.row, []).get(item.row)!).push(item);
  }

  const derived: GanttDerivedItem[] = [];

  for (const r of visible) {
    const rowIndex = rowAt.get(r.row.key)!;
    const mine: GanttDerivedItem[] = [];

    for (const item of byRow.get(r.row.key) ?? []) {
      const milestone = item.shape.form === 'milestone' || item.to === undefined;
      let from = item.from;
      let to = milestone ? item.from : item.to!;
      let rolledUp = false;

      // A summary with no span of its own takes the one its descendants
      // describe — the same contract `WaterfallItem.value: null` keeps, and for
      // the same reason: a roll-up must not be able to contradict what it rolls
      // up. Descendants are read from the AUTHORED rows, not the visible ones,
      // so collapsing a group doesn't change the bar that stands for it.
      if (item.shape.form === 'summary' && item.to === undefined) {
        const span = descendantSpan(spec, all, r.index);
        if (span) {
          [from, to] = span;
          rolledUp = true;
        } else {
          to = from;
        }
      }

      mine.push({ item, row: r.row, rowIndex, lane: 0, from, to: Math.max(from, to), rolledUp });
    }

    r.lanes = assignLanes(mine);
    // Time order within the row. This, with the row loop above, is what makes
    // emission ROW-MAJOR — the invariant `partsInReadingOrder` relies on, and
    // the reason a shift-click across two rows doesn't scramble.
    mine.sort((a, b) => a.from - b.from || a.to - b.to);
    derived.push(...mine);
  }

  return {
    all,
    visible,
    items: derived,
    extent: extentOf(spec, derived),
    cells: cellsFor(spec, visible, derived),
  };
}

/** The span covered by everything under row `i`, or null when it leads nothing. */
function descendantSpan(
  spec: GanttSpec,
  all: GanttDerivedRow[],
  i: number,
): [EpochDay, EpochDay] | null {
  const level = all[i]!.level;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = i + 1; j < all.length && all[j]!.level > level; j++) {
    for (const item of spec.items) {
      if (item.row !== all[j]!.row.key || item.hidden) continue;
      // A roll-up over roll-ups would be circular; only real tasks count.
      if (item.shape.form === 'summary' && item.to === undefined) continue;
      lo = Math.min(lo, item.from);
      hi = Math.max(hi, item.to ?? item.from);
    }
  }
  return Number.isFinite(lo) && hi >= lo ? [lo, hi] : null;
}

function extentOf(spec: GanttSpec, items: GanttDerivedItem[]): [EpochDay, EpochDay] {
  const days: EpochDay[] = [];
  for (const d of items) days.push(d.from, d.to);
  // A shaded span or a pinned today line is part of what the axis must show:
  // a today line off the end of the timescale is a line nobody can see.
  for (const s of spec.shading?.spans ?? []) days.push(s.from, s.to);
  if (spec.today?.show) days.push(spec.today.at);
  if (spec.timescale.min !== undefined) days.push(spec.timescale.min);
  if (spec.timescale.max !== undefined) days.push(spec.timescale.max);
  if (!days.length) return [0, 1];
  const lo = Math.min(...days);
  return [lo, Math.max(lo + 1, Math.max(...days))];
}

/* ------------------------------------------------------------------ */
/* The description table                                              */
/* ------------------------------------------------------------------ */

/** The columns in final left-to-right screen order, plot in the middle. */
export function orderedColumns(spec: GanttSpec): { left: GanttColumn[]; right: GanttColumn[] } {
  const bySide = (side: 'left' | 'right') =>
    spec.columns.filter((c) => c.side === side).sort((a, b) => a.order - b.order);
  return { left: bySide('left'), right: bySide('right') };
}

/**
 * What each cell of the table says.
 *
 * `label` and `text` come from the spec. `start`, `end` and `duration` are
 * COMPUTED from the row's items — which is the whole reason they exist as a
 * source rather than as more authored text: a table that could disagree with
 * the bars beside it is worse than no table.
 *
 * Dates are left as epoch days here and formatted by the placer, which is the
 * only thing that knows the column's pattern.
 */
function cellsFor(
  spec: GanttSpec,
  visible: GanttDerivedRow[],
  items: GanttDerivedItem[],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const r of visible) {
    const key = r.row.key;
    const mine = items.filter((d) => d.row.key === key);
    const row: Record<string, string> = {};
    for (const col of spec.columns) {
      switch (col.source) {
        case 'label':
          row[col.key] = r.row.label;
          break;
        case 'text':
          row[col.key] = spec.cells?.[key]?.[col.key] ?? '';
          break;
        case 'start':
          row[col.key] = mine.length ? String(Math.min(...mine.map((d) => d.from))) : '';
          break;
        case 'end':
          // Inclusive, as the datasheet shows it: a task running to 1 Apr
          // exclusive is one an author calls "ends 31 Mar". A milestone's end
          // IS its day, so it isn't decremented.
          row[col.key] = mine.length
            ? String(Math.max(...mine.map((d) => (d.to > d.from ? d.to - 1 : d.to))))
            : '';
          break;
        case 'duration':
          row[col.key] = mine.length
            ? String(
                Math.max(...mine.map((d) => d.to)) - Math.min(...mine.map((d) => d.from)),
              )
            : '';
          break;
      }
    }
    out[key] = row;
  }
  return out;
}

/** Whether a derived column's cells hold an epoch day rather than plain text. */
export const isDateColumn = (col: GanttColumn): boolean =>
  col.source === 'start' || col.source === 'end';
