/**
 * Structural edits to a sheet — rows, series, fill, paste.
 *
 * All pure and all returning a new `SheetModel`, so the grid's undo ring is a
 * plain stack of snapshots and every one of these is testable without a DOM.
 */
import { nanoid } from 'nanoid';
import {
  cellText,
  columnsFor,
  EMPTY,
  rangeBounds,
  type CellRange,
  type CellType,
  type CellValue,
  type SheetColumn,
  type SheetModel,
  type SheetSeries,
} from '@/model';
import { coerceCell } from './sheetCoerce';
import { looksLikeHeaderRow } from './sheetClipboard';

const blankRow = (width: number): CellValue[] => Array.from({ length: width }, () => EMPTY);

const withRows = (sheet: SheetModel, rows: CellValue[][]): SheetModel => ({ ...sheet, rows });

/** Rebuild the derived column list after the series change. */
const withSeries = (sheet: SheetModel, series: SheetSeries[], rows: CellValue[][]): SheetModel => ({
  ...sheet,
  series,
  columns: columnsFor(sheet.schema, series),
  rows,
});

/* ------------------------------------------------------------------ */
/* Rows                                                               */
/* ------------------------------------------------------------------ */

export function insertRow(sheet: SheetModel, at: number): SheetModel {
  const { caps } = sheet.schema;
  if (!caps.addRows) return sheet;
  // A transposed grid's rows are series, so a pie's one-ring limit is a row
  // limit here — the same cap `maxSeries` applies the other way round.
  if (caps.maxRows !== undefined && sheet.rows.length >= caps.maxRows) return sheet;
  const rows = [...sheet.rows];
  rows.splice(clamp(at, 0, rows.length), 0, blankRow(sheet.columns.length));
  return withRows(sheet, rows);
}

export function deleteRows(sheet: SheetModel, from: number, to = from): SheetModel {
  const min = sheet.schema.caps.minRows ?? 1;
  const [a, b] = [Math.min(from, to), Math.max(from, to)];
  const remaining = sheet.rows.length - (b - a + 1);
  if (remaining < min) return sheet;
  const rows = sheet.rows.filter((_, i) => i < a || i > b);
  const bandValues = mapBands(sheet, (vals) => vals.filter((_, i) => i < a || i > b));
  return { ...withRows(sheet, rows), bandValues };
}

/**
 * Does this row hold any data, beyond the key columns that merely name it?
 *
 * What makes Delete safe to overload. A row nobody has typed a number into is
 * scaffolding — Delete takes the whole thing away, which is what "delete this
 * series" means when the sheet is transposed and a row IS a series. A row with
 * figures in it is data, and Delete goes back to meaning "clear this cell".
 */
export function rowHasData(sheet: SheetModel, r: number): boolean {
  const row = sheet.rows[r];
  if (!row) return false;
  const keys = sheet.schema.keyColumns.length;
  return row.some((cell, c) => c >= keys && (cell?.kind ?? 'empty') !== 'empty');
}

/** The same question of a series, across every column it owns. */
export function seriesHasData(sheet: SheetModel, seriesKey: string): boolean {
  const owned = sheet.columns.flatMap((col, i) => (col.seriesKey === seriesKey ? [i] : []));
  if (!owned.length) return false;
  return sheet.rows.some((row) => owned.some((i) => (row[i]?.kind ?? 'empty') !== 'empty'));
}

export function moveRow(sheet: SheetModel, from: number, to: number): SheetModel {
  if (!sheet.schema.caps.reorderRows || from === to) return sheet;
  const rows = [...sheet.rows];
  const [moved] = rows.splice(from, 1);
  if (!moved) return sheet;
  rows.splice(clamp(to, 0, rows.length), 0, moved);
  const bandValues = mapBands(sheet, (vals) => {
    const next = [...vals];
    const [v] = next.splice(from, 1);
    next.splice(clamp(to, 0, next.length), 0, v ?? EMPTY);
    return next;
  });
  return { ...withRows(sheet, rows), bandValues };
}

