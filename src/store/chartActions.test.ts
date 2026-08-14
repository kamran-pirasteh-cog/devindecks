import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  inchesToEmu,
  isShape,
  legendSeriesKey,
  migrateDeck,
  reidentifyCharts,
  type ChartRef,
  type ColumnBarSpec,
  type Deck,
  type ShapeElement,
  type Slide,
  type SlideChartConfig,
  type SlideElement,
  type WaterfallSpec,
} from '@/model';
import { compileChart } from '@/chart/compile';
import {
  applyChartFormat,
  chartElementIdsBefore,
  chartsForElements,
  detachChartFrom,
  insertChartInto,
  recompileInto,
  repairChartSelection,
  removeChartFrom,
  chartElementRects,
  resizeChartFrames,
  syncChartGeometry,
  translateChartFrames,
} from './chartActions';

const DS = DEFAULT_DESIGN_SYSTEM;
const FRAME = { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(6), h: inchesToEmu(4) };
const compile = (c: Parameters<typeof compileChart>[0]) => compileChart(c, DS).elements;

const title = (): SlideElement => ({
  id: 'title-1',
  type: 'text',
  rect: { x: 0, y: 0, w: 100, h: 100 },
  body: { paragraphs: [{ runs: [{ text: 'Hello' }] }] },
});

const emptySlide = (): Slide => ({ id: 's1', elements: [title()] });

const marksOf = (slide: Slide, chartId: string) =>
  slide.elements.filter((e) => e.chartRef?.chartId === chartId && e.chartRef.part === 'mark');

describe('insertChartInto', () => {
  it('adds a chart without disturbing what is already on the slide', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    expect(slide.elements.find((e) => e.id === 'title-1')).toBeDefined();
    expect(slide.charts).toHaveLength(1);
  });

  it('supports two charts on one slide, each editable on its own', () => {
    const slide = emptySlide();
    const a = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const b = insertChartInto(slide, defaultChartSpec('bar', 'clustered'), FRAME, DS);
    expect(slide.charts).toHaveLength(2);

    const beforeB = marksOf(slide, b.id).length;
    // Edit A only.
    (slide.charts![0].spec as ColumnBarSpec).data.categories.pop();
    (slide.charts![0].spec as ColumnBarSpec).data.series.forEach((s) => s.values.pop());
    recompileInto(slide, a.id, DS);

    // This is the exact regression the old whole-slide update caused.
    expect(marksOf(slide, b.id)).toHaveLength(beforeB);
    expect(slide.elements.find((e) => e.id === 'title-1')).toBeDefined();
  });
});

describe('recompileInto', () => {
  it('reflects a data edit', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'clustered'), FRAME, DS);
    const before = marksOf(slide, chart.id).length;

    (slide.charts![0].spec as ColumnBarSpec).data.categories.push({ key: 'c9', label: 'FY26' });
    (slide.charts![0].spec as ColumnBarSpec).data.series.forEach((s) => s.values.push(700));
    recompileInto(slide, chart.id, DS);

    expect(marksOf(slide, chart.id).length).toBeGreaterThan(before);
  });

  it('keeps element identity stable so selection survives an edit', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const idsBefore = marksOf(slide, chart.id).map((e) => e.id);

    (slide.charts![0].spec as ColumnBarSpec).data.series[0].values[0] = 999;
    recompileInto(slide, chart.id, DS);

    expect(marksOf(slide, chart.id).map((e) => e.id)).toEqual(idsBefore);
  });
});

describe('removeChartFrom / detachChartFrom', () => {
  it('deletes a chart and nothing else', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column'), FRAME, DS);
    removeChartFrom(slide, chart.id);
    expect(slide.charts).toHaveLength(0);
    expect(slide.elements).toHaveLength(1);
  });

  it('detaching keeps the shapes but cuts the data link', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column'), FRAME, DS);
    const count = slide.elements.length;
    detachChartFrom(slide, chart.id);
    expect(slide.elements).toHaveLength(count);
    expect(slide.elements.every((e) => e.chartRef === undefined)).toBe(true);
    expect(slide.charts).toHaveLength(0);
  });
});

