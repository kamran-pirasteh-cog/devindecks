import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  inchesToEmu,
  isShape,
  isText,
  type ChartInstance,
  resolveColor,
  type ColorRef,
  setChartOrientation,
  chartOrientation,
  supportsOrientation,
  canSwapAxes,
  swapAxes,
  type ChartKind,
  type ChartSpec,
  type ColumnBarSpec,
  type ScatterSpec,
  type SankeySpec,
  type WaterfallSpec,
  sampleWaterfallData,
  type LineSpec,
  type SlideElement,
  type StackMode,
} from '@/model';
import { metricMeasurer } from '@/render/measureText';
import { contrastRatio } from './color';
import { compileChart } from './compile';

const FRAME = { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(8), h: inchesToEmu(4.5) };

function chart(
  mutate: (s: ColumnBarSpec) => void = () => {},
  kind: 'column' | 'bar' = 'column',
  stack: StackMode = 'stacked',
): ChartInstance {
  const spec = defaultChartSpec(kind, stack) as ColumnBarSpec;
  mutate(spec);
  return { id: 'c1', groupId: 'g1', frame: FRAME, spec };
}

const compile = (c: ChartInstance) => compileChart(c, DEFAULT_DESIGN_SYSTEM, metricMeasurer());

const byRole = (els: SlideElement[], role: string) => els.filter((e) => e.role === role);
const texts = (els: SlideElement[]) =>
  els.filter(isText).map((e) => e.body.paragraphs[0].runs[0].text);

describe('compileChart — structure', () => {
  it('emits one shape per datum, tagged back to its series and point', () => {
    const { elements } = compile(chart());
    const bars = byRole(elements, 'chart.series');
    // 3 categories x 3 series
    expect(bars).toHaveLength(9);
    expect(bars[0].chartRef).toMatchObject({ part: 'mark', chartId: 'c1' });
    expect(bars.every(isShape)).toBe(true);
  });

  it('puts every element in the chart group so it moves as one object', () => {
    const { elements } = compile(chart());
    expect(elements.every((e) => e.groupIds?.[0] === 'g1')).toBe(true);
  });

  it('gives every element a deterministic id namespaced to the chart', () => {
    const { elements } = compile(chart());
    expect(elements.every((e) => e.id.startsWith('c1::'))).toBe(true);
    expect(new Set(elements.map((e) => e.id)).size).toBe(elements.length);
  });

  it('is byte-identical across recompiles — nothing random, nothing time-based', () => {
    const c = chart();
    expect(compile(c).elements).toEqual(compile(c).elements);
  });

  it('draws gridlines under the bars so the bars stay readable', () => {
    const { elements } = compile(chart());
    const lastGrid = elements.findLastIndex((e) => e.role === 'chart.gridline');
    const firstBar = elements.findIndex((e) => e.role === 'chart.series');
    expect(lastGrid).toBeLessThan(firstBar);
  });

  it('renders a legend entry per series', () => {
    const { elements } = compile(chart());
    const legend = byRole(elements, 'chart.legend');
    // A swatch and a label for each of three series.
    expect(legend).toHaveLength(6);
    expect(texts(legend)).toEqual(['Enterprise', 'Mid-Market', 'SMB']);
  });
});

describe('compileChart — geometry', () => {
  it('keeps every element inside the chart frame', () => {
    const { elements } = compile(chart());
    for (const el of elements) {
      expect(el.rect.x).toBeGreaterThanOrEqual(FRAME.x - 1);
      expect(el.rect.y).toBeGreaterThanOrEqual(FRAME.y - 1);
      expect(el.rect.x + el.rect.w).toBeLessThanOrEqual(FRAME.x + FRAME.w + 1);
      expect(el.rect.y + el.rect.h).toBeLessThanOrEqual(FRAME.y + FRAME.h + 1);
    }
  });

  it('stacks segments contiguously with no gaps or overlaps', () => {
    const { elements } = compile(chart());
    const first = elements.filter((e) => e.chartRef?.part === 'mark' && e.chartRef.point === 'c0');
    const sorted = [...first].sort((a, b) => b.rect.y - a.rect.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      // Each segment's top meets the next segment's bottom.
      expect(sorted[i].rect.y).toBeCloseTo(sorted[i + 1].rect.y + sorted[i + 1].rect.h, -2);
    }
  });

  it('makes a taller value a taller bar', () => {
    const { elements } = compile(
      chart((s) => {
        s.stack = 'clustered';
        s.data.series = [{ key: 's0', name: 'A', values: [10, 100] }];
      }),
    );
    const [a, b] = elements.filter((e) => e.chartRef?.part === 'mark');
    expect(b.rect.h).toBeGreaterThan(a.rect.h * 5);
  });

  it('lays a bar chart on its side', () => {
    // Neither "wider than tall" nor mean aspect ratio separates the two: with
    // a handful of categories in a landscape frame, marks are chunky either
    // way. What is exactly true is the DIRECTION a stack grows — upward in a
    // column chart, where its segments share an x and differ in y, and
    // rightward in a bar chart, where the reverse holds.
    const growth = (els: SlideElement[]) => {
      const m = els.filter((e) => e.chartRef?.part === 'mark' && e.chartRef.point === 'c0');
      return { x: new Set(m.map((e) => e.rect.x)).size, y: new Set(m.map((e) => e.rect.y)).size };
    };
    expect(growth(compile(chart(() => {}, 'column')).elements)).toEqual({ x: 1, y: 3 });
    expect(growth(compile(chart(() => {}, 'bar')).elements)).toEqual({ x: 3, y: 1 });
  });

  it('grows the plot when the frame grows', () => {
    const small = compile(chart());
    const big = compile({ ...chart(), frame: { ...FRAME, w: inchesToEmu(12) } });
    const width = (els: SlideElement[]) => {
      const m = els.filter((e) => e.chartRef?.part === 'mark');
      return Math.max(...m.map((e) => e.rect.x + e.rect.w)) - Math.min(...m.map((e) => e.rect.x));
    };
    expect(width(big.elements)).toBeGreaterThan(width(small.elements));
  });

  it('survives a very small frame without inverting anything', () => {
    const { elements } = compile({
      ...chart(),
      frame: { ...FRAME, w: inchesToEmu(1.2), h: inchesToEmu(0.9) },
    });
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.every((e) => e.rect.w >= 0 && e.rect.h >= 0)).toBe(true);
  });
});

