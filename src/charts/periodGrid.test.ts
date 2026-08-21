import { describe, expect, it } from 'vitest';
import {
  cellsInYear,
  monthDays,
  monthTitle,
  monthsOfYear,
  shiftMonths,
  shiftYears,
} from './periodGrid';

describe('monthDays', () => {
  it('is always six weeks, so the popover keeps its height', () => {
    for (const iso of ['2026-02-01', '2026-07-14', '2027-05-31', '2024-09-01']) {
      expect(monthDays(iso)).toHaveLength(42);
    }
  });

  it('starts on the Monday of the week the first falls in', () => {
    // 1 Jul 2026 is a Wednesday, so the grid opens on Monday 29 Jun.
    const grid = monthDays('2026-07-20');
    expect(grid[0]).toEqual({ iso: '2026-06-29', day: 29, inMonth: false });
    expect(grid[2]).toEqual({ iso: '2026-07-01', day: 1, inMonth: true });
  });

  it('marks the spill either side as out of month but keeps it clickable', () => {
    const grid = monthDays('2026-07-01');
    const inMonth = grid.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0]!.iso).toBe('2026-07-01');
    expect(inMonth.at(-1)!.iso).toBe('2026-07-31');
    // Every cell has a date, in month or not.
    expect(grid.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.iso))).toBe(true);
  });

  it('knows February in a leap year from February in a common one', () => {
    expect(monthDays('2024-02-10').filter((d) => d.inMonth)).toHaveLength(29);
    expect(monthDays('2026-02-10').filter((d) => d.inMonth)).toHaveLength(28);
  });

  it('runs in unbroken day order', () => {
    const grid = monthDays('2026-01-15');
    const days = grid.map((d) => Date.parse(`${d.iso}T00:00:00Z`) / 86_400_000);
    expect(days.every((d, i) => i === 0 || d === days[i - 1]! + 1)).toBe(true);
  });

  it('returns nothing for an unreadable date, rather than a grid of 1970', () => {
    expect(monthDays('July 2026')).toEqual([]);
  });
});

describe('monthsOfYear', () => {
  it('is twelve first-of-months in the year given', () => {
    const months = monthsOfYear('2026-07-14');
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ iso: '2026-01-01', label: 'Jan' });
    expect(months[11]).toEqual({ iso: '2026-12-01', label: 'Dec' });
  });
});

describe('monthTitle', () => {
  it('reads as the header of a calendar', () => {
    expect(monthTitle('2026-07-14')).toBe('Jul 2026');
    expect(monthTitle('2026-12-31')).toBe('Dec 2026');
  });
});

describe('shifting', () => {
  it('steps months and clamps to the shorter one', () => {
    expect(shiftMonths('2026-07-14', 1)).toBe('2026-08-14');
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonths('2026-01-01', -1)).toBe('2025-12-01');
  });

  it('steps years, February included', () => {
    expect(shiftYears('2026-07-01', -2)).toBe('2024-07-01');
    expect(shiftYears('2024-02-29', 1)).toBe('2025-02-28');
  });
});

describe('cellsInYear', () => {
  it('is the four quarter starts of the year given', () => {
    expect(cellsInYear('quarter', '2026-08-14')).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ]);
  });

  it('is the two half starts', () => {
    expect(cellsInYear('half', '2026-12-31')).toEqual(['2026-01-01', '2026-07-01']);
  });

  it('is twelve months, matching the month grid', () => {
    expect(cellsInYear('month', '2026-03-03')).toEqual(monthsOfYear('2026-03-03').map((m) => m.iso));
  });
});
