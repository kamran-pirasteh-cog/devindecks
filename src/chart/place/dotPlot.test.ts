import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  chartOrientation,
  defaultChartSpec,
  inchesToEmu,
  isShape,
  isText,
  setChartOrientation,
  type ChartInstance,
  type DotPlotSpec,
  type SlideElement,
} from '@/model';
import { metricMeasurer } from '@/render/measureText';
import { compileChart } from '../compile';
import { dotEmphasisKey } from './dotPlot';

const FRAME = { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(8), h: inchesToEmu(4.5) };

function chart(mutate: (s: DotPlotSpec) => void = () => {}): ChartInstance {
  const spec = defaultChartSpec('dotplot') as DotPlotSpec;
  mutate(spec);
  return { id: 'c1', groupId: 'g1', frame: FRAME, spec };
}

const compile = (c: ChartInstance) => compileChart(c, DEFAULT_DESIGN_SYSTEM, metricMeasurer());
const marks = (els: SlideElement[]) => els.filter((e) => e.role === 'chart.series');
const labels = (els: SlideElement[]) =>
  els.filter(isText).filter((e) => e.role === 'chart.label');
const markerFor = (els: SlideElement[], series: string, point: string) =>
  els.find(
    (e) =>
      e.chartRef?.part === 'mark' && e.chartRef.series === series && e.chartRef.point === point,
  );