describe('compileChart — values and formatting', () => {
  it('draws a bar for zero but none for null', () => {
    const { elements } = compile(
      chart((s) => {
        s.stack = 'clustered';
        s.data.series = [{ key: 's0', name: 'A', values: [0, null, 5] }];
      }),
    );
    expect(elements.filter((e) => e.chartRef?.part === 'mark')).toHaveLength(2);
  });

  it('labels a 100% stack with shares, not raw values', () => {
    const { elements } = compile(
      chart((s) => {
        s.stack = 'stacked100';
        s.decorations.labels = { ...s.decorations.labels, show: true, hideWhenSmaller: 0 };
        s.data.series = [
          { key: 's0', name: 'A', values: [25] },
          { key: 's1', name: 'B', values: [75] },
        ];
        s.data.categories = [{ key: 'c0', label: 'C0' }];
      }),
    );
    const labels = texts(byRole(elements, 'chart.label'));
    expect(labels).toEqual(['25%', '75%']);
  });

  it('shows the underlying sum in a totals label on a 100% stack', () => {
    const { elements } = compile(
      chart((s) => {
        s.stack = 'stacked100';
        s.decorations.totals = { show: true, content: { kind: 'value' }, placement: 'above' };
        s.data.series = [
          { key: 's0', name: 'A', values: [25] },
          { key: 's1', name: 'B', values: [75] },
        ];
        s.data.categories = [{ key: 'c0', label: 'C0' }];
      }),
    );
    expect(texts(byRole(elements, 'chart.total'))).toEqual(['100']);
  });

  it('hides a label whose segment is too thin to hold it', () => {
    const { elements } = compile(
      chart((s) => {
        s.decorations.labels = { ...s.decorations.labels, show: true };
        s.data.categories = [{ key: 'c0', label: 'C0' }];
        s.data.series = [
          { key: 's0', name: 'Big', values: [1000] },
          { key: 's1', name: 'Sliver', values: [1] },
        ];
      }),
    );
    expect(texts(byRole(elements, 'chart.label'))).toEqual(['1,000']);
  });

  it('applies the axis unit divisor to the tick labels', () => {
    const { elements } = compile(
      chart((s) => {
        // The house style hides the value axis; this test is about what its
        // ticks say when a chart asks for it back.
        s.axes.y.show = true;
        s.axes.y.unitDivisor = 1000;
        s.axes.y.unitNote = 'in $M';
        s.data.categories = [{ key: 'c0', label: 'C0' }];
        s.data.series = [{ key: 's0', name: 'A', values: [4000] }];
      }),
    );
    // Nice ticks are chosen in DISPLAY units: 0..4, not 0..4000 divided after
    // the fact (which would read 0.0 / 0.5 / 1.0 …).
    const ticks = texts(
      elements.filter(
        (e) => e.chartRef?.part === 'axis' && e.chartRef.axis === 'y' && e.chartRef.sub === 'tick',
      ),
    );
    expect(ticks).toEqual(['0', '1', '2', '3', '4']);
    expect(texts(elements)).toContain('in $M');
  });

  it('keeps the gridline count in business-chart range', () => {
    // Gridlines are off by default now, so ask for them explicitly — the point
    // of the test is the tick budget, not the default.
    const { elements } = compile(
      chart((s) => {
        s.axes.y.show = true;
        s.decorations.gridlines.major = { show: true };
      }),
    );
    const grid = byRole(elements, 'chart.gridline');
    expect(grid.length).toBeGreaterThanOrEqual(3);
    expect(grid.length).toBeLessThanOrEqual(8);
  });
});

