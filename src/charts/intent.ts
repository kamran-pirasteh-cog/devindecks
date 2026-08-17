/**
 * "What data do you want to show?" — read as English, answered with a layout.
 *
 * Two jobs, kept apart on purpose:
 *
 * 1. `readBrief` turns a typed sentence into the things a chart needs to know —
 *    who it's about, what's being measured, in what units, over what period,
 *    broken down how. Anything the sentence didn't say goes in `gaps` rather
 *    than being guessed, because the expensive failure here is a confident
 *    chart built on an invented subject or the wrong unit.
 * 2. `recommendLayouts` scores the picker's layouts against what the brief
 *    implies and says WHY, in a line the author can disagree with. A
 *    recommendation nobody can argue with is a recommendation nobody can
 *    correct, so every suggestion carries its reason and the manual grid is
 *    always one click away.
 *
 * Pure and free of `Date.now()`: "the last eight quarters" needs a today, so
 * callers pass `asOf`. That keeps the same sentence producing the same brief in
 * a test as in the editor.
 */
import {
  DEFAULT_NUMBER_FORMAT,
  supportsOrientation,
  type ChartOrientation,
  type DateGrain,
  type NumberFormat,
} from '@/model';
import { CHART_LAYOUTS, type ChartLayout } from './layouts';

export interface BriefContext {
  /** Tags are documented as holding client names — the most specific signal. */
  deckTags?: string[];
  deckTitle?: string;
  slideTitle?: string;
  /** ISO date the relative periods ("last 8 quarters") are measured back from. */
  asOf?: string;
}

export interface BriefPeriod {
  grain: DateGrain;
  labels: string[];
  /** True when the labels came from an explicit range or count in the text. */
  stated: boolean;
}

export interface ChartBrief {
  /** What the author typed, verbatim. Kept so the chart can be re-read later. */
  description: string;
  subject?: string;
  subjectFrom: 'described' | 'tag' | 'slide' | 'deck' | 'unknown';
  /** "Revenue", "Gross margin" — what the value axis is about. */
  measure?: string;
  /** A rate or margin to draw over the top, when one was asked for as well. */
  secondaryMeasure?: string;
  /** Every measure named, in the order they were named — a scatter needs two. */
  measures: string[];
  /** "segment", "region" — what the series break the measure down by. */
  dimension?: string;
  seriesNames: string[];
  /** What one mark is, when the axis isn't time: "Segment", "Product". */
  categoryNoun: string;
  categories: string[];
  period?: BriefPeriod;
  numberFormat: NumberFormat;
  unitDivisor?: number;
  unitNote?: string;
  /** What the sentence didn't say. Shown to the author, never filled in. */
  gaps: string[];
}

export interface LayoutSuggestion {
  layout: ChartLayout;
  orientation: ChartOrientation;
  score: number;
  /** One line, in the author's terms, for why this layout and not another. */
  why: string;
}

export interface ChartRecommendation {
  brief: ChartBrief;
  /** Best first. Never empty — a description we can't read still gets a start. */
  suggestions: LayoutSuggestion[];
  confidence: 'high' | 'medium' | 'low';
}

/* ------------------------------------------------------------------ */
/* Signals                                                            */
/* ------------------------------------------------------------------ */

interface Signals {
  time: boolean;
  share: boolean;
  ranking: boolean;
  compare: boolean;
  bridge: boolean;
  funnel: boolean;
  flow: boolean;
  correlation: boolean;
  sized: boolean;
  /** A rate asked for alongside an absolute — the combo case. */
  rateOverTotal: boolean;
  totalMatters: boolean;
  /** The measure is broken down by something, whether or not "mix" was said. */
  breakdown: boolean;
  /** The author named a chart type outright. That beats every inference. */
  namedKind?: string;
  seriesCount: number;
  periodCount: number;
}

