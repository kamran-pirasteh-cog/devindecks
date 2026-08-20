/**
 * "Refresh the numbers in this deck".
 *
 * One prompt for the WHOLE deck, built from the live model on every click: an
 * inventory of every number the deck states, page by page, and a single CSV
 * contract to return them in. The per-chart brief in `prompt.ts` answers "find
 * the data for this chart"; this answers the other question people actually
 * have — "are any of these figures stale, and what are they now?".
 *
 * Two properties make the answer usable rather than just readable:
 *
 * 1. **Every number carries a `ref`.** A ref addresses the number's place in
 *    the model — page, chart, series, category, or the text element and the
 *    offset of the token inside it — so a returned row routes back to exactly
 *    the figure it replaces. Ordering, labels and titles can all change without
 *    a row losing its target.
 * 2. **One CSV, one header, for the whole deck.** Not a file per chart. The
 *    header is exported here so the eventual paste-back reads the same columns
 *    this prompt asks for, in the same commit.
 *
 * Pure — no clipboard, no `Date.now()`, no randomness — so the same deck always
 * produces the same brief and the whole thing is snapshot-testable.
 */
import {
  isButterflySpec,
  isGridSpec,
  isSankeySpec,
  isWaterfallSpec,
  isXYSpec,
  type ChartSpec,
  type Deck,
  type Slide,
  type SlideElement,
  type TextElement,
} from '@/model';
import { inferChartMeta, type ChartMeta } from './meta';

/** Where a number lives, and what it currently says. */
export interface DeckNumber {
  /** Stable address, echoed back verbatim in the CSV. See the file header. */
  ref: string;
  /** 1-based page number, as printed on the slide. */
  page: number;
  slideId: string;
  origin: 'chart' | 'text';
  chartId?: string;
  seriesName?: string;
  categoryLabel?: string;
  /** What this number is called, in the deck's own words. */
  label: string;
  /** The figure as the model holds it. `null` is a gap, not a zero. */
  value: number | null;
  /** For a text number, the token exactly as typed — "$4.2M", "42%". */
  display?: string;
}

export interface RefreshChart {
  chartId: string;
  kind: ChartSpec['kind'];
  title?: string;
  meta: ChartMeta;
  numbers: DeckNumber[];
}

export interface RefreshPage {
  page: number;
  slideId: string;
  title?: string;
  charts: RefreshChart[];
  /** Numbers stated in body copy, KPI blocks, callouts — anything but a chart. */
  textNumbers: DeckNumber[];
}

export interface DeckRefreshPrompt {
  text: string;
  pages: RefreshPage[];
  /** How many figures the deck states in total. */
  numberCount: number;
  csvHeader: string[];
}

export interface DeckRefreshContext {
  /** Stamped in the footer so an answer can be matched to its question. */
  generatedAt?: string;
  /** "as of" date the refresh should be measured against, e.g. '2026-08-19'. */
  asOf?: string;
}

/**
 * The one CSV shape for the whole deck.
 *
 * `ref` first because it's the only column that must survive round-tripping
 * untouched; `current_value` sits next to `new_value` so a human scanning the
 * file sees the change without doing a lookup.
 */
export const REFRESH_CSV_HEADER = [
  'ref',
  'page',
  'label',
  'current_value',
  'new_value',
  'unit',
  'as_of',
  'source_url',
  'source_note',
  'confidence',
  'notes',
] as const;

const KIND_NOUN: Record<string, string> = {
  column: 'column chart',
  bar: 'bar chart',
  line: 'line chart',
  area: 'area chart',
  combo: 'combination chart',
  pie: 'pie chart',
  donut: 'donut chart',
  scatter: 'scatter plot',
  bubble: 'bubble chart',
  waterfall: 'waterfall (bridge) chart',
  sankey: 'Sankey diagram',
  mekko: 'Mekko chart',
  butterfly: 'butterfly chart',
};

/* ------------------------------------------------------------------ */
/* Collection                                                         */
/* ------------------------------------------------------------------ */

export function collectDeckNumbers(deck: Deck): RefreshPage[] {
  return deck.slides.map((slide, i) => {
    const page = i + 1;
    const title = slideTitle(slide);
    const charts = (slide.charts ?? []).map((chart) =>
      chartNumbers(chart.id, chart.spec, page, slide.id, { deckTitle: deck.title, deckTags: deck.tags, slideTitle: title }),
    );
    return { page, slideId: slide.id, title, charts, textNumbers: textNumbers(slide, page) };
  });
}