describe('compileChart — overrides', () => {
  it('recolours a single point without touching its series', () => {
    const c = chart((s) => {
      s.data.series[0].pointOverrides = {
        c1: { format: { fill: { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } } } },
      };
    });
    const bars = compile(c).elements.filter(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.series === 's0',
    );
    const fills = bars.filter(isShape).map((b) => b.fill);
    // Identify the override by its actual colour rather than by "is it a hex
    // ref" — series colours are themselves resolved hex now that the palette
    // is a generated ramp.
    const red = fills.filter(
      (f) => f?.kind === 'solid' && f.color.kind === 'hex' && f.color.hex === '#FF0000',
    );
    expect(red).toHaveLength(1);
    expect(new Set(fills.map((f) => JSON.stringify(f))).size).toBe(2);
  });

  it('honours a hidden point', () => {
    const c = chart((s) => {
      s.data.series[0].pointOverrides = { c1: { hidden: true } };
    });
    expect(compile(c).elements.filter((e) => e.chartRef?.part === 'mark')).toHaveLength(8);
  });

  it('shifts a label by its manual offset', () => {
    const base = chart((s) => {
      s.decorations.labels = { ...s.decorations.labels, show: true, hideWhenSmaller: 0 };
    });
    const moved = chart((s) => {
      s.decorations.labels = { ...s.decorations.labels, show: true, hideWhenSmaller: 0 };
      s.data.series[0].pointOverrides = { c0: { labelOffset: { dx: 12700, dy: -12700 } } };
    });
    const find = (els: SlideElement[]) =>
      els.find((e) => e.chartRef?.part === 'label' && e.chartRef.point === 'c0')!;
    expect(find(compile(moved).elements).rect.x - find(compile(base).elements).rect.x).toBe(12700);
  });
});

