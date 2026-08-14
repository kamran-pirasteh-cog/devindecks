/**
 * Building paths for chart geometry.
 *
 * Everything here emits NORMALIZED ops (0..1 within the element's box) and
 * cubics only — no `arcTo`. Circular geometry is approximated with <=90 degree
 * cubic segments, which is both visually exact to well under a pixel and the
 * form OOXML `custGeom` imports most reliably into Google Slides.
 */
import type { PathOp, Rect } from '@/model';

export interface Point {
  x: number;
  y: number;
}

/**
 * The magic constant for approximating a quarter circle with a cubic Bézier.
 * For a sweep of θ the control-point distance is (4/3)·tan(θ/4).
 */
const kappaFor = (sweepRad: number): number => (4 / 3) * Math.tan(sweepRad / 4);

/** Absolute points -> ops normalized against `box`. */
export function normalize(points: PathOp[], box: Rect): PathOp[] {
  const nx = (v: number) => (box.w ? (v - box.x) / box.w : 0);
  const ny = (v: number) => (box.h ? (v - box.y) / box.h : 0);
  return points.map((op) => {
    switch (op.op) {
      case 'M':
        return { op: 'M', x: nx(op.x), y: ny(op.y) };
      case 'L':
        return { op: 'L', x: nx(op.x), y: ny(op.y) };
      case 'C':
        return {
          op: 'C',
          x1: nx(op.x1),
          y1: ny(op.y1),
          x2: nx(op.x2),
          y2: ny(op.y2),
          x: nx(op.x),
          y: ny(op.y),
        };
      case 'Z':
        return op;
    }
  });
}

/** The bounding box of a set of absolute points. */
export function boundsOf(points: Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const polar = (cx: number, cy: number, r: number, a: number): Point => ({
  x: cx + r * Math.cos(a),
  y: cy + r * Math.sin(a),
});

/**
 * An arc as cubic segments, appended to `into`.
 *
 * Splitting at 90 degrees keeps the maximum radial error around 0.02% of the
 * radius — invisible at any slide size, and well inside what a reader would
 * ever notice on a pie slice.
 */
export function arcTo(
  into: PathOp[],
  cx: number,
  cy: number,
  r: number,
  startRad: number,
  endRad: number,
): void {
  const total = endRad - startRad;
  const segments = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
  const step = total / segments;
  const k = kappaFor(step);

  let a = startRad;
  for (let i = 0; i < segments; i++) {
    const b = a + step;
    const p0 = polar(cx, cy, r, a);
    const p1 = polar(cx, cy, r, b);
    // Control points lie along the tangents at each end.
    const c1 = { x: p0.x - k * r * Math.sin(a), y: p0.y + k * r * Math.cos(a) };
    const c2 = { x: p1.x + k * r * Math.sin(b), y: p1.y - k * r * Math.cos(b) };
    into.push({ op: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p1.x, y: p1.y });
    a = b;
  }
}

/**
 * A pie or donut slice. `innerR` of 0 gives a wedge from the centre; anything
 * larger gives a ring segment.
 *
 * Angles are in radians, measured clockwise from 12 o'clock — which is where
 * every reader expects a pie to start, and where PowerPoint starts one.
 */
export function slicePath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startRad: number,
  endRad: number,
): { d: PathOp[]; box: Rect } {
  // Convert "clockwise from 12" to standard maths angles (anticlockwise from 3).
  const a0 = startRad - Math.PI / 2;
  const a1 = endRad - Math.PI / 2;

  const abs: PathOp[] = [];
  const outerStart = polar(cx, cy, outerR, a0);
  abs.push({ op: 'M', x: outerStart.x, y: outerStart.y });
  arcTo(abs, cx, cy, outerR, a0, a1);

  if (innerR > 0) {
    const innerEnd = polar(cx, cy, innerR, a1);
    abs.push({ op: 'L', x: innerEnd.x, y: innerEnd.y });
    arcTo(abs, cx, cy, innerR, a1, a0);
  } else {
    abs.push({ op: 'L', x: cx, y: cy });
  }
  abs.push({ op: 'Z' });

  // A slice's bounds can't be taken from its control points — a bulging arc
  // reaches past them — so use the full circle and let the box be honest.
  const box: Rect = { x: cx - outerR, y: cy - outerR, w: outerR * 2, h: outerR * 2 };
  return { d: normalize(abs, box), box };
}

