/**
 * The description table's columns, as spec operations.
 *
 * Pure functions on a `GanttSpec` draft rather than methods on a panel: the
 * same four gestures are reachable from the canvas popover, the datasheet's
 * column menu and (eventually) a drag, and three copies of "which side is it on
 * now" is how two of them come to disagree.
 *
 * The layout rule they all serve, stated once: BOTH sides are laid out
 * left-to-right by ascending `order`. So on the left, a higher order is nearer
 * the chart; on the right, a lower one is. Everything below is written in
 * READING terms — "toward the chart", "away from it" — and converts at the last
 * moment, so an arrow the user presses and the direction a column moves agree
 * on both sides of the plot.
 */
import type { GanttColumn, GanttSpec } from './spec';

/** The columns on one side, nearest-the-chart last. */
export const columnsOnSide = (spec: GanttSpec, side: 'left' | 'right'): GanttColumn[] =>
  spec.columns.filter((c) => c.side === side).sort((a, b) => a.order - b.order);

/**
 * Move a column across the chart body.
 *
 * It lands OUTERMOST on the side it arrives at — the position a reader would
 * predict from having dragged it past everything already there — rather than
 * keeping an `order` that means the opposite thing on the other side.
 */
export function moveGanttColumn(
  spec: GanttSpec,
  key: string,
  side: 'left' | 'right',
): boolean {
  const col = spec.columns.find((c) => c.key === key);
  if (!col || col.side === side) return false;
  const outermost = Math.max(
    -1,
    ...spec.columns.filter((c) => c.side === side && c.key !== key).map((c) => c.order),
  );
  col.side = side;
  col.order = outermost + 1;
  return true;
}

/**
 * Swap a column with its neighbour on the same side.
 *
 * `delta` is -1 for "toward the chart" and +1 for "away from it", on either
 * side. Returns false at the end of the run rather than wrapping: a column that
 * jumped to the far end because someone pressed the arrow once too often is a
 * gesture nobody can undo by pressing it again.
 */
export function nudgeGanttColumn(spec: GanttSpec, key: string, delta: -1 | 1): boolean {
  const col = spec.columns.find((c) => c.key === key);
  if (!col) return false;
  const peers = columnsOnSide(spec, col.side);
  const i = peers.findIndex((c) => c.key === key);
  const j = i + (col.side === 'left' ? -delta : delta);
  const other = peers[j];
  if (!other) return false;
  [col.order, other.order] = [other.order, col.order];
  return true;
}

/**
 * Add a column beside an existing one, or at the outer end of a side.
 *
 * A `text` column by default — the only source an author fills in themselves.
 * The derived ones (start / end / duration) are picked afterwards, because
 * choosing "Duration" is a different decision from wanting another column.
 */
export function addGanttColumn(
  spec: GanttSpec,
  opts: { side?: 'left' | 'right'; after?: string; header?: string; key?: string } = {},
): GanttColumn {
  const anchor = opts.after ? spec.columns.find((c) => c.key === opts.after) : undefined;
  const side = opts.side ?? anchor?.side ?? 'left';
  const at = anchor && anchor.side === side ? anchor.order : undefined;

  // Everything at or past the insertion point shuffles out by one, so the new
  // column lands exactly where it was asked for rather than at the end.
  if (at !== undefined) {
    for (const c of spec.columns) if (c.side === side && c.order > at) c.order += 1;
  }

  const col: GanttColumn = {
    key: opts.key ?? `col.${uniqueSuffix(spec)}`,
    header: opts.header ?? 'Column',
    side,
    order: at !== undefined ? at + 1 : outerEnd(spec, side),
    source: 'text',
  };
  spec.columns.push(col);
  return col;
}

/**
 * Drop a column, and the authored text that only it could show.
 *
 * The cells go with it: they are keyed by column, so leaving them would grow
 * the spec by a copy of the table every time someone added and removed a
 * column. A DERIVED column carries no cells, so this is a no-op for one.
 */
export function removeGanttColumn(spec: GanttSpec, key: string): boolean {
  const before = spec.columns.length;
  spec.columns = spec.columns.filter((c) => c.key !== key);
  if (spec.columns.length === before) return false;
  for (const row of Object.keys(spec.cells ?? {})) {
    delete spec.cells![row]![key];
    if (!Object.keys(spec.cells![row]!).length) delete spec.cells![row];
  }
  return true;
}

const outerEnd = (spec: GanttSpec, side: 'left' | 'right'): number =>
  Math.max(-1, ...spec.columns.filter((c) => c.side === side).map((c) => c.order)) + 1;

/** A key nothing already uses. Keys are stable forever — see the spec header. */
function uniqueSuffix(spec: GanttSpec): string {
  const taken = new Set(spec.columns.map((c) => c.key));
  for (let n = 1; ; n++) {
    const key = `c${n}`;
    if (!taken.has(`col.${key}`)) return key;
  }
}
