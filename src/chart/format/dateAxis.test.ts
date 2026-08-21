import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AXIS_TITLE,
  axisGrain,
  formatTickLabels,
  parseDatePattern,
  sampleTick,
} from './dateAxis';

describe('axisGrain', () => {
  it('reads the grain off the labels', () => {
    expect(axisGrain(['Q1 2025', 'Q2 2025', 'Q3 2025'])).toBe('quarter');
    expect(axisGrain(['Jan 2025', 'Feb 2025', 'Mar 2025'])).toBe('month');
    expect(axisGrain(['2023', '2024', '2025'])).toBe('year');
  });

  it('separates weeks from days by their step', () => {
    expect(axisGrain(['2025-07-07', '2025-07-14', '2025-07-21'])).toBe('week');
    expect(axisGrain(['2025-07-07', '2025-07-08', '2025-07-09'])).toBe('day');
  });

  it('leaves an undated axis alone', () => {
    expect(axisGrain(['North', 'South', 'East'])).toBeNull();
    expect(axisGrain(['Q1 2025'])).toBeNull();
  });

  it('survives one stray label, and stays at the finest grain named', () => {
    expect(axisGrain(['Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025', '2025'])).toBe('month');
    expect(axisGrain(['Jan 2025', 'Budget', 'Actual'])).toBeNull();
  });
});

describe('formatTickLabels', () => {
  it('writes the house form per grain', () => {
    expect(formatTickLabels(['Q2 2025', 'Q3 2025', 'Q4 2026']).labels).toEqual([
      '2Q25',
      '3Q25',
      '4Q26',
    ]);
    expect(formatTickLabels(['May 2024', 'Jun 2024']).labels).toEqual(['May-24', 'Jun-24']);
    expect(formatTickLabels(['2017', '2018']).labels).toEqual(["'17", "'18"]);
  });

  it('labels a week by the day it ends on', () => {
    // Mondays in, "week ending" Sundays out.
    const out = formatTickLabels(['2025-07-07', '2025-07-14', '2025-07-21']);
    expect(out.grain).toBe('week');
    expect(out.labels).toEqual(['7/13', '7/20', '7/27']);
    expect(DEFAULT_AXIS_TITLE.week).toBe('Week ending');
  });

  it('honors an override, and passes an undated axis through', () => {
    expect(formatTickLabels(['Q2 2025', 'Q3 2025'], "'Q'Q yyyy").labels).toEqual([
      'Q2 2025',
      'Q3 2025',
    ]);
    expect(formatTickLabels(['North', 'South'], 'MMM-yy').labels).toEqual(['North', 'South']);
  });

  it('leaves one undated label on a dated axis as it was typed', () => {
    // Four of five dated clears `looksDated`'s bar; the fifth keeps its word.
    const out = formatTickLabels(['Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025', 'Plan']);
    expect(out.labels).toEqual(['Jan-25', 'Feb-25', 'Mar-25', 'Apr-25', 'Plan']);
  });
});

describe('parseDatePattern', () => {
  it('accepts the think-cell spellings', () => {
    expect(parseDatePattern('MM-YY')).toBe('MM-yy');
    expect(parseDatePattern('MMM-yyyy')).toBe('MMM-yyyy');
    expect(parseDatePattern('DD.MM.YYYY')).toBe('dd.MM.yyyy');
  });

  it('keeps quoted literals', () => {
    expect(parseDatePattern("'FY'YY")).toBe("'FY'yy");
    expect(parseDatePattern("''YY")).toBe("''yy");
  });

  it('refuses what no tick could be written from', () => {
    expect(parseDatePattern('')).toBeNull();
    expect(parseDatePattern('--/--')).toBeNull();
    expect(parseDatePattern('Week')).toBeNull();
    expect(parseDatePattern("'FY")).toBeNull();
  });

  it('round-trips through the formatter', () => {
    expect(sampleTick('month', parseDatePattern('MMM-YY')!)).toBe('Apr-25');
    expect(sampleTick('quarter', "Q'Q'yy")).toBe('2Q25');
  });
});
