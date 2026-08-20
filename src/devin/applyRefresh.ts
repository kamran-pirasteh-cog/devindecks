/**
 * Reading a refresh CSV back into the deck.
 *
 * The prompt in `refresh.ts` hands out a `ref` per number; this reads the
 * answer and puts each figure back exactly where its `ref` points. Two rules
 * shape everything here:
 *
 * 1. **Nothing is guessed.** A row whose `new_value` could mean two things —
 *    `42%` against a chart that stores `0.427`, a number that would need a
 *    minus sign the slide has no room for — is refused and reported, never
 *    coerced. A wrong figure that lands silently is the failure this whole
 *    feature exists to prevent.
 * 2. **Only the number changes.** A figure written into a sentence is replaced
 *    inside the run that holds it, in the shape it was already written in:
 *    `$4.2M` becomes `$4.9M`, not `4900000`. Runs, styling, the words around
 *    it and the box itself are untouched.
 *
 * Pure — planning never writes. `src/chat/apply.ts` executes a plan through the
 * store's own actions, so a refresh lands in the undo stack like a hand edit.
 */
import {
  isButterflySpec,
  isGridSpec,
  isSankeySpec,
  isWaterfallSpec,
  isXYSpec,
  type ChartSpec,
  type Deck,
  type TextBody,
  type TextElement,
} from '@/model';
import { parseClipboardTable } from '@/sheet/sheetClipboard';
import { collectDeckNumbers, flattenRuns, numberSites, REFRESH_CSV_HEADER, type DeckNumber } from './refresh';

/* ------------------------------------------------------------------ */
/* The CSV                                                            */
/* ------------------------------------------------------------------ */

export interface RefreshCsvRow {
  /** 1-based line within the CSV, so a problem can be pointed at. */
  line: number;
  ref: string;
  /** Parsed figure; `null` is an explicit "not available". */
  newValue: number | null;
  /** The cell as written, kept for reporting. */
  rawValue: string;
  /** Set when the cell needed interpreting at all — reported, never silent. */
  note?: string;
  unit?: string;
  asOf?: string;
  sourceUrl?: string;
  confidence?: string;
  notes?: string;
  /** Set when the cell could not be read as a number at all. */
  unreadable?: string;
}

export interface ParsedRefreshCsv {
  rows: RefreshCsvRow[];
  /** Anything wrong with the file as a whole — a missing column, no header. */
  problems: string[];
}

const REQUIRED_COLUMNS = ['ref', 'new_value'] as const;

/**
 * Tolerant about packaging, strict about content: a fenced block, a preamble
 * line or a `\r\n` file all read fine, but a value that could mean two things
 * comes back unreadable rather than interpreted.
 */
export function parseRefreshCsv(text: string): ParsedRefreshCsv {
  const problems: string[] = [];
  const body = unfence(text);
  if (!body.trim()) return { rows: [], problems: ['The CSV is empty.'] };

  const table = parseClipboardTable(body).filter((r) => r.some((c) => c.trim()));
  const headerAt = table.findIndex((r) => r[0]?.trim().toLowerCase() === 'ref');
  if (headerAt === -1) {
    return {
      rows: [],
      problems: [
        `No header row. The first column of the header must be "ref"; expected: ${REFRESH_CSV_HEADER.join(', ')}.`,
      ],
    };
  }

  const header = table[headerAt].map((h) => h.trim().toLowerCase());
  const at = (name: string) => header.indexOf(name);
  for (const need of REQUIRED_COLUMNS) {
    if (at(need) === -1) problems.push(`The CSV has no "${need}" column.`);
  }
  if (problems.length) return { rows: [], problems };

  const cell = (row: string[], name: string) => {
    const i = at(name);
    return i === -1 ? undefined : row[i]?.trim() || undefined;
  };

  const rows: RefreshCsvRow[] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const row = table[i];
    const ref = row[at('ref')]?.trim();
    if (!ref) {
      problems.push(`Line ${i + 1} has no ref — skipped.`);
      continue;
    }
    const rawValue = row[at('new_value')]?.trim() ?? '';
    const read = readNumber(rawValue);
    rows.push({
      line: i + 1,
      ref,
      rawValue,
      newValue: read.value,
      ...(read.note ? { note: read.note } : {}),
      ...(read.unreadable ? { unreadable: read.unreadable } : {}),
      unit: cell(row, 'unit'),
      asOf: cell(row, 'as_of'),
      sourceUrl: cell(row, 'source_url'),
      confidence: cell(row, 'confidence'),
      notes: cell(row, 'notes'),
    });
  }

  const seen = new Map<string, number>();
  for (const r of rows) {
    const first = seen.get(r.ref);
    if (first !== undefined) problems.push(`Ref "${r.ref}" appears twice (lines ${first} and ${r.line}).`);
    else seen.set(r.ref, r.line);
  }

  return { rows, problems };
}

