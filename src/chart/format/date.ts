/**
 * Calendar arithmetic and date formatting for the timescale.
 *
 * The sibling of `format/number.ts`, and deliberately not part of it: that file
 * is about digits, grouping and scale suffixes, none of which a date has.
 *
 * Two rules, both load-bearing:
 *
 * 1. **Never `new Date(string)`, and never a `Date` at all.** `parseGrain` already
 *    states the case — it is browser-dependent and happily parses "Enterprise"
 *    on some engines. Here the stakes are higher: a misparse doesn't mislabel an
 *    axis, it moves a bar into the wrong month. Everything below is integer
 *    arithmetic on `EpochDay`, which has no timezone, no DST and no locale, so a
 *    deck authored in Berlin and exported in California say the same thing.
 *
 * 2. **Locale is pinned to en-US**, as in `format/number.ts`. A chart's text is
 *    export-bound; a viewer's locale must not change what the slide says.
 *
 * The conversions themselves live in `model/units.ts`, beside `EpochDay` and
 * the EMU helpers — they are unit arithmetic, and putting them here would make
 * the model layer import from the chart layer to build a sample. What lives
 * here is PRESENTATION: patterns, band walks, and the working week.
 */
import {
  fromEpochDay,
  nextCell,
  startOf,
  toEpochDay,
  type EpochDay,
  type GanttGrain,
} from '@/model';

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number, w: number): string => String(Math.abs(n)).padStart(w, '0');

/**
 * ISO-8601 week number, which is the only week numbering a business calendar
 * uses: weeks start Monday and week 1 is the one containing 4 January.
 */
export function isoWeek(day: EpochDay): { week: number; year: number } {
  // Shift to the Thursday of this ISO week; its calendar year IS the ISO year.
  const { dow } = fromEpochDay(day);
  const isoDow = dow === 0 ? 7 : dow; // Monday = 1 … Sunday = 7
  const thursday = day + (4 - isoDow);
  const { y } = fromEpochDay(thursday);
  const jan1 = toEpochDay(y, 1, 1);
  return { week: Math.floor((thursday - jan1) / 7) + 1, year: y };
}

/**
 * Format one day against a pattern. Tokens, matched longest-first:
 *
 *   yyyy yy | MMMM MMM MM M | dd d | EEEE EEE EE | QQ Q | HH H | ww
 *
 * Anything inside single quotes is a literal, as in ICU, and `''` is one
 * apostrophe — so `"d MMM ''yy"` gives `3 Apr '25`. Unrecognised characters
 * pass through, which is what makes `"MMM d, yyyy"` work without escaping the
 * comma.
 */
export function formatDate(day: EpochDay, pattern: string): string {
  const c = fromEpochDay(day);
  const quarter = Math.floor((c.m - 1) / 3) + 1;
  const half = c.m <= 6 ? 1 : 2;

  const TOKENS: [string, () => string][] = [
    ['yyyy', () => pad(c.y, 4)],
    ['yy', () => pad(c.y % 100, 2)],
    ['MMMM', () => MONTHS_LONG[c.m - 1]],
    ['MMM', () => MONTHS_LONG[c.m - 1].slice(0, 3)],
    ['MM', () => pad(c.m, 2)],
    ['M', () => String(c.m)],
    ['dd', () => pad(c.d, 2)],
    ['d', () => String(c.d)],
    ['EEEE', () => DAYS_LONG[c.dow]],
    ['EEE', () => DAYS_LONG[c.dow].slice(0, 3)],
    ['EE', () => DAYS_LONG[c.dow].slice(0, 2)],
    ['QQ', () => `Q${quarter}`],
    ['Q', () => String(quarter)],
    ['HH', () => `H${half}`],
    ['H', () => String(half)],
    ['ww', () => `W${pad(isoWeek(day).week, 2)}`],
  ];

  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "'") {
      // '' is a literal apostrophe; otherwise run to the closing quote.
      if (pattern[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      const end = pattern.indexOf("'", i + 1);
      out += end < 0 ? pattern.slice(i + 1) : pattern.slice(i + 1, end);
      i = end < 0 ? pattern.length : end + 1;
      continue;
    }
    const hit = TOKENS.find((t) => pattern.startsWith(t[0], i));
    if (hit) {
      out += hit[1]();
      i += hit[0].length;
      continue;
    }
    out += pattern[i];
    i += 1;
  }
  return out;
}

/** The house pattern for each grain, used when a band names none. */
export const DEFAULT_BAND_FORMAT: Record<GanttGrain, string> = {
  year: 'yyyy',
  half: "HH ''yy",
  quarter: "QQ ''yy",
  month: 'MMM',
  week: 'ww',
  day: 'd',
};

/* ------------------------------------------------------------------ */
/* Band cells                                                         */
/* ------------------------------------------------------------------ */

export interface TimeBandCell {
  /** Half-open [from, to), clipped to the requested range. */
  from: EpochDay;
  to: EpochDay;
  /** The cell's own start, BEFORE clipping — what the label is computed from. */
  cellFrom: EpochDay;
  label: string;
}

/**
 * The cells of one band across `[from, to)`, clipped at both ends.
 *
 * A cell is clipped rather than dropped: a plan starting mid-February still
 * wants a "Feb" heading over its first fortnight, and the reader reads the
 * label, not the cell's width.
 */
export function bandCells(
  grain: GanttGrain,
  from: EpochDay,
  to: EpochDay,
  opts: { weekStart?: 0 | 1; format?: string } = {},
): TimeBandCell[] {
  if (!(to > from)) return [];
  const weekStart = opts.weekStart ?? 1;
  const pattern = opts.format ?? DEFAULT_BAND_FORMAT[grain];

  const cells: TimeBandCell[] = [];
  let cursor = startOf(grain, from, weekStart);
  // A wide range at a fine grain is a mistake upstream, not a reason to hang:
  // `grainFor` picks the grain, and this is the backstop if it ever misjudges.
  for (let guard = 0; cursor < to && guard < 4096; guard++) {
    const end = nextCell(grain, cursor, weekStart);
    cells.push({
      from: Math.max(cursor, from),
      to: Math.min(end, to),
      cellFrom: cursor,
      label: formatDate(cursor, pattern),
    });
    cursor = end;
  }
  return cells;
}

/** Whether a day falls outside the working week. `workdays` is 0 = Sunday. */
export const isWorkday = (day: EpochDay, workdays: number[] = [1, 2, 3, 4, 5]): boolean =>
  workdays.includes(fromEpochDay(day).dow);

/** Whole days between two epoch days — a half-open span's duration. */
export const spanDays = (from: EpochDay, to: EpochDay): number => Math.max(0, to - from);
