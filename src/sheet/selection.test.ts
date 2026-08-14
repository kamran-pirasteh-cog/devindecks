import { describe, expect, it } from 'vitest';
import { defaultChartSpec, sheetFromSpec, type SheetModel } from '@/model';
import { setCell } from './sheetOps';
import {
  advance,
  isSingleCell,
  move,
  reconcileSelection,
  selectColumn,
  selectRow,
  singleCell,
} from './selection';

const sheet = (): SheetModel => sheetFromSpec(defaultChartSpec('column', 'stacked'));
// 3 rows (FY23-25) x 4 columns (Date + 3 series).

describe('move', () => {
  it('steps one cell and clamps at the edges', () => {
    const s = sheet();
    expect(move(s, singleCell({ r: 0, c: 0 }), 'right').active).toEqual({ r: 0, c: 1 });
    expect(move(s, singleCell({ r: 0, c: 0 }), 'up').active).toEqual({ r: 0, c: 0 });
    expect(move(s, singleCell({ r: 2, c: 3 }), 'down').active).toEqual({ r: 2, c: 3 });
  });

  it('shift+arrow grows the block and leaves the anchor put', () => {
    const s = sheet();
    const sel = move(s, singleCell({ r: 0, c: 1 }), 'down', { extend: true });
    expect(sel.range.anchor).toEqual({ r: 0, c: 1 });
    expect(sel.range.focus).toEqual({ r: 1, c: 1 });
    expect(sel.active).toEqual({ r: 0, c: 1 });
    expect(isSingleCell(sel)).toBe(false);
  });

  it('cmd+arrow runs to the last filled cell', () => {
    const s = sheet();
    expect(move(s, singleCell({ r: 0, c: 1 }), 'down', { toEdge: true }).active).toEqual({
      r: 2,
      c: 1,
    });
  });

  it('cmd+arrow stops before a gap rather than running to the edge', () => {
    const s = setCell(sheet(), 1, 1, { kind: 'empty' });
    expect(move(s, singleCell({ r: 0, c: 1 }), 'down', { toEdge: true }).active).toEqual({
      r: 0,
      c: 1,
    });
  });

  it('cmd+arrow from a gap jumps to the next filled cell', () => {
    const s = setCell(setCell(sheet(), 0, 1, { kind: 'empty' }), 1, 1, { kind: 'empty' });
    expect(move(s, singleCell({ r: 0, c: 1 }), 'down', { toEdge: true }).active).toEqual({
      r: 2,
      c: 1,
    });
  });
});

describe('advance', () => {
  it('Tab steps right and wraps to the next row', () => {
    const s = sheet();
    expect(advance(s, singleCell({ r: 0, c: 3 }), 'horizontal').active).toEqual({ r: 1, c: 0 });
  });

  it('Shift+Tab steps back and wraps to the previous row', () => {
    const s = sheet();
    expect(advance(s, singleCell({ r: 1, c: 0 }), 'horizontal', true).active).toEqual({ r: 0, c: 3 });
  });

  it('Enter steps down', () => {
    const s = sheet();
    expect(advance(s, singleCell({ r: 0, c: 2 }), 'vertical').active).toEqual({ r: 1, c: 2 });
  });

  it('cycles WITHIN a selected block instead of leaving it', () => {
    const s = sheet();
    const block = { active: { r: 0, c: 1 }, range: { anchor: { r: 0, c: 1 }, focus: { r: 1, c: 2 } } };
    // Across the two-wide block, then wrap onto the next row of the block.
    const a = advance(s, block, 'horizontal');
    expect(a.active).toEqual({ r: 0, c: 2 });
    const b = advance(s, a, 'horizontal');
    expect(b.active).toEqual({ r: 1, c: 1 });
    // The block itself never moves.
    expect(b.range).toEqual(block.range);
  });

  it('wraps around the end of a block back to its start', () => {
    const s = sheet();
    const block = { active: { r: 1, c: 2 }, range: { anchor: { r: 0, c: 1 }, focus: { r: 1, c: 2 } } };
    expect(advance(s, block, 'horizontal').active).toEqual({ r: 0, c: 1 });
  });

  it('cycles down-then-across for Enter inside a block', () => {
    const s = sheet();
    const block = { active: { r: 1, c: 1 }, range: { anchor: { r: 0, c: 1 }, focus: { r: 1, c: 2 } } };
    expect(advance(s, block, 'vertical').active).toEqual({ r: 0, c: 2 });
  });
});

describe('the blank area past the data', () => {
  // The grid renders further than the model does (see gridExtent), and passes
  // that extent in; these are the cases where forgetting to would strand the
  // cursor on the last real cell.
  const extent = { rows: 20, cols: 6 };

  it('lets an arrow key step past the last row and column', () => {
    const s = sheet();
    expect(move(s, singleCell({ r: 2, c: 3 }), 'down', { extent }).active).toEqual({ r: 3, c: 3 });
    expect(move(s, singleCell({ r: 2, c: 3 }), 'right', { extent }).active).toEqual({ r: 2, c: 4 });
  });

  it('still clamps at the end of the blank area', () => {
    const s = sheet();
    expect(move(s, singleCell({ r: 19, c: 5 }), 'down', { extent }).active).toEqual({ r: 19, c: 5 });
  });

  it('wraps Tab at the far edge of the blank area, not of the data', () => {
    const s = sheet();
    expect(advance(s, singleCell({ r: 0, c: 5 }), 'horizontal', false, extent).active).toEqual({
      r: 1,
      c: 0,
    });
  });

  it('keeps a selection sitting in the blank area where it is', () => {
    const s = sheet();
    const sel = singleCell({ r: 8, c: 5 });
    expect(reconcileSelection(s, sel, extent).active).toEqual({ r: 8, c: 5 });
    // ...and without the extent it would be dragged back onto the data.
    expect(reconcileSelection(s, sel).active).toEqual({ r: 2, c: 3 });
  });

  it('selects a whole row or column across the blank area', () => {
    const s = sheet();
    expect(selectRow(s, 7, extent).range.focus).toEqual({ r: 7, c: 5 });
    expect(selectColumn(s, 5, extent).range.focus).toEqual({ r: 19, c: 5 });
  });
});

describe('reconcileSelection', () => {
  it('pulls a selection back inside a sheet that shrank', () => {
    const s = sheet();
    const sel = reconcileSelection(s, singleCell({ r: 99, c: 99 }));
    expect(sel.active).toEqual({ r: 2, c: 3 });
  });
});