/** Strips a markdown fence, and any chat around it, down to the CSV itself. */
function unfence(text: string): string {
  const fenced = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const block = fenced.find((b) => /^\s*ref\s*,/im.test(b));
  return block ?? (fenced.length === 1 ? fenced[0] : text);
}

/**
 * A figure from a cell. Commas, a currency symbol and a k/M/B suffix all scale
 * unambiguously and are accepted with a note; a bare `%` does not — `12%`
 * against a chart could be `12` or `0.12` — so it comes back unreadable.
 */
function readNumber(raw: string): { value: number | null; note?: string; unreadable?: string } {
  const v = raw.trim();
  if (!v || /^(n\/?a|none|null|-)$/i.test(v)) return { value: null };

  if (/^[-+]?\d+(\.\d+)?$/.test(v)) return { value: Number(v) };

  if (/%$/.test(v)) {
    return {
      value: null,
      unreadable: `"${v}" ends in a percent sign, which could mean either ${v.slice(0, -1)} or ${
        Number(v.slice(0, -1).replace(/[^\d.-]/g, '')) / 100
      }. Return it as a plain number in the same form as current_value.`,
    };
  }

  const m = /^([-+]?)\s*[$€£¥]?\s*([\d,]+(?:\.\d+)?)\s*([kKmMbB]n?)?$/.exec(v);
  if (!m) return { value: null, unreadable: `"${v}" isn't a number.` };
  const digits = m[2].replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(digits)) return { value: null, unreadable: `"${v}" isn't a number.` };
  const scale = m[3] ? SUFFIX_SCALE[m[3]] ?? 1 : 1;
  const value = Number(`${m[1] === '-' ? '-' : ''}${digits}`) * scale;
  return {
    value,
    note: `read "${v}" as ${value}`,
  };
}

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

/* ------------------------------------------------------------------ */
/* The plan                                                           */
/* ------------------------------------------------------------------ */

export type EntryStatus =
  /** Will be written. */
  | 'change'
  /** Confirmed, and the same as what's on the slide. */
  | 'unchanged'
  /** The row says the figure isn't available; the slide keeps what it has. */
  | 'unavailable'
  /** The ref names nothing in this deck. */
  | 'unmatched'
  /** The value couldn't be read without guessing. */
  | 'unreadable'
  /** Understood, but writing it would change more than the number. */
  | 'blocked';

export interface PlanEntry {
  ref: string;
  page: number;
  label: string;
  origin: 'chart' | 'text';
  status: EntryStatus;
  current: number | null;
  next: number | null;
  /** For a text figure: the token now, and the token it would become. */
  display?: string;
  nextDisplay?: string;
  /** Why it is blocked, unmatched or unreadable. */
  reason?: string;
  /** Things worth a human's eye before this lands. */
  warnings: string[];
  /** Where to write, resolved once here so applying needs no re-parsing. */
  target?: WriteTarget;
}

export type WriteTarget =
  | { kind: 'chart'; slideId: string; chartId: string; parts: string[] }
  | { kind: 'text'; slideId: string; elementId: string; site: number; text: string };

export interface RefreshPlan {
  entries: PlanEntry[];
  /** Numbers in the deck the CSV never mentions — i.e. never checked. */
  unchecked: DeckNumber[];
  counts: Record<EntryStatus | 'total', number>;
}

/**
 * What the CSV would do to the deck, worked out without touching it.
 *
 * Every row is resolved against a fresh inventory, so a deck edited between
 * generating the prompt and pasting the answer produces `unmatched` rows rather
 * than a number written into the wrong place.
 */
export function planRefresh(deck: Deck, rows: RefreshCsvRow[]): RefreshPlan {
  const pages = collectDeckNumbers(deck);
  const index = new Map<string, { number: DeckNumber; spec?: ChartSpec }>();
  for (const p of pages) {
    for (const c of p.charts) {
      const spec = specFor(deck, c.chartId);
      for (const n of c.numbers) index.set(n.ref, { number: n, spec });
    }
    for (const n of p.textNumbers) index.set(n.ref, { number: n });
  }

  const entries = rows.map((row) => planRow(deck, row, index));
  const mentioned = new Set(rows.map((r) => r.ref));
  const unchecked = [...index.values()].map((v) => v.number).filter((n) => !mentioned.has(n.ref));

  const counts = { total: entries.length } as RefreshPlan['counts'];
  for (const status of ['change', 'unchanged', 'unavailable', 'unmatched', 'unreadable', 'blocked'] as const) {
    counts[status] = entries.filter((e) => e.status === status).length;
  }
  return { entries, unchecked, counts };
}

