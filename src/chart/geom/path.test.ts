import { describe, expect, it } from 'vitest';
import type { PathOp } from '@/model';
import { areaPath, arcTo, boundsOf, linePath, normalize, slicePath } from './path';

/** Walk normalized ops back to points, for geometric assertions. */
const points = (d: PathOp[]) =>
  d.flatMap((op) => (op.op === 'Z' ? [] : [{ x: op.x, y: op.y }]));

describe('normalize', () => {
  it('maps a box onto the unit square', () => {
    const d = normalize(
      [
        { op: 'M', x: 10, y: 20 },
        { op: 'L', x: 110, y: 220 },
      ],
      { x: 10, y: 20, w: 100, h: 200 },
    );
    expect(d).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 1, y: 1 },
    ]);
  });

  it('survives a zero-sized box without producing NaN', () => {
    const d = normalize([{ op: 'M', x: 5, y: 5 }], { x: 5, y: 5, w: 0, h: 0 });
    expect(d).toEqual([{ op: 'M', x: 0, y: 0 }]);
  });

  it('carries control points through', () => {
    const d = normalize(
      [{ op: 'C', x1: 0, y1: 0, x2: 10, y2: 10, x: 10, y: 10 }],
      { x: 0, y: 0, w: 10, h: 10 },
    );
    expect(d[0]).toEqual({ op: 'C', x1: 0, y1: 0, x2: 1, y2: 1, x: 1, y: 1 });
  });
});

describe('arcTo', () => {
  it('splits a sweep into at most 90-degree cubic segments', () => {
    const half: PathOp[] = [];
    arcTo(half, 0, 0, 10, 0, Math.PI);
    expect(half).toHaveLength(2);

    const full: PathOp[] = [];
    arcTo(full, 0, 0, 10, 0, Math.PI * 2);
    expect(full).toHaveLength(4);
  });

  it('emits only cubics — no arcs, which Google Slides imports badly', () => {
    const ops: PathOp[] = [];
    arcTo(ops, 0, 0, 10, 0, Math.PI);
    expect(ops.every((o) => o.op === 'C')).toBe(true);
  });

  it('lands exactly on the end of the sweep', () => {
    const ops: PathOp[] = [];
    arcTo(ops, 0, 0, 10, 0, Math.PI / 2);
    const last = ops[ops.length - 1];
    expect(last.op).toBe('C');
    if (last.op === 'C') {
      expect(last.x).toBeCloseTo(0, 6);
      expect(last.y).toBeCloseTo(10, 6);
    }
  });

  it('stays on the circle at the segment midpoint', () => {
    // The whole reason for the kappa constant: a naive cubic would sag here.
    const ops: PathOp[] = [];
    arcTo(ops, 0, 0, 100, 0, Math.PI / 2);
    const c = ops[0];
    if (c.op !== 'C') throw new Error('expected a cubic');
    const t = 0.5;
    const mt = 1 - t;
    const x = mt ** 3 * 100 + 3 * mt ** 2 * t * c.x1 + 3 * mt * t ** 2 * c.x2 + t ** 3 * c.x;
    const y = mt ** 3 * 0 + 3 * mt ** 2 * t * c.y1 + 3 * mt * t ** 2 * c.y2 + t ** 3 * c.y;
    expect(Math.hypot(x, y)).toBeCloseTo(100, 1);
  });
});

describe('slicePath', () => {
  it('starts a pie at 12 o’clock, where every reader expects it', () => {
    const { d, box } = slicePath(50, 50, 50, 0, 0, Math.PI / 2);
    const first = d[0];
    expect(first.op).toBe('M');
    if (first.op === 'M') {
      // Normalized: top-centre of the box.
      expect(first.x).toBeCloseTo(0.5, 6);
      expect(first.y).toBeCloseTo(0, 6);
    }
    expect(box).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('closes a wedge through the centre', () => {
    const { d } = slicePath(50, 50, 50, 0, 0, Math.PI / 2);
    expect(d[d.length - 1].op).toBe('Z');
    const line = d.find((o) => o.op === 'L');
    expect(line).toBeDefined();
    if (line?.op === 'L') {
      expect(line.x).toBeCloseTo(0.5, 6);
      expect(line.y).toBeCloseTo(0.5, 6);
    }
  });

  it('returns a ring segment for a donut, never passing through the centre', () => {
    const { d } = slicePath(50, 50, 50, 25, 0, Math.PI / 2);
    const centreHits = points(d).filter(
      (p) => Math.abs(p.x - 0.5) < 1e-6 && Math.abs(p.y - 0.5) < 1e-6,
    );
    expect(centreHits).toHaveLength(0);
  });

  it('keeps a full-circle slice inside its box', () => {
    const { d } = slicePath(50, 50, 50, 0, 0, Math.PI * 2);
    for (const p of points(d)) {
      expect(p.x).toBeGreaterThanOrEqual(-0.001);
      expect(p.x).toBeLessThanOrEqual(1.001);
      expect(p.y).toBeGreaterThanOrEqual(-0.001);
      expect(p.y).toBeLessThanOrEqual(1.001);
    }
  });
});

describe('linePath', () => {
  it('emits straight segments by default', () => {
    const r = linePath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(r!.d.filter((o) => o.op === 'L')).toHaveLength(2);
    expect(r!.d.some((o) => o.op === 'C')).toBe(false);
  });

  it('smooths with cubics that still pass through every data point', () => {
    // A "smoothed" line that misses its own points is a lie about the data.
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 30 },
      { x: 20, y: 10 },
    ];
    const r = linePath(pts, true)!;
    const box = boundsOf(pts);
    const ends = r.d.filter((o) => o.op === 'C').map((o) => (o.op === 'C' ? o : null)!);
    expect(ends).toHaveLength(2);
    expect(ends[0].x).toBeCloseTo((10 - box.x) / box.w, 6);
    expect(ends[1].x).toBeCloseTo((20 - box.x) / box.w, 6);
  });

  it('refuses a single point rather than emitting a degenerate path', () => {
    expect(linePath([{ x: 0, y: 0 }])).toBeNull();
  });
});

describe('areaPath', () => {
  it('closes the shape between the top edge and the baseline', () => {
    const r = areaPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
      [
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
    )!;
    expect(r.d[0].op).toBe('M');
    expect(r.d[r.d.length - 1].op).toBe('Z');
    expect(r.box).toEqual({ x: 0, y: 0, w: 10, h: 20 });
  });

  it('refuses a degenerate top edge', () => {
    expect(areaPath([{ x: 0, y: 0 }], [])).toBeNull();
  });
});
