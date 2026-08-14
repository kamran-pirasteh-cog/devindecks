/**
 * The blank space past the data — Excel's, and think-cell's, most important
 * illusion.
 *
 * A spreadsheet is never "5 rows"; it's a plane you happen to have filled five
 * rows of. So the grid renders past the model: PHANTOM cells that look like
 * cells, select like cells and take a keystroke like cells, and only become
 * real when something is actually typed into them. Without this, adding data
 * means hunting for a "+ Row" button, which is the tell that a grid is fake.
 *
 * Phantom addresses live in the SAME coordinate space as real ones — row 7 of a
 * 5-row sheet is simply `{ r: 6 }`. That keeps selection and navigation
 * index-based and unaware of any of this; the only thing that has to translate
 * is `materialize`, and only at the moment of the first keystroke.
 *
 * Phantom COLUMNS are the one place the two spaces diverge. They render at the
 * right end of the table, but a new series' columns land before the schema's
 * fixed extras (a waterfall's Kind stays rightmost), so materializing phantom
 * column `n` moves the cursor to a different index than the one clicked —
 * `materialize` returns the address to use rather than the one it was given.
 */
import type { CellAddress, SheetColumn, SheetModel } from '@/model';
import { addSeries, insertRow } from './sheetOps';

/** Trailing blank rows, and the height the grid pads out to when nearly empty. */
export const PHANTOM_ROWS = 8;
const MIN_VISIBLE_ROWS = 20;

/** Trailing blank series slots. Two is enough to read as "there's room". */
export const PHANTOM_SERIES = 2;

export interface GridExtent {
  /** Total rendered rows, real + phantom. */
  rows: number;
  /** Total rendered columns, real + phantom. */
  cols: number;
  /** Rendered columns that exist in the model; anything at or past this is phantom. */
  realCols: number;
  /** Rows that exist in the model. */
  realRows: number;
  /** Columns each phantom series slot occupies (scatter's X + Y = 2). */
  perSeries: number;
}

export interface ExtentOptions {
  /**
   * Rows to pad out to, so the blank area reaches the bottom of the viewport
   * instead of stopping in mid-air. The grid measures itself and passes it in.
   */
  minRows?: number;
}

export function gridExtent(sheet: SheetModel, opts: ExtentOptions = {}): GridExtent {
  const { caps, perSeries } = sheet.schema;
  const width = Math.max(1, perSeries.length);

  const realRows = sheet.rows.length;
  const padded = Math.max(realRows + PHANTOM_ROWS, opts.minRows ?? MIN_VISIBLE_ROWS);
  // A capped sheet stops at its cap: a phantom row that could never be
  // materialized is an invitation to type into nothing.
  const rows = caps.addRows
    ? caps.maxRows === undefined
      ? padded
      : Math.min(padded, Math.max(realRows, caps.maxRows))
    : realRows;

  const room = caps.maxSeries === undefined ? PHANTOM_SERIES : caps.maxSeries - sheet.series.length;
  const slots = caps.addSeries ? Math.max(0, Math.min(PHANTOM_SERIES, room)) : 0;

  return {
    rows,
    cols: sheet.columns.length + slots * width,
    realCols: sheet.columns.length,
    realRows,
    perSeries: width,
  };
}

export const isPhantom = (extent: GridExtent, addr: CellAddress): boolean =>
  addr.r >= extent.realRows || addr.c >= extent.realCols;

/**
 * The column a rendered index belongs to.
 *
 * For a phantom column that's the schema's template for the field it would
 * hold, so the cell already right-aligns numbers and coerces what's typed the
 * way the column it's about to become will.
 */
export function columnAt(
  sheet: SheetModel,
  extent: GridExtent,
  c: number,
): SheetColumn | undefined {
  if (c < extent.realCols) return sheet.columns[c];
  const field = (c - extent.realCols) % extent.perSeries;
  const template = sheet.schema.perSeries[field];
  return template ? { ...template, header: '', seriesKey: undefined } : undefined;
}

/**
 * Make `addr` a real cell, and say where that cell ended up.
 *
 * Growth is ONE row and ONE series, however far into the blank area the cell
 * was — a keystroke five rows below the data appends one row and the cursor
 * follows it up. Filling the gap instead would be more literally Excel, but
 * every gap row is a category in the chart, so it would put empty bars and
 * blank legend entries on the slide as the price of clicking imprecisely. The
 * chart is the artefact here; the grid is how it gets edited.
 *
 * Returns the sheet unchanged when the caps forbid growing at all, with the
 * address clamped back inside — a keystroke in a slot that can't exist has to
 * land somewhere rather than being written off the end of the model.
 */
export function materialize(
  sheet: SheetModel,
  addr: CellAddress,
): { sheet: SheetModel; addr: CellAddress } {
  let next = sheet;
  let c = addr.c;

  if (addr.c >= sheet.columns.length) {
    const width = Math.max(1, sheet.schema.perSeries.length);
    const field = (addr.c - sheet.columns.length) % width;
    const grown = addSeries(next);
    if (grown !== next) {
      next = grown;
      c = next.schema.keyColumns.length + (next.series.length - 1) * width + field;
    } else {
      c = Math.min(addr.c, next.columns.length - 1);
    }
  }

  let r = addr.r;
  if (addr.r >= next.rows.length) {
    const grown = insertRow(next, next.rows.length);
    r = next.rows.length - (grown === next ? 1 : 0);
    next = grown;
  }

  return {
    sheet: next,
    addr: {
      r: Math.max(0, Math.min(r, next.rows.length - 1)),
      c: Math.max(0, Math.min(c, next.columns.length - 1)),
    },
  };
}

/** Which series a rendered column belongs to, real or phantom. */
export function seriesIndexAt(sheet: SheetModel, extent: GridExtent, c: number): number {
  if (c < extent.realCols) return sheet.columns[c]?.seriesIndex ?? -1;
  return sheet.series.length + Math.floor((c - extent.realCols) / extent.perSeries);
}
