import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, sheetSeriesFor, sheetSchemaFor } from '@/model';
import { chartResultContract } from '@/devin/contract';
import { buildDevinChartPrompt } from '@/devin/prompt';
import { layoutById } from './layouts';
import { carrySetup, defaultSetup, formFor, setupIssues, type ChartSetup } from './setupForm';
import { cellLabel, rangeEndingAt, shiftCells } from './periodRange';
import { briefFromSetup, scheduleWindow, setupSentence, setupPeriods, specFromSetup } from './setupSpec';

const ds = DEFAULT_DESIGN_SYSTEM;
const AS_OF = '2026-08-21';
const L = (id: string) => layoutById(id)!;

/**
 * A setup for `id`. `count` is a shorthand for the range these tests almost
 * always want: that many periods ending on the current one, which is what the
 * form opens on and what the presets produce.
 */
type Over = Partial<ChartSetup> & { count?: number };

const setupFor = (id: string, over: Over = {}): ChartSetup => {
  const { count, ...rest } = over;
  const base: ChartSetup = { ...defaultSetup(formFor(L(id)), AS_OF), ...rest };
  return count === undefined ? base : { ...base, range: rangeEndingAt(base.grain, AS_OF, count) };
};

const build = (id: string, over: Over = {}, ctx = {}) =>
  specFromSetup(L(id), setupFor(id, over), ds, { orientation: 'vertical', asOf: AS_OF, ...ctx });

const grid = (spec: unknown) => (spec as { data: { categories: { label: string }[]; series: { name: string }[] } }).data;

describe('setupPeriods', () => {
  it('lays out a span ending on the period the range ends in', () => {
    const p = setupPeriods(L('line'), setupFor('line', { grain: 'quarter', count: 4 }));
    expect(p).toEqual(["Q4'25", "Q1'26", "Q2'26", "Q3'26"]);
  });

  it('honours an end the author moved off the current period', () => {
    const setup = setupFor('line', { grain: 'quarter', count: 4 });
    const back = {
      ...setup,
      range: rangeEndingAt('quarter', shiftCells('quarter', setup.range.to, -1), 4),
    };
    expect(setupPeriods(L('line'), back)).toEqual(["Q3'25", "Q4'25", "Q1'26", "Q2'26"]);
  });

  it('labels fiscal years as FY when that is what was chosen', () => {
    expect(setupPeriods(L('line'), setupFor('line', { grain: 'year', count: 2, fiscal: true }))).toEqual(
      ['FY25', 'FY26'],
    );
    expect(setupPeriods(L('line'), setupFor('line', { grain: 'year', count: 2 }))).toEqual([
      '2025',
      '2026',
    ]);
  });

  it('gives a moment-shaped chart exactly one period', () => {
    expect(setupPeriods(L('pie'), setupFor('pie', { grain: 'quarter' }))).toHaveLength(1);
  });

  it('gives a bridge only its two ends, however far apart they are', () => {
    // The whole reason the range is stored as ends: a grain plus a count of two
    // could only ever bridge ADJACENT periods, so "how 2023 became 2026" was
    // not expressible at all.
    const setup = setupFor('waterfall-up', { grain: 'year', count: 4 });
    expect(setupPeriods(L('waterfall-up'), setup)).toEqual(['2023', '2026']);
  });

  it('gives a dot plot two markers, or three with a middle', () => {
    const two = setupFor('dotplot', { grain: 'year', count: 5 });
    expect(setupPeriods(L('dotplot'), two)).toEqual(['2022', '2026']);
    expect(setupPeriods(L('dotplot'), { ...two, markers: 3 })).toEqual(['2022', '2024', '2026']);
  });

  it('reads back the range it was given at every grain', () => {
    for (const grain of ['day', 'week', 'month', 'quarter', 'year'] as const) {
      const setup = setupFor('line', { grain, count: 5 });
      const labels = setupPeriods(L('line'), setup);
      expect(labels).toHaveLength(5);
      expect(labels[0]).toBe(cellLabel(grain, setup.range.from));
      expect(labels[4]).toBe(cellLabel(grain, setup.range.to));
    }
  });
});

