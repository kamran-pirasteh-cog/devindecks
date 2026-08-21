import { describe, expect, it } from 'vitest';
import {
  groupBounds,
  groupMemberBox,
  groupMemberRect,
  groupScaleFactor,
  individualBox,
  resizeFactor,
} from './groupResize';
import { occupiedRect, rotatedBounds } from '@/model';

describe('resizeFactor', () => {
  it('scales by the live size when Moveable measures the box correctly', () => {
    expect(resizeFactor(200, 150, -50)).toBeCloseTo(0.75);
    expect(resizeFactor(200, 400, 200)).toBeCloseTo(2);
  });

  it('falls back to the delta when the live size comes back 0', () => {
    // The chart case: a group holding a chart reports height 0 every frame.
    expect(resizeFactor(200, 0, -50)).toBeCloseTo(0.75);
    expect(resizeFactor(200, 0, 100)).toBeCloseTo(1.5);
  });

  it('holds the axis still rather than collapsing it', () => {
    // Neither a size nor a delta that can be believed.
    expect(resizeFactor(200, 0, -200)).toBe(1);
    expect(resizeFactor(200, 0, -400)).toBe(1);
    expect(resizeFactor(0, 0, 50)).toBe(1);
  });
});

describe('individualBox', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  const b = { x: 400, y: 200, w: 200, h: 100 };

  it('holds each object where it is instead of spreading them apart', () => {
    // The `se` handle on `a`, dragged to double its width: `b` doubles too, but
    // about its OWN left edge — a group resize would have pushed it right.
    expect(individualBox(b, 2, 1, 1, 1, false)).toEqual({ x: 400, y: 200, w: 400, h: 100 });
    expect(individualBox(a, 2, 1, 1, 1, false)).toEqual({ x: 0, y: 0, w: 200, h: 50 });
  });

  it('anchors on the edge opposite the handle', () => {
    // `nw`: the bottom-right corner of each object is what stays put.
    const out = individualBox(b, 0.5, 0.5, -1, -1, false);
    expect(out.x + out.w).toBe(600);
    expect(out.y + out.h).toBe(300);
  });

  it('grows about each centre on an edge handle and on a ⌘ resize', () => {
    // `e` handle: no say on the vertical, so height is untouched and centred.
    expect(individualBox(b, 2, 1, 1, 0, false)).toEqual({ x: 400, y: 200, w: 400, h: 100 });
    expect(individualBox(b, 2, 2, 1, 1, true)).toEqual({ x: 300, y: 150, w: 400, h: 200 });
  });

  it('keeps a line a line and everything else grabbable', () => {
    expect(individualBox({ x: 0, y: 10, w: 300, h: 0 }, 0.5, 0.5, 1, 1, false).h).toBe(0);
    expect(individualBox(a, 0.001, 0.001, 1, 1, false)).toMatchObject({ w: 4, h: 4 });
  });
});

describe('groupScaleFactor', () => {
  it('turns an absolute step into the factor the box ended up with', () => {
    expect(groupScaleFactor(300, 100, 10)).toBeCloseTo(4 / 3, 6);
    expect(groupScaleFactor(300, -100, 10)).toBeCloseTo(2 / 3, 6);
  });

  it('holds the axis still when there is nothing to scale', () => {
    expect(groupScaleFactor(0, 100, 10)).toBe(1);
  });

  it('stops at the floor rather than inverting the box', () => {
    expect(groupScaleFactor(100, -400, 10)).toBeCloseTo(0.1, 6);
  });
});

describe('groupMemberRect', () => {
  const origin = { x: 100, y: 100 };

  it('scales the offset from the origin as well as the size', () => {
    const r = groupMemberRect(origin, { x: 200, y: 100, w: 50, h: 50 }, 2, 1);
    expect(r).toEqual({ x: 300, y: 100, w: 100, h: 50 });
  });

  it('leaves an object sitting on the origin where it is', () => {
    const r = groupMemberRect(origin, { x: 100, y: 100, w: 50, h: 50 }, 2, 2);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
  });

  it('keeps a line flat on its cross axis', () => {
    expect(groupMemberRect(origin, { x: 100, y: 100, w: 200, h: 0 }, 2, 2).h).toBe(0);
  });

  it('never rounds a member away to nothing', () => {
    expect(groupMemberRect(origin, { x: 100, y: 100, w: 4, h: 4 }, 0.01, 0.01).w).toBe(1);
  });
});

