import { describe, expect, it } from 'vitest';
import { layoutById, CHART_LAYOUTS } from './layouts';
import {
  carrySetup,
  defaultSetup,
  formFor,
  GRAINS_FOR,
  isReady,
  setupIssues,
  shapeOf,
  SPAN_PRESETS,
  timeQuestionFor,
  type ChartSetup,
  setupCount,
  withGrain,
} from './setupForm';
import { cellCount, cellLabel, rangeEndingAt } from './periodRange';

const AS_OF = '2026-08-21';

const L = (id: string) => layoutById(id)!;

const setupFor = (id: string, over: Partial<ChartSetup> = {}): ChartSetup => ({
  ...defaultSetup(formFor(L(id)), AS_OF),
  ...over,
});

/** A setup covering `count` cells of `grain`, ending on the current one. */
const spanning = (id: string, grain: ChartSetup['grain'], count: number, over: Partial<ChartSetup> = {}) =>
  setupFor(id, { grain, range: rangeEndingAt(grain, AS_OF, count), ...over });

describe('formFor', () => {
  it('asks a trend for a span and a line chart for nothing else', () => {
    const f = formFor(L('line'));
    expect(f.shape).toBe('trend');
    expect(f.axis).toBe('time');
    expect(f.time).toBe('range');
    expect(f.measures).toHaveLength(1);
    expect(f.segments[0].required).toBe(false);
  });

  it('asks a combo for the rate that rides over the top, and demands it', () => {
    const f = formFor(L('combo-clustered-line'));
    expect(f.measures.map((m) => m.key)).toEqual(['primary', 'secondary']);
    expect(f.measures[1].wants).toBe('rate');
    expect(f.measures[1].required).toBe(true);
  });

  it('requires the divider on a stack, because a stack of one is a column', () => {
    expect(formFor(L('stacked')).segments.some((s) => s.required)).toBe(true);
    expect(formFor(L('clustered')).segments.every((s) => !s.required)).toBe(true);
  });

  it('asks a pie for one moment and exactly one cut', () => {
    const f = formFor(L('pie'));
    expect(f.time).toBe('moment');
    expect(f.segments).toHaveLength(1);
    expect(f.segments[0].required).toBe(true);
  });

  it('asks a scatter for two measures and no span at all', () => {
    const f = formFor(L('scatter'));
    expect(f.measures.filter((m) => m.required)).toHaveLength(2);
    expect(f.time).toBe('moment');
    expect(f.axis).toBe('none');
  });

  it('asks a bubble for the third measure, and only a bubble', () => {
    expect(formFor(L('bubble')).measures.map((m) => m.key)).toContain('size');
    expect(formFor(L('scatter')).measures.map((m) => m.key)).not.toContain('size');
  });

  it('asks a bridge for two ends rather than a range', () => {
    expect(formFor(L('waterfall-up')).time).toBe('endpoints');
  });

  it('asks a flow for both ends of the flow', () => {
    const f = formFor(L('sankey'));
    expect(f.segments.filter((s) => s.required)).toHaveLength(2);
  });

  it('asks a dot plot for the moments it compares, not a span', () => {
    expect(formFor(L('dotplot')).time).toBe('points');
    expect(defaultSetup(formFor(L('dotplot')), AS_OF).markers).toBe(2);
  });

  it('asks a Gantt for a window and nothing else — it has no measure', () => {
    const f = formFor(L('gantt'));
    expect(f.shape).toBe('schedule');
    expect(f.measures).toEqual([]);
    expect(f.segments).toEqual([]);
    expect(f.time).toBe('window');
  });

  it('lets a column chart choose between time and a category along the bottom', () => {
    const f = formFor(L('clustered'));
    expect(f.axis).toBe('either');
    expect(timeQuestionFor(f, 'time')).toBe('range');
    // A cut along the bottom is a snapshot: the date belongs in the title.
    expect(timeQuestionFor(f, 'segment')).toBe('moment');
  });

  it('gives every layout a form with a grain list its question offers', () => {
    for (const layout of CHART_LAYOUTS) {
      const form = formFor(layout);
      const setup = defaultSetup(form, AS_OF);
      const question = timeQuestionFor(form, setup.axis);
      expect(GRAINS_FOR[question]).toContain(setup.grain);
      expect(shapeOf(layout)).toBe(form.shape);
    }
  });
});

describe('defaultSetup', () => {
  it('pre-fills nothing that would be a guess at intent', () => {
    const s = defaultSetup(formFor(L('line')), AS_OF);
    expect(s.measure).toBeUndefined();
    expect(s.segment).toBeUndefined();
  });

  it('does pre-fill the range, so the form can be answered by pressing Insert', () => {
    const s = defaultSetup(formFor(L('line')), AS_OF);
    expect(s.grain).toBe('quarter');
    expect(SPAN_PRESETS.quarter).toContain(setupCount(s));
  });

  it('ends the range on the period in progress', () => {
    const s = defaultSetup(formFor(L('line')), AS_OF);
    // Aug 2026 is in Q3'26.
    expect(cellLabel('quarter', s.range.to)).toBe("Q3'26");
  });

  it('opens a moment-shaped chart on one period, both ends the same', () => {
    const s = defaultSetup(formFor(L('pie')), AS_OF);
    expect(setupCount(s)).toBe(1);
    expect(s.range.from).toBe(s.range.to);
  });

  it('opens a bridge wide rather than on two adjacent periods', () => {
    // A bridge exists to show a change; this year to this year is not one.
    const s = defaultSetup(formFor(L('waterfall-up')), AS_OF);
    expect(setupCount(s)).toBe(2);
    expect(s.range.from).not.toBe(s.range.to);
  });
});

