import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysInMonth,
  fromEpochDay,
  fromIso,
  nextCell,
  startOf,
  toEpochDay,
  toIso,
} from '@/model';
import { bandCells, DEFAULT_BAND_FORMAT, formatDate, isoWeek, isWorkday } from './date';

describe('civil date <-> epoch day', () => {
  it('anchors the epoch on a Thursday', () => {
    expect(toEpochDay(1970, 1, 1)).toBe(0);
    expect(fromEpochDay(0)).toEqual({ y: 1970, m: 1, d: 1, dow: 4 });
  });

  it('round-trips every day from 1900 to 2100', () => {
    // ~73k days. Exhaustive rather than sampled: an off-by-one in the era shift
    // shows up on exactly one day a century.
    for (let day = toEpochDay(1900, 1, 1); day <= toEpochDay(2100, 12, 31); day++) {
      const c = fromEpochDay(day);
      expect(toEpochDay(c.y, c.m, c.d)).toBe(day);
    }
  });

  it('walks the day of week without gaps', () => {
    let prev = fromEpochDay(toEpochDay(2026, 1, 1)).dow;
    for (let day = toEpochDay(2026, 1, 2); day <= toEpochDay(2026, 12, 31); day++) {
      const dow = fromEpochDay(day).dow;
      expect(dow).toBe((prev + 1) % 7);
      prev = dow;
    }
  });

  it('handles leap days and the century rules', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(toEpochDay(2024, 3, 1) - toEpochDay(2024, 2, 1)).toBe(29);
    expect(toEpochDay(2023, 3, 1) - toEpochDay(2023, 2, 1)).toBe(28);
  });

  it('handles dates before the epoch', () => {
    expect(toEpochDay(1969, 12, 31)).toBe(-1);
    expect(fromEpochDay(-1)).toMatchObject({ y: 1969, m: 12, d: 31 });
  });

  it('rolls an out-of-range month into the next year', () => {
    expect(toEpochDay(2026, 13, 1)).toBe(toEpochDay(2027, 1, 1));
    expect(toEpochDay(2026, 0, 1)).toBe(toEpochDay(2025, 12, 1));
  });
});

describe('iso', () => {
  it('round-trips', () => {
    expect(toIso(toEpochDay(2026, 3, 9))).toBe('2026-03-09');
    expect(fromIso('2026-03-09')).toBe(toEpochDay(2026, 3, 9));
  });

  it('rejects a date that does not exist rather than rolling it over', () => {
    expect(fromIso('2026-02-31')).toBeNull();
    expect(fromIso('2026-13-01')).toBeNull();
    expect(fromIso('Q1 2026')).toBeNull();
    expect(fromIso('')).toBeNull();
  });
});

describe('addMonths', () => {
  it('clamps to the target month rather than overflowing', () => {
    expect(toIso(addMonths(toEpochDay(2026, 1, 31), 1))).toBe('2026-02-28');
    expect(toIso(addMonths(toEpochDay(2024, 1, 31), 1))).toBe('2024-02-29');
    expect(toIso(addMonths(toEpochDay(2026, 12, 15), 1))).toBe('2027-01-15');
    expect(toIso(addMonths(toEpochDay(2026, 1, 15), -1))).toBe('2025-12-15');
  });
});

describe('formatDate', () => {
  const day = toEpochDay(2026, 4, 3); // a Friday

  it('renders every token', () => {
    expect(formatDate(day, 'yyyy')).toBe('2026');
    expect(formatDate(day, 'yy')).toBe('26');
    expect(formatDate(day, 'MMMM')).toBe('April');
    expect(formatDate(day, 'MMM')).toBe('Apr');
    expect(formatDate(day, 'MM')).toBe('04');
    expect(formatDate(day, 'M')).toBe('4');
    expect(formatDate(day, 'dd')).toBe('03');
    expect(formatDate(day, 'd')).toBe('3');
    expect(formatDate(day, 'EEEE')).toBe('Friday');
    expect(formatDate(day, 'EEE')).toBe('Fri');
    expect(formatDate(day, 'EE')).toBe('Fr');
    expect(formatDate(day, 'QQ')).toBe('Q2');
    expect(formatDate(day, 'Q')).toBe('2');
    expect(formatDate(day, 'HH')).toBe('H1');
    expect(formatDate(toEpochDay(2026, 7, 1), 'HH')).toBe('H2');
  });

  it('treats single quotes as literals, and doubled ones as an apostrophe', () => {
    expect(formatDate(day, "d MMM ''yy")).toBe("3 Apr '26");
    expect(formatDate(day, "'Q'Q 'of' yyyy")).toBe('Q2 of 2026');
  });

  it('passes unrecognised characters through', () => {
    expect(formatDate(day, 'MMM d, yyyy')).toBe('Apr 3, 2026');
  });

  it('matches the longest token first', () => {
    // "MMMM" must not be read as "MMM" + "M".
    expect(formatDate(day, 'MMMM')).not.toContain('4');
  });
});

