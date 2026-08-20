import { describe, expect, it } from 'vitest';
import {
  addPreviewCategory,
  addPreviewSeries,
  applyPreviewData,
  DEFAULT_CHART_PREVIEW_DATA,
  defaultChartSpec,
  isGridSpec,
  previewDataAppliesTo,
  removePreviewCategory,
  removePreviewSeries,
  setPreviewValue,
  type ChartPreviewData,
  type ColumnBarSpec,
  type WaterfallSpec,
} from '@/model';

const data: ChartPreviewData = {
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'ARR', values: [10, 20, 30, 40] },
    { name: 'Services', values: [1, 2, 3, 4] },
  ],
};

describe('applyPreviewData', () => {
  it('redraws a grid chart on the given categories and series', () => {
    const spec = applyPreviewData(defaultChartSpec('column', 'stacked'), data) as ColumnBarSpec;
    expect(spec.data.categories.map((c) => c.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(spec.data.series.map((s) => s.name)).toEqual(['ARR', 'Services']);
    expect(spec.data.series[0].values).toEqual([10, 20, 30, 40]);
  });

  it('is a no-op without data, so a caller need not check', () => {
    const spec = defaultChartSpec('column', 'stacked');
    expect(applyPreviewData(spec, undefined)).toBe(spec);
  });

  it('pads a short row with gaps rather than shifting the values along', () => {
    const spec = applyPreviewData(defaultChartSpec('line'), {
      categories: ['a', 'b', 'c'],
      series: [{ name: 'S', values: [1] }],
    });
    expect(isGridSpec(spec) && spec.data.series[0].values).toEqual([1, null, null]);
  });

  it('trims a row longer than the categories', () => {
    const spec = applyPreviewData(defaultChartSpec('line'), {
      categories: ['a'],
      series: [{ name: 'S', values: [1, 2, 3] }],
    });
    expect(isGridSpec(spec) && spec.data.series[0].values).toEqual([1]);
  });

  it('falls back to the built-in sample rather than drawing an empty chart', () => {
    const spec = applyPreviewData(defaultChartSpec('column', 'stacked'), {
      categories: [],
      series: [],
    });
    expect(isGridSpec(spec) && spec.data.categories.length).toBe(
      DEFAULT_CHART_PREVIEW_DATA.categories.length,
    );
  });

  it('bridges a waterfall: first row the base, last a computed total', () => {
    const spec = applyPreviewData(defaultChartSpec('waterfall'), data) as WaterfallSpec;
    expect(spec.data.items.map((i) => [i.label, i.role, i.value])).toEqual([
      ['Q1', 'start', 10],
      ['Q2', 'delta', 20],
      ['Q3', 'delta', 30],
      ['Q4', 'total', null],
    ]);
  });

  it('gives a butterfly a series per side', () => {
    const spec = applyPreviewData(defaultChartSpec('butterfly'), data);
    expect(spec.kind === 'butterfly' && [spec.left[0].name, spec.right[0].name]).toEqual([
      'ARR',
      'Services',
    ]);
  });

  it('mirrors a single series across a butterfly rather than drawing one side', () => {
    const spec = applyPreviewData(defaultChartSpec('butterfly'), {
      categories: ['a'],
      series: [{ name: 'Only', values: [1] }],
    });
    expect(spec.kind === 'butterfly' && spec.right[0].name).toBe('Only');
  });

  it('leaves a scatter alone — an x/y cloud is not a category table', () => {
    const spec = defaultChartSpec('scatter');
    expect(applyPreviewData(spec, data)).toBe(spec);
    expect(previewDataAppliesTo('scatter')).toBe(false);
    expect(previewDataAppliesTo('column')).toBe(true);
  });

  it('leaves a Sankey alone', () => {
    const spec = defaultChartSpec('sankey');
    expect(applyPreviewData(spec, data)).toBe(spec);
  });
});

describe('editing the preview data', () => {
  it('grows every series when a row is added, so the table stays rectangular', () => {
    const next = addPreviewCategory(data);
    expect(next.categories).toHaveLength(5);
    expect(next.series.every((s) => s.values.length === 5)).toBe(true);
    expect(next.series[0].values[4]).toBeNull();
  });

  it('adds a series sized to the rows already there', () => {
    const next = addPreviewSeries(data);
    expect(next.series[2].values).toEqual([null, null, null, null]);
  });

  it('removes a row from every series at once', () => {
    const next = removePreviewCategory(data, 1);
    expect(next.categories).toEqual(['Q1', 'Q3', 'Q4']);
    expect(next.series[0].values).toEqual([10, 30, 40]);
  });

  it('refuses to empty the table — a chart with no rows previews nothing', () => {
    const one: ChartPreviewData = { categories: ['a'], series: [{ name: 'S', values: [1] }] };
    expect(removePreviewCategory(one, 0)).toBe(one);
    expect(removePreviewSeries(one, 0)).toBe(one);
  });

  it('writes one cell without disturbing its neighbours', () => {
    const next = setPreviewValue(data, 1, 2, 99);
    expect(next.series[1].values).toEqual([1, 2, 99, 4]);
    expect(next.series[0].values).toEqual(data.series[0].values);
  });

  it('takes null for a cell, since a gap is a thing worth previewing', () => {
    expect(setPreviewValue(data, 0, 0, null).series[0].values[0]).toBeNull();
  });
});