/* ------------------------------------------------------------------ */
/* Series                                                             */
/* ------------------------------------------------------------------ */

export function addSeries(sheet: SheetModel, name?: string): SheetModel {
  return insertSeries(sheet, sheet.series.length, name);
}

/**
 * A column insert, Excel's "insert left / insert right".
 *
 * One series is one logical column even when the schema paints it as several
 * (scatter's X and Y), so this inserts at a SERIES index; `reflow` then carries
 * every existing value across to its new position by column key.
 */
export function insertSeries(sheet: SheetModel, at: number, name?: string): SheetModel {
  const { caps } = sheet.schema;
  if (!caps.addSeries) return sheet;
  if (caps.maxSeries !== undefined && sheet.series.length >= caps.maxSeries) return sheet;

  const series = [...sheet.series];
  series.splice(clamp(at, 0, series.length), 0, {
    key: `s-${nanoid(5)}`,
    name: name ?? nextSeriesName(sheet),
  });
  const added = sheet.schema.perSeries.length;
  const rows = sheet.rows.map((r) => [...r, ...blankRow(added)]);
  // New columns land before the fixed extras, so a waterfall's Kind column
  // stays on the right where the user expects it.
  return reflow(withSeries(sheet, series, rows), sheet);
}

/** "Series 4" — the first index that isn't already taken, not just length + 1. */
function nextSeriesName(sheet: SheetModel): string {
  // Under the transposed layout a column group is a CATEGORY, and calling a new
  // period "Series 4" would put that word on the chart's own axis.
  const noun = sheet.schema.layout === 'seriesDown' ? 'Category' : 'Series';
  const taken = new Set(sheet.series.map((s) => s.name));
  for (let i = sheet.series.length + 1; ; i++) {
    const name = `${noun} ${i}`;
    if (!taken.has(name)) return name;
  }
}

export function deleteSeries(sheet: SheetModel, seriesKey: string): SheetModel {
  if (sheet.series.length <= 1) return sheet;
  const series = sheet.series.filter((s) => s.key !== seriesKey);
  const keep = sheet.columns.map((c) => c.seriesKey !== seriesKey);
  const rows = sheet.rows.map((r) => r.filter((_, i) => keep[i]));
  return withSeries(sheet, series, rows);
}

export function renameSeries(sheet: SheetModel, seriesKey: string, name: string): SheetModel {
  const series = sheet.series.map((s) => (s.key === seriesKey ? { ...s, name } : s));
  return { ...sheet, series, columns: columnsFor(sheet.schema, series) };
}

export function moveSeries(sheet: SheetModel, from: number, to: number): SheetModel {
  if (!sheet.schema.caps.reorderSeries || from === to) return sheet;
  const series = [...sheet.series];
  const [moved] = series.splice(from, 1);
  if (!moved) return sheet;
  series.splice(clamp(to, 0, series.length), 0, moved);
  return reflow(withSeries(sheet, series, sheet.rows), sheet);
}

/**
 * Re-lay the row cells to match a new column order. Cells are addressed by
 * column position, so any change to the column list has to carry the data
 * across by key or every value shifts under its neighbour's header.
 */
function reflow(next: SheetModel, prev: SheetModel): SheetModel {
  const oldIndex = new Map(prev.columns.map((c, i) => [c.key, i]));
  const rows = next.rows.map((_, r) =>
    next.columns.map((c) => {
      const i = oldIndex.get(c.key);
      return i === undefined ? EMPTY : (prev.rows[r]?.[i] ?? EMPTY);
    }),
  );
  return { ...next, rows };
}

/* ------------------------------------------------------------------ */
/* Cell edits                                                         */
/* ------------------------------------------------------------------ */

export function setCell(sheet: SheetModel, r: number, c: number, value: CellValue): SheetModel {
  const rows = sheet.rows.map((row, i) =>
    i === r ? row.map((cell, j) => (j === c ? value : cell)) : row,
  );
  return withRows(sheet, rows);
}