describe('syncChartGeometry', () => {
  const dragged = (slide: Slide, chartId: string, dx: number, dy: number) => {
    for (const el of slide.elements) {
      if (el.chartRef?.chartId === chartId) {
        el.rect = { ...el.rect, x: el.rect.x + dx, y: el.rect.y + dy };
      }
    }
  };

  it('a drag translates the frame and leaves the layout alone', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const before = chartElementRects(slide, chart.id);
    const rectsBefore = marksOf(slide, chart.id).map((e) => ({ ...e.rect }));

    dragged(slide, chart.id, 50_000, 20_000);
    syncChartGeometry(slide, chart.id, before, DS);

    expect(slide.charts![0].frame.x).toBe(FRAME.x + 50_000);
    expect(slide.charts![0].frame.y).toBe(FRAME.y + 20_000);
    // No relayout: every mark simply moved with the drag.
    marksOf(slide, chart.id).forEach((e, i) => {
      expect(e.rect.x).toBe(rectsBefore[i].x + 50_000);
      expect(e.rect.w).toBe(rectsBefore[i].w);
    });
  });

  it('a resize relayouts rather than scaling the type', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const before = chartElementRects(slide, chart.id);
    const labelSize = (s: Slide) => {
      const t = s.elements.find((e) => e.chartRef?.part === 'axis' && e.type === 'text');
      return t?.type === 'text' ? t.body.paragraphs[0].runs[0].sizePt : undefined;
    };
    const sizeBefore = labelSize(slide);

    // Double the width, as a corner drag would.
    for (const el of slide.elements) {
      if (el.chartRef?.chartId !== chart.id) continue;
      el.rect = { ...el.rect, x: FRAME.x + (el.rect.x - FRAME.x) * 2, w: el.rect.w * 2 };
    }
    syncChartGeometry(slide, chart.id, before, DS);

    expect(slide.charts![0].frame.w).toBeGreaterThan(FRAME.w * 1.5);
    // The whole point: text stays the size the author chose.
    expect(labelSize(slide)).toBe(sizeBefore);
  });

  it('leaves a frozen chart to scale affinely', () => {
    const slide = emptySlide();
    const { id: chartId } = insertChartInto(slide, defaultChartSpec('column'), FRAME, DS);
    slide.charts![0].frozen = true;
    const before = chartElementRects(slide, chartId);
    for (const el of slide.elements) {
      if (el.chartRef?.chartId === chartId) el.rect = { ...el.rect, w: el.rect.w * 2 };
    }
    syncChartGeometry(slide, chartId, before, DS);
    expect(slide.charts![0].frame.w).toBe(FRAME.w);
  });
});

describe('translateChartFrames', () => {
  it('moves the frame with a keyboard nudge', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column'), FRAME, DS);
    const ids = slide.elements.filter((e) => e.chartRef).map((e) => e.id);
    translateChartFrames(slide, ids, 1000, -500);
    expect(slide.charts![0].frame).toMatchObject({ x: FRAME.x + 1000, y: FRAME.y - 500 });
  });
});