function slideTitle(slide: Slide): string | undefined {
  const el = slide.elements.find(
    (e) => e.type === 'text' && (e.role === 'title' || e.role === 'heading'),
  );
  const text = el?.type === 'text' ? elementText(el) : '';
  return text || undefined;
}

const elementText = (el: TextElement) =>
  el.body.paragraphs
    .map((p) => p.runs.map((r) => r.text).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

function chartNumbers(
  chartId: string,
  spec: ChartSpec,
  page: number,
  slideId: string,
  ctx: { deckTitle?: string; deckTags?: string[]; slideTitle?: string },
): RefreshChart {
  const meta = inferChartMeta(spec, ctx);
  const numbers: DeckNumber[] = [];
  const at = (
    parts: string[],
    label: string,
    value: number | null,
    over: Partial<DeckNumber> = {},
  ) => {
    numbers.push({
      ref: [`p${page}`, `c:${chartId}`, ...parts].join('/'),
      page,
      slideId,
      origin: 'chart',
      chartId,
      label,
      value,
      ...over,
    });
  };

  if (isGridSpec(spec)) {
    for (const s of spec.data.series) {
      spec.data.categories.forEach((cat, i) => {
        at([s.key, cat.key], `${s.name} — ${cat.label}`, s.values[i] ?? null, {
          seriesName: s.name,
          categoryLabel: cat.label,
        });
      });
    }
  } else if (isWaterfallSpec(spec)) {
    for (const item of spec.data.items) {
      // A computed subtotal has no figure of its own to refresh — asking for
      // one invites a number that contradicts the items above it.
      if (item.value === null && (item.role === 'subtotal' || item.role === 'total')) continue;
      at([item.key], `${item.label} (${item.role})`, item.value, { categoryLabel: item.label });
    }
  } else if (isButterflySpec(spec)) {
    for (const [side, series] of [['left', spec.left] as const, ['right', spec.right] as const]) {
      for (const s of series) {
        spec.categories.forEach((cat, i) => {
          at([side, s.key, cat.key], `${s.name} (${side}) — ${cat.label}`, s.values[i] ?? null, {
            seriesName: s.name,
            categoryLabel: cat.label,
          });
        });
      }
    }
  } else if (isXYSpec(spec)) {
    for (const s of spec.data.series) {
      s.points.forEach((p, i) => {
        const name = p.label ?? `Point ${i + 1}`;
        at([s.key, p.key, 'x'], `${s.name} — ${name} (x)`, p.x, { seriesName: s.name, categoryLabel: name });
        at([s.key, p.key, 'y'], `${s.name} — ${name} (y)`, p.y, { seriesName: s.name, categoryLabel: name });
        if (p.size !== undefined) {
          at([s.key, p.key, 'size'], `${s.name} — ${name} (size)`, p.size, {
            seriesName: s.name,
            categoryLabel: name,
          });
        }
      });
    }
  } else if (isSankeySpec(spec)) {
    const label = (key: string) => spec.data.nodes.find((n) => n.key === key)?.label ?? key;
    for (const link of spec.data.links) {
      at([link.key], `${label(link.from)} → ${label(link.to)}`, link.value, {
        categoryLabel: `${label(link.from)} → ${label(link.to)}`,
      });
    }
  }

  return { chartId, kind: spec.kind, title: spec.title, meta, numbers };
}

/**
 * Numbers stated in words — the KPI figure, the "+34% YoY" in a callout, the
 * "$1.2B TAM" in a body line.
 *
 * Deliberately conservative about what counts as a number: a token has to start
 * at a non-letter boundary, so `FY25`, `Q3` and `H1` — labels, not figures —
 * don't come back as 25, 3 and 1. The trade is that a genuinely bare "2025"
 * meaning a value is listed too; a listed number that turns out to be a label
 * costs one line of prompt, while a missed KPI costs a stale slide.
 */
const NUMBER_TOKEN =
  // The comma-grouped branch requires a comma, so "2026" can't be matched as
  // "202" with a stray "6" left behind; the trailing guard stops a token ending
  // part-way through a longer run of digits.
  /(?<![A-Za-z0-9.,])([$€£¥]?\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[$€£¥]?\s?\d+(?:\.\d+)?)(?!\d)\s?(%|bps|pp|[kKmMbB]n?\b|x\b|)/g;

/**
 * A bare four-digit integer in year range, with no currency, separator, decimal
 * or unit on it. In a deck that is "Q3 2026" or "FY 2025" — a label — far more
 * often than it is a figure, and a page of spurious year rows is what makes an
 * inventory get skimmed instead of read. A genuine "2000 seats" is the cost;
 * it's recoverable by writing it as "2,000".
 */
const looksLikeAYear = (numeric: string, suffix: string) =>
  suffix === '' && /^\d{4}$/.test(numeric) && Number(numeric) >= 1900 && Number(numeric) <= 2100;

const SUFFIX_SCALE: Record<string, number> = {
  k: 1e3,
  K: 1e3,
  m: 1e6,
  M: 1e6,
  mn: 1e6,
  b: 1e9,
  B: 1e9,
  bn: 1e9,
  Bn: 1e9,
};

function textNumbers(slide: Slide, page: number): DeckNumber[] {
  const out: DeckNumber[] = [];
  for (const el of slide.elements) {
    if (el.type !== 'text') continue;
    // A chart's own compiled labels are the chart's numbers, already inventoried
    // from the spec. Listing them again would ask for the same figure twice.
    if (el.chartRef) continue;
    const text = elementText(el);
    if (!text) continue;
    let i = 0;
    for (const m of text.matchAll(NUMBER_TOKEN)) {
      const display = m[0].trim();
      const numeric = m[1].trim();
      if (looksLikeAYear(numeric, m[2])) continue;
      const value = parseDisplay(numeric, m[2]);
      if (value === null) continue;
      out.push({
        ref: `p${page}/t:${el.id}/n${i}`,
        page,
        slideId: slide.id,
        origin: 'text',
        label: el.role ? `${el.role}: ${text}` : text,
        value,
        display,
      });
      i += 1;
    }
  }
  return out;
}

function parseDisplay(numeric: string, suffix: string): number | null {
  const n = Number(numeric.replace(/[$€£¥,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (suffix === '%') return n / 100;
  return n * (SUFFIX_SCALE[suffix] ?? 1);
}

/* ------------------------------------------------------------------ */
/* The prompt                                                         */
/* ------------------------------------------------------------------ */

export function buildDeckRefreshPrompt(
  deck: Deck,
  ctx: DeckRefreshContext = {},
): DeckRefreshPrompt {
  const pages = collectDeckNumbers(deck);
  const numberCount = pages.reduce(
    (n, p) => n + p.textNumbers.length + p.charts.reduce((m, c) => m + c.numbers.length, 0),
    0,
  );
  const subject = deck.tags?.find((t) => t.trim()) ?? deck.brief?.client;

  const lines: string[] = [];

  lines.push('# Refresh the numbers in this deck');
  lines.push('');
  lines.push(
    [
      `Below is every figure stated in **${deck.title}**`,
      subject ? ` (subject: **${subject}**)` : '',
      `, page by page — ${numberCount} number${numberCount === 1 ? '' : 's'} across ${pages.length} page${pages.length === 1 ? '' : 's'}.`,
    ].join(''),
  );
  lines.push('');
  lines.push(
    'For each one, find the current figure from a primary source and return it in the CSV described at the bottom. Return **one row per `ref`, for every `ref` listed** — including the ones that have not changed, where `new_value` simply repeats `current_value`.',
  );
  if (ctx.asOf) {
    lines.push('');
    lines.push(`Refresh as of **${ctx.asOf}** — the most recent figure published on or before that date.`);
  }
  lines.push('');

  lines.push('## Rules');
  lines.push('');
  lines.push(
    [
      '- **Never invent a number.** If a figure is not available, leave `new_value` empty and say why in `notes`. Do not interpolate, extrapolate or substitute a plausible value.',
      '- **Match the units of `current_value` exactly.** Each chart states its units below; do not rescale, and do not switch currency. Percentages are decimals — `0.427` means 42.7%.',
      '- Give `source_url` and `source_note` (page or table reference) for **every** row.',
      '- Mark each row `reported` (stated verbatim in a source), `derived` (computed from stated figures — show the arithmetic in `notes`) or `estimated`.',
      '- Prefer primary sources: 10-K/10-Q and equivalent filings, company IR material, regulator and statistical-agency publications.',
      '- If a source restates a prior period, use the restated figure and note it.',
      '- Echo each `ref` back **character for character**. It is how the row finds its way back onto the slide; a reworded ref cannot be applied.',
      "- Where a figure looks wrong rather than stale — a typo, a units mix-up, a label that doesn't match its value — return the correct figure and flag it in `notes`.",
    ].join('\n'),
  );
  lines.push('');

  lines.push('## The numbers, by page');
  lines.push('');

  for (const p of pages) {
    lines.push(`### Page ${p.page}${p.title ? ` — ${p.title}` : ''}`);
    lines.push('');
    if (!p.charts.length && !p.textNumbers.length) {
      lines.push('_No figures on this page — nothing to refresh._');
      lines.push('');
      continue;
    }

    for (const c of p.charts) {
      const noun = KIND_NOUN[c.kind] ?? 'chart';
      lines.push(`**${c.title ?? 'Untitled chart'}** — ${noun}${c.meta.measure ? `, showing ${c.meta.measure}` : ''}`);
      lines.push('');
      lines.push(`- Units: ${c.meta.unitSentence}`);
      if (c.meta.seriesNames.length > 1) {
        lines.push(`- Series: ${c.meta.seriesNames.join(', ')}`);
      }
      lines.push('');
      lines.push(numberTable(c.numbers));
      lines.push('');
    }

    if (p.textNumbers.length) {
      lines.push('**Figures stated in the page text**');
      lines.push('');
      lines.push(textTable(p.textNumbers));
      lines.push('');
      lines.push(
        '_These are read out of the words on the slide, so the label is the whole line the number sits in. Refresh the number, not the sentence._',
      );
      lines.push('');
    }
  }

  lines.push('## Return format');
  lines.push('');
  lines.push('A single CSV — one file for the whole deck — with exactly this header:');
  lines.push('');
  lines.push('```');
  lines.push(REFRESH_CSV_HEADER.join(','));
  lines.push('```');
  lines.push('');
  lines.push(
    [
      '- `ref`, `page`, `label` and `current_value`: copied from the tables above, unchanged.',
      '- `new_value`: a plain number — no currency symbol, no thousands separator, no `%`, no `M`/`B` suffix. Empty means not available.',
      '- `unit`: what the number is in, e.g. `USD`, `USD millions`, `decimal fraction`, `customers`.',
      '- `as_of`: the date the figure is stated as of, `YYYY-MM-DD`.',
      '- `confidence`: `reported`, `derived` or `estimated`.',
      '- Quote any field containing a comma. Return the CSV and nothing else — no commentary above or below the block.',
    ].join('\n'),
  );
  lines.push('');
  lines.push('Worked example of two rows:');
  lines.push('');
  lines.push('```');
  lines.push(REFRESH_CSV_HEADER.join(','));
  lines.push(EXAMPLE_ROWS);
  lines.push('```');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(
    [
      `Deck: ${deck.title}`,
      `\`${deck.id}\``,
      `${pages.length} pages · ${numberCount} numbers`,
      ctx.generatedAt ? `Generated: ${ctx.generatedAt}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );

  return { text: lines.join('\n'), pages, numberCount, csvHeader: [...REFRESH_CSV_HEADER] };
}

const cell = (s: string) => s.replace(/\|/g, '\\|');

function numberTable(numbers: DeckNumber[]): string {
  const rows = [
    '| ref | series | row | current |',
    '| --- | --- | --- | --- |',
    ...numbers.map(
      (n) =>
        `| \`${n.ref}\` | ${cell(n.seriesName ?? '—')} | ${cell(n.categoryLabel ?? '—')} | ${fmt(n.value)} |`,
    ),
  ];
  return rows.join('\n');
}

function textTable(numbers: DeckNumber[]): string {
  const rows = [
    '| ref | as written | in context | current |',
    '| --- | --- | --- | --- |',
    ...numbers.map(
      (n) => `| \`${n.ref}\` | ${cell(n.display ?? '')} | ${cell(truncate(n.label, 90))} | ${fmt(n.value)} |`,
    ),
  ];
  return rows.join('\n');
}

const fmt = (v: number | null) => (v === null ? '_(gap)_' : String(v));

const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/**
 * Deliberately synthetic rather than built from the deck's own first number: an
 * example whose units and source have to be invented anyway reads as real data
 * when it's wearing a real label, and a reader who copies it copies a fiction.
 */
const EXAMPLE_ROWS = [
  'p3/c:ch_7/s0/c2,3,"Revenue — FY25",1240,1310,USD millions,2026-06-30,https://investors.example.com/fy26-q2.pdf,"Total revenue, page 42",reported,',
  'p1/t:el_9/n0,1,"kpi.value: $4.2M ARR",4200000,4900000,USD,2026-06-30,https://investors.example.com/fy26-q2.pdf,"ARR, page 7",reported,"Restated; prior figure excluded services"',
].join('\n');