export function clearRange(sheet: SheetModel, range: CellRange): SheetModel {
  const { r0, r1, c0, c1 } = rangeBounds(range);
  const rows = sheet.rows.map((row, r) =>
    r < r0 || r > r1 ? row : row.map((cell, c) => (c >= c0 && c <= c1 ? EMPTY : cell)),
  );
  return withRows(sheet, rows);
}

/**
 * Excel's ⌘D / ⌘R — repeat the leading edge across the selection.
 *
 * Grows the sheet to reach a selection that runs off the bottom of the data,
 * the way pasting does: dragging down through the blank rows and pressing ⌘D is
 * how a column of "same as last year" gets typed once instead of six times.
 * Columns are NOT grown — a phantom column is a whole new category or series,
 * and filling one into existence is a bigger edit than the keystroke implies.
 *
 * The value carried across is coerced into the column it lands in, so filling a
 * label sideways into number cells keeps the text and raises a diagnostic
 * rather than silently dropping it.
 */
export function fillRange(sheet: SheetModel, range: CellRange, dir: 'down' | 'right'): SheetModel {
  const { r0, r1, c0, c1 } = rangeBounds(range);
  if (r0 === r1 && dir === 'down') return sheet;
  if (c0 === c1 && dir === 'right') return sheet;

  let next = sheet;
  while (next.rows.length <= r1) {
    const grown = insertRow(next, next.rows.length);
    if (grown === next) break;
    next = grown;
  }

  const source = next.rows;
  const rows = source.map((row, r) => {
    if (r < r0 || r > r1) return row;
    return row.map((cell, c) => {
      if (c < c0 || c > c1) return cell;
      if (dir === 'down' ? r === r0 : c === c0) return cell;
      const from = dir === 'down' ? source[r0]?.[c] : source[r]?.[c0];
      return fitToColumn(from, next.columns[c], cell);
    });
  });
  return withRows(next, rows);
}

/**
 * The filled value as the destination column can hold it. A cell of the right
 * shape is copied verbatim — coercing a colour or a date through its text would
 * be a lossy round trip — and anything else goes through the same coercion a
 * paste uses.
 */
function fitToColumn(
  from: CellValue | undefined,
  col: SheetColumn | undefined,
  current: CellValue,
): CellValue {
  if (!col || col.editable === false) return current;
  if (!from || from.kind === 'empty') return EMPTY;
  if (matchesType(from, col.type)) return from;
  return coerceCell(cellText(from), col).value;
}

const matchesType = (cell: CellValue, type: CellType): boolean => {
  switch (cell.kind) {
    case 'number':
      return type === 'number' || type === 'percent';
    case 'text':
      return type === 'text';
    case 'date':
      return type === 'date';
    case 'enum':
      return type === 'enum';
    case 'color':
      return type === 'color';
    default:
      return false;
  }
};

/* ------------------------------------------------------------------ */
/* Paste                                                              */
/* ------------------------------------------------------------------ */

export interface PasteResult {
  sheet: SheetModel;
  /** Rows and series the paste had to create to fit. */
  grewRows: number;
  grewSeries: number;
  /** True when the first pasted row was consumed as series names. */
  usedHeaderRow: boolean;
  warnings: { code: string; message: string }[];
}

export interface PasteOptions {
  /** Force header handling instead of offering it. Undefined = auto-detect. */
  useHeaderRow?: boolean;
}

/**
 * Paste a block at `at`, growing the sheet to fit.
 *
 * A 1×1 block fills the whole selection (Excel's behaviour, and the fastest way
 * to zero a column). Anything larger overwrites from the anchor down and right.
 */
