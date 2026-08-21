/**
 * What a chart is *about*, inferred from the chart itself.
 *
 * The alternative — a form asking the author to restate the measure, the
 * period and the units — is both friction and a second source of truth that
 * immediately drifts from the axis labels. A chart already knows its
 * categories, its series, its number format and its axis titles; that's the
 * research brief, if you read it out.
 *
 * That reading is still the FALLBACK, and for an older chart or one typed
 * straight into the datasheet it is all there is. But a chart built from a
 * description carries `spec.authorBrief` — the sentence the author actually
 * typed, and which of these facts they stated rather than had filled in — and
 * that beats reverse-engineering the picture every time. A label cannot say
 * whether a human demanded it or we invented it; the brief can.
 *
 * Pure, and free of `Date.now()`, so a prompt is reproducible from a spec.
 */
import {
  isButterflySpec,
  isGridSpec,
  isWaterfallSpec,
  isXYSpec,
  parseGrain,
  type AuthorChartBrief,
  type BriefFieldSource,
  type ChartSpec,
  type DateGrain,
} from '@/model';
import { resolveScale } from '@/chart/format/number';

/**
 * Whether a fact in the brief came from a person or from us.
 *
 * 'stated' covers the author's word and a faithful restatement of it; the two
 * are printed identically and nothing downstream distinguishes them.
 */
export type MetaConfidence = 'stated' | 'inferred';

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
  /**
   * Where the subject came from. 'author' is the author naming the entity in
   * their own description and outranks everything. A tag is a deliberate
   * statement of who the DECK is about; a title is a headline that merely tends
   * to contain the name, so a subject read out of one is an assumption to
   * confirm, not a fact.
   */
  subjectSource?: 'author' | 'tag' | 'slide' | 'deck';
  /**
   * Whether each of these was stated by the author or worked out by us.
   *
   * Without a brief they are all 'inferred', which is the honest reading of a
   * chart nobody described: everything here came off the picture.
   */
  measureConfidence: MetaConfidence;
  dimensionConfidence: MetaConfidence;
  periodConfidence: MetaConfidence;
  unitConfidence: MetaConfidence;
  /** The author's sentence, verbatim, when the chart still carries one. */
  description?: string;
  /**
   * The author was asked what this chart shows and declined to say. Different
   * from carrying no brief at all — here we KNOW the labels are placeholders.
   */
  askedAndSkipped?: boolean;
  /** What the description didn't say, when one was read. */
  gaps: string[];
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
  half: 'half-year',
  quarter: 'fiscal quarter',
  month: 'month',
  week: 'week',
  day: 'day',
};

export function inferChartMeta(spec: ChartSpec, ctx: DeckContext = {}): ChartMeta {
  const categories = categoryLabels(spec);
  const seriesNames = seriesLabels(spec);
  const brief = spec.authorBrief;
  // A brief with nothing in it is a refusal, not a statement. Reading fields
  // off it would report an author-stated "nothing" for every one of them.
  const said = brief && !brief.askedAndSkipped ? brief : undefined;

  const measure = reconcileMeasure(spec, seriesNames, said);
  const dimension = reconcileDimension(spec, seriesNames, said);
  const period = inferPeriod(categories);

  return {
    measure: measure.value,
    measureConfidence: measure.confidence,
    unit: inferUnit(spec),
    unitSentence: unitSentence(spec),
    unitConfidence: stated(said?.unitFrom),
    dimension: dimension.value,
    dimensionConfidence: dimension.confidence,
    period,
    periodConfidence: periodConfidence(period, said),
    ...reconcileSubject(said, ctx),
    description: said?.description || undefined,
    askedAndSkipped: brief?.askedAndSkipped,
    gaps: said?.gaps ?? [],
    categories,
    seriesNames,
  };
}

/* ------------------------------------------------------------------ */
/* Reconciling the brief against the chart                            */
/* ------------------------------------------------------------------ */

/**
 * The rule the whole reconciliation follows.
 *
 * A brief records a PAST request; the spec is the chart as it stands now, and
 * the author may have rewritten every label since. So the brief may SUPPLY a
 * value only where the chart has nothing to say, and may raise the CONFIDENCE
 * of a value only while the chart still agrees with it. A brief that has been
 * overtaken by the datasheet is stale, and stale is exactly as dangerous as
 * invented.
 */
const stated = (from: BriefFieldSource | undefined): MetaConfidence =>
  from === 'stated' || from === 'derived' ? 'stated' : 'inferred';

/** Case- and space-insensitive, because "ARR" and "arr " are the same claim. */
const same = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

interface Reconciled {
  value?: string;
  confidence: MetaConfidence;
}