describe('compileChart — export safety', () => {
  // The whole architecture rests on this: a chart is composed of primitives
  // both PowerPoint and Google Slides render natively, so no exporter ever
  // needs a chart branch. If a placer ever emits something else, every export
  // path breaks at once — catch it here instead.
  const SAFE_TYPES = new Set(['text', 'shape', 'line', 'picture']);

  it('emits nothing but safe primitives', () => {
    for (const kind of ['column', 'bar'] as const) {
      for (const stack of ['clustered', 'stacked', 'stacked100'] as const) {
        const { elements } = compile(chart(() => {}, kind, stack));
        expect(elements.every((e) => SAFE_TYPES.has(e.type))).toBe(true);
      }
    }
  });

  it('uses only presets the exporter maps to a native geometry', () => {
    const allowed = new Set(['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'rightArrow', 'chevron', 'pill']);
    const { elements } = compile(chart());
    expect(elements.filter(isShape).every((e) => allowed.has(e.preset))).toBe(true);
  });

  it('reflows every series colour when the brand accent changes', () => {
    // The property that matters is reflow, not token-ness. Series colours are
    // a ramp DERIVED from the brand on every compile, so they still follow a
    // brand edit — while no longer scavenging whichever tokens happen to
    // exist, which is what handed series three the muted-grey.
    const seriesFills = (ds: typeof DEFAULT_DESIGN_SYSTEM) =>
      compileChart(chart(), ds, metricMeasurer())
        .elements.filter((e) => e.chartRef?.part === 'mark')
        .filter(isShape)
        .map((e) => JSON.stringify(e.fill));

    const recoloured = {
      ...DEFAULT_DESIGN_SYSTEM,
      colors: DEFAULT_DESIGN_SYSTEM.colors.map((c) =>
        c.id === 'brand.accent' ? { ...c, hex: '#B91C1C' } : c,
      ),
    };
    const before = seriesFills(DEFAULT_DESIGN_SYSTEM);
    const after = seriesFills(recoloured);
    expect(before).toHaveLength(after.length);
    expect(before.every((f, i) => f !== after[i])).toBe(true);
  });

  it('keeps the chart chrome on brand tokens', () => {
    // Gridlines, axis lines and text still reference tokens directly — only
    // the categorical series ramp is derived.
    const { elements } = compile(
      chart((s) => {
        s.axes.y.show = true;
        s.decorations.gridlines.major = { show: true };
      }),
    );
    const chrome = elements.filter(
      (e) => e.role === 'chart.gridline' || e.role === 'chart.axis',
    );
    expect(chrome.length).toBeGreaterThan(0);
    expect(
      chrome.every((e) => e.type !== 'line' || e.outline?.color.kind === 'token'),
    ).toBe(true);
  });
});

describe('compileChart — label legibility', () => {
  /** A datum's address, for pairing a label with the mark it was drawn over. */
  const keyOf = (el: SlideElement): string | null => {
    const ref = el.chartRef;
    return ref && 'series' in ref && 'point' in ref ? `${ref.series}/${ref.point}` : null;
  };

  /** Every data label, paired with the fill it was drawn on top of. */
  const labelsOnFills = (els: SlideElement[]) => {
    const fillOf = new Map(
      els
        .filter(isShape)
        .filter((e) => e.chartRef?.part === 'mark')
        .map((e) => [keyOf(e), e.fill] as const),
    );
    return els
      .filter(isText)
      .filter((e) => e.chartRef?.part === 'label')
      .map((e) => ({ ink: e.body.paragraphs[0].runs[0].color, fill: fillOf.get(keyOf(e)) }))
      .filter((p) => p.fill?.kind === 'solid');
  };

  it('keeps a stacked label readable on the segment it sits in', () => {
    // The defect this whole pass exists to fix: labels are forced inside on a
    // stacked chart, and the ink used to be near-black regardless of how dark
    // the segment underneath it was.
    const pairs = labelsOnFills(compile(chart()).elements);
    expect(pairs.length).toBeGreaterThan(0);
    for (const { ink, fill } of pairs) {
      const bg = resolveColor((fill as { color: ColorRef }).color, DEFAULT_DESIGN_SYSTEM);
      expect(contrastRatio(resolveColor(ink!, DEFAULT_DESIGN_SYSTEM), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stays readable when a point is recoloured to something dark', () => {
    const pairs = labelsOnFills(
      compile(
        chart((s) => {
          s.data.series[0].pointOverrides = {
            c1: { format: { fill: { kind: 'solid', color: { kind: 'hex', hex: '#0B1020' } } } },
          };
        }),
      ).elements,
    );
    const onOverride = pairs.filter(
      (p) => (p.fill as { color: ColorRef }).color.kind === 'hex' &&
        ((p.fill as { color: ColorRef }).color as { hex: string }).hex === '#0B1020',
    );
    expect(onOverride).toHaveLength(1);
    expect(resolveColor(onOverride[0].ink!, DEFAULT_DESIGN_SYSTEM)).toBe('#FFFFFF');
  });

  it('leaves an author’s explicit label colour alone', () => {
    const pairs = labelsOnFills(
      compile(
        chart((s) => {
          s.decorations.labels = {
            ...s.decorations.labels,
            font: { sizePt: 10, color: { kind: 'hex', hex: '#FF00FF' } },
          };
        }),
      ).elements,
    );
    expect(pairs.length).toBeGreaterThan(0);
    for (const { ink } of pairs) expect(ink).toEqual({ kind: 'hex', hex: '#FF00FF' });
  });

  it('uses the design system’s ink for labels that sit on the slide, not on a mark', () => {
    // A clustered chart labels outside the tip, where the background is the
    // slide — flipping to white there would make the label disappear.
    const els = compile(chart(() => {}, 'column', 'clustered')).elements;
    const inks = els
      .filter(isText)
      .filter((e) => e.chartRef?.part === 'label')
      .map((e) => e.body.paragraphs[0].runs[0].color);
    expect(inks.length).toBeGreaterThan(0);
    for (const ink of inks) expect(ink).toEqual({ kind: 'token', token: 'ink.strong' });
  });
});

describe('compileChart — orientation', () => {
  const FLIPPABLE: ChartKind[] = ['column', 'line', 'area', 'combo', 'waterfall'];

  const compileSpec = (spec: ChartSpec) =>
    compileChart({ id: 'c1', groupId: 'g1', frame: FRAME, spec }, DEFAULT_DESIGN_SYSTEM, metricMeasurer());

  it.each(FLIPPABLE)('lays %s out horizontally on request', (kind) => {
    const spec = defaultChartSpec(kind);
    const flipped = setChartOrientation(spec, 'horizontal');
    expect(chartOrientation(flipped)).toBe('horizontal');
    // The flip has to reach the drawing, not just the spec.
    const marks = (s: ChartSpec) =>
      compileSpec(s)
        .elements.filter((e) => e.chartRef?.part === 'mark')
        .map((e) => `${e.rect.x},${e.rect.y},${e.rect.w},${e.rect.h}`);
    expect(marks(flipped)).not.toEqual(marks(spec));
  });

  it.each(FLIPPABLE)('keeps a horizontal %s inside its frame', (kind) => {
    const flipped = setChartOrientation(defaultChartSpec(kind), 'horizontal');
    for (const el of compileSpec(flipped).elements) {
      expect(el.rect.x).toBeGreaterThanOrEqual(FRAME.x - 1);
      expect(el.rect.y).toBeGreaterThanOrEqual(FRAME.y - 1);
      expect(el.rect.x + el.rect.w).toBeLessThanOrEqual(FRAME.x + FRAME.w + 1);
      expect(el.rect.y + el.rect.h).toBeLessThanOrEqual(FRAME.y + FRAME.h + 1);
    }
  });

  it('round-trips back to where it started', () => {
    const spec = defaultChartSpec('column');
    const there = setChartOrientation(spec, 'horizontal');
    expect(setChartOrientation(there, 'vertical')).toEqual(spec);
  });

  it('is a no-op when the chart is already that way round', () => {
    const spec = defaultChartSpec('column');
    expect(setChartOrientation(spec, 'vertical')).toBe(spec);
  });

  it('flips a column into a bar rather than inventing a parallel field', () => {
    // OOXML models a bar as its own type, so the export path depends on the
    // flip being a kind change and not a flag the exporter would have to know
    // about separately.
    expect(setChartOrientation(defaultChartSpec('column'), 'horizontal').kind).toBe('bar');
  });

  it('offers a swap rather than an orientation on a scatter', () => {
    // A scatter's axes are two variables, not a layout choice — there is no
    // "which way round is it" to read back, so it gets the honest control.
    expect(supportsOrientation('scatter')).toBe(false);
    expect(canSwapAxes('scatter')).toBe(true);
    expect(setChartOrientation(defaultChartSpec('scatter'), 'horizontal')).toEqual(
      defaultChartSpec('scatter'),
    );
  });

  it('trades the axes on a scatter, carrying their settings with the values', () => {
    const spec = defaultChartSpec('scatter') as ScatterSpec;
    spec.axes.x.title = 'Spend';
    spec.axes.y.title = 'Revenue';
    const flipped = swapAxes(spec) as ScatterSpec;
    expect(flipped.axes.x.title).toBe('Revenue');
    expect(flipped.axes.y.title).toBe('Spend');
    expect(flipped.data.series[0].points[0]).toMatchObject({
      x: spec.data.series[0].points[0].y,
      y: spec.data.series[0].points[0].x,
    });
  });

  it('leaves a pie alone, since a pie has no side to lie on', () => {
    expect(supportsOrientation('pie')).toBe(false);
    const spec = defaultChartSpec('pie');
    expect(setChartOrientation(spec, 'horizontal')).toBe(spec);
  });
});

describe('compileChart — sankey', () => {
  const sankey = (mutate: (s: SankeySpec) => void = () => {}) => {
    const spec = defaultChartSpec('sankey') as SankeySpec;
    mutate(spec);
    return compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    );
  };

  it('draws a node per node and a ribbon per flow', () => {
    const { elements } = sankey();
    const marks = elements.filter((e) => e.chartRef?.part === 'mark');
    // One total plus five branches, and a flow into each branch.
    expect(marks.filter((e) => e.type === 'shape')).toHaveLength(6);
    expect(marks.filter((e) => e.type === 'path')).toHaveLength(5);
  });

  it('splits the default evenly, so the shape reads before the numbers do', () => {
    // A ribbon's bounding box includes its vertical travel, so it says nothing
    // about thickness. The branch NODES are what must come out identical.
    const branches = sankey()
      .elements.filter(isShape)
      .filter((e) => e.chartRef?.part === 'mark' && e.name !== 'Total' && e.name !== 'Chart area');
    expect(branches).toHaveLength(5);
    expect(new Set(branches.map((b) => b.rect.h)).size).toBe(1);
  });

  it('puts the end-column labels outside the diagram, not across its ribbons', () => {
    const { elements } = sankey();
    const nodeRect = (name: string) =>
      elements.filter(isShape).find((e) => e.name === name)!.rect;
    const labelRect = (starts: string) =>
      elements.filter(isText).find((e) => e.body.paragraphs[0].runs[0].text.startsWith(starts))!
        .rect;

    // The source labels backwards into the left gutter...
    expect(labelRect('Total').x + labelRect('Total').w).toBeLessThanOrEqual(
      nodeRect('Total').x + 1,
    );
    // ...and the far column forwards into the right one.
    expect(labelRect('Segment A').x).toBeGreaterThanOrEqual(
      nodeRect('Segment A').x + nodeRect('Segment A').w - 1,
    );
  });

  it('names every node on the slide', () => {
    const labels = texts(
      sankey().elements.filter((e) => e.chartRef?.part === 'label'),
    );
    expect(labels.some((t) => t.startsWith('Total'))).toBe(true);
    expect(labels.some((t) => t.startsWith('Segment A'))).toBe(true);
  });

  it('keeps everything inside the frame, labels included', () => {
    for (const el of sankey().elements) {
      expect(el.rect.x).toBeGreaterThanOrEqual(FRAME.x - 1);
      expect(el.rect.y).toBeGreaterThanOrEqual(FRAME.y - 1);
      expect(el.rect.x + el.rect.w).toBeLessThanOrEqual(FRAME.x + FRAME.w + 1);
      expect(el.rect.y + el.rect.h).toBeLessThanOrEqual(FRAME.y + FRAME.h + 1);
    }
  });

  it('stays inside the frame turned on its end too', () => {
    const flipped = setChartOrientation(defaultChartSpec('sankey'), 'vertical');
    const { elements } = compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: flipped },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    );
    expect(elements.length).toBeGreaterThan(0);
    for (const el of elements) {
      expect(el.rect.x).toBeGreaterThanOrEqual(FRAME.x - 1);
      expect(el.rect.y).toBeGreaterThanOrEqual(FRAME.y - 1);
      expect(el.rect.x + el.rect.w).toBeLessThanOrEqual(FRAME.x + FRAME.w + 1);
      expect(el.rect.y + el.rect.h).toBeLessThanOrEqual(FRAME.y + FRAME.h + 1);
    }
  });

  it('reads as horizontal by default, which is what a Sankey is', () => {
    expect(chartOrientation(defaultChartSpec('sankey'))).toBe('horizontal');
  });

  it('draws ribbons translucent so crossings stay readable', () => {
    const ribbons = sankey().elements.filter((e) => e.type === 'path');
    for (const r of ribbons) {
      expect(r.fill?.kind === 'solid' && r.fill.alpha).toBeLessThan(1);
    }
  });

  it('gives a ribbon the colour of the node it came from', () => {
    const { elements } = sankey();
    const nodes = new Map(
      elements
        .filter(isShape)
        .filter((e) => e.chartRef?.part === 'mark' && e.type === 'shape')
        .map((e) => [e.name, e.fill]),
    );
    const inboundRibbon = elements.find(
      (e) => e.type === 'path' && e.name?.startsWith('Total →'),
    );
    const inboundNode = nodes.get('Total');
    expect(inboundRibbon?.type === 'path' && inboundRibbon.fill?.kind === 'solid').toBe(true);
    expect(
      inboundRibbon?.type === 'path' &&
        inboundRibbon.fill?.kind === 'solid' &&
        inboundNode?.kind === 'solid' &&
        JSON.stringify(inboundRibbon.fill.color) === JSON.stringify(inboundNode.color),
    ).toBe(true);
  });

  it('is byte-identical across recompiles', () => {
    expect(sankey().elements).toEqual(sankey().elements);
  });

  it('reports a flow pointing at a node that is not there', () => {
    const { diagnostics } = sankey((s) => {
      s.data.links.push({ key: 'bad', from: 'n0', to: 'nope', value: 10 });
    });
    expect(diagnostics.some((d) => d.code === 'sankey-unknown-node')).toBe(true);
  });

  it('says the chart is empty rather than drawing nothing silently', () => {
    const { elements, diagnostics } = sankey((s) => {
      s.data = { nodes: [], links: [] };
    });
    expect(elements).toEqual([]);
    expect(diagnostics[0].code).toBe('chart-empty');
  });
});

describe('compileChart — diagnostics', () => {
  it('reports an unsupported kind instead of throwing', () => {
    const spec = defaultChartSpec('butterfly');
    const r = compileChart({ id: 'c1', groupId: 'g1', frame: FRAME, spec }, DEFAULT_DESIGN_SYSTEM, metricMeasurer());
    expect(r.elements).toEqual([]);
    expect(r.diagnostics[0].code).toBe('chart-kind-unsupported');
  });

  it('reports an empty chart instead of drawing garbage', () => {
    const r = compile(
      chart((s) => {
        s.data = { categories: [], series: [] };
      }),
    );
    expect(r.elements).toEqual([]);
    expect(r.diagnostics[0].code).toBe('chart-empty');
  });
});

describe('compileChart — every chart kind', () => {
  const KINDS = [
    'column',
    'bar',
    'line',
    'area',
    'combo',
    'pie',
    'donut',
    'scatter',
    'bubble',
    'waterfall',
    'mekko',
  ] as const;

  const compileKind = (kind: (typeof KINDS)[number]) =>
    compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: defaultChartSpec(kind) },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    );

  it.each(KINDS)('draws a %s without diagnostics', (kind) => {
    const r = compileKind(kind);
    expect(r.elements.length).toBeGreaterThan(0);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it.each(KINDS)('%s emits only export-safe primitives', (kind) => {
    const safe = new Set(['text', 'shape', 'line', 'picture', 'path']);
    expect(compileKind(kind).elements.every((e) => safe.has(e.type))).toBe(true);
  });

  it.each(KINDS)('%s keeps everything inside its frame', (kind) => {
    for (const el of compileKind(kind).elements) {
      expect(el.rect.x).toBeGreaterThanOrEqual(FRAME.x - 1);
      expect(el.rect.y).toBeGreaterThanOrEqual(FRAME.y - 1);
      expect(el.rect.x + el.rect.w).toBeLessThanOrEqual(FRAME.x + FRAME.w + 1);
      expect(el.rect.y + el.rect.h).toBeLessThanOrEqual(FRAME.y + FRAME.h + 1);
    }
  });

  it.each(KINDS)('%s is deterministic', (kind) => {
    expect(compileKind(kind).elements).toEqual(compileKind(kind).elements);
  });

  it.each(KINDS)('%s gives every element a unique namespaced id', (kind) => {
    const els = compileKind(kind).elements;
    expect(new Set(els.map((e) => e.id)).size).toBe(els.length);
    expect(els.every((e) => e.id.startsWith('c1::'))).toBe(true);
  });
});

describe('compileChart — pie and donut', () => {
  const pie = (kind: 'pie' | 'donut') =>
    compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: defaultChartSpec(kind) },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    ).elements;

  it('draws one path per slice', () => {
    const slices = pie('pie').filter((e) => e.chartRef?.part === 'mark');
    expect(slices).toHaveLength(3);
    expect(slices.every((e) => e.type === 'path')).toBe(true);
  });

  it('draws no axes or gridlines', () => {
    const els = pie('pie');
    expect(els.filter((e) => e.role === 'chart.gridline')).toHaveLength(0);
    expect(els.filter((e) => e.role === 'chart.axis')).toHaveLength(0);
  });

  it('lists slices in the legend, not series', () => {
    const legend = pie('pie').filter((e) => e.role === 'chart.legend' && isText(e));
    expect(texts(legend)).toEqual(['FY23', 'FY24', 'FY25']);
  });

  it('gives a donut a hole its slices never cross', () => {
    // Every slice path stays clear of the exact centre of its own box.
    const slices = pie('donut').filter((e) => e.chartRef?.part === 'mark');
    for (const el of slices) {
      if (el.type !== 'path') continue;
      const hitsCentre = el.d.some(
        (op) => op.op !== 'Z' && Math.abs(op.x - 0.5) < 1e-9 && Math.abs(op.y - 0.5) < 1e-9,
      );
      expect(hitsCentre).toBe(false);
    }
  });
});