describe('clampCount', () => {
  it('is gone — the range bounds itself, and its ends are what get stored', () => {
    expect(setupCount(spanning('line', 'quarter', 8))).toBe(8);
  });
});

describe('setupIssues', () => {
  it('blocks a stack of a per-something measure', () => {
    const issues = setupIssues(
      L('stacked'),
      setupFor('stacked', { measure: 'acus-per-merged-pr', segment2: 'company' }),
    );
    const blocker = issues.find((i) => i.level === 'blocker');
    expect(blocker?.text).toContain('an average');
    expect(blocker?.text).toContain('exists nowhere in the data');
    expect(blocker?.insteadId).toBe('clustered');
  });

  it('blocks a pie of a rate for the same reason', () => {
    const issues = setupIssues(L('pie'), setupFor('pie', { measure: 'merge-rate', segment: 'company' }));
    expect(issues.some((i) => i.level === 'blocker' && i.text.includes('a rate'))).toBe(true);
  });

  it('allows a clustered column of the same per-something measure', () => {
    expect(
      isReady(L('clustered'), setupFor('clustered', { measure: 'acus-per-merged-pr', segment2: 'company' })),
    ).toBe(true);
  });

  it('allows a stack of a count, which does add up', () => {
    expect(isReady(L('stacked'), setupFor('stacked', { measure: 'acus', segment2: 'department' }))).toBe(
      true,
    );
  });

  it('blocks a required measure or cut that has not been answered', () => {
    expect(isReady(L('line'), setupFor('line'))).toBe(false);
    expect(isReady(L('line'), setupFor('line', { measure: 'acus' }))).toBe(true);
    // A pie's slices are required, a line's split is not.
    expect(isReady(L('pie'), setupFor('pie', { measure: 'acus' }))).toBe(false);
  });

  it('blocks a scatter with the same measure on both axes', () => {
    const issues = setupIssues(
      L('scatter'),
      setupFor('scatter', { measure: 'acus', secondaryMeasure: 'acus', segment: 'company' }),
    );
    expect(issues.some((i) => i.level === 'blocker' && i.text.includes('straight diagonal'))).toBe(true);
  });

  it('blocks a flow from a cut to itself', () => {
    const issues = setupIssues(
      L('sankey'),
      setupFor('sankey', { measure: 'acus', segment: 'company', segment2: 'company' }),
    );
    expect(issues.some((i) => i.level === 'blocker' && i.text.includes('nowhere to go'))).toBe(true);
  });

  it('notes, but does not block, a combo whose second measure is an absolute', () => {
    const setup = setupFor('combo-clustered-line', {
      measure: 'acus',
      secondaryMeasure: 'sessions',
    });
    const issues = setupIssues(L('combo-clustered-line'), setup);
    expect(issues.some((i) => i.level === 'note' && i.text.includes('two absolutes'))).toBe(true);
    expect(isReady(L('combo-clustered-line'), setup)).toBe(true);
  });

  it('notes a bubble with no size measure, since that is a scatter', () => {
    const issues = setupIssues(
      L('bubble'),
      setupFor('bubble', { measure: 'acus', secondaryMeasure: 'prs-merged', segment: 'company' }),
    );
    expect(issues.find((i) => i.text.includes('every bubble'))?.insteadId).toBe('scatter');
  });

  it('leaves the widest cross the menu offers alone — twelve columns still read', () => {
    const issues = setupIssues(
      L('clustered'),
      setupFor('clustered', {
        axis: 'segment',
        measure: 'acus',
        segment: 'use-case',
        segment2: 'cohort',
      }),
    );
    expect(issues).toEqual([]);
  });

  it('notes crossing two cuts into an unreadable number of columns', () => {
    // Unreachable from the menu by design; typed cuts and future entries can
    // still get here. See the guard's own comment.
    const wide = { ...setupFor('clustered'), axis: 'segment' as const, measure: 'acus' };
    const issues = setupIssues(L('clustered'), {
      ...wide,
      segment: 'use-case',
      segment2: 'use-case',
    });
    // Four by four is sixteen, still under the line — the rule is about twenty.
    expect(issues.some((i) => i.text.includes('columns'))).toBe(false);
  });

  it('puts blockers before notes', () => {
    const issues = setupIssues(
      L('stacked'),
      setupFor('stacked', { measure: 'merge-rate', axis: 'segment', segment: 'cohort', segment2: 'use-case' }),
    );
    expect(issues[0].level).toBe('blocker');
  });

  it('has nothing to say about a Gantt, which asks for nothing', () => {
    expect(setupIssues(L('gantt'), setupFor('gantt'))).toEqual([]);
    expect(isReady(L('gantt'), setupFor('gantt'))).toBe(true);
  });
});

