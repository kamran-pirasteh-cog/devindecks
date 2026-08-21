/**
 * Which part of a chart did that click land on?
 *
 * Geometry, not the DOM. The preview renders through `SlideView`, which puts no
 * ids or data attributes on the nodes it draws, and adding them would make every
 * click depend on the renderer's internal shape. The compiled elements already
 * carry both a rect and a `chartRef`, so the honest answer is to test the point
 * against the rects — which also works in a test with no browser at all.
 */
import {
  isPath,
  legendSeriesKey,
  pointsToEmu,
  type ChartRef,
  type PathElement,
  type SlideElement,
} from '@/model';
import type { MarkRender } from './markCaps';

/** Painted order, topmost last — the same array `SlideView` renders. */
export interface HitTarget {
  ref: ChartRef;
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * How much a part wants to be clicked, lower first.
 *
 * Area alone gets this wrong in both directions. A gridline is a hairline
 * spanning the plot, so by area it is TINY and would beat every bar it crosses;
 * the plot background is huge and would never win even when someone clicks
 * genuinely empty space. So rank by class first and only then by size.
 */
function rank(ref: ChartRef): number {
  switch (ref.part) {
    case 'label':
    case 'total':
    case 'title':
    case 'legend.item':
    case 'decoration':
      return 0;
    case 'mark':
      return 1;
    case 'axis':
      // The text of an axis is aimed at; its line and gridlines are furniture
      // that happens to lie across everything else.
      return ref.sub === 'line' || ref.sub === 'grid' || ref.sub === 'tickMark' ? 3 : 0;
    case 'plot':
    case 'legend.box':
      return 4;
    // A Gantt's table is TEXT aimed at directly, exactly like a data label.
    case 'gantt.column':
      return 0;
    case 'gantt.row':
      // The name is aimed at; the tint behind the row and the rule under it are
      // furniture that happens to span the chart — the gridline argument above,
      // applied to the other axis.
      return ref.sub === 'label' ? 0 : ref.sub === 'divider' ? 3 : 4;
    case 'gantt.band':
      // The today rule is a hairline over everything; the shading is backdrop.
      // Neither may out-rank a bar it crosses, which is why these are their own
      // part rather than decorations (which rank 0).
      return ref.sub === 'today' ? 3 : 4;
  }
}

const area = (r: HitTarget['rect']) => Math.max(1, r.w) * Math.max(1, r.h);

/**
 * The box a part actually OCCUPIES on screen.
 *
 * `rect` is the box the part was LAID OUT in; `rotation` is applied afterwards
 * by the renderer, about the box's own centre. On a turned chart the two
 * disagree by a quarter turn — a bar laid out 400 wide and 30 tall is painted
 * 30 wide and 400 tall — so testing a click against `rect` tests a box that
 * isn't where the user is looking, and the ring lands on the same wrong box.
 *
 * Every rect is therefore projected through its own angle first. Written for
 * any angle rather than just the quarter turns, because annotations carry
 * arbitrary rotations too; at a multiple of 90° it is exact.
 */
/** A rect on its side: same centre, sides traded. */
const swapSides = (r: HitTarget['rect']): HitTarget['rect'] => ({
  x: r.x + (r.w - r.h) / 2,
  y: r.y + (r.h - r.w) / 2,
  w: r.h,
  h: r.w,
});

export function visualRect(el: Pick<SlideElement, 'rect' | 'rotation'>): HitTarget['rect'] {
  const deg = (((el.rotation ?? 0) % 360) + 360) % 360;
  if (deg === 0 || deg === 180) return el.rect;
  // The quarter turns are the common case by far — every part of a turned
  // chart — and are exactly a swap of the sides. Taken directly rather than
  // through `cos`, which returns 6e-17 for a right angle and would leave every
  // rect in a turned chart a hair off the box it is painted in.
  if (deg === 90 || deg === 270) return swapSides(el.rect);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = el.rect.w * cos + el.rect.h * sin;
  const h = el.rect.w * sin + el.rect.h * cos;
  // Same centre — a rotation never moves it.
  return { x: el.rect.x + (el.rect.w - w) / 2, y: el.rect.y + (el.rect.h - h) / 2, w, h };
}

const contains = (r: HitTarget['rect'], x: number, y: number, pad: number) =>
  x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

/* ------------------------------------------------------------------ */
/* Strokes                                                            */
/* ------------------------------------------------------------------ */

/**
 * A line series is a STROKE, not the box it spans.
 *
 * Its rect is the bounding box of the whole path — on a rising line that is a
 * rectangle covering most of the plot, so testing a click against it hands the
 * series every click in that region: the line eats the empty space around it,
 * and the selection ring frames a block nobody drew. The path's own points are
 * right there in the element, so the honest test is the distance to them.
 *
 * Only paths with nothing but an outline. A filled path — an area, a pie slice,
 * a Sankey link — is a region, and its box is a fair enough stand-in for it.
 */
export function isStrokeOnly(el: SlideElement): el is PathElement {
  return isPath(el) && (!el.fill || el.fill.kind === 'none') && !!el.outline;
}

/** How closely the curves are chased. Sixteen chords per segment is inside a
 * hairline of a line chart's smoothing at any size a slide is read at. */
const CURVE_STEPS = 16;

const cubic = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/**
 * A path's own geometry, flattened to polylines in the elements' EMU space.
 *
 * `PathOp` coordinates are fractions of the element's rect — the same mapping
 * `pathData` draws with — so this follows exactly what is on screen. Rotation is
 * NOT applied here: the query point is turned into the path's frame instead (see
 * `localPoint`), which is exact at any angle and needs no second flattening.
 */
export function pathRuns(el: PathElement): { x: number; y: number }[][] {
  const at = (fx: number, fy: number) => ({
    x: el.rect.x + fx * el.rect.w,
    y: el.rect.y + fy * el.rect.h,
  });
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  const close = () => {
    if (run.length > 1) runs.push(run);
    run = [];
  };
  for (const op of el.d) {
    switch (op.op) {
      case 'M':
        close();
        run.push(at(op.x, op.y));
        break;
      case 'L':
        run.push(at(op.x, op.y));
        break;
      case 'C': {
        const from = run[run.length - 1] ?? at(op.x1, op.y1);
        const c1 = at(op.x1, op.y1);
        const c2 = at(op.x2, op.y2);
        const to = at(op.x, op.y);
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS;
          run.push({
            x: cubic(from.x, c1.x, c2.x, to.x, t),
            y: cubic(from.y, c1.y, c2.y, to.y, t),
          });
        }
        break;
      }
      case 'Z':
        if (run.length > 1 && run[0]) run.push({ ...run[0] });
        close();
        break;
    }
  }
  close();
  return runs;
}