const RE = {
  time: /\b(over time|trend|trending|trajectory|growth|history|historical|by (?:quarter|month|year|week|day)|quarterly|monthly|weekly|annual(?:ly)?|yearly|year[- ]over[- ]year|yoy|qoq|mom|since \d{2,4}|from (?:fy)?['\d]|last \d+ (?:quarters?|months?|years?|weeks?|days?)|next \d+ (?:quarters?|years?))\b/i,
  share: /\b(share of|shares of|mix|composition|breakdown|broken down|split|% of total|percent of total|proportion|makes? up|made up of|weighting)\b/i,
  ranking: /\b(top \d+|bottom \d+|ranked?|ranking|league table|largest|biggest|smallest|leaders?|by country|by state|by city|long list)\b/i,
  compare: /\b(vs\.?|versus|compared? (?:to|with|against)|comparison|against|benchmark|peers?|competitors?)\b/i,
  // `bridg\w*` rather than `bridge`: "bridged to FY25" is the most natural way
  // anyone asks for a bridge, and the exact word alone missed it.
  bridge: /\b(waterfall|bridg\w*|walk(?:ed|ing)? from|drivers? of|contribution to|variance|delta|movement|build[- ]?up|reconcil\w*|from .{1,30} to .{1,30})\b/i,
  funnel: /\b(funnel|conversion|attrition|churn(?:ed)?|drop[- ]?off|leakage|lost|whittl\w*|survived)\b/i,
  flow: /\b(flows?|flowing|where .{1,30} goes|sources and uses|allocat\w*|routed|distribut\w+ across|upstream|downstream)\b/i,
  correlation: /\b(correlat\w*|relationship between|scatter|elasticity|regression|predicts?|plotted against|x vs y)\b/i,
  sized: /\b(sized by|size(?:d)? by|bubble|weighted by|third (?:measure|dimension|variable))\b/i,
  rate: /\b(margin|conversion rate|win rate|take rate|growth rate|utili[sz]ation|penetration|as a (?:%|percent)|% (?:margin|of revenue)|attach rate)\b/i,
  absolute: /\b(revenue|sales|bookings|billings|arr|mrr|gmv|spend|cost|costs|cogs|opex|capex|ebitda|income|profit|cash|headcount|employees|customers|logos|users|units|volume|subscribers|seats)\b/i,
  totalMatters: /\b(total|overall|aggregate|combined|absolute)\b/i,
} as const;

/** An outright request for a chart type. The author knows; stop guessing. */
const NAMED_KINDS: { re: RegExp; id: string }[] = [
  { re: /\b100% stacked|100 ?% ?stack\w*\b/i, id: 'stacked100' },
  { re: /\bstacked (?:column|bar|chart)s?\b/i, id: 'stacked' },
  { re: /\bclustered|grouped (?:column|bar)s?\b/i, id: 'clustered' },
  { re: /\bline chart|line graph\b/i, id: 'line' },
  { re: /\bcombo chart|combination chart|dual[- ]axis\b/i, id: 'combo-clustered-line' },
  { re: /\bwaterfall|bridge chart\b/i, id: 'waterfall-up' },
  { re: /\bpie chart|donut\b/i, id: 'pie' },
  { re: /\bsankey|flow diagram\b/i, id: 'sankey' },
  { re: /\bscatter ?(?:plot|chart)?\b/i, id: 'scatter' },
  { re: /\bbubble chart\b/i, id: 'bubble' },
];

/* ------------------------------------------------------------------ */
/* The brief                                                          */
/* ------------------------------------------------------------------ */

/** Canonical measures, longest first so "gross margin" beats "margin". */
const MEASURES: string[] = [
  'gross margin',
  'operating margin',
  'net income',
  'market share',
  'win rate',
  'take rate',
  'attach rate',
  'conversion rate',
  'growth rate',
  'free cash flow',
  'headcount',
  'revenue',
  'sales',
  'bookings',
  'billings',
  'pipeline',
  'arr',
  'mrr',
  'gmv',
  'ebitda',
  'margin',
  'churn',
  'retention',
  'nps',
  'utilization',
  'penetration',
  'spend',
  'cost',
  'cogs',
  'opex',
  'capex',
  'customers',
  'logos',
  'users',
  'subscribers',
  'seats',
  'employees',
  'units',
  'volume',
  'orders',
  'asp',
  'profit',
  'cash',
];

const UPPERCASE_MEASURES = new Set(['arr', 'mrr', 'gmv', 'ebitda', 'nps', 'asp', 'cogs']);

const titleCase = (s: string): string =>
  UPPERCASE_MEASURES.has(s.toLowerCase())
    ? s.toUpperCase()
    : s.charAt(0).toUpperCase() + s.slice(1);

/** Dimensions we know the conventional members of. */
const DIMENSIONS: { re: RegExp; noun: string; members: string[] }[] = [
  {
    re: /\bsegments?\b/i,
    noun: 'segment',
    members: ['Enterprise', 'Mid-Market', 'SMB'],
  },
  {
    re: /\b(regions?|geograph\w+|territor\w+)\b/i,
    noun: 'region',
    members: ['Americas', 'EMEA', 'APAC'],
  },
  {
    re: /\bchannels?\b/i,
    noun: 'channel',
    members: ['Direct', 'Partner', 'Self-serve'],
  },
  {
    re: /\bproducts?\b|\bskus?\b|\blines? of business\b/i,
    noun: 'product',
    members: ['Product A', 'Product B', 'Product C'],
  },
  {
    re: /\bcustomers?\b|\baccounts?\b|\blogos\b/i,
    noun: 'customer',
    members: ['Customer A', 'Customer B', 'Customer C'],
  },
  {
    re: /\b(competitors?|peers?)\b/i,
    noun: 'peer',
    members: ['Peer A', 'Peer B', 'Peer C'],
  },
  {
    re: /\bcountr(?:y|ies)\b/i,
    noun: 'country',
    members: ['Country A', 'Country B', 'Country C'],
  },
  {
    re: /\bcohorts?\b/i,
    noun: 'cohort',
    members: ['Cohort A', 'Cohort B', 'Cohort C'],
  },
  {
    re: /\bteams?\b|\bfunctions?\b|\bdepartments?\b/i,
    noun: 'function',
    members: ['Engineering', 'Go-to-market', 'G&A'],
  },
];

/**
 * Words that look like a company when capitalised but never are. Without this,
 * "revenue for EMEA" reports EMEA as the client.
 */
const NOT_A_SUBJECT = new RegExp(
  `^(the|a|an|q[1-4]|q[1-4]'?\\d{2,4}|fy\\d*|cy\\d*|\\d{4}|jan\\w*|feb\\w*|mar\\w*|apr\\w*|may|jun\\w*|jul\\w*|aug\\w*|sep\\w*|oct\\w*|nov\\w*|dec\\w*|` +
    `emea|apac|americas|us|usa|uk|eu|apj|latam|enterprise|mid-market|smb|` +
    `how|show|what|why|where|when|which|plot|chart|graph|draw|give|compare|comparison|breakdown|mix|split|trend|growth|total|share|top|bottom|` +
    `quarterly|monthly|annual|annually|yearly|weekly|daily|each|every|all|both|last|next|this|our|their|` +
    `${MEASURES.map((m) => m.replace(/\s/g, '\\s')).join('|')})$`,
  'i',
);

export function readBrief(description: string, ctx: BriefContext = {}): ChartBrief {
  const text = description.trim();
  const gaps: string[] = [];

  const measures = findMeasures(text);
  const { measure, secondaryMeasure } = splitMeasures(measures);
  const dimension = DIMENSIONS.find((d) => d.re.test(text));
  const listed = explicitMembers(text) ?? rankedMembers(text, dimension);

  const subjectFromText = subjectInText(text);
  const tag = named(ctx.deckTags?.find((t) => t.trim()));
  const slide = named(ctx.slideTitle);
  const deckTitle = named(ctx.deckTitle);
  const subject = subjectFromText ?? tag ?? slide ?? deckTitle;
  const subjectFrom: ChartBrief['subjectFrom'] = subjectFromText
    ? 'described'
    : tag
      ? 'tag'
      : slide
        ? 'slide'
        : deckTitle
          ? 'deck'
          : 'unknown';

  const period = readPeriod(text, ctx.asOf);
  // One named period is a MOMENT, not a trend — "revenue mix by region for
  // FY25" is a single split, and the date belongs in the title rather than on
  // an axis with one tick.
  const overTime = !!period && period.labels.length > 1;
  const members = listed ?? dimension?.members ?? [];
  const format = readFormat(text, measure);

  const categoryNoun = overTime
    ? grainNoun(period!.grain)
    : (dimension?.noun ?? 'category');

  // Without a time axis the members ARE the categories — "revenue by segment"
  // is three bars, not one bar with three colours. With a time axis they're the
  // series drawn across it.
  const categories = overTime
    ? period!.labels
    : members.length
      ? members
      : ['Category A', 'Category B', 'Category C'];

  if (!measure) {
    gaps.push("What's being measured isn't stated — the value axis is unlabelled.");
  }
  if (!subject) {
    gaps.push('No client or subject named here or on the deck.');
  }
  if (RE.time.test(text) && !period) {
    gaps.push("A trend was asked for but no period — say which years or quarters.");
  }

  return {
    description: text,
    subject,
    subjectFrom,
    measure,
    secondaryMeasure,
    measures,
    dimension: dimension?.noun,
    seriesNames: overTime ? members : [],
    categoryNoun: titleCase(categoryNoun),
    categories,
    period,
    numberFormat: format.numberFormat,
    unitDivisor: format.unitDivisor,
    unitNote: format.unitNote,
    gaps,
  };
}

/** Every measure named, in the order the sentence names them. */
function findMeasures(text: string): string[] {
  const hits: { at: number; label: string }[] = [];
  for (const m of MEASURES) {
    const at = text.search(new RegExp(`\\b${m}\\b`, 'i'));
    if (at === -1) continue;
    // Longest-first ordering in MEASURES means "gross margin" is found before
    // "margin"; the shorter one inside it is the same measure counted twice.
    if (hits.some((h) => h.label.toLowerCase().includes(m.toLowerCase()))) continue;
    hits.push({ at, label: titleCase(m) });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.label);
}

const isRate = (label: string): boolean => PERCENT_MEASURES.test(label);

/**
 * Which measure the value axis is about, and which one rides over the top.
 *
 * "Gross margin against revenue" names the rate FIRST, but the columns are the
 * revenue and the line is the margin — a rate can't be the primary of a pair on
 * two scales. So the absolute wins the axis whatever order they were said in,
 * which is the entire reason the combo layout exists.
 */
function splitMeasures(measures: string[]): {
  measure?: string;
  secondaryMeasure?: string;
} {
  const rate = measures.find(isRate);
  const absolute = measures.find((m) => !isRate(m));
  if (rate && absolute) return { measure: absolute, secondaryMeasure: rate };
  return { measure: measures[0] };
}

/**
 * "Top 10 countries" means ten of them. The conventional three placeholders
 * would quietly answer a different question, so a stated count is honoured with
 * a lettered list the author can rename.
 */
function rankedMembers(
  text: string,
  dimension?: { noun: string; members: string[] },
): string[] | undefined {
  const m = /\b(?:top|bottom|first|largest)\s+(\d{1,2})\b/i.exec(text);
  if (!m) return undefined;
  const n = Math.min(Math.max(Number(m[1]), 2), 12);
  if (dimension && dimension.members.length >= n) return dimension.members.slice(0, n);
  const noun = titleCase(dimension?.noun ?? 'item');
  return Array.from({ length: n }, (_, i) => `${noun} ${String.fromCharCode(65 + i)}`);
}

/**
 * Members the author listed themselves — in brackets, after a colon, or as a
 * plain "for A, B and C". Always preferred over our conventional set: they
 * typed the real names, and a placeholder that overrides them is a bug.
 */
function explicitMembers(text: string): string[] | undefined {
  // A parenthetical anywhere, or a list after a colon at the end. The bracket
  // used to have to close the sentence, which missed "by segment (Platform,
  // Services) over the last 3 years" — the commonest way anyone writes one.
  const bracket = /\(([^)]{3,160})\)/.exec(text) ?? /:\s*([^:]{3,160})$/.exec(text);
  const inline =
    /\b(?:for|across|between|split (?:by|across)|by)\s+([A-Z][\w&.'-]*(?:\s*,\s*[A-Z][\w&.'-]*)+(?:\s*,?\s*and\s+[A-Z][\w&.'-]*)?)/.exec(
      text,
    );
  const raw = bracket?.[1] ?? inline?.[1];
  if (!raw) return undefined;
  const parts = raw
    .split(/\s*(?:,|\band\b|\bvs\.?\b|\bversus\b|\/)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length < 40 && !/^\d+$/.test(p));
  return parts.length >= 2 ? parts.slice(0, 8) : undefined;
}

/**
 * A deck the author hasn't named yet is not a client. "Untitled presentation —
 * Revenue by region" on a chart title is worse than no subject at all, and it
 * would be read as a real one.
 */
const named = (s?: string): string | undefined => {
  const t = s?.trim();
  return t && !/^untitled\b/i.test(t) && !/^(slide|new) /i.test(t) ? t : undefined;
};

function subjectInText(text: string): string | undefined {
  const possessive = /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)?)'s\b/.exec(text);
  const forAt = /\b(?:for|at|about)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)?)\b/.exec(text);
  // "Acme Corp revenue FY21-FY25" — a name in front, then what about it. Only
  // at the very start, and only when a lowercase word follows: mid-sentence
  // capitals are usually a segment or a month.
  const leading = /^([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})\s+[a-z]/.exec(text);
  for (const m of [possessive, forAt, leading]) {
    const cand = m?.[1]?.trim();
    if (!cand) continue;
    // A list ("for EMEA, APAC and Americas") is a breakdown, not a client.
    if (NOT_A_SUBJECT.test(cand)) continue;
    if (cand.split(/\s+/).some((w) => NOT_A_SUBJECT.test(w))) continue;
    return cand;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Units                                                              */
/* ------------------------------------------------------------------ */

const PERCENT_MEASURES =
  /^(gross margin|operating margin|margin|market share|win rate|take rate|attach rate|conversion rate|growth rate|churn|retention|utilization|penetration|nps)$/i;

const CURRENCY_MEASURES =
  /^(revenue|sales|bookings|billings|arr|mrr|gmv|ebitda|spend|cost|cogs|opex|capex|profit|cash|net income|free cash flow|pipeline|asp)$/i;

function readFormat(
  text: string,
  measure?: string,
): { numberFormat: NumberFormat; unitDivisor?: number; unitNote?: string } {
  const currency = /£|\bgbp\b/i.test(text)
    ? 'GBP'
    : /€|\beur\b/i.test(text)
      ? 'EUR'
      : /¥|\bjpy\b/i.test(text)
        ? 'JPY'
        : /\$|\busd\b|\bdollars?\b/i.test(text) || (measure && CURRENCY_MEASURES.test(measure))
          ? 'USD'
          : undefined;

  const percent =
    (measure && PERCENT_MEASURES.test(measure)) ||
    /\bpercentage points?\b|\bas a (?:%|percent)\b/i.test(text);

  // A share-of-total chart is still currency data with percentage LABELS, so
  // "% of total" deliberately doesn't make the data a proportion.
  const divisor = /\b(billions?|bn|\$b)\b/i.test(text)
    ? 1e9
    : /\b(millions?|mm?|\$m)\b/i.test(text)
      ? 1e6
      : /\b(thousands?|\$k)\b/i.test(text)
        ? 1e3
        : undefined;

  if (percent) {
    return { numberFormat: { style: 'percent', decimals: 1, negative: 'minus' } };
  }

  const numberFormat: NumberFormat = currency
    ? { ...DEFAULT_NUMBER_FORMAT, style: 'currency', currency, decimals: 0 }
    : { ...DEFAULT_NUMBER_FORMAT, decimals: 0 };

  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'JPY' ? '¥' : '$';
  const suffix = divisor === 1e9 ? 'B' : divisor === 1e6 ? 'M' : 'K';
  return {
    numberFormat,
    unitDivisor: divisor,
    unitNote: divisor ? `in ${currency ? symbol : ''}${suffix}` : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Periods                                                            */
/* ------------------------------------------------------------------ */

const GRAIN_NOUN: Record<DateGrain, string> = {
  year: 'year',
  quarter: 'quarter',
  month: 'month',
  week: 'week',
  day: 'day',
};

const grainNoun = (g: DateGrain): string => GRAIN_NOUN[g];

const DEFAULT_COUNT: Record<DateGrain, number> = {
  year: 4,
  quarter: 8,
  month: 12,
  week: 8,
  day: 7,
};

function readPeriod(text: string, asOf?: string): BriefPeriod | undefined {
  const grain: DateGrain | undefined = /\bquarter\w*|\bqoq\b|\bq[1-4]\b/i.test(text)
    ? 'quarter'
    : /\bmonth\w*|\bmom\b/i.test(text)
      ? 'month'
      : /\bweek\w*\b/i.test(text)
        ? 'week'
        : /\byear\w*|\bannual\w*|\bfy\d{2,4}|\byoy\b|\bcy\d{2,4}|\b(?:19|20)\d{2}\b/i.test(text)
          ? 'year'
          : RE.time.test(text)
            ? 'year'
            : undefined;
  if (!grain) return undefined;

  const fiscal = /\bfy|fiscal\b/i.test(text);

  // Periods the author named themselves win outright: they said both ends, so
  // nothing has to be inferred from today's date. Two mentions are enough —
  // "FY21-FY25" and "how FY24 bridged to FY25" both name their span.
  const stated = statedSpan(text, grain, fiscal);
  if (stated) return { grain: stated.grain, labels: stated.labels, stated: true };

  // A single named period — "for FY25", "in Q3'25" — with nothing asking for a
  // span. One tick is not a time axis, so this is a moment the chart is AT, and
  // the layout rules read it that way (a mix at one date is a pie, not a
  // one-column stack).
  const single = singlePeriod(text, fiscal);
  if (single) return { grain: single.grain, labels: [single.label], stated: true };

  const explicitCount = /\blast\s+(\d{1,2})\s+(quarters?|months?|years?|weeks?|days?)\b/i.exec(text);
  const count = Math.min(
    explicitCount ? Number(explicitCount[1]) : DEFAULT_COUNT[grain],
    16,
  );

  const anchor = parseAsOf(asOf);
  if (!anchor) {
    // No today to count back from. Rather than invent one, fall back to the
    // last N periods ending at the newest year the text itself mentions.
    const mentioned = /\b(?:fy|cy)?\s?((?:19|20)\d{2})\b/.exec(text);
    if (!mentioned) return undefined;
    const end = Number(mentioned[1]);
    return {
      grain: 'year',
      labels: Array.from({ length: count }, (_, i) => yearLabel(end - count + 1 + i, fiscal)),
      stated: !!explicitCount,
    };
  }

  return {
    grain,
    labels: backFrom(anchor, grain, count, fiscal),
    stated: !!explicitCount,
  };
}

/**
 * The span between the earliest and latest period the text names, when it names
 * two or more. Quarters are counted as absolute quarter numbers so a span can
 * cross a year boundary without special cases.
 */
function statedSpan(
  text: string,
  grain: DateGrain,
  fiscal: boolean,
): { grain: DateGrain; labels: string[] } | undefined {
  if (grain === 'quarter') {
    const qs = [...text.matchAll(/\bQ([1-4])\s*'?((?:19|20)?\d{2})\b/gi)].map(
      (m) => fullYear(m[2]) * 4 + Number(m[1]) - 1,
    );
    if (qs.length >= 2) {
      const from = Math.min(...qs);
      const to = Math.max(...qs);
      if (to > from && to - from <= 23) {
        return {
          grain,
          labels: Array.from({ length: to - from + 1 }, (_, i) => {
            const abs = from + i;
            return `Q${(abs % 4) + 1}'${String(Math.floor(abs / 4)).slice(2)}`;
          }),
        };
      }
    }
  }

  const years = [
    ...text.matchAll(/\b(?:FY|CY)\s?((?:19|20)?\d{2})\b|\b((?:19|20)\d{2})\b/gi),
  ].map((m) => fullYear(m[1] ?? m[2]));
  const distinct = [...new Set(years)];
  if (distinct.length >= 2) {
    const from = Math.min(...distinct);
    const to = Math.max(...distinct);
    if (to - from <= 24) {
      return {
        grain: 'year',
        labels: Array.from({ length: to - from + 1 }, (_, i) => yearLabel(from + i, fiscal)),
      };
    }
  }
  return undefined;
}

/**
 * The one period this chart is AT, or nothing.
 *
 * Deliberately strict: any word suggesting a span ("over", "trend", "growth",
 * "each", "by quarter", "since") disqualifies it, because getting this wrong the
 * other way turns a real trend into a single column.
 */
function singlePeriod(
  text: string,
  fiscal: boolean,
): { grain: DateGrain; label: string } | undefined {
  if (
    /\b(over time|trend\w*|growth|history|historical|each|every|by (?:quarter|month|year|week)|quarterly|monthly|weekly|annual\w*|yearly|since|last \d|yoy|qoq|mom|-|–|to|through)\b/i.test(
      text,
    )
  ) {
    return undefined;
  }

  const quarter = /\bQ([1-4])\s*'?((?:19|20)?\d{2})\b/i.exec(text);
  if (quarter) {
    const y = fullYear(quarter[2]);
    return { grain: 'quarter', label: `Q${quarter[1]}'${String(y).slice(2)}` };
  }

  const year = /\b(?:FY|CY)\s?((?:19|20)?\d{2})\b|\b((?:19|20)\d{2})\b/i.exec(text);
  if (year) {
    const raw = year[1] ?? year[2];
    const explicitFiscal = !!year[1];
    return {
      grain: 'year',
      label: yearLabel(fullYear(raw), fiscal || explicitFiscal),
    };
  }
  return undefined;
}

const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));

const yearLabel = (y: number, fiscal: boolean): string =>
  fiscal ? `FY${String(y).slice(2)}` : String(y);

function parseAsOf(asOf?: string): { y: number; m: number; d: number } | undefined {
  const m = asOf ? /^(\d{4})-(\d{2})-(\d{2})/.exec(asOf) : null;
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : undefined;
}

const MONTH_NAMES = [
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
];

/**
 * The last `count` periods ending with the one `anchor` falls in, labelled the
 * way `parseGrain` reads them back — so the datasheet knows it has a date axis
 * and the Devin prompt can state the grain.
 */
function backFrom(
  anchor: { y: number; m: number; d: number },
  grain: DateGrain,
  count: number,
  fiscal: boolean,
): string[] {
  const out: string[] = [];

  if (grain === 'year') {
    for (let i = count - 1; i >= 0; i--) out.push(yearLabel(anchor.y - i, fiscal));
    return out;
  }

  if (grain === 'quarter') {
    const q = Math.floor((anchor.m - 1) / 3);
    for (let i = count - 1; i >= 0; i--) {
      const abs = anchor.y * 4 + q - i;
      const year = Math.floor(abs / 4);
      out.push(`Q${(abs % 4) + 1}'${String(year).slice(2)}`);
    }
    return out;
  }

  if (grain === 'month') {
    for (let i = count - 1; i >= 0; i--) {
      const abs = anchor.y * 12 + (anchor.m - 1) - i;
      const year = Math.floor(abs / 12);
      out.push(`${MONTH_NAMES[abs % 12]} ${year}`);
    }
    return out;
  }

  // Weeks and days both land on a real date, so they're labelled ISO and read
  // back by `parseGrain` as day-grain — a week label of "2026-04-06" is the
  // week beginning, which is what a weekly axis means anyway.
  const step = grain === 'week' ? 7 : 1;
  const ms = Date.UTC(anchor.y, anchor.m - 1, anchor.d);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(ms - i * step * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Recommendation                                                     */
/* ------------------------------------------------------------------ */

interface Rule {
  /** Layout ids this rule speaks for. */
  ids: string[];
  points: number;
  because: string;
  when: (s: Signals) => boolean;
}

/**
 * The rules, in one table so they can be read as an argument rather than traced
 * through branches. Points are deliberately coarse — this is a ranking, and the
 * author sees the runners-up and the reason next to every one of them.
 */
const RULES: Rule[] = [
  {
    ids: ['waterfall-up'],
    points: 10,
    because: 'you asked how one total became another, which is a bridge',
    when: (s) => s.bridge && !s.funnel,
  },
  {
    ids: ['waterfall-down'],
    points: 10,
    because: 'a funnel is a bridge that only ever loses volume',
    when: (s) => s.funnel && (s.bridge || !s.time),
  },
  {
    ids: ['sankey'],
    points: 10,
    because: 'you described a quantity moving between things, not sitting in them',
    when: (s) => s.flow,
  },
  {
    ids: ['bubble'],
    points: 11,
    because: 'three measures at once — two on the axes, one in the size',
    when: (s) => s.sized,
  },
  {
    ids: ['scatter'],
    points: 10,
    because: 'two measures against each other is the one thing a scatter does best',
    when: (s) => s.correlation && !s.sized,
  },
  {
    ids: ['combo-clustered-line'],
    points: 9,
    because: 'a rate and an absolute belong on two scales, so the rate rides on a line',
    when: (s) => s.rateOverTotal && !s.share,
  },
  {
    ids: ['combo-stacked-line'],
    points: 9,
    because: 'the rate sits over a build of its own components',
    when: (s) => s.rateOverTotal && s.share,
  },
  {
    ids: ['line'],
    points: 8,
    because: 'this many periods reads as a trend; columns would be a picket fence',
    when: (s) => s.time && s.periodCount >= 10,
  },
  {
    ids: ['line'],
    points: 6,
    because: 'one measure across many periods is a trend, and a trend is a line',
    when: (s) => s.time && s.periodCount >= 6 && s.seriesCount <= 1,
  },
  {
    ids: ['line'],
    points: 5,
    because: 'too many subjects to compare period by period, so each gets a line',
    when: (s) => s.time && s.seriesCount >= 4 && !s.share,
  },
  {
    ids: ['stacked'],
    points: 6,
    because: 'a breakdown over time stacks, so each period still shows its total',
    when: (s) => s.time && s.breakdown && !s.compare,
  },
  {
    ids: ['clustered'],
    points: 6,
    because: 'a few parts per period read better side by side than stacked',
    when: (s) => s.time && s.breakdown && s.seriesCount <= 3 && s.periodCount <= 8,
  },
  {
    ids: ['stacked100'],
    points: 8,
    because: 'you asked about the mix, not the total, so each period is normalised',
    when: (s) => s.share && s.time && !s.totalMatters,
  },
  {
    ids: ['stacked'],
    points: 8,
    because: 'the total and its parts are both being read, so the parts stack into it',
    when: (s) => s.share && s.time && s.totalMatters,
  },
  {
    ids: ['pie'],
    points: 8,
    because: 'one moment split into shares — no span of periods was asked for',
    when: (s) => s.share && !s.time,
  },
  {
    ids: ['stacked100', 'clustered'],
    points: 3,
    because: 'the same split reads as columns if you would rather compare parts',
    when: (s) => s.share && !s.time,
  },
  {
    ids: ['clustered'],
    points: 7,
    because: 'you asked to compare things side by side, which is what clustering does',
    when: (s) => s.compare && !s.share && !s.correlation,
  },
  {
    ids: ['clustered'],
    points: 5,
    because: 'a handful of periods compares better as columns than as a line',
    when: (s) => s.time && s.periodCount > 0 && s.periodCount <= 6 && !s.share,
  },
  {
    ids: ['clustered'],
    points: 4,
    because: 'a ranking is a bar per thing, longest first',
    when: (s) => s.ranking,
  },
  {
    ids: ['stacked'],
    points: 3,
    because: 'a breakdown of a total stacks into it',
    when: (s) => s.share && s.totalMatters,
  },
];

/** Tie-break, so the same sentence always produces the same order. */
const BASE_PRIORITY = ['clustered', 'line', 'stacked', 'stacked100', 'pie'];

export function recommendLayouts(
  description: string,
  ctx: BriefContext = {},
): ChartRecommendation {
  const brief = readBrief(description, ctx);
  const text = brief.description;

  const named = NAMED_KINDS.find((n) => n.re.test(text));
  const overTime = (brief.period?.labels.length ?? 0) > 1;
  const signals: Signals = {
    // A single named period is a moment, not a time axis — see `readBrief`.
    time: overTime || (RE.time.test(text) && !brief.period),
    share: RE.share.test(text),
    ranking: RE.ranking.test(text),
    compare: RE.compare.test(text),
    bridge: RE.bridge.test(text),
    funnel: RE.funnel.test(text),
    flow: RE.flow.test(text),
    correlation: RE.correlation.test(text),
    sized: RE.sized.test(text),
    rateOverTotal: !!brief.secondaryMeasure,
    totalMatters: RE.totalMatters.test(text),
    breakdown: !!brief.dimension,
    namedKind: named?.id,
    seriesCount: brief.seriesNames.length || brief.categories.length,
    periodCount: overTime ? brief.period!.labels.length : 0,
  };

  const scores = new Map<string, { score: number; why: string; points: number }>();
  const add = (id: string, points: number, because: string) => {
    const prev = scores.get(id);
    const score = (prev?.score ?? 0) + points;
    // The reason shown is the strongest one that fired, not the last.
    const better = !prev || points > prev.points;
    scores.set(id, {
      score,
      points: better ? points : prev.points,
      why: better ? because : prev.why,
    });
  };

  for (const rule of RULES) {
    if (!rule.when(signals)) continue;
    for (const id of rule.ids) add(id, rule.points, rule.because);
  }

  if (signals.namedKind) {
    add(signals.namedKind, 12, 'you named this chart type, so nothing was inferred');
  }

  // Nothing matched: a description we couldn't read still has to produce a
  // start, and a clustered column is the least presumptuous one there is.
  if (!scores.size) {
    add(
      'clustered',
      1,
      "nothing in the description pinned a shape down — this is the plainest place to start",
    );
  }

  const suggestions: LayoutSuggestion[] = [...scores.entries()]
    .map(([id, v]) => {
      const layout = CHART_LAYOUTS.find((l) => l.id === id);
      return layout ? { id, layout, ...v } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        basePriority(a.id) - basePriority(b.id) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 4)
    .map(({ layout, score, why }) => ({
      layout,
      orientation: orientationFor(layout, signals, brief),
      score,
      why,
    }));

  const top = suggestions[0]?.score ?? 0;
  const runnerUp = suggestions[1]?.score ?? 0;
  const confidence: ChartRecommendation['confidence'] =
    top >= 8 && top - runnerUp >= 2 ? 'high' : top >= 5 ? 'medium' : 'low';

  return { brief, suggestions, confidence };
}

const basePriority = (id: string): number => {
  const i = BASE_PRIORITY.indexOf(id);
  return i === -1 ? BASE_PRIORITY.length : i;
};

/**
 * Sideways when the labels need the room: a ranking, or long category names
 * with no time axis. A time axis always runs left to right — a horizontal
 * timeline reads as a Gantt chart, which is not what was asked for.
 */
function orientationFor(
  layout: ChartLayout,
  signals: Signals,
  brief: ChartBrief,
): ChartOrientation {
  if (!supportsOrientation(layout.kind)) return 'vertical';
  if (signals.time || brief.period) return 'vertical';
  const longest = Math.max(0, ...brief.categories.map((c) => c.length));
  if (signals.ranking || (brief.categories.length > 5 && longest > 12)) return 'horizontal';
  return 'vertical';
}
