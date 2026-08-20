import { describe, expect, it } from 'vitest';
import { inchesToEmu, pointsToEmu, toEpochDay, toIso } from '@/model';
import { defaultBands, grainFor, niceTimeDomain, timeScale } from './time';

const day = toEpochDay;

describe('timeScale', () => {
  const min = day(2026, 1, 1);
  const max = day(2026, 7, 1);

  it('is a LinearScale over epoch days, so a Projector takes it unchanged', () => {
    const s = timeScale(min, max, [{ grain: 'month' }]);
    expect(s.min).toBe(min);
    expect(s.max).toBe(max);
    expect(s.norm(min)).toBe(0);
    expect(s.norm(max)).toBe(1);
    expect(s.norm(s.invert(0.25))).toBeCloseTo(0.25, 10);
    expect(s.invert(0.5)).toBeCloseTo((min + max) / 2, 10);
  });

  it('orders bands coarsest first regardless of how they were asked for', () => {
    const s = timeScale(min, max, [{ grain: 'month' }, { grain: 'year' }]);
    expect(s.bands.map((b) => b.grain)).toEqual(['year', 'month']);
    expect(s.grain).toBe('month');
  });

  it('drops a repeated band', () => {
    const s = timeScale(min, max, [{ grain: 'month' }, { grain: 'month' }]);
    expect(s.bands).toHaveLength(1);
  });

  it('puts ticks on cell STARTS, and never on the plot edge', () => {
    const s = timeScale(min, max, [{ grain: 'month' }]);
    expect(s.ticks.map(toIso)).toEqual([
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
    ]);
  });

  it('honours a per-band format', () => {
    const s = timeScale(min, max, [{ grain: 'month', format: 'MMMM' }]);
    expect(s.bands[0].cells[0].label).toBe('January');
  });

  it('survives an empty band list', () => {
    const s = timeScale(min, max, []);
    expect(s.bands).toEqual([]);
    expect(s.ticks).toEqual([]);
    expect(s.norm(max)).toBe(1);
  });

  it('never produces a zero-width domain', () => {
    const s = timeScale(min, min, [{ grain: 'day' }]);
    expect(s.max).toBeGreaterThan(s.min);
  });
});

describe('niceTimeDomain', () => {
  it('rounds outward to whole calendar cells', () => {
    const { min, max } = niceTimeDomain([day(2026, 2, 10), day(2026, 5, 20)], {
      coarsest: 'month',
    });
    expect(toIso(min)).toBe('2026-02-01');
    expect(toIso(max)).toBe('2026-06-01');
  });

  it('does not pull in an empty cell when the range ends on a boundary', () => {
    const { max } = niceTimeDomain([day(2026, 1, 5), day(2026, 4, 1)], { coarsest: 'month' });
    expect(toIso(max)).toBe('2026-04-01');
  });

  it('snaps to quarters when asked', () => {
    const { min, max } = niceTimeDomain([day(2026, 2, 10), day(2026, 5, 20)], {
      coarsest: 'quarter',
    });
    expect(toIso(min)).toBe('2026-01-01');
    expect(toIso(max)).toBe('2026-07-01');
  });

  it('lets an explicit bound win over the data', () => {
    const pinned = { min: day(2026, 1, 1), max: day(2026, 12, 31) };
    const { min, max } = niceTimeDomain([day(2027, 6, 1)], { ...pinned, coarsest: 'month' });
    expect(min).toBe(pinned.min);
    expect(max).toBe(pinned.max);
  });

  it('gives an empty schedule an axis without reading a clock', () => {
    const a = niceTimeDomain([], { coarsest: 'month' });
    const b = niceTimeDomain([], { coarsest: 'month' });
    expect(a).toEqual(b);
    expect(a.max).toBeGreaterThan(a.min);
  });
});

describe('grainFor', () => {
  const plot = inchesToEmu(8);
  const label = pointsToEmu(24);

  it('gets finer as the span shortens', () => {
    expect(grainFor(365 * 4, plot, label)).toBe('quarter');
    expect(grainFor(180, plot, label)).toBe('month');
    expect(grainFor(60, plot, label)).toBe('week');
    expect(grainFor(20, plot, label)).toBe('day');
  });

  it('gets coarser as the plot narrows', () => {
    const wide = grainFor(365, inchesToEmu(10), label);
    const narrow = grainFor(365, inchesToEmu(1.5), label);
    expect(['month', 'week']).toContain(wide);
    expect(['year', 'half', 'quarter']).toContain(narrow);
  });

  it('falls back rather than dividing by zero', () => {
    expect(grainFor(0, plot, label)).toBe('month');
    expect(grainFor(100, 0, label)).toBe('month');
    expect(grainFor(100, plot, 0)).toBe('month');
  });
});

describe('defaultBands', () => {
  it('gives two rows: which year, and which month', () => {
    const bands = defaultBands(180, inchesToEmu(8), pointsToEmu(24));
    expect(bands.map((b) => b.grain)).toEqual(['quarter', 'month']);
  });

  it('collapses to one row when the finest grain is already the coarsest', () => {
    const bands = defaultBands(365 * 40, inchesToEmu(3), pointsToEmu(24));
    expect(bands).toHaveLength(1);
    expect(bands[0].grain).toBe('year');
  });
});