/** The query point in the path's own unrotated frame. */
function localPoint(el: SlideElement, x: number, y: number) {
  const deg = (((el.rotation ?? 0) % 360) + 360) % 360;
  if (!deg) return { x, y };
  // The renderer turns the box by +deg about its centre, so the point comes
  // back the other way.
  const rad = (-deg * Math.PI) / 180;
  const cx = el.rect.x + el.rect.w / 2;
  const cy = el.rect.y + el.rect.h / 2;
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** Distance from a point to a segment — the whole of the stroke test. */
function segDistance(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = vx * vx + vy * vy;
  // A degenerate segment is a point, which is its own nearest thing.
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}

export function distanceToPath(
  runs: { x: number; y: number }[][],
  x: number,
  y: number,
): number {
  let best = Infinity;
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1];
      const b = run[i];
      if (!a || !b) continue;
      best = Math.min(best, segDistance(x, y, a, b));
      if (best === 0) return 0;
    }
  }
  return best;
}

/**
 * How far off a stroke still counts as on it.
 *
 * Half the stroke — anything inside the ink itself is plainly a hit — plus the
 * caller's slop, floored at a couple of points so a hairline series is still
 * grabbable in a small preview where `pad` works out to nearly nothing.
 */
const strokeTolerance = (el: PathElement, pad: number) =>
  (el.outline?.widthEmu ?? 0) / 2 + Math.max(pad, pointsToEmu(2));

