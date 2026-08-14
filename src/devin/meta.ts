/**
 * What a chart is *about*, inferred from the chart itself.
 *
 * The alternative — a form asking the author to restate the measure, the
 * period and the units — is both friction and a second source of truth that
 * immediately drifts from the axis labels. A chart already knows its
 * categories, its series, its number format and its axis titles; that's the
 * research brief, if you read it out.
 *
 * Pure, and free of `Date.now()`, so a prompt is reproducible from a spec.
 */
import {
  isButterflySpec,
  isGridSpec,
  isWaterfallSpec,
  isXYSpec,
  parseGrain,
  type ChartSpec,
  type DateGrain,
} from '@/model';
import { resolveScale } from '@/chart/format/number';

export interface ChartPeriod {
  grain: DateGrain;
  from: string;
  to: string;
  /** How many periods the axis spans, for CAGR-style questions. */
  count: number;
}

export interface ChartMeta {
  /** "Revenue", "Gross margin" — from the value axis title or series names. */
  measure?: string;
  /** "$", "%", "customers" — from the number format and the unit note. */
  unit?: string;
  /** The literal instruction: "USD millions, 1 decimal place". */
  unitSentence: string;
  /** "by segment", "by region" — what the series break the measure down by. */
  dimension?: string;
  period?: ChartPeriod;
  /** Who or what the chart is about, from the deck and slide around it. */
  subject?: string;
  categories: string[];
  seriesNames: string[];
}

export interface DeckContext {
  deckTitle?: string;
  deckTags?: string[];
  slideTitle?: string;
}

const GRAIN_NOUN: Record<DateGrain, string> = {
  year: 'year',
  quarter: 'fiscal quarter',
  month: 'month',
  week: 'week',
  day: 'day',
};

export function inferChartMeta(spec: ChartSpec, ctx: DeckContext = {}): ChartMeta {
  const categories = categoryLabels(spec);
  const seriesNames = seriesLabels(spec);

  return {
    measure: inferMeasure(spec, seriesNames),
    unit: inferUnit(spec),
    unitSentence: unitSentence(spec),
    dimension: inferDimension(spec, seriesNames),
    period: inferPeriod(categories),
    subject: inferSubject(ctx),
    categories,
    seriesNames,
  };
}

/* ------------------------------------------------------------------ */

function categoryLabels(spec: ChartSpec): string[] {
  if (isGridSpec(spec)) return spec.data.categories.map((c) => c.label);
  if (isWaterfallSpec(spec)) return spec.data.items.map((i) => i.label);
  if (isButterflySpec(spec)) return spec.categories.map((c) => c.label);
  if (isXYSpec(spec)) {
    return spec.data.series[0]?.points.map((p, i) => p.label ?? `Point ${i + 1}`) ?? [];
  }
  return [];
}

function seriesLabels(spec: ChartSpec): string[] {
  if (isGridSpec(spec) || isXYSpec(spec)) return spec.data.series.map((s) => s.name);
  if (isButterflySpec(spec)) return [...spec.left, ...spec.right].map((s) => s.name);
  if (isWaterfallSpec(spec)) return ['Value'];
  return [];
}

/**
 * The measure, in preference order: the value axis title (an author who wrote
 * one meant it), then a common prefix across series names ("EMEA revenue",
 * "APAC revenue" -> "revenue"), then the chart title.
 */
function inferMeasure(spec: ChartSpec, seriesNames: string[]): string | undefined {
  if (spec.axes.y.title) return spec.axes.y.title;
  const common = commonWords(seriesNames);
  if (common) return common;
  return spec.title;
}

function commonWords(names: string[]): string | undefined {
  if (names.length < 2) return undefined;
  const tokenized = names.map((n) => n.toLowerCase().split(/\s+/).filter(Boolean));
  const shared = tokenized[0].filter((w) => tokenized.every((t) => t.includes(w)));
  return shared.length ? shared.join(' ') : undefined;
}

function inferUnit(spec: ChartSpec): string | undefined {
  const f = spec.numberFormat;
  if (f.style === 'percent') return '%';
  if (f.style === 'currency') return f.currency ?? 'USD';
  return spec.axes.y.unitNote;
}

