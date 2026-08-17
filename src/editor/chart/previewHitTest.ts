/**
 * Which part of a chart did that click land on?
 *
 * Geometry, not the DOM. The preview renders through `SlideView`, which puts no
 * ids or data attributes on the nodes it draws, and adding them would make every
 * click depend on the renderer's internal shape. The compiled elements already
 * carry both a rect and a `chartRef`, so the honest answer is to test the point
 * against the rects — which also works in a test with no browser at all.
 */
import type { ChartRef, SlideElement } from '@/model';

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
 */
export function hitTestChart(
  elements: SlideElement[],
  x: number,
  y: number,
  pad = 0,
): ChartRef | null {
  let best: HitTarget | null = null;

  for (const el of elements) {
    if (!el.chartRef) continue;
    const rect = visualRect(el);
    // Slop only helps the small stuff. Padding the plot or a bar would let a
    // click outside the chart entirely land on it.
    const slop = rank(el.chartRef) <= 1 || el.chartRef.part === 'axis' ? pad : 0;
    if (!contains(rect, x, y, slop)) continue;
    if (
      !best ||
      rank(el.chartRef) < rank(best.ref) ||
      // Same class: the smaller thing is the more specific one — a data label
      // sits inside its bar, and the number is what a click on it means.
      (rank(el.chartRef) === rank(best.ref) && area(rect) < area(best.rect))
    ) {
      best = { ref: el.chartRef, rect };
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
export function describePart(
  ref: ChartRef,
  seriesName?: string,
  /** How that series is DRAWN — a combo's series aren't all the same shape. */
  render?: 'column' | 'line' | 'area' | 'point' | 'slice',
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
              : render === 'line'
                ? 'point'
                : render === 'slice'
                  ? 'slice'
                  : render === 'point'
                    ? 'point'
                    : 'bar';
      return `${seriesName} · ${noun}`;
    }
    case 'label':
      return seriesName ? `${seriesName} · label` : 'Data label';
    case 'total':
      return 'Total';
    case 'axis':
      return ref.axis === 'y' ? 'Value axis' : 'Category axis';
    case 'legend.item':
    case 'legend.box':
      return 'Legend';
    case 'decoration':
      return 'Annotation';
  }
}