describe('applyChartFormat', () => {
  const fillOf = (el: SlideElement | undefined) =>
    el && isShape(el) ? (el as ShapeElement).fill : undefined;

  it('writes to the SERIES when every point of it is selected', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const ids = slide.elements
      .filter((e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0')
      .map((e) => e.id);

    expect(applyChartFormat(slide, ids, { fill: { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } } })).toBe(true);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].format?.fill).toMatchObject({ kind: 'solid' });
    // Not a pile of per-point overrides.
    expect(spec.data.series[0].pointOverrides).toBeUndefined();

    recompileInto(slide, chart.id, DS);
    const recoloured = slide.elements.filter(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0',
    );
    expect(recoloured.every((e) => fillOf(e)?.kind === 'solid')).toBe(true);
  });

  it('writes a point override when only one bar is selected', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const one = slide.elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;

    applyChartFormat(slide, [one.id], { fill: { kind: 'solid', color: { kind: 'hex', hex: '#00FF00' } } });
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(Object.keys(spec.data.series[0].pointOverrides ?? {})).toEqual(['c1']);
  });

  it('survives a recompile — the point of routing through the spec', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const one = slide.elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;
    applyChartFormat(slide, [one.id], { fill: { kind: 'solid', color: { kind: 'hex', hex: '#00FF00' } } });

    // Now edit the data, which is what would have wiped an element-level fill.
    (slide.charts![0].spec as ColumnBarSpec).data.series[0].values[0] = 12;
    recompileInto(slide, chart.id, DS);

    const after = slide.elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    );
    expect(fillOf(after)).toMatchObject({ color: { kind: 'hex', hex: '#00FF00' } });
  });

  it('clears shadowing point fills when the whole series is recoloured', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    spec.data.series[0].pointOverrides = {
      c1: { format: { fill: { kind: 'solid', color: { kind: 'hex', hex: '#00FF00' } } } },
    };
    const ids = slide.elements
      .filter((e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0')
      .map((e) => e.id);

    applyChartFormat(slide, ids, { fill: { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } } });
    expect(spec.data.series[0].pointOverrides!.c1.format?.fill).toBeUndefined();
  });

  it('declines a non-chart selection so ordinary shapes take the normal path', () => {
    const slide = emptySlide();
    expect(applyChartFormat(slide, ['title-1'], { fill: { kind: 'none' } })).toBe(false);
  });

  it('recolours a waterfall bar, which has an item rather than a series', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('waterfall'), FRAME, DS);
    const bar = slide.elements.find((e) => e.chartRef?.part === 'mark')!;
    const key = (bar.chartRef as Extract<ChartRef, { part: 'mark' }>).point;

    expect(
      applyChartFormat(slide, [bar.id], {
        fill: { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } },
      }),
    ).toBe(true);

    const spec = slide.charts![0].spec as WaterfallSpec;
    expect(spec.data.items.find((i) => i.key === key)?.format?.fill).toMatchObject({
      color: { kind: 'hex', hex: '#FF0000' },
    });

    // And it survives the recompile, same as the series path.
    recompileInto(slide, chart.id, DS);
    const after = slide.elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.point === key,
    );
    expect(fillOf(after)).toMatchObject({ color: { kind: 'hex', hex: '#FF0000' } });
  });
});

describe('legendSeriesKey', () => {
  it('strips the id-only suffix the legend TEXT carries', () => {
    expect(legendSeriesKey({ chartId: 'c', part: 'legend.item', series: 's1' })).toBe('s1');
    expect(legendSeriesKey({ chartId: 'c', part: 'legend.item', series: 's1.label' })).toBe('s1');
  });

  it('leaves a series whose own key merely contains "label" alone', () => {
    expect(legendSeriesKey({ chartId: 'c', part: 'legend.item', series: 'labels' })).toBe('labels');
  });
});

describe('chartsForElements', () => {
  it('finds every chart a selection touches, and no others', () => {
    const slide = emptySlide();
    const a = insertChartInto(slide, defaultChartSpec('column'), FRAME, DS);
    insertChartInto(slide, defaultChartSpec('bar'), FRAME, DS);
    const oneOfA = slide.elements.find((e) => e.chartRef?.chartId === a.id)!.id;
    expect(chartsForElements(slide, [oneOfA, 'title-1']).map((c) => c.id)).toEqual([a.id]);
  });
});

describe('reidentifyCharts', () => {
  it('gives a copied slide its own chart, with matching element ids', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column'), FRAME, DS);
    const copy = reidentifyCharts(JSON.parse(JSON.stringify(slide)));

    expect(copy.charts![0].id).not.toBe(slide.charts![0].id);
    const chartId = copy.charts![0].id;
    const owned = copy.elements.filter((e) => e.chartRef);
    expect(owned.every((e) => e.id.startsWith(`${chartId}::`))).toBe(true);
    expect(owned.every((e) => e.chartRef!.chartId === chartId)).toBe(true);
    expect(owned.every((e) => e.groupIds?.[0] === copy.charts![0].groupId)).toBe(true);
  });

  it('the copy recompiles independently of the original', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'clustered'), FRAME, DS);
    const copy = reidentifyCharts(JSON.parse(JSON.stringify(slide)));

    (copy.charts![0].spec as ColumnBarSpec).data.categories = [{ key: 'c0', label: 'Only' }];
    (copy.charts![0].spec as ColumnBarSpec).data.series.forEach((s) => (s.values = [1]));
    recompileInto(copy, copy.charts![0].id, DS);

    expect(marksOf(copy, copy.charts![0].id)).toHaveLength(3);
    expect(marksOf(slide, slide.charts![0].id)).toHaveLength(9);
  });
});