function planRow(
  deck: Deck,
  row: RefreshCsvRow,
  index: Map<string, { number: DeckNumber; spec?: ChartSpec }>,
): PlanEntry {
  const hit = index.get(row.ref);
  const base: PlanEntry = {
    ref: row.ref,
    page: hit?.number.page ?? 0,
    label: hit?.number.label ?? '—',
    origin: hit?.number.origin ?? 'text',
    status: 'change',
    current: hit?.number.value ?? null,
    next: row.newValue,
    warnings: [],
  };

  if (!hit) {
    return {
      ...base,
      status: 'unmatched',
      reason: `Nothing in this deck has the ref "${row.ref}". It may be from an older version of the deck, or the ref was reworded.`,
    };
  }
  if (row.unreadable) return { ...base, status: 'unreadable', reason: row.unreadable };
  if (row.newValue === null) {
    return {
      ...base,
      status: 'unavailable',
      reason: row.notes ? `Reported unavailable: ${row.notes}` : 'The row reports no figure available.',
    };
  }
  if (row.note) base.warnings.push(row.note);

  const entry =
    hit.number.origin === 'chart'
      ? planChart(base, hit.number, hit.spec, row)
      : planText(deck, base, hit.number, row);

  if (entry.status === 'change' && entry.current === entry.next && entry.nextDisplay === entry.display) {
    return { ...entry, status: 'unchanged' };
  }
  return entry;
}

function planChart(base: PlanEntry, number: DeckNumber, spec: ChartSpec | undefined, row: RefreshCsvRow): PlanEntry {
  if (!spec || !number.chartId) {
    return { ...base, status: 'blocked', reason: 'That chart is no longer on the slide.' };
  }
  const parts = number.ref.split('/').slice(2);
  if (!writeToSpec(structuredClone(spec), parts, row.newValue!)) {
    return {
      ...base,
      status: 'blocked',
      reason: 'That series or row no longer exists in the chart — its data has been edited since the prompt was generated.',
    };
  }
  const warnings = [...base.warnings, ...magnitudeWarnings(number.value, row.newValue!)];
  // A chart in percent style stores 0.427, so a figure above 1.5 is nearly
  // always a percentage that arrived unscaled. It is refused rather than
  // divided, because 1.2 could honestly be either 120% or a small ratio.
  if (spec.numberFormat.style === 'percent' && Math.abs(row.newValue!) > 1.5) {
    return {
      ...base,
      status: 'blocked',
      reason: `This chart holds percentages as decimals (0.427 = 42.7%), and ${row.newValue} would plot as ${Math.round(
        row.newValue! * 100,
      )}00%. Send it as a decimal fraction.`,
      warnings,
    };
  }
  if (row.unit) warnings.push(...unitWarnings(row.unit, spec));
  return {
    ...base,
    warnings,
    target: { kind: 'chart', slideId: number.slideId, chartId: number.chartId, parts },
  };
}

function planText(deck: Deck, base: PlanEntry, number: DeckNumber, row: RefreshCsvRow): PlanEntry {
  const el = textElement(deck, number.slideId, number.ref);
  if (!el) return { ...base, status: 'blocked', reason: 'That text box is no longer on the slide.' };

  const siteIndex = Number(number.ref.split('/').pop()?.replace(/^n/, ''));
  const site = numberSites(el)[siteIndex];
  if (!site || site.display !== number.display) {
    return { ...base, status: 'blocked', reason: 'That line has been edited since the prompt was generated.' };
  }

  const { spans } = flattenRuns(el);
  const touched = spans.filter((s) => s.start < site.end && s.end > site.start);
  if (touched.length !== 1) {
    return {
      ...base,
      display: site.display,
      status: 'blocked',
      reason: `"${site.display}" is split across differently-styled pieces of text, so replacing it would change how the line looks. Edit it by hand.`,
    };
  }

  const next = formatLikeToken(site.display, row.newValue!);
  if (!next) {
    return {
      ...base,
      display: site.display,
      status: 'blocked',
      reason: `Can't write ${row.newValue} in the same form as "${site.display}"${
        row.newValue! < 0 ? ' — the slide writes this figure without a sign' : ''
      }.`,
    };
  }

  const warnings = [...base.warnings, ...magnitudeWarnings(number.value, row.newValue!)];
  const rendered = numberSites(withText(el, touched[0], site, next))[siteIndex];
  if (!rendered || Math.abs(rendered.value - row.newValue!) > Math.abs(row.newValue! || 1) * 0.005) {
    warnings.push(
      `"${site.display}" is written to ${decimalsOf(site.display)} decimal${
        decimalsOf(site.display) === 1 ? '' : 's'
      }, so ${row.newValue} shows as "${next}".`,
    );
  }
  if (next.length > site.display.length + 2) {
    warnings.push(`"${site.display}" becomes the longer "${next}" — check the line still fits.`);
  }

  return {
    ...base,
    display: site.display,
    nextDisplay: next,
    warnings,
    target: { kind: 'text', slideId: number.slideId, elementId: el.id, site: siteIndex, text: next },
  };
}

