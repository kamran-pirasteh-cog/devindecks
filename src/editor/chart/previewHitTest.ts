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
      return ref.sub === 'line' || ref.sub === 'grid' ? 3 : 0;
    case 'plot':
    case 'legend.box':
      return 4;
  }
}

const area = (r: HitTarget['rect']) => Math.max(1, r.w) * Math.max(1, r.h);

const contains = (r: HitTarget['rect'], x: number, y: number, pad: number) =>
  x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

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
    // Slop only helps the small stuff. Padding the plot or a bar would let a
    // click outside the chart entirely land on it.
    const slop = rank(el.chartRef) <= 1 || el.chartRef.part === 'axis' ? pad : 0;
    if (!contains(el.rect, x, y, slop)) continue;
    if (
      !best ||
      rank(el.chartRef) < rank(best.ref) ||
      // Same class: the smaller thing is the more specific one — a data label
      // sits inside its bar, and the number is what a click on it means.
      (rank(el.chartRef) === rank(best.ref) && area(el.rect) < area(best.rect))
    ) {
      best = { ref: el.chartRef, rect: el.rect };
    }
  }

  return best?.ref ?? null;
}

/** The rect a hit part occupies, for drawing the selection ring over it. */
export function rectOfPart(
  elements: SlideElement[],
  ref: ChartRef,
): HitTarget['rect'] | null {
  const key = JSON.stringify(ref);
  const el = elements.find((e) => e.chartRef && JSON.stringify(e.chartRef) === key);
  return el?.rect ?? null;
}

/**
 * What the panel calls the selected part.
 *
 * Deliberately in the reader's terms rather than the model's: "Value axis", not
 * `axis.y.tick`. The sub-part a click landed on doesn't matter to the options it
 * gets — clicking a tick, the axis line or its title all mean "the axis".
 */
export function describePart(ref: ChartRef, seriesName?: string): string {
  switch (ref.part) {
    case 'plot':
      return 'Chart';
    case 'title':
      return 'Title';
    case 'mark':
      return seriesName ? `${seriesName} · bar` : 'Series';
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