export function pasteTable(
  sheet: SheetModel,
  at: { r: number; c: number },
  block: string[][],
  range?: CellRange,
  opts: PasteOptions = {},
): PasteResult {
  const warnings: PasteResult['warnings'] = [];
  if (!block.length) {
    return { sheet, grewRows: 0, grewSeries: 0, usedHeaderRow: false, warnings };
  }

  let next = sheet;
  let usedHeaderRow = false;
  let body = block;

  const wantsHeader = opts.useHeaderRow ?? looksLikeHeaderRow(block);
  if (wantsHeader && sheet.schema.caps.addSeries) {
    usedHeaderRow = true;
    body = block.slice(1);
  }

  // Single cell into a multi-cell selection: fill the selection.
  if (body.length === 1 && body[0].length === 1 && range) {
    const { r0, r1, c0, c1 } = rangeBounds(range);
    const raw = body[0][0];
    let filled = next;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        filled = writeCell(filled, r, c, raw, warnings);
      }
    }
    return { sheet: filled, grewRows: 0, grewSeries: 0, usedHeaderRow: false, warnings };
  }

  // Grow series first, so the columns exist before we address them.
  const width = Math.max(...body.map((r) => r.length));
  const perSeries = Math.max(1, sheet.schema.perSeries.length);
  const keyCols = sheet.schema.keyColumns.length;
  const neededSeries = Math.ceil(Math.max(0, width - keyCols) / perSeries);
  let grewSeries = 0;
  while (
    next.series.length < neededSeries &&
    next.schema.caps.addSeries &&
    (next.schema.caps.maxSeries === undefined || next.series.length < next.schema.caps.maxSeries)
  ) {
    const headerName = usedHeaderRow
      ? block[0][keyCols + next.series.length * perSeries]
      : undefined;
    const grown = addSeries(next, headerName?.trim() || undefined);
    if (grown === next) break;
    next = grown;
    grewSeries++;
  }
  if (next.series.length < neededSeries) {
    warnings.push({
      code: 'series-capped',
      message: `This chart takes at most ${next.series.length} series; ${neededSeries - next.series.length} pasted column(s) were ignored.`,
    });
  }
  if (usedHeaderRow && !grewSeries) {
    // Header names still apply to the series that already exist.
    next = block[0]
      .slice(keyCols)
      .reduce(
        (acc, name, i) =>
          i < acc.series.length && name.trim()
            ? renameSeries(acc, acc.series[i].key, name.trim())
            : acc,
        next,
      );
  }

  let grewRows = 0;
  while (next.rows.length < at.r + body.length && next.schema.caps.addRows) {
    const grown = insertRow(next, next.rows.length);
    if (grown === next) break;
    next = grown;
    grewRows++;
  }
  const droppedRows = at.r + body.length - next.rows.length;
  if (droppedRows > 0) {
    // Same contract as the series cap: a block that doesn't fit is REPORTED,
    // never quietly truncated. A transposed grid caps rows (a pie has one
    // ring), so this is the row-shaped half of the same warning.
    warnings.push({
      code: 'rows-capped',
      message: `This chart takes at most ${next.rows.length} row${next.rows.length === 1 ? '' : 's'}; ${droppedRows} pasted row(s) were ignored.`,
    });
  }

  for (let i = 0; i < body.length; i++) {
    for (let j = 0; j < body[i].length; j++) {
      const r = at.r + i;
      const c = at.c + j;
      if (r >= next.rows.length || c >= next.columns.length) continue;
      next = writeCell(next, r, c, body[i][j], warnings);
    }
  }

  return { sheet: next, grewRows, grewSeries, usedHeaderRow, warnings };
}

function writeCell(
  sheet: SheetModel,
  r: number,
  c: number,
  raw: string,
  warnings: PasteResult['warnings'],
): SheetModel {
  const col = sheet.columns[c];
  if (!col || col.editable === false) return sheet;
  const { value, warning } = coerceCell(raw, col);
  if (warning && !warnings.some((w) => w.code === warning.code)) warnings.push(warning);
  return setCell(sheet, r, c, value);
}

/* ------------------------------------------------------------------ */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function mapBands(
  sheet: SheetModel,
  fn: (vals: CellValue[]) => CellValue[],
): SheetModel['bandValues'] {
  const out: SheetModel['bandValues'] = {};
  for (const [k, v] of Object.entries(sheet.bandValues)) out[k] = fn(v);
  return out;
}
