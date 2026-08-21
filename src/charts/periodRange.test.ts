import { describe, expect, it } from 'vitest';
import {
  cellCount,
  cellLabel,
  cellOptions,
  currentCell,
  endsOnCurrent,
  midCell,
  rangeEndingAt,
  shiftCells,
  snap,
  MAX_CELLS,
} from './periodRange';

const AS_OF = '2026-08-21';

describe('snap', () => {
  it('moves a date to the start of its cell, so two clicks in one period agree', () => {
    expect(snap('quarter', '2026-08-21')).toBe('2026-07-01');
    expect(snap('quarter', '2026-09-30')).toBe('2026-07-01');
    expect(snap('month', '2026-08-21')).toBe('2026-08-01');
    expect(snap('year', '2026-08-21')).toBe('2026-01-01');
  });

  it('snaps a week to its Monday, which is what a weekly axis means', () => {
    // 2026-08-21 is a Friday.
    expect(snap('week', '2026-08-21')).toBe('2026-08-17');
    expect(snap('week', '2026-08-17')).toBe('2026-08-17');
  });

  it('leaves a day alone', () => {
    expect(snap('day', '2026-08-21')).toBe('2026-08-21');
  });
});

describe('shiftCells', () => {
  it('steps forward and back by whole cells', () => {
    expect(shiftCells('quarter', '2026-07-01', 1)).toBe('2026-10-01');
    expect(shiftCells('quarter', '2026-07-01', -1)).toBe('2026-04-01');
    expect(shiftCells('year', '2026-01-01', -3)).toBe('2023-01-01');
  });

  it('crosses a year boundary in either direction', () => {
    expect(shiftCells('quarter', '2026-01-01', -1)).toBe('2025-10-01');
    expect(shiftCells('month', '2026-12-01', 2)).toBe('2027-02-01');
  });

  it('steps back by real months rather than by an average length', () => {
    // A fixed 30 days would land in the wrong month for February and for the
    // 31-day months either side of it.
    expect(shiftCells('month', '2026-03-01', -1)).toBe('2026-02-01');
    expect(shiftCells('month', '2026-03-01', -2)).toBe('2026-01-01');
  });

  it('is a no-op for zero', () => {
    expect(shiftCells('week', '2026-08-17', 0)).toBe('2026-08-17');
  });
});

describe('cellCount', () => {
  it('counts both ends', () => {
    expect(cellCount('quarter', { from: '2026-07-01', to: '2026-07-01' })).toBe(1);
    expect(cellCount('quarter', { from: '2026-01-01', to: '2026-10-01' })).toBe(4);
    expect(cellCount('year', { from: '2024-01-01', to: '2026-01-01' })).toBe(3);
  });

  it('counts the cells a range TOUCHES, whatever days it was given', () => {
    // Mid-period dates snap outward, so every period the author picked is in.
    expect(cellCount('quarter', { from: '2026-02-14', to: '2026-08-21' })).toBe(3);
  });

  it('returns zero for a range the wrong way round rather than silently drawing one', () => {
    expect(cellCount('quarter', { from: '2026-10-01', to: '2026-01-01' })).toBe(0);
  });

  it('stops at the hard bound instead of running away on a day range', () => {
    expect(cellCount('day', { from: '2020-01-01', to: '2026-01-01' })).toBe(MAX_CELLS);
  });
});

describe('rangeEndingAt', () => {
  it('builds a span of the count asked for', () => {
    const r = rangeEndingAt('quarter', AS_OF, 8);
    expect(cellCount('quarter', r)).toBe(8);
    expect(cellLabel('quarter', r.to)).toBe("Q3'26");
    expect(cellLabel('quarter', r.from)).toBe("Q4'24");
  });

  it('treats a count of one as a single period', () => {
    const r = rangeEndingAt('month', AS_OF, 1);
    expect(r.from).toBe(r.to);
  });

  it('never produces an empty range, whatever it is asked for', () => {
    expect(cellCount('year', rangeEndingAt('year', AS_OF, 0))).toBe(1);
    expect(cellCount('year', rangeEndingAt('year', AS_OF, -5))).toBe(1);
  });
});

describe('cellLabel', () => {
  it('spells a cell exactly as the axis does', () => {
    expect(cellLabel('quarter', '2026-07-01')).toBe("Q3'26");
    expect(cellLabel('month', '2026-08-01')).toBe('Aug 2026');
    expect(cellLabel('year', '2026-01-01')).toBe('2026');
    // Weeks and days both land on a real date; the label is the week beginning.
    expect(cellLabel('week', '2026-08-17')).toBe('2026-08-17');
  });

  it('labels any day in a cell as that cell', () => {
    expect(cellLabel('quarter', '2026-09-30')).toBe("Q3'26");
  });
});

describe('midCell', () => {
  it('lands between the ends, for a three-marker dot plot', () => {
    const r = rangeEndingAt('year', AS_OF, 5);
    expect(cellLabel('year', r.from)).toBe('2022');
    expect(cellLabel('year', midCell('year', r))).toBe('2024');
    expect(cellLabel('year', r.to)).toBe('2026');
  });

  it('is the start itself when there is nothing in between', () => {
    const r = rangeEndingAt('year', AS_OF, 2);
    expect(midCell('year', r)).toBe(r.from);
  });
});

describe('endsOnCurrent', () => {
  it('is a fact about the range rather than a setting somebody ticked', () => {
    expect(endsOnCurrent('quarter', rangeEndingAt('quarter', AS_OF, 4), AS_OF)).toBe(true);
    const earlier = rangeEndingAt('quarter', shiftCells('quarter', AS_OF, -1), 4);
    expect(endsOnCurrent('quarter', earlier, AS_OF)).toBe(false);
  });

  it('goes false on its own once the deck is a period out of date', () => {
    // The same chart, read six months later. Nothing was edited, and the answer
    // changed — which is the point of storing the ends.
    const range = rangeEndingAt('quarter', AS_OF, 4);
    expect(endsOnCurrent('quarter', range, AS_OF)).toBe(true);
    expect(endsOnCurrent('quarter', range, '2027-02-14')).toBe(false);
  });
});

describe('cellOptions', () => {
  it('offers a window either side of today, oldest first', () => {
    const opts = cellOptions('year', AS_OF);
    expect(opts[0].label).toBe('2020');
    expect(opts[opts.length - 1].label).toBe('2028');
    expect(opts.map((o) => o.label)).toContain('2026');
  });

  it('labels quarters as quarters', () => {
    const opts = cellOptions('quarter', AS_OF);
    expect(opts.some((o) => o.label === "Q3'26")).toBe(true);
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length);
  });
});

describe('currentCell', () => {
  it('is the cell today falls in', () => {
    expect(cellLabel('quarter', currentCell('quarter', AS_OF))).toBe("Q3'26");
    expect(cellLabel('month', currentCell('month', AS_OF))).toBe('Aug 2026');
  });
});