describe('compileChart — line and area', () => {
  const build = (kind: 'line' | 'area', mutate: (s: never) => void = () => {}) => {
    const spec = defaultChartSpec(kind);
    mutate(spec as never);
    return compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    ).elements;
  };

  it('draws one path per line series', () => {
    const lines = build('line').filter((e) => e.chartRef?.part === 'mark');
    expect(lines).toHaveLength(3);
    expect(lines.every((e) => e.type === 'path')).toBe(true);
  });

  it('breaks a line at a gap rather than joining across it', () => {
    const spec = defaultChartSpec('line') as LineSpec;
    spec.data.categories = [0, 1, 2, 3].map((i) => ({ key: `c${i}`, label: `C${i}` }));
    // One gap splits this into two drawable runs, not one line straight
    // through a hole in the data.
    spec.data.series = [{ key: 's0', name: 'A', values: [10, 20, null, 40] }];
    const els = compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    ).elements;
    // The trailing single point can't form a path, so exactly one run draws.
    expect(els.filter((e) => e.chartRef?.part === 'mark')).toHaveLength(1);
  });

  it('fills an area as a closed path', () => {
    const areas = build('area').filter((e) => e.chartRef?.part === 'mark');
    expect(areas.length).toBeGreaterThan(0);
    for (const el of areas) {
      if (el.type !== 'path') continue;
      expect(el.d[el.d.length - 1].op).toBe('Z');
    }
  });
});

