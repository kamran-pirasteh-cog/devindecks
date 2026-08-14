/**
 * The datasheet model.
 *
 * A chart's data is edited as a grid, but twelve chart kinds don't need twelve
 * grids — they need a SCHEMA per kind and one grid that reads it. That schema
 * is also what the Devin return contract is generated from, which is why
 * "Devin's answer pastes straight back into the sheet" is a structural
 * guarantee rather than a convention someone has to maintain.
 *
 * Nothing here knows about React or the DOM.
 */
import type { ColorRef } from './tokens';
import type { NumberFormat } from './chart/format';

export type CellType = 'text' | 'number' | 'percent' | 'date' | 'enum' | 'color';

export type CellValue =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'number'; n: number }
  /** ISO day string, not a Date — serializable, comparable, no timezone traps. */
  | { kind: 'date'; iso: string }
  | { kind: 'enum'; value: string }
  | { kind: 'color'; ref: ColorRef }
  /**
   * What the user typed, kept verbatim because it couldn't be coerced. Nothing
   * is ever silently dropped: the cell keeps the text, the chart keeps
   * rendering, and a diagnostic says why.
   */
  | { kind: 'invalid'; raw: string; expected: CellType };

export const EMPTY: CellValue = { kind: 'empty' };

export interface EnumOption {
  value: string;
  label: string;
  /** Shown as a tooltip, and reused verbatim in the Devin prompt's key. */
  hint?: string;
}

export interface SheetColumn {
  /** Stable key the adapter switches on when writing back to the spec. */
  key: string;
  header: string;
  type: CellType;
  options?: EnumOption[];
  format?: NumberFormat;
  /** Which series this column belongs to, for the header swatch and rename. */
  seriesKey?: string;
  seriesIndex?: number;
  /** Which field of that series — 'value', 'x', 'y', 'size'. */
  field?: string;
  editable?: boolean;
  /** A blank here is a real defect (a scatter point with no Y isn't a point). */
  required?: boolean;
  widthPx?: number;
}

/** A row band above or below the data, e.g. Mekko's column widths. */
export interface SheetBandRow {
  key: string;
  header: string;
  type: CellType;
  placement: 'top' | 'bottom';
  format?: NumberFormat;
}

export interface SheetCaps {
  addRows: boolean;
  addSeries: boolean;
  reorderRows: boolean;
  reorderSeries: boolean;
  maxSeries?: number;
  maxRows?: number;
  minRows?: number;
}

/**
 * What one ROW of the grid is.
 *
 * - `recordsDown` — a row is a record (a point, a ledger entry, a flow) and a
 *   series is a column group. The only reading that makes sense for a
 *   waterfall, a Sankey or a scatter, where there is no category × series
 *   grid to turn around.
 * - `seriesDown` — a row is a SERIES and a column is a category. think-cell's
 *   datasheet, and the one a category grid is edited in here: the category
 *   axis is nearly always time, and time reads left to right in the chart, so
 *   it has to read left to right in the sheet under it.
 */
export type SheetLayout = 'recordsDown' | 'seriesDown';

export interface SheetSchema {
  /** Also the contract id Devin echoes back. */
  id: string;
  /** Which dimension the rows enumerate — see `SheetLayout`. */
  layout: SheetLayout;
  /**
   * Leading non-series columns: Category / Point / Label / Date — or, under
   * `seriesDown`, the one column holding the series names.
   */
  keyColumns: SheetColumn[];
  /** The shape of ONE series, repeated per series. */
  perSeries: SheetColumn[];
  /** Fixed extras that aren't per-series (waterfall Kind). */
  extraColumns: SheetColumn[];
  bands: SheetBandRow[];
  caps: SheetCaps;
}

export interface SheetSeries {
  key: string;
  name: string;
  color?: ColorRef;
}

export interface SheetModel {
  schema: SheetSchema;
  /** keyColumns + (perSeries × series) + extraColumns, in display order. */
  columns: SheetColumn[];
  /**
   * One entry per column group. Under `seriesDown` these are the CATEGORIES —
   * the grid is transposed, so every column-shaped operation (add, rename,
   * reorder, delete) is a category operation and needs no separate code path.
   */
  series: SheetSeries[];
  rows: CellValue[][];
  bandValues: Record<string, CellValue[]>;
}

export interface CellAddress {
  r: number;
  c: number;
}

export interface CellRange {
  anchor: CellAddress;
  focus: CellAddress;
}

export interface SheetDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  cell?: CellAddress;
  column?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

export const cellNumber = (v: CellValue | undefined): number | null =>
  v?.kind === 'number' ? v.n : null;

export const cellText = (v: CellValue | undefined): string => {
  switch (v?.kind) {
    case 'text':
      return v.text;
    case 'number':
      return String(v.n);
    case 'date':
      return v.iso;
    case 'enum':
      return v.value;
    case 'invalid':
      return v.raw;
    default:
      return '';
  }
};

export const rangeBounds = (range: CellRange) => ({
  r0: Math.min(range.anchor.r, range.focus.r),
  r1: Math.max(range.anchor.r, range.focus.r),
  c0: Math.min(range.anchor.c, range.focus.c),
  c1: Math.max(range.anchor.c, range.focus.c),
});

export const sameAddress = (a: CellAddress, b: CellAddress) => a.r === b.r && a.c === b.c;

export function inRange(range: CellRange, addr: CellAddress): boolean {
  const { r0, r1, c0, c1 } = rangeBounds(range);
  return addr.r >= r0 && addr.r <= r1 && addr.c >= c0 && addr.c <= c1;
}

/** Materialize the display column list from a schema plus its series. */
export function columnsFor(schema: SheetSchema, series: SheetSeries[]): SheetColumn[] {
  const perSeries = series.flatMap((s, i) =>
    schema.perSeries.map((col) => ({
      ...col,
      key: `${s.key}.${col.key}`,
      // A single value column per series is titled by the series; a multi-field
      // series (scatter's X and Y) needs both names to stay legible.
      header: schema.perSeries.length === 1 ? s.name : `${s.name} ${col.header}`,
      seriesKey: s.key,
      seriesIndex: i,
      field: col.key,
    })),
  );
  return [...schema.keyColumns, ...perSeries, ...schema.extraColumns];
}
