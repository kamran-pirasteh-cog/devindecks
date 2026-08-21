/**
 * The brief, turned into a chart.
 *
 * A chart built from a description differs from a blank one in its LABELS, not
 * its figures: the client on the title, the period on the category axis, the
 * breakdown on the series, the currency and scale on the value axis. That's the
 * part a description can honestly supply.
 *
 * The numbers are placeholders, and stay placeholders. They're shaped rather
 * than flat — a trend trends, a mix adds up, a bridge closes — because an
 * author is judging whether the chart fits the slide, and 1/2/3 makes every
 * chart look identical. What they are NOT is research: nothing here goes and
 * finds a figure, and the UI that calls this says so plainly and points at the
 * datasheet and the Devin prompt, which is where real numbers come from.
 *
 * Deterministic: the shape is seeded from the description, so re-running the
 * same brief gives the same chart rather than a different one each time.
 */
import {
  defaultChartSpec,
  sampleWaterfallData,
  setChartOrientation,
  supportsOrientation,
  withChartStyleDefaults,
  type ChartSpec,
  type DesignSystem,
  type GridData,
  type GridSeries,
  type SankeyData,
  type WaterfallData,
  type XYData,
} from '@/model';
import { authorBriefFrom } from './authorBrief';
import type { ChartBrief, LayoutSuggestion } from './intent';

/** A small deterministic PRNG, seeded from the text of the brief. */
function seeded(seedText: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10_000) / 10_000;
  };
}

/** The placeholder an author types over, when there's nothing honest to say. */
export const DEFAULT_CHART_TITLE = 'Chart Title';

/**
 * A subject worth printing in front of a title.
 *
 * The subject can come from the deck's tags — a client name — or, failing that,
 * from the SLIDE'S TITLE, which is as often a whole sentence as it is a name.
 * "Session insights, merged PRs, comps, usage analytics — Revenue by function"
 * is not a chart title anybody wrote on purpose, so a phrase that doesn't read
 * as a name is dropped and the title stands on its own.
 */
const nameLike = (subject: string): boolean =>
  !/[,;:]/.test(subject) && subject.trim().split(/\s+/).length <= 4;

/**
 * A deck title is a FILE NAME as often as it is a name — "BVA Pitch (2)" —
 * so it never gets printed in front of a chart title, however name-like it
 * looks. It still stands as the brief's subject for the questions and the
 * research prompt, where naming the deck the chart came from is useful.
 */
const printableSubject = (brief: ChartBrief): string | undefined =>
  brief.subjectFrom !== 'deck' && brief.subject && nameLike(brief.subject)
    ? brief.subject
    : undefined;

/**
 * The chart's title: what it shows, for whom, over what. Assembled from what
 * the brief actually knows — an unknown subject leaves the subject out rather
 * than writing "for [client]".
 *
 * With no measure named there is nothing to assemble. It used to fall back to
 * the word "Data" and print the surrounding scraps anyway — a slide title, a
 * "by function", a date range — which reads as a title the author chose and
 * has to be deleted rather than typed over. `DEFAULT_CHART_TITLE` is the
 * honest version of that.
 */
export function briefTitle(brief: ChartBrief): string {
  if (!brief.measure) return DEFAULT_CHART_TITLE;
  const measure = brief.measure;
  const by = brief.dimension ? ` by ${brief.dimension}` : '';
  const labels = brief.period?.labels ?? [];
  // One period prints once. "FY25–FY25" reads as a broken range rather than as
  // a single year.
  const span = labels.length
    ? ` · ${labels.length > 1 ? `${labels[0]}–${labels[labels.length - 1]}` : labels[0]}`
    : '';
  const subject = printableSubject(brief);
  const who = subject ? `${subject} — ` : '';
  return `${who}${measure}${by}${span}`;
}

/**
 * `asOf` is the date an unstated span was counted back from. It is recorded
 * rather than used: the chart is already laid out by the time we get here, and
 * the point is to be able to say later WHY the axis reads Q1'25–Q4'26 when
 * nobody asked for those quarters.
 *
 * Optional, and the picker doesn't pass it yet — without it a prompt can still
 * say the range was never asked for, just not what it was counted back from.
 */