/**
 * How far the point is from a stroke-only part, and how far off still counts —
 * null for every part whose box is a fair test of it.
 */
export function strokeProximity(
  el: SlideElement,
  x: number,
  y: number,
  pad: number,
): { dist: number; tol: number } | null {
  if (!isStrokeOnly(el)) return null;
  const local = localPoint(el, x, y);
  return {
    dist: distanceToPath(pathRuns(el), local.x, local.y),
    tol: strokeTolerance(el, pad),
  };
}

/**
 * An axis is a BAND, not the handful of numbers printed along it.
 *
 * A value axis is usually drawn as nothing but its tick labels — a column of
 * boxes a tenth of an inch tall with an inch of blank gutter between them, and
 * often no axis rule at all (`showValueAxisLine` is off by default). Testing the
 * point against those boxes alone means the only way to reach the axis is to
 * land on a digit: aim at the gutter between "200" and "300", which is where the
 * axis visibly IS, and the click finds nothing. Every other app lets you click
 * anywhere down the axis, so the parts are unioned back into the strip a reader
 * would point at.
 *
 * Only the axis proper — its numbers, its tick marks and its rule. Gridlines
 * span the plot, and the axis title and unit note are full-width rows above or
 * beside it; unioning either in would stretch the band across the whole chart
 * and swallow clicks meant for the plot.
 */
function axisBands(elements: SlideElement[]): { rect: HitTarget['rect']; refs: HitTarget[] }[] {
  const byAxis = new Map<string, HitTarget[]>();
  for (const el of elements) {
    const ref = el.chartRef;
    if (!ref || ref.part !== 'axis') continue;
    if (ref.sub !== 'tick' && ref.sub !== 'tickMark' && ref.sub !== 'line') continue;
    const list = byAxis.get(ref.axis) ?? [];
    list.push({ ref, rect: visualRect(el) });
    byAxis.set(ref.axis, list);
  }
  return [...byAxis.values()].map((refs) => {
    const x0 = Math.min(...refs.map((r) => r.rect.x));
    const y0 = Math.min(...refs.map((r) => r.rect.y));
    const x1 = Math.max(...refs.map((r) => r.rect.x + r.rect.w));
    const y1 = Math.max(...refs.map((r) => r.rect.y + r.rect.h));
    return { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, refs };
  });
}

/**
 * The band the axis a part belongs to occupies, for framing it on the canvas.
 *
 * A hover or selection ring drawn on one tick's own box is a ring around three
 * digits, which reads as "this number" when what is selected — and what the
 * panel edits — is the whole axis. Null for anything that isn't part of an axis
 * proper, which keeps every other part framed by its own rect.
 */
export function axisBandFor(
  elements: SlideElement[],
  ref: ChartRef,
): HitTarget['rect'] | null {
  if (ref.part !== 'axis') return null;
  // The axis title and the unit note are their own boxes somewhere off the
  // axis — framing them as the axis would put the ring nowhere near them.
  if (ref.sub !== 'tick' && ref.sub !== 'tickMark' && ref.sub !== 'line') return null;
  const band = axisBands(elements).find((b) =>
    b.refs.some((t) => t.ref.part === 'axis' && t.ref.axis === ref.axis),
  );
  return band?.rect ?? null;
}

