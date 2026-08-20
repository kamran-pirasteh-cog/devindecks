/**
 * Turning what a person typed (or pasted out of Excel) into a cell value.
 *
 * Real spreadsheet data arrives dressed up: "$1,240", "(88)", "42.7%", "—".
 * Refusing all of that and making the user retype it is the fastest way to
 * make a datasheet feel fake. Anything genuinely unparseable is kept verbatim
 * as `invalid` rather than silently becoming zero.
 */
import { formatNumber } from '@/chart/format/number';
import { formatDate } from '@/chart/format/date';
import { parseDay, parseGrain } from '@/model/sheetSchema';
import { fromIso } from '@/model';
import type { CellType, CellValue, NumberFormat, SheetColumn } from '@/model';

/** Unicode minus, en dash and em dash all mean "minus" when pasted. */
const DASHES = /[−–—]/g;

/** Currency symbols we strip before parsing. */
const CURRENCY = /[$£€¥₹]/g;

/**
 * `1.234` is one-thousand-two-hundred-thirty-four in de-DE and 1.234 in en-US.
 * v1 assumes en-US and flags the ambiguity rather than guessing a locale — a
 * wrong guess silently changes every number on the slide by 1000×.
 */
export const AMBIGUOUS_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

export interface CoerceResult {
  value: CellValue;
  /** Set when the input parsed but something about it deserves a warning. */
  warning?: { code: string; message: string };
}

/**
 * What a cell needs to coerce: its type, and — for a date — what it stores.
 *
 * The column rather than just the type, because `date` means two different
 * things. A category axis's date column keeps the author's WORDING ("FY25" must
 * still read "FY25" after a round trip) and only needs to know what period it
 * denotes; a Gantt's Start cell must resolve to an actual day or the bar cannot
 * be placed. See `SheetColumn.dateGrain`.
 */
export type CoerceColumn = Pick<SheetColumn, 'type' | 'dateGrain'>;

export function coerceCell(raw: string, col: CellType | CoerceColumn): CoerceResult {
  const column: CoerceColumn = typeof col === 'string' ? { type: col } : col;
  const type = column.type;
  const s = raw.trim();
  if (!s) return { value: { kind: 'empty' } };

  switch (type) {
    case 'text':
      return { value: { kind: 'text', text: raw } };

    case 'enum':
      return { value: { kind: 'enum', value: s } };

    case 'date': {
      if (column.dateGrain === 'day') {
        // An exact day. The first real producer of `{ kind: 'date' }`, whose
        // slot in `CellValue` has been waiting for one.
        const iso = parseDay(s);
        return iso
          ? { value: { kind: 'date', iso } }
          : { value: { kind: 'invalid', raw, expected: 'date' } };
      }
      const parsed = parseGrain(s);
      // A period label keeps the author's own wording — "FY25" is what belongs
      // on the axis, not "2025-01-01".
      return parsed
        ? { value: { kind: 'text', text: s } }
        : { value: { kind: 'invalid', raw, expected: 'date' } };
    }

    case 'color': {
      // The other `CellValue` slot with no producer. A token id or a hex — the
      // same two things `ColorRef` carries, so nothing is lost on the way in.
      const hex = /^#?([0-9a-f]{6})$/i.exec(s);
      if (hex) return { value: { kind: 'color', ref: { kind: 'hex', hex: `#${hex[1]!.toLowerCase()}` } } };
      return /^[a-z][\w.-]*$/i.test(s)
        ? { value: { kind: 'color', ref: { kind: 'token', token: s } } }
        : { value: { kind: 'invalid', raw, expected: 'color' } };
    }

    case 'number':
    case 'percent': {
      const parsed = parseNumber(s);
      if (parsed === null) return { value: { kind: 'invalid', raw, expected: type } };
      // 42.7 / 100 is 0.42700000000000005 in binary floating point. Left
      // alone, that noise ends up in the spec, in the data label, and in the
      // JSON we hand to Devin — so it's cleaned at the point of entry.
      const n = s.endsWith('%') ? cleanFloat(parsed / 100) : parsed;
      const warning = AMBIGUOUS_THOUSANDS.test(s.replace(CURRENCY, ''))
        ? {
            code: 'ambiguous-decimal-separator',
            message: `"${s}" could be ${parsed} or a European thousands separator. Read as ${parsed}.`,
          }
        : undefined;
      return { value: { kind: 'number', n }, warning };
    }

    default:
      return { value: { kind: 'text', text: raw } };
  }
}

/** Drop binary-floating-point tail noise without changing the real value. */
export const cleanFloat = (n: number): number =>
  Number.isFinite(n) ? Number(n.toPrecision(12)) : n;

/**
 * The numeric core. Handles grouping separators, currency, trailing percent,
 * and accounting parentheses for negatives.
 */
export function parseNumber(input: string): number | null {
  let s = input.trim().replace(DASHES, '-').replace(CURRENCY, '').replace(/%$/, '').trim();
  if (!s) return null;

  let negative = false;
  if (/^\((.*)\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  }

  // Grouping commas only; a lone comma as a decimal point is the ambiguity we
  // refuse to guess at, so it fails rather than parsing wrongly.
  if (/,/.test(s) && !/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) return null;
  s = s.replace(/,/g, '');

  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.?\d*$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** What a cell shows when it isn't being edited. */
export function formatCell(value: CellValue, format?: NumberFormat, dateFormat?: string): string {
  switch (value.kind) {
    case 'empty':
      return '';
    case 'number':
      return format ? formatNumber(value.n, format).text : trimNumber(value.n);
    case 'text':
      return value.text;
    case 'date':
      // ISO unless the column names a pattern: a sheet of "2026-03-14" beside a
      // chart reading "14 Mar '26" is two spellings of one date.
      return dateFormat ? formatDate(fromIso(value.iso) ?? 0, dateFormat) : value.iso;
    case 'enum':
      return value.value;
    case 'invalid':
      return value.raw;
    case 'color':
      return value.ref.kind === 'hex' ? value.ref.hex : value.ref.token;
  }
}

/** What a cell shows once you start editing it — always the raw figure. */
export function editText(value: CellValue): string {
  // A date edits as ISO whatever it DISPLAYS as: it is unambiguous, `parseDay`
  // reads it back exactly, and it is the one spelling that never depends on
  // which country the author is in.
  if (value.kind === 'date') return value.iso;
  return value.kind === 'number' ? trimNumber(value.n) : formatCell(value);
}

/**
 * Numbers round-trip through the editor without gaining noise: 1240 stays
 * "1240", and 0.1 + 0.2 doesn't become "0.30000000000000004".
 */
function trimNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}