describe('the category and series mapping', () => {
  it('puts the periods on the axis and the cut on the series for a trend', () => {
    const data = grid(build('line', { measure: 'acus', segment: 'department', count: 4 }));
    expect(data.categories.map((c) => c.label)).toEqual(["Q4'25", "Q1'26", "Q2'26", "Q3'26"]);
    expect(data.series.map((s) => s.name)).toEqual(['Engineering', 'Go-to-market', 'G&A']);
  });

  it('leaves a trend with no cut as a single total', () => {
    const data = grid(build('line', { measure: 'acus', count: 3 }));
    expect(data.series).toHaveLength(1);
    expect(data.series[0].name).toBe('ACUs');
  });

  it('puts the cut along the bottom when the author asked for that instead', () => {
    const data = grid(
      build('clustered', { axis: 'segment', measure: 'acus', segment: 'use-case' }),
    );
    expect(data.categories.map((c) => c.label)).toEqual([
      'Feature work',
      'Bug fixes',
      'Refactors',
      'Migrations',
    ]);
  });

  it('crosses two cuts when both are given on a categorical chart', () => {
    const data = grid(
      build('clustered', { axis: 'segment', measure: 'acus', segment: 'devin-org', segment2: 'cohort' }),
    );
    expect(data.categories.map((c) => c.label)).toEqual(['Org A', 'Org B', 'Org C']);
    expect(data.series.map((s) => s.name)).toEqual(['Cohort A', 'Cohort B', 'Cohort C']);
  });

  it('reads a pie off the slices, with one series', () => {
    const data = grid(build('pie', { measure: 'acus', segment: 'department' }));
    expect(data.categories.map((c) => c.label)).toEqual(['Engineering', 'Go-to-market', 'G&A']);
    expect(data.series).toHaveLength(1);
  });

  it('inverts a dot plot: rows are the cut, the moments are the series', () => {
    const data = grid(
      build('dotplot', { measure: 'acus', segment: 'department', grain: 'year', count: 2 }),
    );
    expect(data.categories.map((c) => c.label)).toEqual(['Engineering', 'Go-to-market', 'G&A']);
    expect(data.series.map((s) => s.name)).toEqual(['2025', '2026']);
  });

  it('names a bridge from its two ends and its drivers', () => {
    const spec = build('waterfall-up', { measure: 'acus', segment: 'use-case', grain: 'year' });
    const items = (spec as { data: { items: { label: string; role: string }[] } }).data.items;
    expect(items[0].label).toBe('2025 acus');
    expect(items[items.length - 1].label).toBe('2026 acus');
    expect(items.slice(1, -1).map((i) => i.label)).toEqual([
      'Feature work',
      'Bug fixes',
      'Refactors',
      'Migrations',
    ]);
  });

  it('labels the dots on a scatter with the members of the cut', () => {
    const spec = build('scatter', {
      measure: 'prs-merged',
      secondaryMeasure: 'acus',
      segment: 'company',
    });
    const points = (spec as { data: { series: { points: { label: string }[] }[] } }).data.series[0]
      .points;
    expect(points.map((p) => p.label)).toEqual(['Company A', 'Company B', 'Company C']);
    expect(spec.axes.x.title).toBe('PRs merged');
    expect(spec.axes.y.title).toBe('ACUs');
  });
});

describe('flow', () => {
  it('builds nodes at both ends rather than one source fanning out', () => {
    const spec = build('sankey', { measure: 'acus', segment: 'department', segment2: 'use-case' });
    const data = (spec as { data: { nodes: { label: string; layer?: number }[]; links: unknown[] } })
      .data;
    expect(data.nodes.filter((n) => n.layer === 0).map((n) => n.label)).toEqual([
      'Engineering',
      'Go-to-market',
      'G&A',
    ]);
    expect(data.nodes.filter((n) => n.layer === 1).map((n) => n.label)).toEqual([
      'Feature work',
      'Bug fixes',
      'Refactors',
      'Migrations',
    ]);
    expect(data.links).toHaveLength(12);
  });
});

describe('schedule', () => {
  it('moves the sample plan into the window that was asked for', () => {
    const spec = build('gantt', { grain: 'month', count: 6 });
    const gantt = spec as { items: { from: number; to?: number }[]; timescale: { min?: number; max?: number } };
    const min = gantt.timescale.min!;
    const max = gantt.timescale.max!;
    expect(Math.min(...gantt.items.map((i) => i.from))).toBeGreaterThanOrEqual(min);
    expect(Math.max(...gantt.items.map((i) => i.to ?? i.from))).toBeLessThanOrEqual(max);
  });

  it('keeps every bar at least a day long, however long the window', () => {
    const spec = build('gantt', { grain: 'week', count: 4 });
    const items = (spec as { items: { from: number; to?: number }[] }).items;
    for (const item of items) {
      if (item.to !== undefined) expect(item.to).toBeGreaterThan(item.from);
    }
  });

  it('puts a coarser band above the chosen grain', () => {
    const bands = (build('gantt', { grain: 'month' }) as { timescale: { bands: { grain: string }[] } })
      .timescale.bands;
    expect(bands.map((b) => b.grain)).toEqual(['quarter', 'month']);
  });

  it('reports the window it will cover', () => {
    // Three months ending on the current one is Jun, Jul, Aug — and the window
     // runs to the END of August, which is the first of September.
    expect(scheduleWindow(setupFor('gantt', { grain: 'month', count: 3 }))).toEqual({
      from: 'Jun 2026',
      to: 'Sep 2026',
    });
  });
});

