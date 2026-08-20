import { describe, expect, it } from 'vitest';
import type { GridData } from '@/model';
import { deriveGrid, stackTops } from './grid';

const grid = (values: (number | null)[][]): GridData => ({
  categories: values[0].map((_, i) => ({ key: `c${i}`, label: `C${i}` })),
  series: values.map((row, i) => ({ key: `s${i}`, name: `S${i}`, values: row })),
});

const at = (d: ReturnType<typeof deriveGrid>, s: number, c: number) =>
  d.data.find((x) => x.seriesIndex === s && x.pointIndex === c)!;

describe('deriveGrid — clustered', () => {
  it('leaves every bar based at zero', () => {
    const d = deriveGrid(grid([[10, 20], [30, 40]]), 'clustered');
    expect(at(d, 1, 0)).toMatchObject({ base: 0, top: 30 });
    expect(at(d, 1, 1)).toMatchObject({ base: 0, top: 40 });
  });

  it('sums totals per category', () => {
    expect(deriveGrid(grid([[10, 20], [30, 40]]), 'clustered').totals).toEqual([40, 60]);
  });
});

describe('deriveGrid — stacked', () => {
  it('stacks each series on the one below', () => {
    const d = deriveGrid(grid([[10], [30], [5]]), 'stacked');
    expect(at(d, 0, 0)).toMatchObject({ base: 0, top: 10 });
    expect(at(d, 1, 0)).toMatchObject({ base: 10, top: 40 });
    expect(at(d, 2, 0)).toMatchObject({ base: 40, top: 45 });
  });

  it('stacks negatives downward rather than eating the bar below', () => {
    const d = deriveGrid(grid([[100], [-40], [20]]), 'stacked');
    expect(at(d, 0, 0)).toMatchObject({ base: 0, top: 100 });
    // The negative hangs below zero...
    expect(at(d, 1, 0)).toMatchObject({ base: 0, top: -40 });
    // ...and the next positive resumes on top of the positive stack.
    expect(at(d, 2, 0)).toMatchObject({ base: 100, top: 120 });
  });

  it('reports an extent that spans both directions', () => {
    const d = deriveGrid(grid([[100], [-40]]), 'stacked');
    expect(Math.min(...d.extent)).toBe(-40);
    expect(Math.max(...d.extent)).toBe(100);
  });
});

describe('deriveGrid — stacked100', () => {
  it('normalises each category to sum to one', () => {
    const d = deriveGrid(grid([[25, 10], [75, 30]]), 'stacked100');
    expect(at(d, 1, 0).top).toBeCloseTo(1);
    expect(at(d, 1, 1).top).toBeCloseTo(1);
  });

  it('labels with the share, not the raw value', () => {
    const d = deriveGrid(grid([[25], [75]]), 'stacked100');
    expect(at(d, 0, 0).labelValue).toBeCloseTo(0.25);
    expect(at(d, 0, 0).share).toBeCloseTo(0.25);
  });

  it('divides by magnitude so a category summing to zero does not explode', () => {
    const d = deriveGrid(grid([[10], [-10]]), 'stacked100');
    expect(d.data.every((x) => Number.isFinite(x.top))).toBe(true);
    expect(at(d, 0, 0).share).toBeCloseTo(0.5);
  });

  it('leaves an all-zero category finite', () => {
    const d = deriveGrid(grid([[0], [0]]), 'stacked100');
    expect(d.data.every((x) => Number.isFinite(x.top))).toBe(true);
    expect(at(d, 0, 0).share).toBeUndefined();
  });
});

describe('deriveGrid — gaps', () => {
  it('treats null as a gap, not a zero, and keeps it out of the extent', () => {
    const d = deriveGrid(grid([[10, null], [30, 40]]), 'stacked');
    expect(at(d, 0, 1).value).toBeNull();
    // The gap contributes nothing to the stack: series 1 still starts at zero.
    expect(at(d, 1, 1)).toMatchObject({ base: 0, top: 40 });
  });

  it('still produces a usable axis when every value is null', () => {
    const d = deriveGrid(grid([[null, null]]), 'clustered');
    expect(d.extent.length).toBeGreaterThan(0);
    expect(Math.max(...d.extent)).toBeGreaterThan(Math.min(...d.extent));
  });
});

describe('stackTops', () => {
  it('reports the top of each stack for totals labels', () => {
    const d = deriveGrid(grid([[10, 5], [30, 15]]), 'stacked');
    expect(stackTops(d, 2)).toEqual([40, 20]);
  });
});

describe('deriveGrid — the secondary axis', () => {
  const secondary = new Set(['s1']);

  it('keeps a secondary series out of the primary extent, so the left axis fits the left data', () => {
    const d = deriveGrid(grid([[400, 500], [18, 24]]), 'clustered', { secondary });
    expect(d.extent).toEqual([0, 400, 0, 500]);
    expect(d.extentSecondary).toEqual([0, 18, 0, 24]);
  });

  it('leaves it out of the totals — a rate is not part of the sum of its parts', () => {
    const d = deriveGrid(grid([[400, 500], [18, 24]]), 'stacked', { secondary });
    expect(d.totals).toEqual([400, 500]);
  });

  it('never stacks it, whatever the chart stacks', () => {
    const d = deriveGrid(grid([[400], [18]]), 'stacked', { secondary });
    expect(at(d, 1, 0)).toMatchObject({ base: 0, top: 18 });
  });

  it('keeps its own units under 100% stacking rather than becoming a share', () => {
    const d = deriveGrid(grid([[300], [100], [18]]), 'stacked100', {
      secondary: new Set(['s2']),
    });
    // The two primary series split the category between them…
    expect(at(d, 0, 0).top).toBeCloseTo(0.75);
    // …and the rate on the other axis is still 18.
    expect(at(d, 2, 0)).toMatchObject({ base: 0, top: 18, labelValue: 18 });
  });
});