describe('compileChart — waterfall', () => {
  const build = () =>
    compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: defaultChartSpec('waterfall') },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    ).elements;

  it('draws a bar per item and a connector between them', () => {
    const els = build();
    expect(els.filter((e) => e.chartRef?.part === 'mark')).toHaveLength(5);
    expect(els.filter((e) => e.chartRef?.part === 'decoration').length).toBeGreaterThan(0);
  });

  it('computes a blank total from the movements above it', () => {
    // The build-up bridge is 1040 + 260 + 145 + 95 = 1540.
    const labels = texts(build().filter((e) => e.role === 'chart.label'));
    expect(labels[labels.length - 1]).toBe('1,540');
  });

  it('signs the movements but not the milestones', () => {
    const labels = texts(build().filter((e) => e.role === 'chart.label'));
    expect(labels[0]).toBe('1,040');
    expect(labels[1]).toBe('+260');
  });

  it('builds down as well as up, from the same kind', () => {
    // 1540 - 320 - 210 - 180 = 830. A bridge that only ever built upward
    // would need every sign retyped to say this.
    const spec = defaultChartSpec('waterfall') as WaterfallSpec;
    spec.data = sampleWaterfallData('down');
    const labels = texts(
      compileChart(
        { id: 'c1', groupId: 'g1', frame: FRAME, spec },
        DEFAULT_DESIGN_SYSTEM,
        metricMeasurer(),
      ).elements.filter((e) => e.role === 'chart.label'),
    );
    expect(labels[0]).toBe('1,540');
    expect(labels[1]).toBe('-320');
    expect(labels[labels.length - 1]).toBe('830');
  });
});