/**
 * The box the legend as a WHOLE occupies — the union of its entries.
 *
 * A legend is a population, exactly like an axis: a plain click takes every one
 * of its entries (see `clickSelectParts`), so ringing the entries one by one
 * draws four rings around four words when what is selected is ONE thing. The
 * union of the entries rather than the `legend.box` rect, which is the gutter
 * the layout reserved — full chart width for a legend on top, so a ring on it
 * would run out well past both ends of the keys it holds.
 *
 * Null when the chart draws no legend, which leaves callers framing the part's
 * own rect.
 */
export function legendBand(elements: SlideElement[]): HitTarget['rect'] | null {
  return unionOf(
    elements.filter((el) => el.chartRef?.part === 'legend.item').map(visualRect),
  );
}

/**
 * One legend ENTRY: the swatch and the name beside it.
 *
 * The two carry different series keys (see `legendSeriesKey`) and are the two
 * halves of one word, so the narrowest thing a legend selection reaches is the
 * pair — and it gets one ring, not two.
 */
export function legendEntryRect(
  elements: SlideElement[],
  series: string,
): HitTarget['rect'] | null {
  return unionOf(
    elements
      .filter(
        (el) =>
          el.chartRef?.part === 'legend.item' && legendSeriesKey(el.chartRef) === series,
      )
      .map(visualRect),
  );
}

/** The smallest box holding all of them, or null for none. */
function unionOf(rects: HitTarget['rect'][]): HitTarget['rect'] | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Of an axis's own parts, the one nearest the point — what the click means. */
function nearestIn(refs: HitTarget[], x: number, y: number): ChartRef {
  const dist = (t: HitTarget) =>
    Math.hypot(t.rect.x + t.rect.w / 2 - x, t.rect.y + t.rect.h / 2 - y);
  // Ties and near-ties go to a tick: the numbers are what an axis click is
  // about, and the popover it opens is the same for every sub-part anyway.
  const ticks = refs.filter((t) => t.ref.part === 'axis' && t.ref.sub === 'tick');
  const pool = ticks.length ? ticks : refs;
  return pool.reduce((best, t) => (dist(t) < dist(best) ? t : best)).ref;
}

/**
 * The part at (x, y), in the same EMU space as the elements' rects.
 *
 * `pad` widens every candidate — a tick label is a few hundredths of an inch
 * tall and an axis line is one hairline, and a click that has to be pixel-exact
 * reads as a broken control rather than as a precise one.
 *
 * Ties break SMALLEST FIRST: a data label sits inside its bar, and the label is
 * what someone clicking the number means. The backdrop parts are considered only
 * when nothing else matched at all.
 *
 * A stroke-only path — a line series — is taken on its ink rather than on its
 * box; see `isStrokeOnly` for why a box is the wrong question to ask of a line.
 */
export function hitTestChart(
  elements: SlideElement[],
  x: number,
  y: number,
  pad = 0,
): ChartRef | null {
  /** The best candidate so far, with what it is being ranked on. */
  let best: (HitTarget & { size: number; dist: number }) | null = null;

  for (const el of elements) {
    if (!el.chartRef) continue;
    const rect = visualRect(el);
    // Slop only helps the small stuff. Padding the plot or a bar would let a
    // click outside the chart entirely land on it.
    const slop = rank(el.chartRef) <= 1 || el.chartRef.part === 'axis' ? pad : 0;
    // The box is the cheap first pass; a stroke then narrows it to the ink.
    if (!contains(rect, x, y, slop)) continue;
    let size = area(rect);
    let dist = 0;
    const stroke = strokeProximity(el, x, y, pad);
    if (stroke) {
      if (stroke.dist > stroke.tol) continue;
      // A stroke is as SPECIFIC as a small target however far its box reaches: a
      // line crossing an area or a band is the thing under the pointer, and
      // ranking it by its box would hand the click to whatever it crosses.
      size = Math.min(size, (stroke.tol * 2) ** 2);
      dist = stroke.dist;
    }
    if (
      !best ||
      rank(el.chartRef) < rank(best.ref) ||
      // Same class: the smaller thing is the more specific one — a data label
      // sits inside its bar, and the number is what a click on it means.
      (rank(el.chartRef) === rank(best.ref) &&
        (size < best.size ||
          // Two strokes crossing are the same size, so the nearer ink wins.
          (size === best.size && dist < best.dist)))
    ) {
      best = { ref: el.chartRef, rect, size, dist };
    }
  }

  // The axis band is consulted only when nothing more specific answered, so a
  // click on a bar standing in front of the axis is still a click on the bar,
  // and only the furniture — the plot backdrop, a gridline, the axis rule —
  // gives way to it.
  if (!best || rank(best.ref) >= 3) {
    const band = axisBands(elements).find((b) => contains(b.rect, x, y, pad));
    if (band) return nearestIn(band.refs, x, y);
  }

  return best?.ref ?? null;
}