/**
 * A filled area between a top edge and a baseline.
 *
 * `smooth` runs a Catmull-Rom-to-Bézier conversion so a smoothed line chart and
 * its area fill trace exactly the same curve — if they were computed
 * separately they'd diverge and the fill would peek out from under the line.
 */
export function areaPath(
  top: Point[],
  bottom: Point[],
  smooth = false,
): { d: PathOp[]; box: Rect } | null {
  if (top.length < 2) return null;
  const abs: PathOp[] = [];

  abs.push({ op: 'M', x: top[0].x, y: top[0].y });
  appendEdge(abs, top, smooth);
  if (bottom.length) {
    abs.push({ op: 'L', x: bottom[0].x, y: bottom[0].y });
    appendEdge(abs, bottom, smooth);
  }
  abs.push({ op: 'Z' });

  const box = boundsOf([...top, ...bottom]);
  return { d: normalize(abs, box), box };
}

/**
 * A Sankey ribbon: a band of constant thickness sweeping from one node to
 * another.
 *
 * `start` and `end` are the ribbon's leading corner at each end — its top edge
 * for a left-to-right flow, its left edge for a top-to-bottom one — and `flow`
 * says which axis the ribbon travels along.
 *
 * The two control points sit at the MIDPOINT of the flow axis, level with
 * their own endpoint. That's what gives a Sankey its distinctive flat-then-turn
 * shape, and it keeps the curve inside the box its endpoints describe, so the
 * bounds are just the corners.
 */
export function ribbonPath(
  start: Point,
  end: Point,
  thickness: number,
  flow: 'x' | 'y',
): { d: PathOp[]; box: Rect } {
  const along = flow === 'x' ? 'x' : 'y';
  const across = flow === 'x' ? 'y' : 'x';
  const mid = (start[along] + end[along]) / 2;

  const at = (a: number, c: number): Point =>
    flow === 'x' ? { x: a, y: c } : { x: c, y: a };

  const leadStart = start[across];
  const leadEnd = end[across];
  const trailStart = leadStart + thickness;
  const trailEnd = leadEnd + thickness;

  const p = (point: Point) => ({ x: point.x, y: point.y });
  const c1 = at(mid, leadStart);
  const c2 = at(mid, leadEnd);
  const c3 = at(mid, trailEnd);
  const c4 = at(mid, trailStart);
  const endLead = at(end[along], leadEnd);
  const endTrail = at(end[along], trailEnd);
  const startTrail = at(start[along], trailStart);

  const abs: PathOp[] = [
    { op: 'M', ...p(start) },
    { op: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, ...p(endLead) },
    { op: 'L', ...p(endTrail) },
    { op: 'C', x1: c3.x, y1: c3.y, x2: c4.x, y2: c4.y, ...p(startTrail) },
    { op: 'Z' },
  ];

  const box = boundsOf([start, endLead, endTrail, startTrail]);
  return { d: normalize(abs, box), box };
}

/** A polyline or smooth curve through `points`. */
export function linePath(points: Point[], smooth = false): { d: PathOp[]; box: Rect } | null {
  if (points.length < 2) return null;
  const abs: PathOp[] = [{ op: 'M', x: points[0].x, y: points[0].y }];
  appendEdge(abs, points, smooth);
  return { d: normalize(abs, boundsOf(points)), box: boundsOf(points) };
}

function appendEdge(into: PathOp[], points: Point[], smooth: boolean): void {
  if (!smooth) {
    for (let i = 1; i < points.length; i++) {
      into.push({ op: 'L', x: points[i].x, y: points[i].y });
    }
    return;
  }
  // Catmull-Rom through the points, converted to cubics. Tension 6 is the
  // standard uniform form — it passes through every point, which matters:
  // a "smoothed" line that misses its own data points is a lie.
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    into.push({
      op: 'C',
      x1: p1.x + (p2.x - p0.x) / 6,
      y1: p1.y + (p2.y - p0.y) / 6,
      x2: p2.x - (p3.x - p1.x) / 6,
      y2: p2.y - (p3.y - p1.y) / 6,
      x: p2.x,
      y: p2.y,
    });
  }
}