export function specFromBrief(
  brief: ChartBrief,
  suggestion: LayoutSuggestion,
  ds: DesignSystem,
  opts: { asOf?: string } = {},
): ChartSpec {
  const { layout } = suggestion;
  const rand = seeded(brief.description || layout.id);

  const base = defaultChartSpec(layout.kind, layout.stack, withChartStyleDefaults(ds.chart));

  // On an x/y plot both axes are measures, and the description named them in
  // order — a scatter whose axes aren't titled says nothing at all.
  const xy = layout.kind === 'scatter' || layout.kind === 'bubble';
  const yTitle = xy ? (brief.measures[1] ?? brief.measure) : brief.measure;

  let spec: ChartSpec = {
    ...base,
    title: briefTitle(brief),
    // Attached by the producer rather than the caller, so a second insert path
    // cannot be written that forgets to keep the author's own words.
    authorBrief: authorBriefFrom(brief, opts),
    numberFormat: { ...brief.numberFormat },
    axes: {
      ...base.axes,
      x: {
        ...base.axes.x,
        title: xy ? brief.measures[0] : axisXTitle(brief, layout.kind),
      },
      y: {
        ...base.axes.y,
        title: yTitle,
        unitDivisor: brief.unitDivisor,
        unitNote: brief.unitNote,
      },
    },
  };

  // Each family carries its data differently, and the labels are the whole
  // point of building from a brief — so every one of them gets filled rather
  // than left on the sample.
  if (spec.kind === 'waterfall') {
    spec = { ...spec, data: waterfallFromBrief(brief, layout.waterfall ?? 'up', rand) };
  } else if (spec.kind === 'sankey') {
    spec = { ...spec, data: sankeyFromBrief(brief, rand) };
  } else if (spec.kind === 'scatter' || spec.kind === 'bubble') {
    spec = { ...spec, data: xyFromBrief(brief, spec.kind === 'bubble', rand) };
  } else if ('data' in spec && 'categories' in spec.data) {
    const data = gridFromBrief(brief, spec.kind, rand);
    spec = { ...spec, data };
    if (spec.kind === 'combo') {
      // The rate is the last series, drawn as a line on its own scale — the
      // reason a combo was recommended in the first place.
      const rateKey = data.series[data.series.length - 1]?.key;
      spec = {
        ...spec,
        render: rateKey ? { [rateKey]: 'line' } : spec.render,
        axes: {
          ...spec.axes,
          y2: {
            show: true,
            scale: 'linear',
            title: brief.secondaryMeasure,
            numberFormat: { style: 'percent', decimals: 1 },
          },
        },
      };
    }
  }

  // A line chart emphasises the subject the deck is about, when the series are
  // named subjects rather than parts of a whole.
  if (spec.kind === 'line' && brief.subject) {
    const match =
      'data' in spec && 'series' in spec.data
        ? spec.data.series.find((s) =>
            s.name.toLowerCase().includes(brief.subject!.toLowerCase()),
          )
        : undefined;
    if (match) spec = { ...spec, emphasis: match.key };
  }

  return supportsOrientation(layout.kind)
    ? setChartOrientation(spec, suggestion.orientation)
    : spec;
}

const axisXTitle = (brief: ChartBrief, kind: string): string | undefined =>
  kind === 'scatter' || kind === 'bubble' || kind === 'pie' || kind === 'sankey'
    ? undefined
    : brief.period
      ? undefined // The labels already say Q1'25; a "Quarter" title is noise.
      : brief.dimension
        ? brief.categoryNoun
        : undefined;

/* ------------------------------------------------------------------ */
/* Grid data                                                          */
/* ------------------------------------------------------------------ */

/** Percent data is a proportion, so its placeholders live in 0…1. */
const isProportion = (brief: ChartBrief): boolean => brief.numberFormat.style === 'percent';

function gridFromBrief(brief: ChartBrief, kind: string, rand: () => number): GridData {
  const categories = brief.categories.map((label, i) => ({ key: `c${i}`, label }));

  // A pie has one series and reads its slices off the categories.
  const names =
    kind === 'pie' || kind === 'donut'
      ? [brief.measure ?? 'Value']
      : brief.seriesNames.length
        ? brief.seriesNames
        : [brief.measure ?? 'Value'];

  const proportion = isProportion(brief);
  const magnitude = proportion ? 1 : brief.unitDivisor ? 1_000 * brief.unitDivisor : 1_000;

  const series: GridSeries[] = names.map((name, i) => ({
    key: `s${i}`,
    name,
    values: shapedValues(categories.length, i, names.length, magnitude, proportion, rand),
  }));

  // The rate the combo was chosen for: its own series, on the secondary axis,
  // and always a proportion whatever the primary measure is.
  if (kind === 'combo' && brief.secondaryMeasure) {
    series.push({
      key: `s${series.length}`,
      name: brief.secondaryMeasure,
      axis: 'secondary',
      numberFormat: { style: 'percent', decimals: 1 },
      values: Array.from(
        { length: categories.length },
        (_, c) => round(0.28 + 0.015 * c + rand() * 0.03, 3),
      ),
    });
  }

  return { categories, series };
}

