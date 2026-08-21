/**
 * The grids the period pickers draw.
 *
 * The native `date` and `month` inputs each browser draws are the wrong shape
 * for this form twice over: they look nothing like the rest of the panel, and
 * they ask for a day when the axis is months and a month when the axis is
 * weeks. So the panel draws its own — and the arithmetic lives here, away from
 * the markup, because "what does the January grid look like in a leap year"
 * is a question with an answer rather than something to eyeball.
 *
 * Everything is ISO `YYYY-MM-DD` in and out, same as `periodRange`, and every
 * month grid is six weeks whether or not the month needs the sixth: a popover
 * that changes height as you page through months is the jumpiness this
 * replaced.
 */
import { addMonths, fromEpochDay, fromIso, startOf, toEpochDay, toIso } from '@/model';

/** Weeks per month grid — fixed, so the popover doesn't resize as you page. */
const WEEKS = 6;

/** Column headers for a Monday-first grid, in the order the columns run. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

export const MONTH_ABBRS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface GridDay {
  /** ISO date of the cell. */
  iso: string;
  /** Day of the month, for the label. */
  day: number;
  /** Whether it belongs to the month being shown, or is spill either side. */
  inMonth: boolean;
}

/** The year and month `iso` falls in, for a header. */
export function monthOf(iso: string): { year: number; month: number } {
  const day = fromIso(iso);
  const c = fromEpochDay(day ?? 0);
  return { year: c.y, month: c.m };
}

/** `Jul 2026` — the heading over a day grid. */
export const monthTitle = (iso: string): string => {
  const { year, month } = monthOf(iso);
  return `${MONTH_ABBRS[month - 1]} ${year}`;
};

/**
 * Six Monday-first weeks covering the month `iso` falls in, oldest first.
 *
 * Cells outside the month are included rather than blanked: clicking 31 Aug
 * from the September grid is what an author means by it, and a week that
 * straddles two months has to be clickable from both.
 */
export function monthDays(iso: string): GridDay[] {
  const anchor = fromIso(iso);
  if (anchor === null) return [];
  const { year, month } = monthOf(iso);
  const first = toEpochDay(year, month, 1);
  const start = startOf('week', first);
  const out: GridDay[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const day = start + i;
    const c = fromEpochDay(day);
    out.push({ iso: toIso(day), day: c.d, inMonth: c.y === year && c.m === month });
  }
  return out;
}

/** The twelve months of the year `iso` falls in, as first-of-month ISO dates. */
export function monthsOfYear(iso: string): { iso: string; label: string }[] {
  const { year } = monthOf(iso);
  return MONTH_ABBRS.map((label, i) => ({ iso: toIso(toEpochDay(year, i + 1, 1)), label }));
}

/** The same day-of-month `n` months away, clamped to the target month's length. */
export function shiftMonths(iso: string, n: number): string {
  const day = fromIso(iso);
  return day === null ? iso : toIso(addMonths(day, n));
}

/** `n` years away, same month and day where it exists. */
export const shiftYears = (iso: string, n: number): string => shiftMonths(iso, n * 12);

/**
 * The cells of one year at a sub-year grain — the four quarters, the two
 * halves, the twelve months — as first-of-cell ISO dates.
 *
 * A year of quarters is a picker; a scrolling list of forty quarters is a
 * search. Paging by year and clicking Q3 is how a quarter gets said out loud.
 */
export function cellsInYear(grain: 'month' | 'quarter' | 'half', iso: string): string[] {
  const { year } = monthOf(iso);
  const per = grain === 'month' ? 1 : grain === 'quarter' ? 3 : 6;
  const out: string[] = [];
  for (let m = 1; m <= 12; m += per) out.push(toIso(toEpochDay(year, m, 1)));
  return out;
}
