/**
 * How a DATED category axis writes its ticks.
 *
 * The sheet holds the author's words — "Q3 2024", "2026-04-06", "May 2024" —
 * because that is what they typed and what `parseGrain` reads back. An axis is
 * not a column of a sheet, though: it is read sideways, at eight points, next
 * to eleven of its neighbours, and the house form for it is shorter than
 * anything anyone types. So the labels are RE-WRITTEN on the way to the axis,
 * from the period each one denotes:
 *
 *   year      '17   '18            the century is the same on every tick
 *   quarter   2Q25  4Q26           the analyst's form, quarter first
 *   month     May-24 Jun-24
 *   week      7/15  7/21           the week's END, under a "Week ending" title
 *
 * Nothing here parses a date at render time beyond what `parseGrain` already
 * does, and nothing invents one: a label that doesn't denote a period passes
 * through untouched, so a segment axis of product names is left alone.
 *
 * The pattern vocabulary is `formatDate`'s — one date formatter for the deck,
 * shared with the Gantt timescale. What this file adds is the DEFAULTS per
 * grain and the translator for the custom box (`parseDatePattern`), which is
 * to dates what `pattern.ts` is to numbers.
 */
import { fromIso, parseGrain, type DateGrain } from '@/model';
import { formatDate } from './date';

/**
 * The house pattern per grain — the four forms above.
 *
 * Deliberately not `DEFAULT_BAND_FORMAT`: a Gantt band is a HEADING over a
 * span of days, wide enough for "Q2 '25" and needing the space filled, where
 * an axis tick is a point label competing with its neighbours for room.
 */
export const DEFAULT_TICK_FORMAT: Record<DateGrain, string> = {
  year: "''yy",
  half: "HH ''yy",
  quarter: "Q'Q'yy",
  month: 'MMM-yy',
  week: 'M/d',
  day: 'M/d',
};

/** The title a grain implies when the author hasn't written one. */
export const DEFAULT_AXIS_TITLE: Partial<Record<DateGrain, string>> = {
  // A weekly tick reads "7/15", which is one day of the seven. Saying which
  // one is the difference between an axis and a riddle, and it belongs on the
  // axis rather than repeated on every tick.
  week: 'Week ending',
};

/**
 * The day a tick's text is computed from — the start of its period, except for
 * a week, which is labelled by the day it ENDS on. That is the convention the
 * "Week ending" title states, and a weekly column labelled by its Monday is
 * routinely read as covering the week before.
 */
const labelDay = (grain: DateGrain, iso: string): number | null => {
  const day = fromIso(iso);
  if (day === null) return null;
  return grain === 'week' ? day + 6 : day;
};

/**
 * The grain a whole axis is at, or null when it isn't dated.
 *
 * Two things happen here that no single label can answer:
 *
 * 1. **A week looks like a day.** `periodLabels` writes weekly periods as the
 *    ISO date they begin on, so `parseGrain` reports `day` for both. The step
 *    between the labels is what separates them, which is a question about the
 *    SET.
 * 2. **A stray name doesn't undate the axis.** The rule matches `looksDated`:
 *    a strong majority of dated labels means a dated axis, and the odd
 *    "Budget" column keeps its own text.
 */
export function axisGrain(labels: string[]): DateGrain | null {
  if (labels.length < 2) return null;
  const parsed = labels.map((l) => parseGrain(l));
  const dated = parsed.filter((p) => p !== null);
  if (dated.length / labels.length < 0.8) return null;

  // The FINEST grain any label names wins: an axis of months carrying a "2024"
  // total column is a monthly axis, and writing those months as years would
  // collapse twelve ticks into one word repeated twelve times.
  const ORDER: DateGrain[] = ['day', 'week', 'month', 'quarter', 'half', 'year'];
  let grain = dated[0]!.grain;
  for (const p of dated) {
    if (ORDER.indexOf(p!.grain) < ORDER.indexOf(grain)) grain = p!.grain;
  }
  if (grain !== 'day') return grain;

  // Day grain: promote to week when every step is a whole week. Uniform, not
  // "mostly" — a gap of 7 between two of eight dailies says nothing.
  const days = dated.map((p) => fromIso(p!.iso)).filter((d): d is number => d !== null);
  if (days.length < 2) return 'day';
  const steps = days.slice(1).map((d, i) => d - days[i]!);
  return steps.every((s) => s === 7) ? 'week' : 'day';
}

