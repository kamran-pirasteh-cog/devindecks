/**
 * Turning what a person typed (or pasted out of Excel) into a cell value.
 *
 * Real spreadsheet data arrives dressed up: "$1,240", "(88)", "42.7%", "—".
 * Refusing all of that and making the user retype it is the fastest way to
 * make a datasheet feel fake. Anything genuinely unparseable is kept verbatim
 * as `invalid` rather than silently becoming zero.
 */
import { formatNumber } from '@/chart/format/number';
import { parseGrain } from '@/model/sheetSchema';
import type { CellType, CellValue, NumberFormat } from '@/model';

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

export function coerceCell(raw: string, type: CellType): CoerceResult {
  const s = raw.trim();
  if (!s) return { value: { kind: 'empty' } };

  switch (type) {
    case 'text':
      return { value: { kind: 'text', text: raw } };

    case 'enum':
      return { value: { kind: 'enum', value: s } };

    case 'date': {
      const parsed = parseGrain(s);
      // A date column keeps the author's own wording — "FY25" is what belongs
      // on the axis, not "2025-01-01".
      return parsed
        ? { value: { kind: 'text', text: s } }
        : { value: { kind: 'invalid', raw, expected: 'date' } };
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
export function formatCell(value: CellValue, format?: NumberFormat): string {
  switch (value.kind) {
    case 'empty':
      return '';
    case 'number':
      return format ? formatNumber(value.n, format).text : trimNumber(value.n);
    case 'text':
      return value.text;
    case 'date':
      return value.iso;
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