describe('rotatedBounds', () => {
  it('leaves an upright box alone', () => {
    expect(rotatedBounds({ x: 10, y: 20, w: 100, h: 40 }, 0)).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 40,
    });
  });

  it('swaps the axes of a quarter turn, about the same centre', () => {
    const b = rotatedBounds({ x: 0, y: 0, w: 100, h: 40 }, 90);
    expect(b.w).toBeCloseTo(40, 6);
    expect(b.h).toBeCloseTo(100, 6);
    expect(b.x + b.w / 2).toBeCloseTo(50, 6);
    expect(b.y + b.h / 2).toBeCloseTo(20, 6);
  });

  it('is the same box whichever way the object leans', () => {
    expect(rotatedBounds({ x: 0, y: 0, w: 100, h: 40 }, 30)).toEqual(
      rotatedBounds({ x: 0, y: 0, w: 100, h: 40 }, -30),
    );
  });
});

describe('groupBounds', () => {
  it('wraps what a rotated member occupies, not its own box', () => {
    // A 90°-turned 100×40 text box occupies 40×100 — the group has to reach
    // past the member's height or Moveable's box disagrees with ours and the
    // first frame of a resize starts from a factor that isn't 1.
    const g = groupBounds([{ x: 0, y: 0, w: 100, h: 40, rotation: 90 }])!;
    expect(g.x0).toBeCloseTo(30, 6);
    expect(g.x1).toBeCloseTo(70, 6);
    expect(g.y0).toBeCloseTo(-30, 6);
    expect(g.y1).toBeCloseTo(70, 6);
  });

  it('unions upright members exactly as the plain rects do', () => {
    const g = groupBounds([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 200, y: 100, w: 100, h: 50 },
    ])!;
    expect(g).toEqual({ x0: 0, x1: 300, y0: 0, y1: 150 });
  });

  it('floors each member the way the DOM does', () => {
    const g = groupBounds([{ x: 0, y: 0, w: 300, h: 0 }], (n) => Math.max(n, 1))!;
    expect(g.y1).toBe(1);
  });

  it('has no bounds for an empty selection', () => {
    expect(groupBounds([])).toBeNull();
  });
});

describe('groupMemberBox', () => {
  it('matches top-left scaling for an upright member', () => {
    // The behaviour this replaced, unchanged where rotation isn't involved.
    expect(groupMemberBox({ x: 200, y: 100, w: 50, h: 50 }, 2, 1, 100, 100)).toEqual({
      x: 300,
      y: 100,
      w: 100,
      h: 50,
    });
  });

  it('scales a rotated member about its centre, keeping it on the grid', () => {
    // Two boxes of the same size and centre, one turned: the resize has to put
    // both centres in the same place, or the turned one drifts out of the group.
    const upright = { x: 100, y: 100, w: 100, h: 40 };
    const a = groupMemberBox(upright, 2, 2, 0, 0);
    expect(a.x + a.w / 2).toBeCloseTo(300, 6);
    expect(a.y + a.h / 2).toBeCloseTo(240, 6);
  });

  it('keeps a line a line and everything else grabbable', () => {
    expect(groupMemberBox({ x: 0, y: 10, w: 300, h: 0 }, 0.5, 0.5, 0, 0).h).toBe(0);
    expect(groupMemberBox({ x: 0, y: 0, w: 100, h: 50 }, 0.001, 0.001, 0, 0)).toMatchObject({
      w: 4,
      h: 4,
    });
  });
});

describe('occupiedRect', () => {
  const el = (id: string, rect: { x: number; y: number; w: number; h: number }, rotation = 0) =>
    ({ id, kind: 'shape', rect, rotation }) as never;

  it('reaches past a rotated member, so a group step grows the drawn box', () => {
    const els = [el('a', { x: 0, y: 0, w: 100, h: 40 }, 90), el('b', { x: 200, y: 0, w: 50, h: 50 })];
    expect(occupiedRect(els, ['a', 'b'])).toEqual({ x: 30, y: -30, w: 220, h: 100 });
  });

  it('is the plain union when nothing is turned', () => {
    const els = [el('a', { x: 0, y: 0, w: 100, h: 40 }), el('b', { x: 200, y: 0, w: 50, h: 50 })];
    expect(occupiedRect(els, ['a', 'b'])).toEqual({ x: 0, y: 0, w: 250, h: 50 });
  });

  it('has no box without elements', () => {
    expect(occupiedRect([], ['a'])).toBeNull();
  });
});