/**
 * The axis's labels as the axis should write them.
 *
 * `pattern` is the author's override; without one the grain's house form is
 * used. Undated axes — and undated labels on a dated axis — come back as they
 * went in, which is what makes this safe to run over every chart's categories.
 */
export function formatTickLabels(
  labels: string[],
  pattern?: string,
): { labels: string[]; grain: DateGrain | null } {
  const grain = axisGrain(labels);
  if (!grain) return { labels, grain: null };
  const fmt = pattern ?? DEFAULT_TICK_FORMAT[grain];
  return {
    grain,
    labels: labels.map((raw) => {
      const p = parseGrain(raw);
      if (!p) return raw;
      const day = labelDay(grain, p.iso);
      return day === null ? raw : formatDate(day, fmt);
    }),
  };
}

/** What a pattern looks like on a real tick, for a menu row or a preview. */
export const sampleTick = (grain: DateGrain, pattern: string, iso = '2025-04-14'): string => {
  const day = labelDay(grain, iso);
  return day === null ? pattern : formatDate(day, pattern);
};

/**
 * The patterns offered per grain, house form first.
 *
 * Short lists on purpose: these are the forms a business chart actually uses,
 * and anything else is what the custom box is for.
 */
export const TICK_FORMAT_CHOICES: Record<DateGrain, string[]> = {
  year: ["''yy", 'yyyy', "'FY'yy"],
  half: ["HH ''yy", "HH yyyy"],
  quarter: ["Q'Q'yy", "'Q'Q ''yy", "'Q'Q yyyy"],
  month: ['MMM-yy', 'MMM', 'MMMM yyyy', 'MM/yy'],
  week: ['M/d', 'MM/dd', 'MMM d', 'ww'],
  day: ['M/d', 'MM/dd/yy', 'MMM d', 'd MMM'],
};

/* ------------------------------------------------------------------ */
/* The custom box                                                     */
/* ------------------------------------------------------------------ */

/** Tokens as people type them, mapped to what `formatDate` reads. */
const ALIASES: [RegExp, string][] = [
  [/^YYYY/, 'yyyy'],
  [/^YY/, 'yy'],
  [/^DDDD/, 'EEEE'], // think-cell spells the weekday name with Ds
  [/^DDD/, 'EEE'],
  [/^DD/, 'dd'],
  [/^D/, 'd'],
];

/** Tokens `formatDate` already knows, longest first. */
const TOKENS = [
  'yyyy', 'yy', 'MMMM', 'MMM', 'MM', 'M', 'dd', 'd',
  'EEEE', 'EEE', 'EE', 'QQ', 'Q', 'HH', 'H', 'ww',
];

/**
 * A date pattern as the user meant it, in `formatDate`'s vocabulary — or null
 * when it says nothing a tick could be written from.
 *
 * The point of the translation is that `MM-YY` and `MMM-yyyy` work: think-cell
 * upper-cases the year and the day, and refusing that spelling would make the
 * box a quiz about this codebase. What is NOT accepted is a letter that means
 * nothing here — typing "Week" would otherwise render "Wee2" and look like a
 * bug rather than a rejected pattern.
 *
 * Quoted runs are literals, as in `formatDate`, so `'W'ww` is a real answer.
 */
export function parseDatePattern(src: string): string | null {
  const raw = src.trim();
  if (!raw) return null;

  let out = '';
  let tokens = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;

    // A literal run passes through with its quotes intact — it is already in
    // the vocabulary, and re-quoting it on the way out would double them.
    if (ch === "'") {
      if (raw[i + 1] === "'") {
        out += "''";
        i += 2;
        continue;
      }
      const end = raw.indexOf("'", i + 1);
      if (end < 0) return null; // an unclosed quote is a half-typed pattern
      out += raw.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    const alias = ALIASES.find(([re]) => re.test(raw.slice(i)));
    if (alias) {
      const [re, replacement] = alias;
      out += replacement;
      i += re.exec(raw.slice(i))![0].length;
      tokens++;
      continue;
    }

    const token = TOKENS.find((t) => raw.startsWith(t, i));
    if (token) {
      out += token;
      i += token.length;
      tokens++;
      continue;
    }

    // Separators are free; unknown letters are not.
    if (/[A-Za-z]/.test(ch)) return null;
    out += ch;
    i += 1;
  }

  return tokens > 0 ? out : null;
}
