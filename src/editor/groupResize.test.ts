import { describe, expect, it } from 'vitest';
import { individualBox, resizeFactor } from './groupResize';

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