describe('units', () => {
  it('gives a per-something measure a decimal and a "per" note', () => {
    const spec = build('line', { measure: 'acus-per-merged-pr', count: 3 });
    expect(spec.numberFormat.decimals).toBe(1);
    expect(spec.axes.y.unitNote).toBe('per merged PR');
    expect(spec.axes.y.unitDivisor).toBeUndefined();
  });

  it('scales a big count rather than printing five-digit axis labels', () => {
    const spec = build('line', { measure: 'acus', count: 3 });
    expect(spec.axes.y.unitDivisor).toBe(1e3);
    expect(spec.axes.y.unitNote).toBeUndefined();
  });

  it('makes a rate a percentage', () => {
    expect(build('line', { measure: 'merge-rate', count: 3 }).numberFormat.style).toBe('percent');
  });

  it('makes ARR money', () => {
    const spec = build('line', { measure: 'arr', count: 3 });
    expect(spec.numberFormat.style).toBe('currency');
    expect(spec.axes.y.unitDivisor).toBe(1e6);
  });

  it('puts the placeholder figures at the measure’s own magnitude', () => {
    const ratio = grid(build('line', { measure: 'acus-per-merged-pr', count: 3 })) as unknown as {
      series: { values: number[] }[];
    };
    // A per-merged-PR figure lives in the tens, not the thousands — an author
    // judging whether the chart fits the slide is reading the axis.
    expect(Math.max(...ratio.series[0].values)).toBeLessThan(100);
  });
});

describe('the sentence the answers amount to', () => {
  it('reads as the request it is', () => {
    const setup = setupFor('line', { measure: 'acus-per-merged-pr', segment: 'company', count: 8 });
    expect(setupSentence(L('line'), setup, setupPeriods(L('line'), setup))).toBe(
      "ACUs per merged PR, by company, 8 quarters, Q4'24 to Q3'26",
    );
  });

  it('names both ends of a flow', () => {
    const setup = setupFor('sankey', { measure: 'acus', segment: 'department', segment2: 'use-case' });
    expect(setupSentence(L('sankey'), setup, setupPeriods(L('sankey'), setup))).toContain(
      'flowing from department to use case',
    );
  });

  it('reads an x/y plot as one measure against the other', () => {
    const setup = setupFor('bubble', {
      measure: 'prs-merged',
      secondaryMeasure: 'acus',
      sizeMeasure: 'seats',
      segment: 'company',
    });
    expect(setupSentence(L('bubble'), setup, [])).toContain('ACUs against PRs merged, sized by Seats');
  });
});

describe('the brief the chart carries', () => {
  it('records the answers as stated, with no gaps', () => {
    const brief = briefFromSetup(
      L('line'),
      setupFor('line', { measure: 'acus', segment: 'department', count: 4 }),
      { asOf: AS_OF },
    );
    expect(brief.gaps).toEqual([]);
    expect(brief.unitStated).toBe(true);
    expect(brief.period?.stated).toBe(true);
    expect(brief.period?.fiscal).toBe(false);
  });

  it('takes the subject from the deck the same way a typed brief does', () => {
    const brief = briefFromSetup(L('line'), setupFor('line', { measure: 'acus' }), {
      asOf: AS_OF,
      deckTags: ['Acme Corp'],
    });
    expect(brief.subject).toBe('Acme Corp');
    expect(brief.subjectFrom).toBe('tag');
  });
});

