import { describe, expect, it } from 'vitest';
import { baselineOf, makeScale, niceDomain, niceStep } from './linear';
import { bandScale, weightedBands } from './band';

describe('niceStep', () => {
  it('climbs the 1/2/2.5/5 ladder', () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(1, 5)).toBe(0.2);
    expect(niceStep(1000, 4)).toBe(250);
  });

  it('survives a degenerate span', () => {
    expect(niceStep(0, 5)).toBe(1);
    expect(niceStep(NaN, 5)).toBe(1);
  });
});

describe('niceDomain', () => {
  it('rounds outward to whole ticks', () => {
    const s = niceDomain([0, 640, 372]);
    expect(s.min).toBe(0);
    expect(s.max).toBeGreaterThanOrEqual(640);
    expect(s.max % s.step).toBe(0);
  });

  it('includes zero by default so bars have a real baseline', () => {
    expect(niceDomain([120, 180]).min).toBe(0);
  });

  it('can skip zero for a line chart that would otherwise be flat', () => {
    const s = niceDomain([120, 180], { includeZero: false });
    expect(s.min).toBeGreaterThan(0);
  });

  it('handles negatives on both sides of zero', () => {
    const s = niceDomain([-88, 260]);
    expect(s.min).toBeLessThan(0);
    expect(s.max).toBeGreaterThan(260);
  });

  it('gives a flat series something to be drawn against', () => {
    const s = niceDomain([5, 5], { includeZero: false });
    expect(s.max).toBeGreaterThan(s.min);
    const z = niceDomain([0, 0]);
    expect(z.max).toBeGreaterThan(z.min);
  });

  it('lets an explicit min/max/step win over the data', () => {
    const s = niceDomain([0, 640], { min: 0, max: 800, step: 200 });
    expect(s.min).toBe(0);
    expect(s.max).toBe(800);
    expect(s.ticks).toEqual([0, 200, 400, 600, 800]);
  });

  it('survives an empty series', () => {
    const s = niceDomain([]);
    expect(Number.isFinite(s.min)).toBe(true);
    expect(s.max).toBeGreaterThan(s.min);
  });
});

describe('makeScale', () => {
  it('emits ticks free of floating-point fuzz', () => {
    expect(makeScale(0, 1, 0.1).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it('norm and invert round-trip', () => {
    const s = makeScale(0, 800, 200);
    expect(s.norm(400)).toBeCloseTo(0.5);
    expect(s.invert(0.5)).toBeCloseTo(400);
    expect(s.invert(s.norm(137))).toBeCloseTo(137);
  });

  it('never emits negative zero', () => {
    expect(Object.is(makeScale(-2, 2, 1).ticks[2], 0)).toBe(true);
  });
});

describe('baselineOf', () => {
  it('sits at zero when the domain spans it', () => {
    expect(baselineOf(makeScale(-100, 100, 50))).toBeCloseTo(0.5);
  });

  it('pins to an edge when the domain is one-sided', () => {
    expect(baselineOf(makeScale(0, 100, 25))).toBe(0);
    expect(baselineOf(makeScale(10, 100, 10))).toBe(0);
    expect(baselineOf(makeScale(-100, -10, 10))).toBe(1);
  });
});

describe('bandScale', () => {
  it('centres category groups evenly', () => {
    const b = bandScale({ count: 4, seriesCount: 1, gapWidthPct: 150, overlapPct: 0 });
    expect(b.center(0)).toBeCloseTo(0.125);
    expect(b.center(3)).toBeCloseTo(0.875);
    expect(b.bandWidth).toBeCloseTo(0.25);
  });

  it('narrows bars as the gap widens', () => {
    const tight = bandScale({ count: 3, seriesCount: 1, gapWidthPct: 0, overlapPct: 0 });
    const loose = bandScale({ count: 3, seriesCount: 1, gapWidthPct: 300, overlapPct: 0 });
    expect(loose.barWidth).toBeLessThan(tight.barWidth);
  });

  it('keeps a clustered group centred on its category', () => {
    const b = bandScale({ count: 2, seriesCount: 3, gapWidthPct: 150, overlapPct: -27 });
    const first = b.barStart(0, 0);
    const last = b.barStart(0, 2) + b.barWidth;
    expect((first + last) / 2).toBeCloseTo(b.center(0));
  });

  it('stacks bars exactly at 100% overlap', () => {
    const b = bandScale({ count: 2, seriesCount: 3, gapWidthPct: 150, overlapPct: 100 });
    expect(b.barStart(0, 0)).toBeCloseTo(b.barStart(0, 2));
  });

  it('keeps every bar inside the axis', () => {
    const b = bandScale({ count: 5, seriesCount: 4, gapWidthPct: 150, overlapPct: -27 });
    expect(b.barStart(0, 0)).toBeGreaterThanOrEqual(0);
    expect(b.barStart(4, 3) + b.barWidth).toBeLessThanOrEqual(1.0001);
  });
});

describe('weightedBands', () => {
  it('sizes columns in proportion to their weights', () => {
    const [a, b] = weightedBands([1, 3], 0);
    expect(b.width).toBeCloseTo(a.width * 3);
  });

  it('fills the axis, gaps included', () => {
    const bands = weightedBands([2, 3, 5], 0.01);
    const last = bands[bands.length - 1];
    expect(last.start + last.width).toBeCloseTo(1);
  });

  it('survives zero and empty weights', () => {
    expect(weightedBands([])).toEqual([]);
    const z = weightedBands([0, 0], 0);
    expect(z.every((b) => Number.isFinite(b.width))).toBe(true);
  });
});