describe('migrateDeck', () => {
  const legacy: SlideChartConfig = {
    type: 'bar',
    orientation: 'vertical',
    data: {
      categories: ['A', 'B'],
      series: [{ name: 'S', color: { kind: 'hex', hex: '#123456' }, values: [1, 2] }],
    },
    box: { w: 8, h: 4 },
    xLabel: 'X',
    yLabel: 'Y',
  };

  const deckWith = (slide: Slide): Deck => ({
    id: 'd1',
    title: 'T',
    slideSize: { w: 12_192_000, h: 6_858_000 },
    slides: [slide],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: '',
    updatedAt: '',
  });

  it('turns a legacy bar chart into a chart instance', () => {
    const deck = deckWith({ id: 's1', elements: [], chart: legacy });
    const out = migrateDeck(deck, compile);
    expect(out.slides[0].chart).toBeUndefined();
    expect(out.slides[0].charts).toHaveLength(1);
    expect(out.slides[0].elements.length).toBeGreaterThan(0);
    const spec = out.slides[0].charts![0].spec as ColumnBarSpec;
    expect(spec.kind).toBe('column');
    expect(spec.axes.x.title).toBe('X');
    expect(spec.data.series[0].format?.fill).toMatchObject({ color: { kind: 'hex', hex: '#123456' } });
  });

  it('maps a horizontal legacy bar to a bar chart', () => {
    const deck = deckWith({ id: 's1', elements: [], chart: { ...legacy, orientation: 'horizontal' } });
    expect(migrateDeck(deck, compile).slides[0].charts![0].spec.kind).toBe('bar');
  });

  it.each(['bar', 'line', 'area', 'pie', 'donut', 'scatter'] as const)(
    'migrates a legacy %s chart into a drawable instance',
    (type) => {
      const out = migrateDeck(deckWith({ id: 's1', elements: [], chart: { ...legacy, type } }), compile);
      expect(out.slides[0].chart).toBeUndefined();
      expect(out.slides[0].charts).toHaveLength(1);
      // The point of migrating: it renders, rather than going blank.
      expect(out.slides[0].elements.length).toBeGreaterThan(0);
    },
  );

  it('carries a legacy scatter across using the category index as x', () => {
    // The old model had no x column, so this is the only honest reading.
    const out = migrateDeck(
      deckWith({ id: 's1', elements: [], chart: { ...legacy, type: 'scatter' } }),
      compile,
    );
    const spec = out.slides[0].charts![0].spec;
    expect(spec.kind).toBe('scatter');
    if (spec.kind === 'scatter') {
      expect(spec.data.series[0].points.map((p) => p.x)).toEqual([0, 1]);
      expect(spec.data.series[0].points.map((p) => p.y)).toEqual([1, 2]);
      expect(spec.data.series[0].points.map((p) => p.label)).toEqual(['A', 'B']);
    }
  });

  it('is idempotent', () => {
    const deck = deckWith({ id: 's1', elements: [], chart: legacy });
    const once = migrateDeck(deck, compile);
    const twice = migrateDeck(once, compile);
    expect(twice).toBe(once);
  });

  it('leaves a deck with no charts untouched apart from the version stamp', () => {
    const deck = deckWith(emptySlide());
    const out = migrateDeck(deck, compile);
    expect(out.slides[0].elements).toEqual(deck.slides[0].elements);
    expect(out.schemaVersion).toBeGreaterThan(0);
  });
});