describe('the prompt it produces', () => {
  const promptFor = (id: string, over: Over) =>
    buildDevinChartPrompt(build(id, over)).text;

  it('reports the period as stated rather than as something we filled in', () => {
    const t = promptFor('line', { measure: 'acus', segment: 'department', count: 4 });
    expect(t).toContain('Stated by the author');
    expect(t).not.toContain('Filled in by us');
  });

  it('asks nothing about the timeframe, because the form answered it', () => {
    const t = promptFor('line', { measure: 'acus', count: 4 });
    expect(t).not.toContain('**Timeframe**');
    expect(t).not.toContain('the fiscal or the calendar year');
  });

  it('asks nothing at all when the form answered everything', () => {
    const t = buildDevinChartPrompt(
      build('line', { measure: 'acus', segment: 'department', count: 4 }),
      { deckTags: ['Acme Corp'] },
    ).text;
    expect(t).not.toContain('## Ask first');
    expect(t).toContain('Everything the brief needed is stated above');
  });

  it('asks the currency only when the figures are money', () => {
    expect(promptFor('line', { measure: 'arr', count: 4 })).toContain('Reporting currency?');
    expect(promptFor('line', { measure: 'acus-per-merged-pr', count: 4 })).not.toContain(
      'Reporting currency?',
    );
  });

  it('lists the exact rows and series to return', () => {
    const t = promptFor('line', { measure: 'acus', segment: 'department', grain: 'year', count: 3 });
    for (const label of ['2024', '2025', '2026', 'Engineering', 'Go-to-market', 'G&A']) {
      expect(t).toContain(label);
    }
  });

  it('says which column is which series, rather than leaving it to order', () => {
    const t = promptFor('line', { measure: 'acus', segment: 'department', count: 3 });
    expect(t).toContain('| `s0_value` | Engineering |');
    expect(t).toContain('| `s2_value` | G&A |');
    expect(t).toContain('Column order is not the contract');
  });

  it('carries a CSV header the answer pastes straight back through', () => {
    const spec = build('line', { measure: 'acus', segment: 'department', count: 3 });
    const contract = chartResultContract(sheetSchemaFor(spec), sheetSeriesFor(spec));
    expect(contract.csvHeader).toEqual([
      'label',
      's0_value',
      's1_value',
      's2_value',
      'source_url',
      'source_note',
      'confidence',
    ]);
    // Every column named in the legend is a column in the header, in order.
    expect(contract.legend.map((c) => c.name)).toEqual(contract.columns);
    expect(buildDevinChartPrompt(spec).text).toContain(contract.csvHeader.join(','));
  });
});

describe('notes for Devin', () => {
  const NOTE = 'Count a session as productive only if it merged a PR.';

  it('rides onto the chart with the brief', () => {
    const spec = build('line', { measure: 'acus', count: 4, notes: NOTE });
    expect(spec.authorBrief?.notes).toBe(NOTE);
  });

  it('is quoted in the prompt as instruction, not as context', () => {
    const t = buildDevinChartPrompt(build('line', { measure: 'acus', count: 4, notes: NOTE })).text;
    expect(t).toContain('### Notes from the author');
    expect(t).toContain(`> ${NOTE}`);
    expect(t).toContain('These are instructions, not context');
  });

  it('quotes every line of a multi-line note', () => {
    const t = buildDevinChartPrompt(
      build('line', { measure: 'acus', count: 4, notes: 'One thing.\nAnother thing.' }),
    ).text;
    expect(t).toContain('> One thing.\n> Another thing.');
  });

  it('says nothing at all when there is no note', () => {
    const t = buildDevinChartPrompt(build('line', { measure: 'acus', count: 4 })).text;
    expect(t).not.toContain('Notes from the author');
  });

  it('keeps out of the sentence, which is what the chart shows rather than how to fill it', () => {
    const setup = setupFor('line', { measure: 'acus', count: 4, notes: NOTE });
    expect(setupSentence(L('line'), setup, setupPeriods(L('line'), setup))).not.toContain(
      'productive',
    );
  });

  it('drops a note that is only whitespace rather than recording an empty one', () => {
    expect(build('line', { measure: 'acus', count: 4, notes: '   ' }).authorBrief?.notes).toBeUndefined();
  });
});

describe('the current period', () => {
  /** The same span, ended one period earlier. */
  const endedEarlier = (over: Over = {}) => {
    const setup = setupFor('line', { grain: 'quarter', count: 4, ...over });
    return {
      ...setup,
      range: rangeEndingAt('quarter', shiftCells('quarter', setup.range.to, -1), 4),
    };
  };

  it('is derived from the range rather than answered separately', () => {
    // The form opens on the current period, so that is what a default records.
    expect(build('line', { measure: 'acus', count: 4 }).authorBrief?.currentPeriod).toBe('included');
    expect(
      specFromSetup(L('line'), endedEarlier({ measure: 'acus' }), ds, {
        orientation: 'vertical',
        asOf: AS_OF,
      }).authorBrief?.currentPeriod,
    ).toBe('excluded');
  });

  it('warns that the last figure is partial when the range ends on the current period', () => {
    const t = buildDevinChartPrompt(build('line', { measure: 'acus', grain: 'quarter', count: 8 })).text;
    expect(t).toContain('**quarter in progress**');
    expect(t).toContain('Return it to-date');
  });

  it('tells the prompt not to add the partial period back when it was left out', () => {
    const spec = specFromSetup(L('line'), endedEarlier({ measure: 'acus' }), ds, {
      orientation: 'vertical',
      asOf: AS_OF,
    });
    const t = buildDevinChartPrompt(spec).text;
    expect(t).toContain('deliberately **excluded**');
    expect(t).toContain('Do not add a partial period');
  });

  it('names the grain the author picked, not the one a date label parses as', () => {
    // Weekly labels are ISO dates, which read back as days on their own.
    const t = buildDevinChartPrompt(build('line', { measure: 'acus', grain: 'week', count: 6 })).text;
    expect(t).toContain('One row per calendar week');
  });
});

