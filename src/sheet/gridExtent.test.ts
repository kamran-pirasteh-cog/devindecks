import { describe, expect, it } from 'vitest';
import { cellText, defaultChartSpec, sheetFromSpec, type SheetModel } from '@/model';
import { columnAt, gridExtent, isPhantom, materialize, seriesIndexAt } from './gridExtent';
import { insertSeries, setCell } from './sheetOps';

/**
 * A transposed category grid: 3 rows (one per segment) × 4 columns (the series
 * name plus FY23-25), and more periods can be added.
 */
const grid = (): SheetModel => sheetFromSpec(defaultChartSpec('column', 'stacked'));
/** 1 series, capped: a waterfall takes no more, but it does take rows. */
const waterfall = (): SheetModel => sheetFromSpec(defaultChartSpec('waterfall'));

describe('gridExtent', () => {
  it('renders past the data so there is somewhere to type', () => {
    const e = gridExtent(grid());
    expect(e.realRows).toBe(3);
    expect(e.rows).toBeGreaterThan(3);
    expect(e.cols).toBeGreaterThan(e.realCols);
  });

  it('pads out to the measured viewport when that is taller', () => {
    expect(gridExtent(grid(), { minRows: 60 }).rows).toBe(60);
    // ...but never shrinks below the data plus its trailing blanks.
    expect(gridExtent(grid(), { minRows: 1 }).rows).toBe(3 + 8);
  });

  it('offers no blank columns to a chart that cannot take another series', () => {
    const e = gridExtent(waterfall());
    expect(e.cols).toBe(e.realCols);
    expect(e.rows).toBeGreaterThan(e.realRows);
  });

  it('stops offering blank columns once the cap is reached', () => {
    const butterfly = sheetFromSpec(defaultChartSpec('butterfly'));
    // maxSeries 2, so the room left decides the count.
    const room = 2 - butterfly.series.length;
    const e = gridExtent(butterfly);
    expect(e.cols - e.realCols).toBe(room);
  });
});

describe('isPhantom', () => {
  it('is true past the last row or column and false inside', () => {
    const e = gridExtent(grid());
    expect(isPhantom(e, { r: 0, c: 0 })).toBe(false);
    expect(isPhantom(e, { r: 2, c: 3 })).toBe(false);
    expect(isPhantom(e, { r: 3, c: 0 })).toBe(true);
    expect(isPhantom(e, { r: 0, c: 4 })).toBe(true);
  });
});

describe('columnAt', () => {
  it('gives a blank column the schema template for the field it would hold', () => {
    const s = grid();
    const e = gridExtent(s);
    expect(columnAt(s, e, 0)?.type).toBe('text');
    // The next column's first (and only) field is a number, so the blank column
    // right-aligns and coerces like one before it exists.
    expect(columnAt(s, e, e.realCols)?.type).toBe('number');
  });

  it('keeps a multi-field schema in field order across blank columns', () => {
    const s = sheetFromSpec(defaultChartSpec('bubble'));
    const e = gridExtent(s);
    expect(e.perSeries).toBe(3);
    expect(columnAt(s, e, e.realCols)?.key).toBe('x');
    expect(columnAt(s, e, e.realCols + 1)?.key).toBe('y');
    expect(columnAt(s, e, e.realCols + 2)?.key).toBe('size');
  });
});

describe('materialize', () => {
  it('leaves a real cell alone', () => {
    const s = grid();
    const out = materialize(s, { r: 1, c: 1 });
    expect(out.sheet).toBe(s);
    expect(out.addr).toEqual({ r: 1, c: 1 });
  });

  it('appends one row however far down the blank area was clicked', () => {
    const s = grid();
    const out = materialize(s, { r: 9, c: 1 });
    // Not ten rows and five empty categories on the slide — one row, and the
    // address moves up to it.
    expect(out.sheet.rows).toHaveLength(4);
    expect(out.addr).toEqual({ r: 3, c: 1 });
    expect(cellText(out.sheet.rows[3][1])).toBe('');
  });

  it('appends to a chart with no rows to speak of', () => {
    const s = grid();
    const out = materialize(s, { r: 3, c: 1 });
    expect(out.sheet.rows).toHaveLength(4);
    expect(out.addr).toEqual({ r: 3, c: 1 });
  });

  it('grows a series for the first blank column', () => {
    const s = grid();
    const e = gridExtent(s);
    const out = materialize(s, { r: 0, c: e.realCols });
    expect(out.sheet.series).toHaveLength(s.series.length + 1);
    expect(out.addr).toEqual({ r: 0, c: e.realCols });
  });

  it('adds one series for any blank column, and lands the cursor on it', () => {
    const s = grid();
    const e = gridExtent(s);
    const out = materialize(s, { r: 0, c: e.realCols + 1 });
    expect(out.sheet.series).toHaveLength(s.series.length + 1);
    // The second blank slot collapses onto the first: one keystroke, one
    // column, no empty series in the legend.
    expect(out.addr.c).toBe(e.realCols);
    expect(out.sheet.columns[out.addr.c]?.seriesKey).toBe(out.sheet.series[3].key);
  });

  it('clamps instead of writing off the end when the caps forbid growing', () => {
    const s = waterfall();
    const out = materialize(s, { r: 0, c: s.columns.length + 1 });
    expect(out.sheet.series).toHaveLength(1);
    expect(out.addr.c).toBe(s.columns.length - 1);
  });

  it('grows a row and a column at once when the corner is typed into', () => {
    const s = grid();
    const e = gridExtent(s);
    const out = materialize(s, { r: 4, c: e.realCols });
    const col = out.sheet.columns[out.addr.c];
    expect(col?.seriesKey).toBe(out.sheet.series[out.sheet.series.length - 1].key);
    expect(out.sheet.rows).toHaveLength(4);
    expect(out.addr.r).toBe(3);
  });

  it('does not disturb the data it grows around', () => {
    const s = setCell(grid(), 0, 1, { kind: 'number', n: 42 });
    const out = materialize(s, { r: 6, c: gridExtent(s).realCols });
    expect(out.sheet.rows).toHaveLength(4);
    expect(cellText(out.sheet.rows[0][1])).toBe('42');
  });
});

describe('seriesIndexAt', () => {
  it('numbers blank column slots on from the last real series', () => {
    const s = grid();
    const e = gridExtent(s);
    expect(seriesIndexAt(s, e, 1)).toBe(0);
    expect(seriesIndexAt(s, e, e.realCols)).toBe(s.series.length);
    // Which is exactly the index "insert column right" of the last one uses.
    expect(insertSeries(s, seriesIndexAt(s, e, e.realCols)).series).toHaveLength(
      s.series.length + 1,
    );
  });
});