describe('resizeChartFrames', () => {
  const STEP = inchesToEmu(0.083);
  const MIN = inchesToEmu(0.05);
  const ids = (slide: Slide, chartId: string) =>
    slide.elements.filter((e) => e.chartRef?.chartId === chartId).map((e) => e.id);

  it('grows the frame by exactly the step it was given', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    resizeChartFrames(slide, ids(slide, chart.id), STEP, 0, DS, MIN);
    expect(slide.charts![0].frame).toEqual({ ...FRAME, w: FRAME.w + STEP });
  });

  it('is exact over a run of presses — the bug that made charts jump', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    for (let i = 0; i < 10; i++) {
      resizeChartFrames(slide, ids(slide, chart.id), STEP, STEP, DS, MIN);
    }
    // Ten presses, ten steps, and the origin never moved. Inferring the frame
    // from the elements' union drifted on every press instead.
    expect(slide.charts![0].frame).toEqual({
      x: FRAME.x,
      y: FRAME.y,
      w: FRAME.w + STEP * 10,
      h: FRAME.h + STEP * 10,
    });
  });

  it('relayouts into the new frame rather than scaling the type', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const sizeOf = (s: Slide) => {
      const label = s.elements.find((e) => e.chartRef?.part === 'label');
      return label && 'body' in label ? label.body?.paragraphs[0]?.runs[0]?.sizePt : undefined;
    };
    const before = sizeOf(slide);
    resizeChartFrames(slide, ids(slide, chart.id), inchesToEmu(2), inchesToEmu(1), DS, MIN);
    expect(sizeOf(slide)).toBe(before);
    // ...and the marks did move, so it really did lay out again.
    expect(marksOf(slide, chart.id).length).toBeGreaterThan(0);
  });

  it('never shrinks past the minimum', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    resizeChartFrames(slide, ids(slide, chart.id), -FRAME.w * 2, -FRAME.h * 2, DS, MIN);
    expect(slide.charts![0].frame.w).toBe(MIN);
    expect(slide.charts![0].frame.h).toBe(MIN);
  });

  it('leaves a frozen chart alone', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    slide.charts![0].frozen = true;
    resizeChartFrames(slide, ids(slide, chart.id), STEP, STEP, DS, MIN);
    expect(slide.charts![0].frame).toEqual(FRAME);
  });

  it('ignores element ids that belong to no chart', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    resizeChartFrames(slide, ['title-1'], STEP, STEP, DS, MIN);
    expect(slide.charts![0].frame).toEqual(FRAME);
  });
});

describe('repairChartSelection', () => {
  const ids = (slide: Slide, chartId: string) =>
    slide.elements.filter((e) => e.chartRef?.chartId === chartId).map((e) => e.id);

  it('keeps the whole chart selected across a relayout that changes its parts', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const before = chartElementIdsBefore(slide, [chart.id]);
    const selected = ids(slide, chart.id);

    // A much shorter frame fits fewer y ticks, so ids the selection was made
    // against stop existing — the resize case from the bug report.
    slide.charts![0].frame = { ...FRAME, h: inchesToEmu(2) };
    recompileInto(slide, chart.id, DS);

    const after = ids(slide, chart.id);
    expect(after).not.toEqual(selected); // the premise: the part set really moved
    expect(repairChartSelection(slide, before, selected).sort()).toEqual([...after].sort());
  });

  it('drops parts that no longer exist from a drilled-in selection', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const before = chartElementIdsBefore(slide, [chart.id]);
    const mark = marksOf(slide, chart.id)[0].id;
    const ghost = `${chart.id}::axis.y.tick.99`;
    before.set(chart.id, [...before.get(chart.id)!, ghost]);

    expect(repairChartSelection(slide, before, [mark, ghost])).toEqual([mark]);
  });

  it('falls back to the whole chart when every drilled part went away', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const ghost = `${chart.id}::axis.y.tick.99`;
    const before = new Map([[chart.id, [ghost]]]);

    expect(repairChartSelection(slide, before, [ghost]).sort()).toEqual(
      [...ids(slide, chart.id)].sort(),
    );
  });

  it('leaves a selection that never touched the chart alone', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const before = chartElementIdsBefore(slide, [chart.id]);
    expect(repairChartSelection(slide, before, ['title-1'])).toEqual(['title-1']);
  });

  it('keeps non-chart neighbours in place around the repaired parts', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const before = chartElementIdsBefore(slide, [chart.id]);
    const mark = marksOf(slide, chart.id)[0].id;
    expect(repairChartSelection(slide, before, [mark, 'title-1'])).toEqual([mark, 'title-1']);
  });
});