describe('which ones of a cut, end to end', () => {
  it('labels the chart with the members the author named', () => {
    const data = grid(
      build('clustered', {
        axis: 'segment',
        measure: 'acus',
        segment: 'department',
        which: 'Platform, Payments, Data',
      }),
    );
    expect(data.categories.map((c) => c.label)).toEqual(['Platform', 'Payments', 'Data']);
  });

  it('names the series when the cut that was scoped is the one dividing them', () => {
    const data = grid(
      build('line', { measure: 'acus', segment: 'company', which: 'Acme, Globex', count: 4 }),
    );
    expect(data.series.map((s) => s.name)).toEqual(['Acme', 'Globex']);
  });

  it('keeps the placeholders when the answer was a rule rather than a list', () => {
    const data = grid(
      build('line', {
        measure: 'acus',
        segment: 'department',
        which: 'only the ones over 100 ACUs',
        count: 4,
      }),
    );
    expect(data.series.map((s) => s.name)).toEqual(['Engineering', 'Go-to-market', 'G&A']);
  });

  it('puts the answer in the sentence either way, because the prompt quotes it', () => {
    const named = setupFor('line', {
      measure: 'acus',
      segment: 'department',
      which: 'Platform, Payments',
      count: 4,
    });
    expect(setupSentence(L('line'), named, setupPeriods(L('line'), named))).toContain(
      'by department (Platform, Payments)',
    );

    const scoped = { ...named, which: 'only the ones over 100 ACUs' };
    expect(setupSentence(L('line'), scoped, setupPeriods(L('line'), scoped))).toContain(
      'by department (only the ones over 100 ACUs)',
    );
  });

  it('reaches the Devin prompt as the author\u2019s own words and as the rows to return', () => {
    const t = buildDevinChartPrompt(
      build('line', {
        measure: 'acus',
        segment: 'department',
        which: 'Platform, Payments',
        grain: 'year',
        count: 3,
      }),
    ).text;
    expect(t).toContain('by department (Platform, Payments)');
    expect(t).toContain('Platform');
    expect(t).toContain('Payments');
    expect(t).not.toContain('Go-to-market');
  });

  it('counts named members when warning about too many of them', () => {
    const many = setupFor('pie', {
      measure: 'acus',
      segment: 'department',
      which: 'A1, A2, A3, A4, A5, A6, A7, A8',
    });
    expect(setupIssues(L('pie'), many).some((i) => i.text.includes('8 slices'))).toBe(true);
  });

  it('scopes both ends of a flow separately', () => {
    const setup = setupFor('sankey', {
      measure: 'acus',
      segment: 'department',
      which: 'Platform, Payments',
      segment2: 'use-case',
      which2: 'Feature work, Migrations',
    });
    const sentence = setupSentence(L('sankey'), setup, setupPeriods(L('sankey'), setup));
    expect(sentence).toContain('flowing from department (Platform, Payments)');
    expect(sentence).toContain('to use case (Feature work, Migrations)');
    const nodes = (specFromSetup(L('sankey'), setup, ds, {
      orientation: 'vertical',
      asOf: AS_OF,
    }) as { data: { nodes: { label: string }[] } }).data.nodes.map((n) => n.label);
    expect(nodes).toEqual(['Platform', 'Payments', 'Feature work', 'Migrations']);
  });

  it('carries the answer with the cut when the chart kind changes', () => {
    const from = setupFor('line', {
      measure: 'acus',
      segment: 'department',
      which: 'Platform, Payments',
      count: 4,
    });
    expect(carrySetup(from, L('pie'), AS_OF).which).toBe('Platform, Payments');
    // A schedule has no cut to hang it on, so the answer goes with it.
    expect(carrySetup(from, L('gantt'), AS_OF).which).toBeUndefined();
  });
});
