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
  type LineSpec,
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
  applyChartTextFormat,
  chartFontFromRun,
  chartElementIdsBefore,
  chartsForElements,
  clearChartFormatting,
  detachChartFrom,
  insertChartInto,
  recolorLegendEntry,
  legendEntryColor,
  recompileInto,
  repairChartSelection,
  removeChartFrom,
  chartElementRects,
  deleteChartParts,
  resizeChartFrames,
  runSizeOf,
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

describe('recolorLegendEntry', () => {
  // A bar is a shape and a pie slice is a path, and both carry a fill.
  const fillOf = (el: SlideElement | undefined) =>
    el && 'fill' in el ? JSON.stringify(el.fill) : '';

  /** The legend key a swatch carries, which is what the panel hands the action. */
  const legendKeys = (slide: Slide): string[] =>
    slide.elements
      .filter((e) => e.chartRef?.part === 'legend.item')
      .map((e) => legendSeriesKey(e.chartRef as Extract<ChartRef, { part: 'legend.item' }>));

  it('recolours the whole series a legend key stands for', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;

    expect(
      recolorLegendEntry(spec, 's0', { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } }),
    ).toBe(true);
    expect(spec.data.series[0].format?.fill).toMatchObject({
      color: { kind: 'hex', hex: '#FF0000' },
    });

    recompileInto(slide, chart.id, DS);
    const marks = slide.elements.filter(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0',
    );
    expect(marks.length).toBeGreaterThan(1);
    expect(marks.every((e) => fillOf(e).includes('#FF0000'))).toBe(true);
  });

  it('takes the key from the legend as compiled, swatch or text', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    for (const key of legendKeys(slide)) {
      expect(
        recolorLegendEntry(spec, key, { kind: 'solid', color: { kind: 'hex', hex: '#123456' } }),
      ).toBe(true);
    }
  });

  it('clears the per-point fills that would shadow the colour just set', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    spec.data.series[0].pointOverrides = {
      c1: { format: { fill: { kind: 'solid', color: { kind: 'hex', hex: '#00FF00' } } } },
    };

    recolorLegendEntry(spec, 's0', { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } });
    expect(spec.data.series[0].pointOverrides!.c1.format?.fill).toBeUndefined();
  });

  it('repaints a line with the colour, outline and all', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('line'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    spec.data.series[0].format = {
      outline: { color: { kind: 'hex', hex: '#000000' }, widthEmu: 12700, dash: 'solid' },
    };

    recolorLegendEntry(spec, 's0', { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } });
    // A line takes its colour from the outline: a stale one left behind would
    // recolour the dots and leave the line black.
    expect(spec.data.series[0].format?.outline?.color).toMatchObject({ hex: '#FF0000' });
  });

  it("gives a pie's legend entry the SLICE, since that is what it lists", () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('pie'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    const key = legendKeys(slide)[0]!;

    expect(
      recolorLegendEntry(spec, key, { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } }),
    ).toBe(true);
    expect(spec.data.series[0].pointOverrides?.[key]?.format?.fill).toMatchObject({
      color: { kind: 'hex', hex: '#FF0000' },
    });
    // The other slices keep the palette.
    expect(Object.keys(spec.data.series[0].pointOverrides!)).toEqual([key]);

    recompileInto(slide, chart.id, DS);
    const slice = slide.elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.point === key,
    );
    expect(fillOf(slice)).toContain('#FF0000');
  });

  it('clearing puts the entry back on the palette rather than writing a colour', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;

    recolorLegendEntry(spec, 's0', { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } });
    expect(recolorLegendEntry(spec, 's0', undefined)).toBe(true);
    expect(spec.data.series[0].format?.fill).toBeUndefined();
    expect(legendEntryColor(spec, 's0')).toEqual({ fill: undefined });
  });

  it('says no to a key that addresses nothing, so it costs no undo step', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(recolorLegendEntry(spec, 'nope', { kind: 'none' })).toBe(false);
    expect(legendEntryColor(spec, 'nope')).toBeNull();
  });
});