/**
 * The single most load-bearing sentence in the prompt. If the format says
 * millions and the answer comes back in units, every number on the slide is
 * wrong by 1000× and nothing about the chart looks broken.
 */
function unitSentence(spec: ChartSpec): string {
  const f = spec.numberFormat;
  const parts: string[] = [];

  if (f.style === 'percent') {
    parts.push('Values are proportions expressed as decimals (0.427 means 42.7%)');
  } else if (f.style === 'currency') {
    parts.push(`Values are in ${f.currency ?? 'USD'}`);
  } else {
    parts.push('Values are plain numbers');
  }

  const divisor = spec.axes.y.unitDivisor;
  if (divisor && divisor > 1) {
    const word = divisor === 1e3 ? 'thousands' : divisor === 1e6 ? 'millions' : divisor === 1e9 ? 'billions' : `units of ${divisor}`;
    // The axis is *displayed* divided; the DATA is not. Saying which is which
    // is the difference between 4 and 4,000,000.
    parts.push(
      `stated in full units — the chart divides them by ${divisor.toLocaleString('en-US')} for display (${word})`,
    );
  }

  const scale = resolveScale([], { ...f, scale: f.scale });
  if (scale !== 'none' && !divisor) {
    parts.push(`abbreviated on the axis with a "${scale}" suffix, but return full figures`);
  }

  parts.push(
    f.decimals === undefined
      ? 'to whatever precision the source reports'
      : `to ${f.decimals} decimal place${f.decimals === 1 ? '' : 's'}`,
  );

  return `${parts.join(', ')}.`;
}

/**
 * What the series break the measure down by. A common suffix or a known word
 * is a decent guess; anything else, we say "these series" and list them rather
 * than inventing a dimension name.
 */
function inferDimension(spec: ChartSpec, seriesNames: string[]): string | undefined {
  if (spec.axes.x.title) return spec.axes.x.title;
  if (!seriesNames.length) return undefined;
  const KNOWN = ['segment', 'region', 'product', 'channel', 'geography', 'customer', 'market'];

  // Two guards, both learned from "Mid-Market":
  //
  // 1. Tokens split on WHITESPACE, not on every non-letter — "Mid-Market" is
  //    one name, not the two words "mid" and "market".
  // 2. The word has to appear in EVERY series name. A dimension is what the
  //    series have in common; a word in one of them is just part of its name.
  const tokens = seriesNames.map(
    (n) => new Set(n.toLowerCase().split(/\s+/).map((w) => w.replace(/^[^a-z]+|[^a-z]+$/g, ''))),
  );
  return KNOWN.find((k) => tokens.every((t) => t.has(k)));
}

function inferPeriod(categories: string[]): ChartPeriod | undefined {
  const parsed = categories.map(parseGrain);
  const hits = parsed.filter((p): p is NonNullable<typeof p> => p !== null);
  // A single stray "2024" among segment names isn't a time axis.
  if (hits.length < 2 || hits.length / categories.length < 0.8) return undefined;

  const first = categories[parsed.findIndex((p) => p !== null)];
  const lastIndex = parsed.length - 1 - [...parsed].reverse().findIndex((p) => p !== null);
  return {
    grain: hits[0].grain,
    from: first,
    to: categories[lastIndex],
    count: categories.length,
  };
}

function inferSubject(ctx: DeckContext): string | undefined {
  // Tags are documented as holding client names, so they're the most specific
  // signal available; the slide title beats the deck title for the same reason.
  const tag = ctx.deckTags?.find((t) => t.trim());
  return tag ?? ctx.slideTitle?.trim() ?? ctx.deckTitle?.trim() ?? undefined;
}

/** A human phrase for the period, e.g. "each fiscal quarter from Q1'23 to Q4'25". */
export function periodPhrase(period: ChartPeriod | undefined): string | null {
  if (!period) return null;
  return `one row per ${GRAIN_NOUN[period.grain]}, from ${period.from} to ${period.to} (${period.count} periods)`;
}