describe('compileChart — scatter and bubble', () => {
  const build = (kind: 'scatter' | 'bubble') =>
    compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: defaultChartSpec(kind) },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    ).elements;

  it('draws a marker per point', () => {
    expect(build('scatter').filter((e) => e.chartRef?.part === 'mark')).toHaveLength(5);
  });

  it('sizes bubbles by area, so a 4x value is 2x wide, not 4x', () => {
    const marks = build('bubble').filter((e) => e.chartRef?.part === 'mark');
    const sizes = marks.map((e) => e.rect.w).sort((a, b) => a - b);
    // Sample sizes are 18..55; area encoding compresses that ratio to ~sqrt.
    const ratio = sizes[sizes.length - 1] / sizes[0];
    expect(ratio).toBeLessThan(55 / 18);
    expect(ratio).toBeGreaterThan(1);
  });

  it('gives both axes real tick labels', () => {
    const ticks = build('scatter').filter((e) => e.role === 'chart.tick');
    expect(ticks.length).toBeGreaterThan(4);
  });
});

describe('compileChart — mekko', () => {
  it('widens a column in proportion to its total', () => {
    const spec = defaultChartSpec('mekko');
    const els = compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    ).elements;
    const marks = els.filter((e) => e.chartRef?.part === 'mark');
    const widthByCategory = new Map<string, number>();
    for (const el of marks) {
      if (el.chartRef?.part !== 'mark') continue;
      widthByCategory.set(el.chartRef.point, el.rect.w);
    }
    const widths = [...widthByCategory.values()];
    // Sample totals rise across FY23-25, so the columns must widen.
    expect(widths[2]).toBeGreaterThan(widths[0]);
  });

  it('stacks every column to full height', () => {
    const els = compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: defaultChartSpec('mekko') },
      DEFAULT_DESIGN_SYSTEM,
      metricMeasurer(),
    ).elements;
    const marks = els.filter((e) => e.chartRef?.part === 'mark');
    const byCategory = new Map<string, number>();
    for (const el of marks) {
      if (el.chartRef?.part !== 'mark') continue;
      byCategory.set(el.chartRef.point, (byCategory.get(el.chartRef.point) ?? 0) + el.rect.h);
    }
    const heights = [...byCategory.values()];
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2000);
  });
});

