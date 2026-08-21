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
import {
  axisBandFor,
  describePart,
  hitTestChart,
  isStrokeOnly,
  legendBand,
  legendEntryRect,
  pathRuns,
  rectOfPart,
} from './previewHitTest';

const FRAME = { x: 0, y: 0, w: inchesToEmu(8), h: inchesToEmu(4) };

type Kind = 'column' | 'waterfall' | 'line';

const chart = (kind: Kind = 'column'): ChartInstance => ({
  id: 'c1',
  groupId: 'g1',
  frame: FRAME,
  spec: defaultChartSpec(kind, 'stacked'),
});

const elements = (kind: Kind = 'column'): SlideElement[] =>
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

  /**
   * The bug this covers: a value axis is drawn as nothing but a column of tick
   * labels a tenth of an inch tall, so the only way to reach it was to land on a
   * digit — aiming at the gutter between two numbers, which is where the axis
   * visibly is, gave the plot and selected the whole chart.
   */
  it('takes the whole axis band, not just the digits printed on it', () => {
    const els = elements();
    const ticks = els.filter(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.axis === 'y' && e.chartRef.sub === 'tick',
    );
    expect(ticks.length).toBeGreaterThan(1);
    const [a, b] = [ticks[0], ticks[1]].sort((p, q) => p.rect.y - q.rect.y);
    // Squarely in the blank between two labels, and clear of both boxes.
    const between = { x: centreOf(a).x, y: a.rect.y + a.rect.h + (b.rect.y - a.rect.y - a.rect.h) / 2 };
    expect(between.y).toBeGreaterThan(a.rect.y + a.rect.h);
    const hit = hitTestChart(els, between.x, between.y);
    expect(hit).toMatchObject({ part: 'axis', axis: 'y' });
  });

  it('leaves a bar standing in front of the axis alone', () => {
    const els = elements();
    const bar = els.find((e) => e.chartRef?.part === 'mark')!;
    // The bars nearest the axis are the ones a widened band would steal.
    const hit = hitTestChart(els, bar.rect.x + 1, bar.rect.y + bar.rect.h * 0.9, inchesToEmu(0.05));
    expect(hit?.part).toBe('mark');
  });

  it('still gives the plot for a point above the axis band', () => {
    const els = elements();
    const tick = els.find(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.axis === 'y' && e.chartRef.sub === 'tick',
    )!;
    // Level with the tick column but well above its topmost label.
    const hit = hitTestChart(els, centreOf(tick).x, 0);
    expect(hit?.part).toBe('plot');
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

/**
 * A line series is a stroke, and its rect is the bounding box of the whole path
 * — on a rising line, most of the plot. Testing a click against that box handed
 * the series every click inside it: the empty space under the line selected the
 * line, and the ring framed a block nobody drew.
 */
describe('hitTestChart on a line series', () => {
  const lineChart = () => {
    const els = elements('line');
    const line = els.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.point === 'line',
    )!;
    if (!isStrokeOnly(line)) throw new Error('a line series is a stroke');
    return { els, line, runs: pathRuns(line) };
  };

  it('draws its lines as bare strokes', () => {
    const { runs } = lineChart();
    // The geometry the hit test now reads: one run of real points, not a box.
    expect(runs[0]!.length).toBeGreaterThan(1);
  });

  it('takes a click on the line itself', () => {
    const { els, line, runs } = lineChart();
    const run = runs[0]!;
    // Halfway along the first segment, which is ink either way it slopes.
    const a = run[0]!;
    const b = run[1]!;
    const hit = hitTestChart(els, (a.x + b.x) / 2, (a.y + b.y) / 2, inchesToEmu(0.02));
    expect(hit).toEqual(line.chartRef);
  });

  it('leaves the empty space inside its box to the chart', () => {
    const { els, line, runs } = lineChart();
    const run = runs[0]!;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    // The corner of the box the line's own ends span: inside the rect, a long
    // way off the diagonal between them.
    const hit = hitTestChart(els, last.x, first.y, inchesToEmu(0.02));
    expect(hit).not.toEqual(line.chartRef);
    expect(hit?.part).toBe('plot');
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

describe('axisBandFor', () => {
  it('frames the axis a tick belongs to, so the ring is not around three digits', () => {
    const els = elements();
    const ticks = els.filter(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.axis === 'y' && e.chartRef.sub === 'tick',
    );
    const band = axisBandFor(els, ticks[0].chartRef!)!;
    expect(band).not.toBeNull();
    // Taller than any one label, and covering every one of them.
    expect(band.h).toBeGreaterThan(ticks[0].rect.h);
    for (const t of ticks) {
      expect(t.rect.y).toBeGreaterThanOrEqual(band.y);
      expect(t.rect.y + t.rect.h).toBeLessThanOrEqual(band.y + band.h);
    }
  });

  it('is null for parts that are framed by their own box', () => {
    const els = elements();
    const bar = els.find((e) => e.chartRef?.part === 'mark')!;
    expect(axisBandFor(els, bar.chartRef!)).toBeNull();
    // The axis title sits off to the side of the axis, not along it.
    expect(axisBandFor(els, { chartId: 'c1', part: 'axis', axis: 'y', sub: 'title' })).toBeNull();
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

describe('legendBand', () => {
  it('holds every entry, and nothing beyond the last one', () => {
    const els = elements();
    const keys = els.filter((e) => e.chartRef?.part === 'legend.item');
    expect(keys.length).toBeGreaterThan(1);
    const band = legendBand(els)!;
    for (const k of keys) {
      expect(k.rect.x).toBeGreaterThanOrEqual(band.x);
      expect(k.rect.x + k.rect.w).toBeLessThanOrEqual(band.x + band.w);
      expect(k.rect.y).toBeGreaterThanOrEqual(band.y);
      expect(k.rect.y + k.rect.h).toBeLessThanOrEqual(band.y + band.h);
    }
    // Tight: the band's edges are the outermost keys', not the gutter the
    // layout reserved (`legend.box`, which spans the chart).
    const right = Math.max(...keys.map((k) => k.rect.x + k.rect.w));
    expect(band.x + band.w).toBe(right);
    const box = els.find((e) => e.chartRef?.part === 'legend.box')!;
    expect(band.w).toBeLessThan(box.rect.w);
  });

  it('takes an entry as the swatch and its name together', () => {
    const els = elements();
    const swatch = els.find(
      (e) => e.chartRef?.part === 'legend.item' && !e.chartRef.series.endsWith('.label'),
    )!;
    const series = (swatch.chartRef as { series: string }).series;
    const name = els.find(
      (e) => e.chartRef?.part === 'legend.item' && e.chartRef.series === `${series}.label`,
    )!;
    const entry = legendEntryRect(els, series)!;
    expect(entry.x).toBe(Math.min(swatch.rect.x, name.rect.x));
    expect(entry.x + entry.w).toBe(
      Math.max(swatch.rect.x + swatch.rect.w, name.rect.x + name.rect.w),
    );
    // One entry, not the whole legend.
    expect(entry.w).toBeLessThan(legendBand(els)!.w);
  });

  it('is null on a chart that draws no legend', () => {
    expect(legendBand([])).toBeNull();
  });
});