function magnitudeWarnings(current: number | null, next: number): string[] {
  if (current === null || current === 0 || next === 0) return [];
  const ratio = Math.abs(next / current);
  const out: string[] = [];
  if (ratio >= 50 || ratio <= 1 / 50) {
    out.push(
      `${current} → ${next} is a ${ratio >= 50 ? `${Math.round(ratio)}×` : `${Math.round(1 / ratio)}× smaller`} move — check the units match.`,
    );
  }
  if (Math.sign(current) !== Math.sign(next)) out.push(`${current} → ${next} flips sign.`);
  return out;
}

/** The unit column against what the chart actually holds. */
function unitWarnings(unit: string, spec: ChartSpec): string[] {
  const u = unit.toLowerCase();
  const divisor = spec.axes.y.unitDivisor;
  const scaled = /thousand|million|billion|\bk\b|\bm\b|\bbn?\b/.test(u);
  const out: string[] = [];
  if (scaled && !divisor) {
    out.push(`The row says the unit is "${unit}", but this chart holds full figures — check it wasn't divided.`);
  }
  const currency = spec.numberFormat.style === 'currency' ? (spec.numberFormat.currency ?? 'USD') : undefined;
  if (currency && /usd|eur|gbp|jpy|chf|cad|aud/.test(u) && !u.includes(currency.toLowerCase())) {
    out.push(`The row is in "${unit}" but the chart is in ${currency}.`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Writing                                                            */
/* ------------------------------------------------------------------ */

/**
 * The new figure in the shape the old one was written in: same currency
 * symbol, same grouping, same decimal places, same k/M/B or % suffix. Returns
 * null when the shape can't hold the value — a negative where the slide writes
 * none, or a token this doesn't recognise.
 */
export function formatLikeToken(display: string, value: number): string | null {
  const m = /^([$€£¥]?)(\s?)([\d,]+(?:\.(\d+))?)(\s?)(%|bps|pp|[kKmMbB]n?|x)?$/.exec(display.trim());
  if (!m) return null;
  const [, symbol, symbolGap, digits, decimalPart, suffixGap, suffix = ''] = m;
  if (value < 0) return null;

  const scale = suffix === '%' ? 0.01 : SUFFIX_SCALE[suffix] ?? 1;
  const shown = value / scale;
  const decimals = decimalPart?.length ?? 0;
  const grouped = digits.includes(',');
  const body = shown.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
  return `${symbol}${symbolGap}${body}${suffixGap}${suffix}`;
}

const decimalsOf = (display: string) => /\.(\d+)/.exec(display)?.[1].length ?? 0;

/**
 * One number replaced inside one run. Everything else about the body — the
 * other runs, their styling, the paragraph properties — is carried through
 * untouched, which is the whole point of resolving the span first.
 */
export function bodyWithNumber(el: TextElement, siteIndex: number, text: string): TextBody | null {
  const site = numberSites(el)[siteIndex];
  if (!site) return null;
  const { spans } = flattenRuns(el);
  const touched = spans.filter((s) => s.start < site.end && s.end > site.start);
  if (touched.length !== 1) return null;
  return withText(el, touched[0], site, text).body;
}

/** The element with `site` rewritten inside `span`. Pure; used for both the preview and the write. */
function withText(
  el: TextElement,
  span: { p: number; r: number; start: number },
  site: { start: number; end: number },
  text: string,
): TextElement {
  const paragraphs = el.body.paragraphs.map((para, p) =>
    p !== span.p
      ? para
      : {
          ...para,
          runs: para.runs.map((run, r) => {
            if (r !== span.r) return run;
            const from = site.start - span.start;
            const to = site.end - span.start;
            return { ...run, text: run.text.slice(0, from) + text + run.text.slice(to) };
          }),
        },
  );
  return { ...el, body: { ...el.body, paragraphs } };
}

/**
 * A figure written into a chart spec, addressed the way `refresh.ts` addressed
 * it. Mutates the spec it is given — callers hand it a clone. Returns false if
 * the ref names something the chart no longer has, which is the signal that the
 * data has moved on since the prompt.
 */
export function writeToSpec(spec: ChartSpec, parts: string[], value: number): boolean {
  if (isGridSpec(spec)) {
    const [seriesKey, catKey] = parts;
    const series = spec.data.series.find((s) => s.key === seriesKey);
    const i = spec.data.categories.findIndex((c) => c.key === catKey);
    if (!series || i === -1) return false;
    series.values[i] = value;
    return true;
  }
  if (isWaterfallSpec(spec)) {
    const item = spec.data.items.find((it) => it.key === parts[0]);
    if (!item) return false;
    item.value = value;
    return true;
  }
  if (isButterflySpec(spec)) {
    const [side, seriesKey, catKey] = parts;
    const series = (side === 'left' ? spec.left : side === 'right' ? spec.right : []).find(
      (s) => s.key === seriesKey,
    );
    const i = spec.categories.findIndex((c) => c.key === catKey);
    if (!series || i === -1) return false;
    series.values[i] = value;
    return true;
  }
  if (isXYSpec(spec)) {
    const [seriesKey, pointKey, field] = parts;
    const point = spec.data.series.find((s) => s.key === seriesKey)?.points.find((p) => p.key === pointKey);
    if (!point) return false;
    if (field === 'x') point.x = value;
    else if (field === 'y') point.y = value;
    else if (field === 'size') point.size = value;
    else return false;
    return true;
  }
  if (isSankeySpec(spec)) {
    const link = spec.data.links.find((l) => l.key === parts[0]);
    if (!link) return false;
    link.value = value;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */

function specFor(deck: Deck, chartId: string): ChartSpec | undefined {
  for (const slide of deck.slides) {
    const chart = slide.charts?.find((c) => c.id === chartId);
    if (chart) return chart.spec;
  }
  return undefined;
}

function textElement(deck: Deck, slideId: string, ref: string): TextElement | undefined {
  const elementId = /\/t:([^/]+)\//.exec(ref)?.[1];
  const el = deck.slides.find((s) => s.id === slideId)?.elements.find((e) => e.id === elementId);
  return el?.type === 'text' ? el : undefined;
}

/* ------------------------------------------------------------------ */
/* Reporting                                                          */
/* ------------------------------------------------------------------ */

/**
 * The plan as the chat panel reads it back.
 *
 * Written for a reader who is about to say yes or no: what would change, what
 * would not, and — first, because it is the part that gets skimmed — everything
 * that needs a decision before any of it lands.
 */
export function describePlan(plan: RefreshPlan, opts: { applied?: boolean } = {}): string {
  const { counts } = plan;
  const verb = opts.applied ? 'Applied' : 'Would change';
  const lines: string[] = [];

  lines.push(
    `${verb} ${counts.change} of ${counts.total} rows. Unchanged: ${counts.unchanged}. ` +
      `Not available: ${counts.unavailable}. Needs a decision: ${counts.unreadable + counts.unmatched + counts.blocked}.`,
  );
  if (plan.unchecked.length) {
    lines.push(
      `${plan.unchecked.length} figures in the deck are not in the CSV at all, so they were never checked: ${plan.unchecked
        .slice(0, 8)
        .map((n) => n.ref)
        .join(', ')}${plan.unchecked.length > 8 ? ', …' : ''}`,
    );
  }

  const stuck = plan.entries.filter((e) => e.status === 'unreadable' || e.status === 'unmatched' || e.status === 'blocked');
  if (stuck.length) {
    lines.push('', 'Not applied — ask the user about these:');
    for (const e of stuck) lines.push(`- ${e.ref} (page ${e.page}, ${e.label}): ${e.reason}`);
  }

  const flagged = plan.entries.filter((e) => e.warnings.length && e.status === 'change');
  if (flagged.length) {
    lines.push('', 'Applied but worth flagging:');
    for (const e of flagged) lines.push(`- ${e.ref} (page ${e.page}): ${e.warnings.join(' ')}`);
  }

  const changes = plan.entries.filter((e) => e.status === 'change');
  if (changes.length) {
    lines.push('', `The ${changes.length} changes:`);
    for (const e of changes.slice(0, 60)) {
      lines.push(
        `- ${e.ref} · p${e.page} · ${e.label.slice(0, 60)}: ${
          e.display ? `"${e.display}" → "${e.nextDisplay}"` : `${e.current} → ${e.next}`
        }`,
      );
    }
    if (changes.length > 60) lines.push(`- …and ${changes.length - 60} more.`);
  }

  return lines.join('\n');
}