/**
 * Placeholder values with a shape: each series starts somewhere different and
 * grows across the categories, with a little deterministic wobble so the picture
 * doesn't look ruled.
 */
function shapedValues(
  count: number,
  index: number,
  seriesCount: number,
  magnitude: number,
  proportion: boolean,
  rand: () => number,
): number[] {
  if (proportion) {
    // Shares of one whole, so they're generated to sum near 1 and each drifts.
    const share = 1 / Math.max(1, seriesCount);
    return Array.from({ length: count }, (_, c) =>
      round(Math.max(0.01, share + (index - (seriesCount - 1) / 2) * 0.04 + c * 0.005 + rand() * 0.02), 3),
    );
  }
  const start = magnitude * (1 - index * 0.28) * (0.8 + rand() * 0.4);
  const growth = 0.06 + rand() * 0.08;
  return Array.from({ length: count }, (_, c) =>
    Math.round(Math.max(1, start * Math.pow(1 + growth, c) * (0.95 + rand() * 0.1))),
  );
}

const round = (n: number, dp: number): number => Number(n.toFixed(dp));

/* ------------------------------------------------------------------ */
/* Waterfall                                                          */
/* ------------------------------------------------------------------ */

const DRIVERS_UP = ['New logos', 'Expansion', 'Upsell'];
const DRIVERS_DOWN = ['Unqualified', 'No decision', 'Lost'];

/**
 * A bridge whose ends are named from the brief's period — "FY24 revenue" to
 * "FY25 revenue" — and whose middle is the breakdown, if one was given. Falls
 * back to the house sample when the brief says nothing usable, rather than
 * inventing driver names.
 */
function waterfallFromBrief(
  brief: ChartBrief,
  direction: 'up' | 'down',
  rand: () => number,
): WaterfallData {
  const labels = brief.period?.labels ?? [];
  const measure = brief.measure ? brief.measure.toLowerCase() : 'total';
  const startLabel = labels.length ? `${labels[0]} ${measure}` : `Opening ${measure}`;
  const endLabel = labels.length
    ? `${labels[labels.length - 1]} ${measure}`
    : `Closing ${measure}`;

  const drivers = brief.seriesNames.length
    ? brief.seriesNames
    : direction === 'down'
      ? DRIVERS_DOWN
      : DRIVERS_UP;

  if (!brief.measure && !labels.length && !brief.seriesNames.length) {
    return sampleWaterfallData(direction);
  }

  const magnitude = brief.unitDivisor ? 1_000 * brief.unitDivisor : 1_000;
  const start = Math.round(magnitude * (0.9 + rand() * 0.4));
  const sign = direction === 'down' ? -1 : 1;

  return {
    items: [
      { key: 'w0', label: startLabel, role: 'start', value: start },
      ...drivers.map((label, i) => ({
        key: `w${i + 1}`,
        label,
        role: 'delta' as const,
        value: sign * Math.round(start * (0.08 + rand() * 0.12)),
      })),
      { key: `w${drivers.length + 1}`, label: endLabel, role: 'total' as const, value: null },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Sankey                                                             */
/* ------------------------------------------------------------------ */

function sankeyFromBrief(brief: ChartBrief, rand: () => number): SankeyData {
  const branches = brief.seriesNames.length
    ? brief.seriesNames
    : brief.categories.length > 1
      ? brief.categories
      : ['Segment A', 'Segment B', 'Segment C'];
  const source = brief.measure ?? 'Total';

  return {
    nodes: [
      { key: 'n0', label: source },
      ...branches.map((label, i) => ({ key: `n${i + 1}`, label })),
    ],
    links: branches.map((_, i) => ({
      key: `f${i}`,
      from: 'n0',
      to: `n${i + 1}`,
      value: Math.round(100 * (0.5 + rand())),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Scatter and bubble                                                 */
/* ------------------------------------------------------------------ */

/**
 * One point per named thing, so the plot is about the author's subjects rather
 * than five anonymous dots. The axes are left titled by the brief's measures —
 * a scatter with untitled axes says nothing at all.
 */
function xyFromBrief(brief: ChartBrief, withSize: boolean, rand: () => number): XYData {
  const labels = brief.seriesNames.length
    ? brief.seriesNames
    : brief.categories.length > 1
      ? brief.categories
      : ['Account A', 'Account B', 'Account C', 'Account D', 'Account E'];

  return {
    series: [
      {
        key: 's0',
        name: brief.categoryNoun,
        points: labels.map((label, i) => ({
          key: `p${i}`,
          label,
          x: round(10 + rand() * 80, 1),
          y: round(10 + rand() * 80, 1),
          ...(withSize ? { size: round(10 + rand() * 50, 1) } : {}),
        })),
      },
    ],
  };
}
