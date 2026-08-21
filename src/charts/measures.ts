/**
 * The variables a chart can be about, and the one fact about them that changes
 * which charts are honest: whether they ADD UP.
 *
 * A count of ACUs adds up — the parts of a stack sum to the total, a pie's
 * slices sum to the whole, a Sankey's branches sum to their source. "ACUs per
 * merged PR" does not: the average of two teams is not the sum of their
 * averages, so a stacked column of it is a picture of a number that doesn't
 * exist. Neither is a rate. That single property is what `additive` carries, and
 * `src/charts/setupForm.ts` turns it into the warnings the setup step shows.
 *
 * `magnitude` is the order of the placeholder figures, not a claim about
 * anybody's data: it exists so a chart of ACUs per merged PR comes out reading
 * "13.4" rather than "1,000", because an author judging whether a chart fits a
 * slide is reading the axis.
 *
 * The list is a starting menu, never a closed set — `freeMeasure` covers
 * everything it doesn't, and a typed measure is a first-class one.
 */
import { DEFAULT_NUMBER_FORMAT, type NumberFormat } from '@/model';

/**
 * What kind of quantity this is. It decides the number format, the placeholder
 * magnitude, and whether the measure can be summed.
 */
export type MeasureUnit = 'count' | 'hours' | 'currency' | 'percent' | 'ratio';

export type MeasureGroup = 'Usage' | 'Delivery' | 'Efficiency' | 'Rates' | 'Commercial';

export interface MeasureDef {
  id: string;
  /** As it prints on the value axis and in the title. */
  label: string;
  unit: MeasureUnit;
  group: MeasureGroup;
  /**
   * The denominator, for a per-something measure. Kept apart from the label so
   * a chart can say what one mark counts ("per merged PR") without the caller
   * parsing the label back apart.
   */
  per?: string;
  /** Roughly where the placeholder figures should sit. See the file header. */
  magnitude: number;
}

/**
 * Grouped so the menu reads as the question it is: what kind of number is this?
 * Efficiency and Rates are deliberately their own groups rather than being
 * mixed in with the counts they're built from — that grouping is the only
 * warning some authors will read before they pick a stacked column.
 */
export const MEASURE_GROUPS: MeasureGroup[] = [
  'Usage',
  'Delivery',
  'Efficiency',
  'Rates',
  'Commercial',
];

export const MEASURES: MeasureDef[] = [
  // Usage
  { id: 'acus', label: 'ACUs', unit: 'count', group: 'Usage', magnitude: 40_000 },
  { id: 'sessions', label: 'Sessions', unit: 'count', group: 'Usage', magnitude: 12_000 },
  {
    id: 'productive-sessions',
    label: 'Productive sessions',
    unit: 'count',
    group: 'Usage',
    magnitude: 9_000,
  },
  {
    id: 'productive-hours',
    label: 'Productive engineering hours',
    unit: 'hours',
    group: 'Usage',
    magnitude: 6_400,
  },
  {
    id: 'active-developers',
    label: 'Active developers',
    unit: 'count',
    group: 'Usage',
    magnitude: 320,
  },

  // Delivery
  { id: 'prs-created', label: 'PRs created', unit: 'count', group: 'Delivery', magnitude: 4_200 },
  { id: 'prs-merged', label: 'PRs merged', unit: 'count', group: 'Delivery', magnitude: 3_100 },
  {
    id: 'reviews',
    label: 'Reviews completed',
    unit: 'count',
    group: 'Delivery',
    magnitude: 5_600,
  },

  // Efficiency — ratios. None of these add up; see the file header.
  {
    id: 'acus-per-merged-pr',
    label: 'ACUs per merged PR',
    unit: 'ratio',
    group: 'Efficiency',
    per: 'merged PR',
    magnitude: 13,
  },
  {
    id: 'acus-per-session',
    label: 'ACUs per session',
    unit: 'ratio',
    group: 'Efficiency',
    per: 'session',
    magnitude: 3.4,
  },
  {
    id: 'hours-per-merged-pr',
    label: 'Productive hours per merged PR',
    unit: 'ratio',
    group: 'Efficiency',
    per: 'merged PR',
    magnitude: 2.1,
  },
  {
    id: 'sessions-per-developer',
    label: 'Sessions per active developer',
    unit: 'ratio',
    group: 'Efficiency',
    per: 'active developer',
    magnitude: 38,
  },

  // Rates
  { id: 'merge-rate', label: 'Merge rate', unit: 'percent', group: 'Rates', magnitude: 0.74 },
  {
    id: 'productive-rate',
    label: 'Productive session rate',
    unit: 'percent',
    group: 'Rates',
    magnitude: 0.78,
  },
  {
    id: 'seat-adoption',
    label: 'Seat adoption',
    unit: 'percent',
    group: 'Rates',
    magnitude: 0.62,
  },

  // Commercial
  { id: 'arr', label: 'ARR', unit: 'currency', group: 'Commercial', magnitude: 24_000_000 },
  { id: 'revenue', label: 'Revenue', unit: 'currency', group: 'Commercial', magnitude: 8_000_000 },
  { id: 'seats', label: 'Seats', unit: 'count', group: 'Commercial', magnitude: 1_800 },
];