describe('isoWeek', () => {
  it('puts 4 January in week 1', () => {
    expect(isoWeek(toEpochDay(2026, 1, 4)).week).toBe(1);
  });

  it('carries the last days of December into the next ISO year', () => {
    // 2025-12-29 is a Monday; its Thursday falls in 2026.
    expect(isoWeek(toEpochDay(2025, 12, 29))).toEqual({ week: 1, year: 2026 });
  });
});

describe('startOf / nextCell', () => {
  const d = toEpochDay(2026, 5, 20); // a Wednesday

  it('snaps down to each grain', () => {
    expect(toIso(startOf('year', d))).toBe('2026-01-01');
    expect(toIso(startOf('half', d))).toBe('2026-01-01');
    expect(toIso(startOf('quarter', d))).toBe('2026-04-01');
    expect(toIso(startOf('month', d))).toBe('2026-05-01');
    expect(toIso(startOf('week', d))).toBe('2026-05-18'); // Monday
    expect(toIso(startOf('week', d, 0))).toBe('2026-05-17'); // Sunday
    expect(toIso(startOf('day', d))).toBe('2026-05-20');
  });

  it('advances to the next cell', () => {
    expect(toIso(nextCell('quarter', d))).toBe('2026-07-01');
    expect(toIso(nextCell('half', d))).toBe('2026-07-01');
    expect(toIso(nextCell('month', d))).toBe('2026-06-01');
    expect(toIso(nextCell('week', d))).toBe('2026-05-25');
  });
});

describe('bandCells', () => {
  const from = toEpochDay(2026, 2, 10);
  const to = toEpochDay(2026, 5, 1);

  it('clips the first and last cell rather than dropping them', () => {
    const cells = bandCells('month', from, to);
    expect(cells.map((c) => c.label)).toEqual(['Feb', 'Mar', 'Apr']);
    expect(cells[0].from).toBe(from);
    expect(toIso(cells[0].cellFrom)).toBe('2026-02-01');
    expect(cells[cells.length - 1].to).toBe(to);
  });

  it('tiles the range with no gaps or overlaps', () => {
    for (const grain of ['year', 'quarter', 'month', 'week', 'day'] as const) {
      const cells = bandCells(grain, from, to);
      expect(cells[0].from).toBe(from);
      expect(cells[cells.length - 1].to).toBe(to);
      for (let i = 1; i < cells.length; i++) expect(cells[i].from).toBe(cells[i - 1].to);
    }
  });

  it('lands a quarter boundary exactly', () => {
    const cells = bandCells('quarter', toEpochDay(2026, 1, 1), toEpochDay(2026, 7, 1));
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.label)).toEqual(["Q1 '26", "Q2 '26"]);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(bandCells('month', 100, 100)).toEqual([]);
    expect(bandCells('month', 200, 100)).toEqual([]);
  });

  it('has a house format for every grain', () => {
    for (const grain of ['year', 'half', 'quarter', 'month', 'week', 'day'] as const) {
      expect(DEFAULT_BAND_FORMAT[grain]).toBeTruthy();
      expect(bandCells(grain, from, to)[0].label).not.toBe('');
    }
  });
});

describe('isWorkday', () => {
  it('excludes the weekend by default', () => {
    expect(isWorkday(toEpochDay(2026, 4, 3))).toBe(true); // Friday
    expect(isWorkday(toEpochDay(2026, 4, 4))).toBe(false); // Saturday
    expect(isWorkday(toEpochDay(2026, 4, 5))).toBe(false); // Sunday
  });

  it('honours a named working week', () => {
    expect(isWorkday(toEpochDay(2026, 4, 5), [0, 1, 2, 3, 4])).toBe(true);
  });
});
