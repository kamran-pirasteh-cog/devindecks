import { describe, expect, it } from 'vitest';
import { defaultChartSpec, sheetFromSpec, type SheetModel } from '@/model';
import { setCell } from './sheetOps';
import { advance, isSingleCell, move, reconcileSelection, singleCell } from './selection';

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

describe('reconcileSelection', () => {
  it('pulls a selection back inside a sheet that shrank', () => {
    const s = sheet();
    const sel = reconcileSelection(s, singleCell({ r: 99, c: 99 }));
    expect(sel.active).toEqual({ r: 2, c: 3 });
  });
});