describe('dot plot', () => {
  it('draws one marker per datum plus one track per row', () => {
    const { elements, diagnostics } = compile(chart());
    expect(diagnostics).toEqual([]);
    // 3 rows x 3 series markers, and a range track on each row.
    expect(marks(elements)).toHaveLength(12);
    expect(marks(elements).filter((e) => e.chartRef?.part === 'mark' && e.chartRef.series === 'track')).toHaveLength(3);
    expect(marks(elements).every(isShape)).toBe(true);
  });

  it('gives every element a unique, deterministic id', () => {
    const c = chart();
    const { elements } = compile(c);
    expect(new Set(elements.map((e) => e.id)).size).toBe(elements.length);
    expect(compile(c).elements).toEqual(elements);
  });

  it('lies on its side by default, and can be stood up', () => {
    const spec = chart().spec as DotPlotSpec;
    expect(chartOrientation(spec)).toBe('horizontal');
    expect(chartOrientation(setChartOrientation(spec, 'vertical'))).toBe('vertical');
  });

  it('spans the track from the row’s lowest point to its highest', () => {
    const { elements } = compile(chart());
    const first = markerFor(elements, 's0', 'c0')!;
    const last = markerFor(elements, 's2', 'c0')!;
    const track = elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 'track' && e.chartRef.point === 'c0',
    )!;
    const mid = (r: { x: number; w: number }) => r.x + r.w / 2;
    expect(mid(track.rect)).toBeCloseTo((mid(first.rect) + mid(last.rect)) / 2, -3);
    expect(track.rect.w).toBeGreaterThan(0);
    // Both markers sit on the row's own line.
    expect(first.rect.y + first.rect.h / 2).toBeCloseTo(last.rect.y + last.rect.h / 2, -3);
  });

  it('climbs the ladder left to right — hollow, step, subject', () => {
    const { elements } = compile(chart());
    const sizes = ['s0', 's1', 's2'].map((k) => markerFor(elements, k, 'c0')!.rect.w);
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);

    const [hollow, step, subject] = ['s0', 's1', 's2'].map(
      (k) => markerFor(elements, k, 'c0')! as SlideElement & {
        preset?: string;
        fill?: { kind: string; color?: unknown; alpha?: number };
        outline?: unknown;
      },
    );
    // The hollow rung is the only one that carries a ring.
    expect(hollow.outline).toBeDefined();
    expect(step.outline).toBeUndefined();
    expect(subject.outline).toBeUndefined();
    // Shape carries identity as well as size: the step is a diamond.
    expect(hollow.preset).toBe('ellipse');
    expect(step.preset).toBe('diamond');
    expect(subject.preset).toBe('ellipse');
    expect(hollow.fill).not.toEqual(subject.fill);
  });

  it('paints the subject in the palette’s first colour, wherever it sits', () => {
    const { elements } = compile(chart());
    const asFill = (e: SlideElement) => (e as SlideElement & { fill?: unknown }).fill;
    const subject = asFill(markerFor(elements, 's2', 'c0')!);

    // Named on a middle series, the SAME paint moves with the emphasis rather
    // than the dot taking series slot 1's tint.
    const named = compile(chart((s) => (s.emphasis = 's1'))).elements;
    expect(asFill(markerFor(named, 's1', 'c0')!)).toEqual(subject);
    expect(markerFor(named, 's1', 'c0')!.rect.w).toBeGreaterThan(
      markerFor(named, 's2', 'c0')!.rect.w,
    );
  });

  it('draws every marker alike when emphasis is off', () => {
    const flat = compile(chart((s) => (s.emphasis = null))).elements;
    const sizes = ['s0', 's1', 's2'].map((k) => markerFor(flat, k, 'c0')!.rect.w);
    // No subject, so the leading rungs are all this chart has: they still step,
    // and nothing is blown up to twice the size of its neighbour.
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.4);
  });

  it('runs the ladder to five markers and flattens past it', () => {
    const five = compile(
      chart((s) => {
        s.data.categories = [{ key: 'c0', label: 'Gross margin' }];
        s.data.series = [0, 1, 2, 3, 4].map((i) => ({
          key: `s${i}`,
          name: `M${i}`,
          values: [10 + i * 10],
        }));
      }),
    ).elements;
    const sizes = [0, 1, 2, 3, 4].map((i) => markerFor(five, `s${i}`, 'c0')!.rect.w);
    // Five distinct rungs, strictly increasing.
    expect(new Set(sizes).size).toBe(5);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);

    const six = compile(
      chart((s) => {
        s.data.categories = [{ key: 'c0', label: 'Gross margin' }];
        s.data.series = [0, 1, 2, 3, 4, 5].map((i) => ({
          key: `s${i}`,
          name: `M${i}`,
          values: [10 + i * 10],
        }));
      }),
    ).elements;
    const leading = [0, 1, 2, 3, 4].map((i) => markerFor(six, `s${i}`, 'c0')!.rect.w);
    expect(new Set(leading).size).toBe(1);
    expect(markerFor(six, 's5', 'c0')!.rect.w).toBeGreaterThan(leading[0]);
  });

  it('sets the subject’s number larger, and puts it under the track', () => {
    const { elements } = compile(chart());
    const labelFor = (series: string) =>
      elements
        .filter(isText)
        .find((e) => e.chartRef?.part === 'label' && e.chartRef.series === series)!;
    const sizeOf = (e: ReturnType<typeof labelFor>) =>
      e.body.paragraphs[0].runs[0].sizePt ?? 0;
    expect(sizeOf(labelFor('s2'))).toBeGreaterThan(sizeOf(labelFor('s0')));

    // Below the track on a horizontal chart, with the comparators above it.
    const track = elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 'track',
    )!;
    const mid = track.rect.y + track.rect.h / 2;
    expect(labelFor('s2').rect.y).toBeGreaterThan(mid);
    expect(labelFor('s0').rect.y).toBeLessThan(mid);
  });

  it('never forces zero onto the value axis — the spread is the whole chart', () => {
    const { elements } = compile(
      chart((s) => {
        s.data.series = [
          { key: 's0', name: 'Us', values: [42] },
          { key: 's1', name: 'Peers', values: [67] },
        ];
        s.data.categories = [{ key: 'c0', label: 'Cost per unit' }];
      }),
    );
    const ticks = elements
      .filter(isText)
      .filter((e) => e.role === 'chart.tick')
      .map((e) => e.body.paragraphs[0].runs[0].text);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).not.toBe('0');
  });

  it('labels every marker, and keeps two labels on one track from overlapping', () => {
    const { elements } = compile(
      chart((s) => {
        s.data.categories = [{ key: 'c0', label: 'Gross margin' }];
        // Two numbers a hair apart: their labels cannot both sit above the dot.
        s.data.series = [
          { key: 's0', name: 'FY23', values: [51] },
          { key: 's1', name: 'FY25', values: [52] },
        ];
      }),
    );
    const [a, b] = labels(elements);
    expect(labels(elements)).toHaveLength(2);
    const overlaps = (p: SlideElement, q: SlideElement) =>
      p.rect.x < q.rect.x + q.rect.w &&
      q.rect.x < p.rect.x + p.rect.w &&
      p.rect.y < q.rect.y + q.rect.h &&
      q.rect.y < p.rect.y + p.rect.h;
    expect(overlaps(a, b)).toBe(false);
  });

  it('prints a per-datum caption beyond the number, in smaller muted type', () => {
    const { elements } = compile(
      chart((s) => {
        s.data.categories = [{ key: 'c0', label: 'Gross margin' }];
        s.data.series = [
          { key: 's0', name: 'Baseline', values: [30], pointOverrides: { c0: { note: 'FY23' } } },
          { key: 's1', name: 'Today', values: [52], pointOverrides: { c0: { note: 'Q2 FY26' } } },
        ];
      }),
    );
    const textOf = (e: SlideElement) => (isText(e) ? e.body.paragraphs[0].runs[0].text : '');
    const captions = labels(elements).filter((e) => e.chartRef?.part === 'label' && e.chartRef.point.endsWith('.note'));
    expect(captions.map(textOf)).toEqual(['Q2 FY26', 'FY23']);

    const numberFor = (series: string) =>
      labels(elements).find(
        (e) => e.chartRef?.part === 'label' && e.chartRef.series === series && e.chartRef.point === 'c0',
      )!;
    const captionFor = (series: string) =>
      labels(elements).find(
        (e) => e.chartRef?.part === 'label' && e.chartRef.series === series && e.chartRef.point === 'c0.note',
      )!;
    const sizeOf = (e: SlideElement) => (isText(e) ? (e.body.paragraphs[0].runs[0].sizePt ?? 0) : 0);
    expect(sizeOf(captionFor('s0'))).toBeLessThan(sizeOf(numberFor('s0')));

    // Beyond the number, on the number's own side of the track: the subject's
    // block hangs below the track and its comparator's sits above it.
    const track = elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 'track',
    )!;
    const mid = track.rect.y + track.rect.h / 2;
    expect(captionFor('s1').rect.y).toBeGreaterThan(numberFor('s1').rect.y);
    expect(numberFor('s1').rect.y).toBeGreaterThan(mid);
    expect(captionFor('s0').rect.y).toBeLessThan(numberFor('s0').rect.y);
    expect(captionFor('s0').rect.y + captionFor('s0').rect.h).toBeLessThan(mid);
  });

  it('prints a caption even where the numbers are turned off', () => {
    const { elements } = compile(
      chart((s) => {
        s.decorations.labels = { ...s.decorations.labels, show: false };
        s.data.categories = [{ key: 'c0', label: 'Gross margin' }];
        s.data.series = [
          { key: 's0', name: 'Today', values: [52], pointOverrides: { c0: { note: 'Q2 FY26' } } },
        ];
      }),
    );
    expect(
      labels(elements).map((e) => (isText(e) ? e.body.paragraphs[0].runs[0].text : '')),
    ).toEqual(['Q2 FY26']);
  });

  it('honours a hidden point and a series told to draw no marker', () => {
    const hidden = compile(
      chart((s) => {
        s.data.series[0].pointOverrides = { c0: { hidden: true } };
      }),
    ).elements;
    expect(markerFor(hidden, 's0', 'c0')).toBeUndefined();
    expect(markerFor(hidden, 's2', 'c0')).toBeDefined();

    const none = compile(
      chart((s) => {
        s.data.series[0].format = { marker: { shape: 'none', sizeEmu: 0 } };
      }),
    ).elements;
    expect(markerFor(none, 's0', 'c0')).toBeUndefined();
  });

  it('draws a stem per point when the connector runs to the axis', () => {
    const { elements } = compile(chart((s) => (s.connector = 'axis')));
    const stems = marks(elements).filter(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 'track',
    );
    // One per datum, rather than one per row.
    expect(stems).toHaveLength(9);

    const bare = compile(chart((s) => (s.connector = 'none'))).elements;
    expect(
      marks(bare).filter((e) => e.chartRef?.part === 'mark' && e.chartRef.series === 'track'),
    ).toHaveLength(0);
  });
});

describe('dotEmphasisKey', () => {
  const spec = defaultChartSpec('dotplot') as DotPlotSpec;

  it('falls back to the last series when the named one is gone', () => {
    expect(dotEmphasisKey({ ...spec, emphasis: 'nope' }, ['s0', 's1'])).toBe('s1');
    expect(dotEmphasisKey(spec, ['s0', 's1'])).toBe('s1');
    expect(dotEmphasisKey({ ...spec, emphasis: null }, ['s0', 's1'])).toBeNull();
    expect(dotEmphasisKey(spec, [])).toBeNull();
  });
});