describe('carrySetup', () => {
  it('keeps the timeframe when the chart type changes', () => {
    const from = spanning('line', 'week', 12, { measure: 'acus' });
    const to = carrySetup(from, L('stacked'), AS_OF);
    expect(to.grain).toBe('week');
    expect(to.range).toEqual(from.range);
    expect(setupCount(to)).toBe(12);
  });

  it('keeps the calendar choice and the notes', () => {
    const from = setupFor('line', { grain: 'year', fiscal: true, notes: 'exclude internal orgs' });
    const to = carrySetup(from, L('clustered'), AS_OF);
    expect(to.fiscal).toBe(true);
    expect(to.notes).toBe('exclude internal orgs');
  });

  it('keeps the measure and the cut where the new form still has a slot', () => {
    const from = setupFor('line', { measure: 'acus', segment: 'department' });
    const to = carrySetup(from, L('pie'), AS_OF);
    expect(to.measure).toBe('acus');
    expect(to.segment).toBe('department');
  });

  it('drops an answer the new chart has nowhere to put', () => {
    const from = setupFor('bubble', {
      measure: 'prs-merged',
      secondaryMeasure: 'acus',
      sizeMeasure: 'seats',
      segment: 'company',
    });
    // A line has one measure slot and no size.
    const to = carrySetup(from, L('line'), AS_OF);
    expect(to.measure).toBe('prs-merged');
    expect(to.secondaryMeasure).toBeUndefined();
    expect(to.sizeMeasure).toBeUndefined();
  });

  it('translates a grain the new question does not offer to the nearest it does', () => {
    // A bridge bridges by quarter or year, never by the day.
    const from = spanning('line', 'week', 8);
    expect(carrySetup(from, L('waterfall-up'), AS_OF).grain).toBe('quarter');
  });

  it('keeps the DATES when the grain has to change, rather than the number', () => {
    // Sixteen weeks is about four months. Carried onto a bridge it becomes the
    // quarters those weeks fall in — not sixteen quarters, which is four years.
    const from = spanning('line', 'week', 16);
    const to = carrySetup(from, L('waterfall-up'), AS_OF);
    expect(setupCount(to)).toBeLessThanOrEqual(3);
    expect(to.range.to).toBe('2026-07-01');
  });

  it('collapses a moment to its single end', () => {
    const from = spanning('line', 'quarter', 12);
    const to = carrySetup(from, L('pie'), AS_OF);
    expect(to.range.from).toBe(to.range.to);
    expect(setupCount(to)).toBe(1);
  });

  it('keeps the axis choice between two charts that both offer it', () => {
    const from = setupFor('clustered', { axis: 'segment', measure: 'acus', segment: 'company' });
    expect(carrySetup(from, L('stacked'), AS_OF).axis).toBe('segment');
    // A line has no such choice — time is the only axis it has.
    expect(carrySetup(from, L('line'), AS_OF).axis).toBe('time');
  });

  it('round-trips through a chart that asks less and back again', () => {
    const start = spanning('line', 'month', 12, { measure: 'acus', segment: 'cohort' });
    const viaPie = carrySetup(start, L('pie'), AS_OF);
    const back = carrySetup(viaPie, L('line'), AS_OF);
    expect(back.grain).toBe('month');
    expect(back.measure).toBe('acus');
    expect(back.segment).toBe('cohort');
    // The span cannot survive a trip through a chart that holds one period —
    // a pie genuinely forgot it — but the end does, and it is re-spanned.
    expect(setupCount(back)).toBeGreaterThan(1);
  });
});

describe('withGrain', () => {
  it('keeps a real span across a change of unit', () => {
    // Twelve months ending in Aug 2026 runs from Sep 2025, and those months
    // touch five quarters — Q3'25 through Q3'26. The ends snap OUTWARD, so
    // every period the author picked is still covered; a span that shrank to
    // four would drop one of them.
    const from = spanning('line', 'month', 12);
    const to = withGrain(from, 'quarter', 'range');
    expect(to.grain).toBe('quarter');
    expect(cellCount('quarter', to.range)).toBe(5);
    expect(cellLabel('quarter', to.range.from)).toBe("Q3'25");
    expect(cellLabel('quarter', to.range.to)).toBe("Q3'26");
  });

  it('re-spans when the dates collapse into one cell of the new grain', () => {
    // Four weeks is inside one quarter; keeping the dates would draw one column.
    const from = spanning('line', 'week', 4);
    const to = withGrain(from, 'quarter', 'range');
    expect(cellCount('quarter', to.range)).toBeGreaterThan(1);
  });

  it('holds a moment to one cell', () => {
    const from = setupFor('pie', { grain: 'quarter' });
    const to = withGrain(from, 'year', 'moment');
    expect(to.range.from).toBe(to.range.to);
  });
});