describe('clearChartFormatting', () => {
  it('drops hand-applied colour and type, and says it did', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;

    const ids = slide.elements
      .filter((e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0')
      .map((e) => e.id);
    applyChartFormat(slide, ids, { fill: { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } } });
    spec.titleFont = { sizePt: 30 };
    spec.legend.font = { bold: true };
    spec.axes.y.font = { sizePt: 6 };
    spec.palette = [{ kind: 'hex', hex: '#123456' }];
    spec.data.series[1]!.pointOverrides = {
      c1: { format: { fill: { kind: 'solid', color: { kind: 'hex', hex: '#00FF00' } } } },
    };

    expect(clearChartFormatting(spec)).toBe(true);
    expect(spec.data.series[0]!.format).toBeUndefined();
    expect(spec.titleFont).toBeUndefined();
    expect(spec.legend.font).toBeUndefined();
    expect(spec.axes.y.font).toBeUndefined();
    expect(spec.palette).toBeUndefined();
    // The override carried nothing but the colour, so the entry goes too.
    expect(spec.data.series[1]!.pointOverrides).toBeUndefined();

    // And the chart draws again — at the brand's colours, not the red.
    recompileInto(slide, chart.id, DS);
    const marks = slide.elements.filter(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0',
    );
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) {
      const fill = isShape(m) ? (m as ShapeElement).fill : undefined;
      expect(JSON.stringify(fill)).not.toContain('FF0000');
    }
  });

  it('keeps the data and the choices that are not formatting', () => {
    const spec = defaultChartSpec('column', 'stacked') as ColumnBarSpec;
    const before = JSON.parse(
      JSON.stringify({
        categories: spec.data.categories,
        values: spec.data.series.map((s) => s.values),
      }),
    );
    spec.decorations.labels.show = true;
    spec.decorations.labels.placement = 'insideEnd';
    spec.decorations.labels.font = { sizePt: 14 };
    spec.axes.y.max = 500;
    spec.data.series[0]!.pointOverrides = { c1: { hidden: true, labelOffset: { dx: 9, dy: 9 } } };

    clearChartFormatting(spec);

    expect({
      categories: spec.data.categories,
      values: spec.data.series.map((s) => s.values),
    }).toEqual(before);
    expect(spec.decorations.labels.show).toBe(true);
    expect(spec.decorations.labels.placement).toBe('insideEnd');
    expect(spec.decorations.labels.font).toBeUndefined();
    expect(spec.axes.y.max).toBe(500);
    expect(spec.stack).toBe('stacked');
    // A hidden point is a content decision; only the nudge was formatting.
    expect(spec.data.series[0]!.pointOverrides!.c1).toEqual({ hidden: true });
  });

  it('reports no change for a chart nobody restyled, so it costs no undo step', () => {
    expect(clearChartFormatting(defaultChartSpec('column'))).toBe(false);
    expect(clearChartFormatting(defaultChartSpec('waterfall'))).toBe(false);
  });

  it('resets a waterfall bar, whose format lives on the item', () => {
    const spec = defaultChartSpec('waterfall') as WaterfallSpec;
    spec.data.items[0]!.format = { fill: { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } } };
    expect(clearChartFormatting(spec)).toBe(true);
    expect(spec.data.items[0]!.format).toBeUndefined();
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

describe('syncChartGeometry', () => {
  it('refuses a degenerate frame rather than flattening the chart', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const before = chartElementRects(slide, chart.id);
    // What a group resize used to hand it: every box flattened on one axis.
    for (const el of slide.elements) {
      if (el.chartRef) el.rect = { ...el.rect, h: 0 };
    }
    syncChartGeometry(slide, chart.id, before, DS);
    expect(slide.charts![0].frame.h).toBeGreaterThan(0);
    expect(slide.charts![0].frame.w).toBe(FRAME.w);
  });
});

describe('applyChartTextFormat', () => {
  const sizeOf = (slide: Slide, suffix: string) => {
    const el = slide.elements.find((e) => e.id.endsWith(suffix));
    return el && el.type === 'text' ? el.body.paragraphs[0].runs[0].sizePt : undefined;
  };

  it('writes a point override when one label is selected, and keeps it across a recompile', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const one = slide.elements.find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;

    expect(applyChartTextFormat(slide, [one.id], DS, () => ({ sizePt: 18 }))).toEqual([one.id]);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].pointOverrides?.c1?.label?.font?.sizePt).toBe(18);
    expect(sizeOf(slide, '::label.s0.c1')).toBe(18);

    // A resize is a recompile, which is what used to reset the size.
    resizeChartFrames(slide, [one.id], inchesToEmu(1), inchesToEmu(1), DS, inchesToEmu(1));
    expect(sizeOf(slide, '::label.s0.c1')).toBe(18);
  });

  /*
   * Bold and italic on a SINGLE data label — the editorial act these exist for:
   * marking out the one number that is pro-forma, or estimated, or the point of
   * the slide. Both travel the same road as a size step (`chartFontFromRun` →
   * `writeLabelFonts` → `labelHomeFor`), so what these prove is that the road
   * carries them: that the override lands on the narrowest node, survives a
   * recompile, and does not touch the label next to it.
   */
  const runOf = (slide: Slide, suffix: string) => {
    const el = slide.elements.find((e) => e.id.endsWith(suffix));
    return el && el.type === 'text' ? el.body.paragraphs[0].runs[0] : undefined;
  };

  it('bolds ONE data label, as a point override, and leaves its neighbours roman', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const one = slide.elements.find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;

    applyChartTextFormat(slide, [one.id], DS, () => ({ bold: true }));
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].pointOverrides?.c1?.label?.font?.bold).toBe(true);
    expect(runOf(slide, '::label.s0.c1')?.bold).toBe(true);
    // The chart-wide node is untouched, so every other label is unaffected.
    expect(spec.decorations.labels.font?.bold).toBeUndefined();
    expect(runOf(slide, '::label.s0.c2')?.bold).not.toBe(true);
  });

  it('italicizes ONE data label, and keeps it across a recompile', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const one = slide.elements.find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;

    applyChartTextFormat(slide, [one.id], DS, () => ({ italic: true }));
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].pointOverrides?.c1?.label?.font?.italic).toBe(true);
    expect(runOf(slide, '::label.s0.c1')?.italic).toBe(true);
    expect(runOf(slide, '::label.s0.c2')?.italic).not.toBe(true);

    // A resize is a recompile — the thing that used to eat formatting written
    // onto the emitted element rather than into the spec.
    resizeChartFrames(slide, [one.id], inchesToEmu(1), inchesToEmu(1), DS, inchesToEmu(1));
    expect(runOf(slide, '::label.s0.c1')?.italic).toBe(true);
  });

  it('bold and italic compose on one label rather than replacing each other', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const one = slide.elements.find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;

    applyChartTextFormat(slide, [one.id], DS, () => ({ bold: true }));
    applyChartTextFormat(slide, [one.id], DS, () => ({ italic: true }));
    const run = runOf(slide, '::label.s0.c1');
    expect(run?.bold).toBe(true);
    expect(run?.italic).toBe(true);
  });

  it('turns italic back OFF explicitly, rather than leaving it inherited', () => {
    // `false` has to survive as `false`: `fontOver` checks `!== undefined`, so a
    // cleared flag is what turns off an italic coming from the series or chart.
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const one = slide.elements.find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;

    applyChartTextFormat(slide, [one.id], DS, () => ({ italic: true }));
    applyChartTextFormat(slide, [one.id], DS, () => ({ italic: false }));
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].pointOverrides?.c1?.label?.font?.italic).toBe(false);
    expect(runOf(slide, '::label.s0.c1')?.italic).toBe(false);
  });

  it('italicizes a whole series when every one of its labels is selected', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const ids = slide.elements
      .filter((e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0')
      .map((e) => e.id);

    applyChartTextFormat(slide, ids, DS, () => ({ italic: true }));
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].labels?.font?.italic).toBe(true);
    // Scoped to the series, not scattered across point overrides.
    expect(spec.data.series[0].pointOverrides).toBeUndefined();
  });

  it('writes to the series when every one of its labels is selected', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const ids = slide.elements
      .filter((e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0')
      .map((e) => e.id);

    applyChartTextFormat(slide, ids, DS, () => ({ sizePt: 16 }));
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].labels?.font?.sizePt).toBe(16);
    expect(spec.data.series[0].pointOverrides).toBeUndefined();
  });

  it('routes an axis label to that axis, and the title to the title', () => {
    const slide = emptySlide();
    insertChartInto(slide, { ...defaultChartSpec('column', 'stacked'), title: 'Revenue' }, FRAME, DS);
    const tick = slide.elements.find(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.axis === 'y' && e.chartRef.sub === 'tick',
    )!;
    const heading = slide.elements.find((e) => e.chartRef?.part === 'title')!;

    applyChartTextFormat(slide, [tick.id, heading.id], DS, () => ({ sizePt: 12 }));
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.axes.y.font?.sizePt).toBe(12);
    expect(spec.titleFont?.sizePt).toBe(12);
  });

  it("steps a line's series label, whose only home is the series", () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('line'), FRAME, DS);
    // `end` is not one of the chart's categories, so a point override here
    // would be written and then never read — the label would not move.
    const end = slide.elements.find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0' && e.chartRef.point === 'end',
    )!;

    applyChartTextFormat(slide, [end.id], DS, () => ({ sizePt: 20 }));
    const spec = slide.charts![0].spec as LineSpec;
    expect(spec.data.series[0].labels?.font?.sizePt).toBe(20);
    expect(spec.data.series[0].pointOverrides?.end).toBeUndefined();
    expect(sizeOf(slide, '::label.s0.end')).toBe(20);
  });

  it("steps one waterfall bar's label, leaving its neighbours alone", () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('waterfall'), FRAME, DS);
    const labels = slide.elements.filter((e) => e.chartRef?.part === 'label');

    applyChartTextFormat(slide, [labels[0]!.id], DS, () => ({ sizePt: 20 }));
    const spec = slide.charts![0].spec as WaterfallSpec;
    expect(spec.data.items[0].labels?.font?.sizePt).toBe(20);
    expect(spec.decorations.labels.font?.sizePt).toBeUndefined();
    const after = slide.elements.filter((e) => e.chartRef?.part === 'label').map(runSizeOf);
    expect(after[0]).toBe(20);
    expect(after.slice(1).every((s) => s !== 20)).toBe(true);
  });

  it('claims chart parts even where the spec has no home for the change', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('column', 'stacked'), FRAME, DS);
    const bar = slide.elements.find((e) => e.chartRef?.part === 'mark')!;
    // Claimed, so the caller doesn't write a run style the next recompile eats.
    expect(applyChartTextFormat(slide, [bar.id], DS, () => ({ sizePt: 12 }))).toEqual([bar.id]);
  });

  it('leaves a plain shape to the ordinary element path', () => {
    const slide = emptySlide();
    expect(applyChartTextFormat(slide, ['title-1'], DS, () => ({ sizePt: 12 }))).toEqual([]);
  });
});