function reconcileMeasure(
  spec: ChartSpec,
  seriesNames: string[],
  said: AuthorChartBrief | undefined,
): Reconciled {
  const axis = spec.axes.y.title;
  if (axis) {
    // An author who wrote an axis title meant it. It is only STATED, though, if
    // it is still the measure they described — otherwise they have retitled the
    // axis since and we no longer know where this came from.
    return { value: axis, confidence: same(axis, said?.measure) ? stated(said?.measureFrom) : 'inferred' };
  }
  if (said?.measure) return { value: said.measure, confidence: stated(said.measureFrom) };
  const common = commonWords(seriesNames);
  if (common) return { value: common, confidence: 'inferred' };
  return { value: titleAsMeasure(spec), confidence: 'inferred' };
}

function reconcileDimension(
  spec: ChartSpec,
  seriesNames: string[],
  said: AuthorChartBrief | undefined,
): Reconciled {
  const axis = spec.axes.x.title;
  if (axis) {
    return {
      value: axis,
      confidence: same(axis, said?.dimension) ? stated(said?.dimensionFrom) : 'inferred',
    };
  }
  // The brief read the actual sentence against a nine-entry table of dimensions
  // and their conventional members, which beats scanning series names for one
  // of seven words it has to find in every single one of them.
  if (said?.dimension) return { value: said.dimension, confidence: stated(said.dimensionFrom) };
  const guessed = guessDimension(seriesNames);
  return { value: guessed, confidence: 'inferred' };
}

/**
 * The span is ALWAYS the one on the axis — that is what is plotted, whatever
 * was once asked for. The brief only says whether to trust it: a range that
 * still matches the request is stated, and a range the author never asked for
 * (or has since moved) is ours to justify, not theirs to have confirmed.
 */
function periodConfidence(
  period: ChartPeriod | undefined,
  said: AuthorChartBrief | undefined,
): MetaConfidence {
  if (!period || !said?.period) return 'inferred';
  const agrees = same(period.from, said.period.from) && same(period.to, said.period.to);
  return agrees ? stated(said.periodFrom) : 'inferred';
}

function reconcileSubject(
  said: AuthorChartBrief | undefined,
  ctx: DeckContext,
): Pick<ChartMeta, 'subject' | 'subjectSource'> {
  // The author naming the entity in their own sentence. This is the strongest
  // signal in the system and it used to be thrown away and replaced with a
  // deck title, which is as often a file name as it is a company.
  if (said?.subjectFrom === 'described' && said.subject) {
    return { subject: said.subject, subjectSource: 'author' };
  }
  return inferSubject(ctx);
}

/**
 * A subject we may print as fact: the author typed it, or the deck declares it.
 *
 * One predicate, used by both the prompt and the questions, because the two
 * disagreeing is precisely how a chart ends up both asserting a subject and
 * asking about it.
 */
export const isSubjectStated = (meta: ChartMeta): boolean =>
  meta.subjectSource === 'author' || meta.subjectSource === 'tag';

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
 * The chart title, read as a measure — the last resort, and a weak one: a title
 * is a headline ("Revenue bridge", "Where the growth came from"), not a metric.
 *
 * The placeholders are excluded outright. `DEFAULT_CHART_TITLE` is the words an
 * author is meant to type OVER; reporting "Chart Title" as the thing being
 * measured sends research off to find it, which is the most embarrassing
 * possible way to fabricate a brief.
 */
function titleAsMeasure(spec: ChartSpec): string | undefined {
  const title = spec.title?.trim();
  if (!title || PLACEHOLDER_TITLES.has(title.toLowerCase())) return undefined;
  return title;
}

/**
 * Kept as literals rather than imported from `@/charts`: this module is the
 * model's side of the fence and must not depend on the picker. The strings are
 * covered by a test, so a rename there fails here loudly.
 */
const PLACEHOLDER_TITLES = new Set(['chart title', 'untitled chart', 'new chart']);

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
function guessDimension(seriesNames: string[]): string | undefined {
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

function inferSubject(ctx: DeckContext): Pick<ChartMeta, 'subject' | 'subjectSource'> {
  // Tags are documented as holding client names, so they're the most specific
  // signal available; the slide title beats the deck title for the same reason.
  const tag = ctx.deckTags?.find((t) => t.trim());
  if (tag) return { subject: tag, subjectSource: 'tag' };
  const slide = ctx.slideTitle?.trim();
  if (slide) return { subject: slide, subjectSource: 'slide' };
  const deck = ctx.deckTitle?.trim();
  if (deck) return { subject: deck, subjectSource: 'deck' };
  return {};
}

/** A human phrase for the period, e.g. "each fiscal quarter from Q1'23 to Q4'25". */
export function periodPhrase(period: ChartPeriod | undefined): string | null {
  if (!period) return null;
  return `one row per ${GRAIN_NOUN[period.grain]}, from ${period.from} to ${period.to} (${period.count} periods)`;
}
