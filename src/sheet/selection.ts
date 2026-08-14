/**
 * Grid selection and navigation, as pure functions.
 *
 * Kept out of the component so the fiddly parts — where ⌘→ lands, how Tab
 * cycles inside a selected block — are testable without a DOM. These are the
 * behaviours people notice immediately when they're wrong and never think
 * about when they're right.
 */
import { rangeBounds, type CellAddress, type CellRange, type SheetModel } from '@/model';

export interface SheetSelection {
  active: CellAddress;
  range: CellRange;
}

export const singleCell = (addr: CellAddress): SheetSelection => ({
  active: addr,
  range: { anchor: addr, focus: addr },
});

export const isSingleCell = (sel: SheetSelection): boolean => {
  const { r0, r1, c0, c1 } = rangeBounds(sel.range);
  return r0 === r1 && c0 === c1;
};

export type Direction = 'up' | 'down' | 'left' | 'right';

const DELTA: Record<Direction, { dr: number; dc: number }> = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

const clamp = (n: number, hi: number) => Math.max(0, Math.min(hi, n));

const bounds = (sheet: SheetModel) => ({
  maxR: Math.max(0, sheet.rows.length - 1),
  maxC: Math.max(0, sheet.columns.length - 1),
});

export function move(
  sheet: SheetModel,
  sel: SheetSelection,
  dir: Direction,
  opts: { extend?: boolean; toEdge?: boolean } = {},
): SheetSelection {
  const { maxR, maxC } = bounds(sheet);
  const { dr, dc } = DELTA[dir];
  const from = opts.extend ? sel.range.focus : sel.active;

  const next: CellAddress = opts.toEdge
    ? edgeFrom(sheet, from, dir)
    : { r: clamp(from.r + dr, maxR), c: clamp(from.c + dc, maxC) };

  // Extending keeps the anchor put: shift+arrow grows the block from where the
  // selection started, it doesn't drag the whole block along.
  return opts.extend
    ? { active: sel.active, range: { anchor: sel.range.anchor, focus: next } }
    : singleCell(next);
}

/**
 * ⌘→ jumps to the last cell before a gap, or to the edge if there is none —
 * Excel's behaviour, and the only fast way to reach the end of a long column.
 */
function edgeFrom(sheet: SheetModel, from: CellAddress, dir: Direction): CellAddress {
  const { maxR, maxC } = bounds(sheet);
  const { dr, dc } = DELTA[dir];
  const filled = (r: number, c: number) => (sheet.rows[r]?.[c]?.kind ?? 'empty') !== 'empty';

  let { r, c } = from;
  const startFilled = filled(r, c);
  for (;;) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr > maxR || nc < 0 || nc > maxC) break;
    // From a filled cell: run to the last filled one. From an empty cell: run
    // to the first filled one.
    if (startFilled && !filled(nr, nc)) break;
    r = nr;
    c = nc;
    if (!startFilled && filled(r, c)) break;
  }
  return { r, c };
}

/**
 * Where Tab or Enter goes.
 *
 * Inside a multi-cell selection it cycles within the block and the block stays
 * put — that's what makes "select a column, type down it" work. Outside one it
 * just steps, wrapping at the end of a row.
 */
export function advance(
  sheet: SheetModel,
  sel: SheetSelection,
  axis: 'horizontal' | 'vertical',
  back = false,
): SheetSelection {
  const { maxR, maxC } = bounds(sheet);

  if (!isSingleCell(sel)) {
    const { r0, r1, c0, c1 } = rangeBounds(sel.range);
    const w = c1 - c0 + 1;
    const h = r1 - r0 + 1;
    const index =
      axis === 'horizontal'
        ? (sel.active.r - r0) * w + (sel.active.c - c0)
        : (sel.active.c - c0) * h + (sel.active.r - r0);
    const total = w * h;
    const nextIndex = (index + (back ? -1 : 1) + total) % total;
    const active =
      axis === 'horizontal'
        ? { r: r0 + Math.floor(nextIndex / w), c: c0 + (nextIndex % w) }
        : { r: r0 + (nextIndex % h), c: c0 + Math.floor(nextIndex / h) };
    return { active, range: sel.range };
  }

  const { r, c } = sel.active;
  if (axis === 'vertical') {
    return singleCell({ r: clamp(r + (back ? -1 : 1), maxR), c });
  }
  const nc = c + (back ? -1 : 1);
  if (nc > maxC) return singleCell({ r: clamp(r + 1, maxR), c: 0 });
  if (nc < 0) return singleCell({ r: clamp(r - 1, maxR), c: maxC });
  return singleCell({ r, c: nc });
}

/** Clamp a selection back inside a sheet that just shrank. */
export function reconcileSelection(sheet: SheetModel, sel: SheetSelection): SheetSelection {
  const { maxR, maxC } = bounds(sheet);
  const fix = (a: CellAddress): CellAddress => ({ r: clamp(a.r, maxR), c: clamp(a.c, maxC) });
  return {
    active: fix(sel.active),
    range: { anchor: fix(sel.range.anchor), focus: fix(sel.range.focus) },
  };
}

/** Select whole rows or columns, for the gutter and header clicks. */
export const selectRow = (sheet: SheetModel, r: number): SheetSelection => ({
  active: { r, c: 0 },
  range: { anchor: { r, c: 0 }, focus: { r, c: Math.max(0, sheet.columns.length - 1) } },
});

export const selectColumn = (sheet: SheetModel, c: number): SheetSelection => ({
  active: { r: 0, c },
  range: { anchor: { r: 0, c }, focus: { r: Math.max(0, sheet.rows.length - 1), c } },
});