describe('chartFontFromRun', () => {
  it('keeps what a chart can store and drops what it cannot', () => {
    expect(chartFontFromRun({ sizePt: 14, bold: true })).toEqual({ sizePt: 14, bold: true });
    // Italic is storable now — `LabelFont` carries it, so ⌘I on a label reaches
    // the spec. Underline and a numeric weight still have no home there.
    expect(chartFontFromRun({ italic: true })).toEqual({ italic: true });
    expect(chartFontFromRun({ underline: true, weight: 500 })).toBeNull();
  });

  it('carries an explicit false through, so a flag can be turned OFF', () => {
    // `fontOver` gates on `!== undefined`, so `false` is the only way to clear
    // an italic inherited from the series or the chart.
    expect(chartFontFromRun({ italic: false })).toEqual({ italic: false });
    expect(chartFontFromRun({ bold: false })).toEqual({ bold: false });
  });
});

describe('deleteChartParts', () => {
  const partIds = (slide: Slide, pred: (r: ChartRef) => boolean) =>
    slide.elements.filter((e) => e.chartRef && pred(e.chartRef)).map((e) => e.id);

  const columnChart = (patch: (s: ColumnBarSpec) => void = () => {}) => {
    const slide = emptySlide();
    const spec = defaultChartSpec('column', 'clustered') as ColumnBarSpec;
    spec.title = 'Revenue';
    spec.legend.show = true;
    spec.decorations.labels.show = true;
    patch(spec);
    const chart = insertChartInto(slide, spec, FRAME, DS);
    return { slide, chart, spec: slide.charts![0].spec as ColumnBarSpec };
  };

  it('hides the legend instead of deleting the chart', () => {
    const { slide, chart } = columnChart();
    const ids = partIds(slide, (r) => r.part === 'legend.box' || r.part === 'legend.item');
    expect(ids.length).toBeGreaterThan(0);

    const { handled, removed } = deleteChartParts(slide, ids, DS);
    expect(removed).toEqual([]);
    expect(handled.size).toBe(ids.length);
    expect(slide.charts).toHaveLength(1);
    expect((slide.charts![0].spec as ColumnBarSpec).legend.show).toBe(false);
    expect(partIds(slide, (r) => r.part.startsWith('legend'))).toEqual([]);

    // And it stays gone, which an element-level delete could not promise.
    recompileInto(slide, chart.id, DS);
    expect(partIds(slide, (r) => r.part.startsWith('legend'))).toEqual([]);
  });

  it('clears the title', () => {
    const { slide } = columnChart();
    const ids = partIds(slide, (r) => r.part === 'title');
    deleteChartParts(slide, ids, DS);
    expect((slide.charts![0].spec as ColumnBarSpec).title).toBeUndefined();
    expect(partIds(slide, (r) => r.part === 'title')).toEqual([]);
  });

  it('switches off one data label as a point override, leaving the rest', () => {
    const { slide } = columnChart();
    const one = slide.elements.find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;

    deleteChartParts(slide, [one.id], DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].pointOverrides!.c1.label!.show).toBe(false);
    expect(spec.data.series[0].labels?.show).not.toBe(false);
    expect(
      partIds(slide, (r) => r.part === 'label' && r.series === 's0' && r.point === 'c1'),
    ).toEqual([]);
    expect(partIds(slide, (r) => r.part === 'label' && r.series === 's0').length).toBeGreaterThan(0);
  });

  it("writes to the series when every one of its labels is selected", () => {
    const { slide } = columnChart();
    const ids = partIds(slide, (r) => r.part === 'label' && r.series === 's0');
    deleteChartParts(slide, ids, DS);

    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].labels?.show).toBe(false);
    expect(spec.data.series[0].pointOverrides).toBeUndefined();
    expect(partIds(slide, (r) => r.part === 'label' && r.series === 's0')).toEqual([]);
    // The other series still has its numbers.
    expect(partIds(slide, (r) => r.part === 'label' && r.series === 's1').length).toBeGreaterThan(0);
  });

  it('hides an axis, and its gridlines separately', () => {
    const { slide } = columnChart((s) => {
      s.decorations.gridlines.major = { show: true };
    });
    const tick = slide.elements.find(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.axis === 'y' && e.chartRef.sub === 'tick',
    )!;
    deleteChartParts(slide, [tick.id], DS);
    expect((slide.charts![0].spec as ColumnBarSpec).axes.y.show).toBe(false);

    const grid = slide.elements.find(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.sub === 'grid',
    );
    if (grid) {
      deleteChartParts(slide, [grid.id], DS);
      expect(
        (slide.charts![0].spec as ColumnBarSpec).decorations.gridlines.major?.show,
      ).toBe(false);
    }
  });

  it('hides one bar as a point override', () => {
    const { slide } = columnChart();
    const bar = slide.elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0' && e.chartRef.point === 'c1',
    )!;
    deleteChartParts(slide, [bar.id], DS);

    const spec = slide.charts![0].spec as ColumnBarSpec;
    expect(spec.data.series[0].pointOverrides!.c1.hidden).toBe(true);
    expect(
      partIds(slide, (r) => r.part === 'mark' && r.series === 's0' && r.point === 'c1'),
    ).toEqual([]);
    expect(slide.charts).toHaveLength(1);
  });

  it('takes the legend key with a series whose every mark is deleted', () => {
    const { slide } = columnChart();
    const ids = partIds(slide, (r) => r.part === 'mark' && r.series === 's0');
    deleteChartParts(slide, ids, DS);

    expect(partIds(slide, (r) => r.part === 'mark' && r.series === 's0')).toEqual([]);
    const keys = slide.elements.filter(
      (e) => e.chartRef?.part === 'legend.item' && legendSeriesKey(e.chartRef) === 's0',
    );
    expect(keys).toEqual([]);
    // The other series keeps its key.
    expect(
      slide.elements.some(
        (e) => e.chartRef?.part === 'legend.item' && legendSeriesKey(e.chartRef) === 's1',
      ),
    ).toBe(true);
  });

  it('deletes a line whose mark is one path for the whole series', () => {
    const slide = emptySlide();
    const chart = insertChartInto(slide, defaultChartSpec('line'), FRAME, DS);
    const line = slide.elements.find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0' && e.chartRef.point === 'line',
    )!;

    deleteChartParts(slide, [line.id], DS);
    const spec = slide.charts![0].spec as ColumnBarSpec;
    // Expanded to the real points — 'line' is an id, not a datum.
    expect(spec.data.series[0].pointOverrides?.line).toBeUndefined();
    expect(Object.values(spec.data.series[0].pointOverrides!).every((o) => o.hidden)).toBe(true);
    expect(partIds(slide, (r) => r.part === 'mark' && r.series === 's0')).toEqual([]);
    expect(slide.charts!.find((c) => c.id === chart.id)).toBeDefined();
  });

  it('deletes the whole chart when the whole chart is selected', () => {
    const { slide, chart } = columnChart();
    const ids = slide.elements.filter((e) => e.chartRef?.chartId === chart.id).map((e) => e.id);

    const { removed } = deleteChartParts(slide, ids, DS);
    expect(removed).toEqual([chart.id]);
    expect(slide.charts).toHaveLength(0);
    expect(slide.elements.some((e) => e.chartRef?.chartId === chart.id)).toBe(false);
  });

  it('deletes the chart when the plot backdrop is selected — the plot IS the chart', () => {
    const { slide, chart } = columnChart();
    const plot = slide.elements.find((e) => e.chartRef?.part === 'plot')!;
    const { removed } = deleteChartParts(slide, [plot.id], DS);
    expect(removed).toEqual([chart.id]);
    expect(slide.charts).toHaveLength(0);
  });

  it('leaves a part with no spec switch alone rather than eating the chart', () => {
    const slide = emptySlide();
    insertChartInto(slide, defaultChartSpec('waterfall'), FRAME, DS);
    const bar = slide.elements.find((e) => e.chartRef?.part === 'mark')!;

    const { handled, removed } = deleteChartParts(slide, [bar.id], DS);
    expect(removed).toEqual([]);
    expect(handled.size).toBe(0);
    expect(slide.charts).toHaveLength(1);
    expect(slide.elements.find((e) => e.id === bar.id)).toBeDefined();
  });

  it('ignores a selection with no chart in it', () => {
    const slide = emptySlide();
    const { handled, removed } = deleteChartParts(slide, ['title-1'], DS);
    expect(handled.size).toBe(0);
    expect(removed).toEqual([]);
  });
});
