import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  chartOrientation,
  isGridSpec,
  isWaterfallSpec,
  isXYSpec,
  type ChartSpec,
} from '@/model';
import { compileChart } from '@/chart/compile';
import { recommendLayouts } from './intent';
import { briefTitle, specFromBrief } from './briefedSpec';
import { CHART_LAYOUTS } from './layouts';

const AS_OF = '2026-08-17';
const DS = DEFAULT_DESIGN_SYSTEM;

const build = (description: string, ctx: Record<string, unknown> = {}): ChartSpec => {
  const rec = recommendLayouts(description, { asOf: AS_OF, ...ctx });
  return specFromBrief(rec.brief, rec.suggestions[0], DS);
};

const FRAME = { x: 0, y: 0, w: 9_144_000, h: 5_143_500 };
const compiles = (spec: ChartSpec) =>
  compileChart({ id: 'c', groupId: 'g', frame: FRAME, spec }, DS).elements;

describe('specFromBrief', () => {
  it('names the client and the period on the title', () => {
    const spec = build('quarterly ARR by segment for the last 4 quarters in $M', {
      deckTags: ['Globex'],
    });
    expect(spec.title).toBe("Globex — ARR by segment · Q4'25–Q3'26");
  });

  it('leaves the subject out rather than writing a placeholder for it', () => {
    expect(build('revenue by segment over the last 3 years').title).not.toMatch(/—/);
  });

  it('puts the described period on the categories and the breakdown on the series', () => {
    const spec = build('revenue by region over the last 3 years');
    if (!isGridSpec(spec)) throw new Error('expected a grid chart');
    expect(spec.data.categories.map((c) => c.label)).toEqual(['2024', '2025', '2026']);
    expect(spec.data.series.map((s) => s.name)).toEqual(['Americas', 'EMEA', 'APAC']);
  });

  it('carries the units onto the value axis', () => {
    const spec = build('revenue by region over the last 3 years in $M');
    expect(spec.numberFormat.style).toBe('currency');
    expect(spec.axes.y.unitDivisor).toBe(1e6);
    expect(spec.axes.y.unitNote).toBe('in $M');
    expect(spec.axes.y.title).toBe('Revenue');
  });

  it('gives a combo its rate on a second axis, drawn as a line', () => {
    const spec = build('gross margin against revenue, quarterly');
    if (spec.kind !== 'combo') throw new Error('expected a combo');
    const rate = spec.data.series[spec.data.series.length - 1];
    expect(rate.name).toBe('Gross margin');
    expect(rate.axis).toBe('secondary');
    expect(spec.render[rate.key]).toBe('line');
    expect(spec.axes.y2?.title).toBe('Gross margin');
    // The columns stay in currency; only the line is a proportion.
    expect(spec.numberFormat.style).toBe('currency');
    expect(rate.numberFormat?.style).toBe('percent');
    expect(rate.values.every((v) => v !== null && v > 0 && v < 1)).toBe(true);
  });

  it('names both ends of a bridge from the period', () => {
    const spec = build('how FY24 revenue bridged to FY25');
    if (!isWaterfallSpec(spec)) throw new Error('expected a waterfall');
    const labels = spec.data.items.map((i) => i.label);
    expect(labels[0]).toBe('FY24 revenue');
    expect(labels[labels.length - 1]).toBe('FY25 revenue');
    // The closing total is computed from the deltas above it, never typed in.
    expect(spec.data.items[spec.data.items.length - 1].value).toBeNull();
  });

  it('labels a scatter with both measures and one point per named thing', () => {
    const spec = build('relationship between headcount and revenue across peers');
    if (!isXYSpec(spec)) throw new Error('expected an x/y plot');
    expect(spec.axes.x.title).toBe('Headcount');
    expect(spec.axes.y.title).toBe('Revenue');
    expect(spec.data.series[0].points.map((p) => p.label)).toEqual([
      'Peer A',
      'Peer B',
      'Peer C',
    ]);
  });

  it('keeps proportional data inside 0…1 so the percent format means something', () => {
    const spec = build('gross margin by segment over the last 3 years');
    if (!isGridSpec(spec)) throw new Error('expected a grid chart');
    const values = spec.data.series.flatMap((s) => s.values);
    expect(spec.numberFormat.style).toBe('percent');
    expect(values.every((v) => v !== null && v > 0 && v <= 1)).toBe(true);
  });

  it('lays a ranking on its side', () => {
    expect(chartOrientation(build('top 8 countries by revenue'))).toBe('horizontal');
  });

  it('is deterministic — the same brief builds the same figures', () => {
    const a = build('revenue by segment over the last 3 years');
    const b = build('revenue by segment over the last 3 years');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('builds a compilable chart for every layout the recommender can name', () => {
    const rec = recommendLayouts('revenue by segment over the last 4 quarters in $M', {
      asOf: AS_OF,
      deckTags: ['Globex'],
    });
    for (const layout of CHART_LAYOUTS) {
      const spec = specFromBrief(rec.brief, { layout, orientation: 'vertical', score: 1, why: '' }, DS);
      expect(compiles(spec).length, `${layout.id} drew nothing`).toBeGreaterThan(0);
    }
  });

  it('falls back to the house sample when the description says nothing usable', () => {
    const rec = recommendLayouts('waterfall', { asOf: AS_OF });
    const spec = specFromBrief(rec.brief, rec.suggestions[0], DS);
    if (!isWaterfallSpec(spec)) throw new Error('expected a waterfall');
    expect(spec.data.items.length).toBeGreaterThan(2);
  });
});

describe('briefTitle', () => {
  it('prints a single period once rather than as a range', () => {
    const rec = recommendLayouts('revenue mix by region for FY25', { asOf: AS_OF });
    expect(briefTitle(rec.brief)).toBe('Revenue by region · FY25');
  });
});