describe('compileChart — turned charts', () => {
  /**
   * The box an element actually covers on the slide: a rect is stored
   * unturned, with the angle it is drawn at alongside it, so a quarter-turned
   * part covers its own box with the sides swapped.
   */
  const painted = (e: SlideElement) => {
    const turned = e.rotation === 90 || e.rotation === 270;
    const w = turned ? e.rect.h : e.rect.w;
    const h = turned ? e.rect.w : e.rect.h;
    return {
      x: e.rect.x + e.rect.w / 2 - w / 2,
      y: e.rect.y + e.rect.h / 2 - h / 2,
      w,
      h,
    };
  };

  /** How far outside `FRAME` the compiled parts reach, in EMU. */
  const overflow = (els: SlideElement[]) =>
    Math.max(
      0,
      ...els.map(painted).map((r) => FRAME.x - r.x),
      ...els.map(painted).map((r) => r.x + r.w - (FRAME.x + FRAME.w)),
      ...els.map(painted).map((r) => FRAME.y - r.y),
      ...els.map(painted).map((r) => r.y + r.h - (FRAME.y + FRAME.h)),
    );

  it('keeps a quarter-turned chart inside its own frame', () => {
    // The bug this guards: laying out in the frame and then turning gives a
    // 4.5in-wide picture in an 8in box, hanging ~1.75in off each end.
    const upright = overflow(compile(chart()).elements);
    for (const rotation of [90, 180, 270]) {
      const { elements } = compile({ ...chart(), rotation });
      expect(overflow(elements)).toBeLessThanOrEqual(upright + 1);
    }
  });

  it('turns the backdrop onto the frame, so the chart stays clickable', () => {
    const { elements } = compile({ ...chart(), rotation: 90 });
    const backdrop = elements.find((e) => e.chartRef?.part === 'plot')!;
    expect(painted(backdrop)).toEqual(FRAME);
  });

  it('draws the same chart whichever way round it is', () => {
    const bars = (rotation: number) =>
      compile({ ...chart(), rotation }).elements.filter((e) => e.chartRef?.part === 'mark');
    expect(bars(90)).toHaveLength(bars(0).length);
    expect(texts(compile({ ...chart(), rotation: 90 }).elements).sort()).toEqual(
      texts(compile(chart()).elements).sort(),
    );
  });

  it('ignores rotation on a scatter or bubble — they have no side to lie on', () => {
    for (const kind of ['scatter', 'bubble'] as const) {
      const instance: ChartInstance = {
        id: 'c1',
        groupId: 'g1',
        frame: FRAME,
        spec: defaultChartSpec(kind),
      };
      expect(compile({ ...instance, rotation: 90 }).elements).toEqual(
        compile(instance).elements,
      );
    }
  });
});
