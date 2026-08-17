import { describe, expect, it } from 'vitest';
import { compileChart } from '@/chart/compile';
import { metricMeasurer } from '@/render/measureText';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  inchesToEmu,
  type ChartInstance,
  type SlideElement,
} from '@/model';
import { describePart, hitTestChart, rectOfPart } from './previewHitTest';

const FRAME = { x: 0, y: 0, w: inchesToEmu(8), h: inchesToEmu(4) };

const chart = (kind: 'column' | 'waterfall' = 'column'): ChartInstance => ({
  id: 'c1',
  groupId: 'g1',
  frame: FRAME,
  spec: defaultChartSpec(kind, 'stacked'),
});

const elements = (kind: 'column' | 'waterfall' = 'column'): SlideElement[] =>
  compileChart(chart(kind), DEFAULT_DESIGN_SYSTEM, metricMeasurer()).elements;

/** Centre of an element, for aiming a click at it. */
const centreOf = (el: SlideElement) => ({
  x: el.rect.x + el.rect.w / 2,
  y: el.rect.y + el.rect.h / 2,
});

describe('hitTestChart', () => {
  it('finds nothing outside the chart', () => {
    const els = elements();
    expect(hitTestChart(els, -1000, -1000)).toBeNull();
  });

  it('picks the bar a click lands on, and names its series and point', () => {
    const els = elements();
    const bar = els.find((e) => e.chartRef?.part === 'mark')!;
    // Off-centre on purpose: dead centre is where the segment's own label sits.
    const hit = hitTestChart(els, bar.rect.x + bar.rect.w * 0.12, bar.rect.y + bar.rect.h * 0.12);
    expect(hit).toEqual(bar.chartRef);
  });

  it('prefers the label over the bar it sits on', () => {
    const els = elements();
    const label = els.find((e) => e.chartRef?.part === 'label')!;
    const hit = hitTestChart(els, centreOf(label).x, centreOf(label).y);
    expect(hit?.part).toBe('label');
    // Same series and point either way, so the options panel shows the same
    // thing whichever of the two you hit.
    expect(hit).toMatchObject({ series: 's0' });
  });

  it('falls back to the plot when the click is in empty chart space', () => {
    const els = elements();
    const plot = els.find((e) => e.chartRef?.part === 'plot')!;
    // Mid-width, near the top: above every bar and clear of the tick column
    // down the left edge. The plot spans the whole frame, so this is the
    // "nothing in particular" answer that gives chart-level options.
    const hit = hitTestChart(els, plot.rect.x + plot.rect.w / 2, plot.rect.y + plot.rect.h * 0.05);
    expect(hit?.part).toBe('plot');
  });

  it('hits an axis tick label, which is a hairline tall', () => {
    const els = elements();
    const tick = els.find(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.sub === 'tick',
    );
    if (!tick) return;
    const hit = hitTestChart(els, centreOf(tick).x, centreOf(tick).y, inchesToEmu(0.02));
    expect(hit?.part).toBe('axis');
  });

  it('reaches a part just outside it when given slop', () => {
    const els = elements();
    const cat = els.find(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.axis === 'x' && e.chartRef.sub === 'tick',
    )!;
    // A hair below the category label — outside its rect, well inside the
    // distance a person considers "on it".
    const justBelow = { x: centreOf(cat).x, y: cat.rect.y + cat.rect.h + inchesToEmu(0.01) };
    expect(hitTestChart(els, justBelow.x, justBelow.y, 0)?.part).not.toBe('axis');
    expect(hitTestChart(els, justBelow.x, justBelow.y, inchesToEmu(0.05))?.part).toBe('axis');
  });
});

describe('hitTestChart — on a turned chart', () => {
  const turned = (rotation: number): SlideElement[] =>
    compileChart(
      { ...chart(), rotation },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    ).elements;

  /**
   * The bug this covers: a turned part keeps the rect it was LAID OUT in and
   * carries the angle separately, so a click aimed at where the part is
   * PAINTED missed it entirely and landed on the plot behind.
   */
  it('hits a bar where it is painted, not where it was laid out', () => {
    const els = turned(90);
    const bar = els.find((e) => e.chartRef?.part === 'mark')!;
    // The painted box is the laid-out one with its sides swapped about the
    // same centre — a wide bar becomes a tall one.
    const painted = {
      x: bar.rect.x + (bar.rect.w - bar.rect.h) / 2,
      y: bar.rect.y + (bar.rect.h - bar.rect.w) / 2,
      w: bar.rect.h,
      h: bar.rect.w,
    };
    // Well along the painted bar, and outside the laid-out rect entirely.
    const x = painted.x + painted.w * 0.12;
    expect(x).toBeLessThan(bar.rect.x);
    expect(hitTestChart(els, x, centreOf(bar).y)).toEqual(bar.chartRef);
  });

  it('still finds nothing outside the chart', () => {
    expect(hitTestChart(turned(90), -1000, -1000)).toBeNull();
  });

  it('is unchanged by a half turn, which swaps no sides', () => {
    const els = turned(180);
    const bar = els.find((e) => e.chartRef?.part === 'mark')!;
    expect(rectOfPart(els, bar.chartRef!)).toEqual(bar.rect);
  });
});

describe('rectOfPart', () => {
  it('finds the rect for the exact ref, for drawing the ring', () => {
    const els = elements();
    const bar = els.find((e) => e.chartRef?.part === 'mark')!;
    expect(rectOfPart(els, bar.chartRef!)).toEqual(bar.rect);
  });

  it('returns null for a part this chart does not have', () => {
    expect(rectOfPart(elements(), { chartId: 'c1', part: 'title' })).toBeNull();
  });
});

describe('describePart', () => {
  it('names parts the way a reader would, not the way the model does', () => {
    expect(describePart({ chartId: 'c1', part: 'axis', axis: 'y', sub: 'tick' })).toBe('Value axis');
    expect(describePart({ chartId: 'c1', part: 'axis', axis: 'x', sub: 'tick' })).toBe(
      'Category axis',
    );
    expect(describePart({ chartId: 'c1', part: 'legend.item', series: 's0' })).toBe('Legend');
    expect(describePart({ chartId: 'c1', part: 'mark', series: 's0', point: 'c0' }, 'SMB')).toBe(
      'SMB · bar',
    );
  });
});
