/**
 * A range of periods, held as the two ends rather than as a length.
 *
 * "The last 8 quarters" is a question about today; "Q3'24 to Q2'26" is a
 * statement about the chart. The second is what an author means, what the axis
 * shows, and what a research brief has to be able to quote — and it stops being
 * true the moment nobody edits it, whereas a length silently means something
 * different next month. So the ends are stored and the length is derived.
 *
 * Both ends are ISO dates SNAPPED to the start of their cell at the grain: the
 * first day of the quarter, the Monday of the week. That makes two ranges equal
 * when they cover the same periods, whatever day inside them got clicked.
 *
 * The labels come from `periodLabels` rather than from anything here — one
 * labeller, so a range built with the pickers reads identically to one read out
 * of a typed sentence.
 */
import { fromIso, startOf, nextCell, toIso, type DateGrain } from '@/model';
import { periodLabels } from './intent';

export interface PeriodRange {
  /** First period included, ISO, snapped to its cell. */
  from: string;
  /** Last period included, ISO, snapped to its cell. */
  to: string;
}

/**
 * The most cells a range may cover.
 *
 * Not a taste limit — `setupIssues` has one of those, much lower. This is the
 * bound that stops a mis-set day range asking the compiler for four hundred
 * categories.
 */
export const MAX_CELLS = 120;

/** The start of the cell `iso` falls in, as ISO. The canonical form of an end. */
export function snap(grain: DateGrain, iso: string): string {
  const day = fromIso(iso);
  return day === null ? iso : toIso(startOf(grain, day));
}

/** The cell today falls in — the period in progress. */
export const currentCell = (grain: DateGrain, asOf: string): string => snap(grain, asOf);

/** `n` cells later, or earlier for a negative `n`. */
export function shiftCells(grain: DateGrain, iso: string, n: number): string {
  const start = fromIso(snap(grain, iso));
  if (start === null) return iso;
  let day = start;
  if (n >= 0) {
    for (let i = 0; i < n; i++) day = nextCell(grain, day);
    return toIso(day);
  }
  // Backwards has no `prevCell`, and subtracting a fixed number of days is
  // wrong for every grain a month or longer. Stepping back a day from the start
  // of a cell lands inside the previous one, whatever its length.
  for (let i = 0; i < -n; i++) day = startOf(grain, day - 1);
  return toIso(day);
}

/**
 * How many cells the range covers, both ends included. Zero for a range whose
 * ends are the wrong way round, which is what makes that state visible rather
 * than silently drawing one period.
 */
export function cellCount(grain: DateGrain, range: PeriodRange): number {
  const from = fromIso(snap(grain, range.from));
  const to = fromIso(snap(grain, range.to));
  if (from === null || to === null || to < from) return 0;
  let n = 1;
  let day = from;
  while (day < to && n < MAX_CELLS) {
    day = nextCell(grain, day);
    n++;
  }
  return n;
}

/** The `count` cells ending with the one `to` falls in. */
export const rangeEndingAt = (grain: DateGrain, to: string, count: number): PeriodRange => ({
  from: shiftCells(grain, to, -(Math.max(1, count) - 1)),
  to: snap(grain, to),
});

/** One cell's label, spelled exactly as it would be on an axis. */
export const cellLabel = (grain: DateGrain, iso: string, fiscal = false): string =>
  periodLabels(grain, 1, snap(grain, iso), fiscal)[0] ?? '';

/** Every label in the range, oldest first. */
export function rangeLabels(grain: DateGrain, range: PeriodRange, fiscal = false): string[] {
  const count = cellCount(grain, range);
  return count === 0 ? [] : periodLabels(grain, count, snap(grain, range.to), fiscal);
}

/**
 * The cell halfway along, for the one caller that wants a middle: a three-point
 * dot plot reading "was, halfway, now".
 */
export const midCell = (grain: DateGrain, range: PeriodRange): string =>
  shiftCells(grain, range.from, Math.floor((cellCount(grain, range) - 1) / 2));

/**
 * Whether the range ends on the period still in progress.
 *
 * The whole reason the ends are stored: with a length, this was a setting
 * somebody had to remember to tick. With ends, it is a fact about the range —
 * and it stays a fact next month, when the same chart is no longer up to date
 * and shouldn't quietly pretend to be.
 */
export const endsOnCurrent = (grain: DateGrain, range: PeriodRange, asOf: string): boolean =>
  snap(grain, range.to) === currentCell(grain, asOf);

/* ------------------------------------------------------------------ */
/* Picker options                                                     */
/* ------------------------------------------------------------------ */

/** How far either side of today the quarter and year pickers reach. */
const BACK_YEARS = 6;
const FORWARD_YEARS = 2;

/**
 * The options for a period picker at this grain — used for the grains a native
 * input can't offer (quarters, years, halves). Newest last, so the list reads in
 * the direction the axis does.
 */
export function cellOptions(
  grain: DateGrain,
  asOf: string,
  fiscal = false,
): { value: string; label: string }[] {
  const per = grain === 'year' ? 1 : grain === 'half' ? 2 : 4;
  // Plus one: the window spans both endpoints, so six years back and two
  // forward is nine years of options, not eight.
  const total = (BACK_YEARS + FORWARD_YEARS) * per + 1;
  const end = shiftCells(grain, currentCell(grain, asOf), FORWARD_YEARS * per);
  const out: { value: string; label: string }[] = [];
  for (let i = total - 1; i >= 0; i--) {
    const value = shiftCells(grain, end, -i);
    out.push({ value, label: cellLabel(grain, value, fiscal) });
  }
  return out;
}

/**
 * Which control a grain wants.
 *
 * Three, not one: a day is a date, a month is the `month` input every browser
 * already draws, and a quarter is neither — there is no native quarter picker
 * and a date input asking for one invites the wrong precision. A week is a date
 * input labelled as the week beginning, which is what a weekly axis means.
 */
export const pickerFor = (grain: DateGrain): 'date' | 'month' | 'select' =>
  grain === 'day' || grain === 'week' ? 'date' : grain === 'month' ? 'month' : 'select';