/**
 * The rect a hit part occupies on screen, for drawing the selection ring over
 * it — the PAINTED box, so the ring still frames the part on a turned chart.
 */
export function rectOfPart(
  elements: SlideElement[],
  ref: ChartRef,
): HitTarget['rect'] | null {
  const key = JSON.stringify(ref);
  const el = elements.find((e) => e.chartRef && JSON.stringify(e.chartRef) === key);
  return el ? visualRect(el) : null;
}

/**
 * What the panel calls the selected part.
 *
 * Deliberately in the reader's terms rather than the model's: "Value axis", not
 * `axis.y.tick`. The sub-part a click landed on doesn't matter to the options it
 * gets — clicking a tick, the axis line or its title all mean "the axis".
 */
/**
 * What to call a mark of each render class.
 *
 * A table rather than a chain of ternaries now that a Gantt contributes five of
 * its own — and it is the reason a milestone reads "Launch · milestone" rather
 * than "Launch · bar", which is the difference between a header that names what
 * was clicked and one that names its neighbour.
 */
const MARK_NOUNS: Partial<Record<MarkRender, string>> = {
  line: 'point',
  area: 'point',
  point: 'point',
  dot: 'dot',
  slice: 'slice',
  column: 'bar',
  'gantt.bar': 'bar',
  'gantt.chevron': 'chevron',
  'gantt.milestone': 'milestone',
  'gantt.summary': 'summary',
  'gantt.bracket': 'bracket',
};

export function describePart(
  ref: ChartRef,
  seriesName?: string,
  /** How that series is DRAWN — a combo's series aren't all the same shape. */
  render?: MarkRender,
): string {
  switch (ref.part) {
    case 'plot':
      return 'Chart';
    case 'title':
      return 'Title';
    case 'mark': {
      if (!seriesName) return 'Series';
      // The line placer addresses the whole path as one point; anything else
      // is a single datum on it.
      const noun =
        ref.point === 'line'
          ? 'line'
          : ref.point === 'area'
            ? 'area'
            : ref.point === 'end'
              ? 'end dot'
              : (MARK_NOUNS[render ?? 'column'] ?? 'bar');
      return `${seriesName} · ${noun}`;
    }
    case 'label':
      return seriesName ? `${seriesName} · label` : 'Data label';
    case 'total':
      return 'Total';
    case 'axis':
      return ref.axis === 'y'
        ? 'Value axis'
        : ref.axis === 'y2'
          ? 'Right axis'
          : 'Category axis';
    case 'legend.item':
    case 'legend.box':
      return 'Legend';
    case 'decoration':
      return 'Annotation';
    case 'gantt.row':
      return ref.sub === 'label' ? 'Task' : ref.sub === 'divider' ? 'Row divider' : 'Row band';
    case 'gantt.column':
      return ref.sub === 'header' ? 'Column heading' : 'Cell';
    case 'gantt.band':
      return ref.sub === 'today'
        ? 'Today line'
        : ref.sub === 'weekend'
          ? 'Non-working days'
          : 'Holiday';
  }
}