export const measureById = (id: string): MeasureDef | undefined =>
  MEASURES.find((m) => m.id === id);

/**
 * A measure the author typed. Treated as a count, which is the permissive
 * reading: it keeps every layout on the table rather than blocking a stack on
 * a guess about a word we don't know. If they typed a rate they'll pick a rate
 * from the menu, or the % in their own label will say so — hence the sniff.
 */
export function freeMeasure(label: string): MeasureDef {
  const clean = label.trim();
  const looksRate = /\brate\b|\bmargin\b|%|\bshare\b|\bpercent\w*\b/i.test(clean);
  const looksRatio = /\bper\b|\bavg\b|\baverage\b|\bmean\b/i.test(clean);
  return {
    id: `free:${clean.toLowerCase()}`,
    label: clean,
    unit: looksRate ? 'percent' : looksRatio ? 'ratio' : 'count',
    group: 'Usage',
    magnitude: looksRate ? 0.5 : looksRatio ? 10 : 1_000,
  };
}

export const resolveMeasure = (id: string): MeasureDef =>
  measureById(id) ?? freeMeasure(id.replace(/^free:/, ''));

/* ------------------------------------------------------------------ */
/* The properties the layouts care about                              */
/* ------------------------------------------------------------------ */

/**
 * Can this measure be summed?
 *
 * The one question behind every warning in the setup step. Stacking, 100%
 * stacking, pies and Sankeys all draw a total made of parts, and for a ratio or
 * a rate that total is a number nobody can name.
 */
export const additive = (m: MeasureDef): boolean =>
  m.unit === 'count' || m.unit === 'hours' || m.unit === 'currency';

/** A measure that belongs on a secondary axis over the top of an absolute. */
export const isRate = (m: MeasureDef): boolean => m.unit === 'percent' || m.unit === 'ratio';

/* ------------------------------------------------------------------ */
/* Numbers                                                           */
/* ------------------------------------------------------------------ */

/**
 * How a measure's figures read. No unit note: the axis title already names the
 * measure — "Productive engineering hours" over a "hours" caption — and the
 * note is left for the scale ("in millions"), which the author sets.
 */
export interface MeasureFormat {
  numberFormat: NumberFormat;
  /** Divide the stored figures by this to get the printed ones. */
  unitDivisor?: number;
  /** Where the placeholder figures sit once the divisor is accounted for. */
  magnitude: number;
}

/**
 * Big counts are printed scaled — "42.1K sessions" rather than a five-digit
 * axis — because a chart of raw counts spends its axis width on zeroes. The
 * threshold is where the fourth digit appears; below it the plain number is
 * shorter than the scaled one.
 */
export function measureFormat(m: MeasureDef, currency = 'USD'): MeasureFormat {
  if (m.unit === 'percent') {
    return {
      numberFormat: { style: 'percent', decimals: 0, negative: 'minus' },
      magnitude: m.magnitude,
    };
  }

  if (m.unit === 'ratio') {
    // One decimal: the whole point of a per-something measure is the part after
    // the point, and rounding "13.4 ACUs per PR" to 13 throws the argument away.
    return {
      numberFormat: { ...DEFAULT_NUMBER_FORMAT, decimals: 1 },
      magnitude: m.magnitude,
    };
  }

  const divisor = m.magnitude >= 1e8 ? 1e9 : m.magnitude >= 1e5 ? 1e6 : m.magnitude >= 1e4 ? 1e3 : undefined;

  if (m.unit === 'currency') {
    return {
      numberFormat: { ...DEFAULT_NUMBER_FORMAT, style: 'currency', currency, decimals: 0 },
      unitDivisor: divisor,
      magnitude: m.magnitude,
    };
  }

  return {
    numberFormat: { ...DEFAULT_NUMBER_FORMAT, decimals: 0 },
    unitDivisor: divisor,
    magnitude: m.magnitude,
  };
}
