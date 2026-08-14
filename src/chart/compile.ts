/**
 * `compileChart` — spec + frame -> safe primitives.
 *
 * The whole engine funnels through here, and it is deliberately pure: give it
 * the same instance, design system and measurer and it returns byte-identical
 * elements. That's what lets the canvas, an SSR thumbnail and an exported
 * .pptx agree on where every label sits.
 *
 * The two-pass structure exists because the plot's size and the axis domain
 * depend on each other: how wide the tick-label gutter is depends on the tick
 * text, which depends on the domain, which depends on how many ticks fit in a
 * plot whose height we haven't solved yet. Pass one guesses from the frame,
 * pass two re-solves against the real plot. Two is enough; a third is capped
 * off as insurance rather than as a plan.
 */
import {
  isGridSpec,
  isHorizontal,
  supportsTurn,
  token,
  type AreaSpec,
  type ChartInstance,
  type ChartSpec,
  type ColumnBarSpec,
  type ComboSpec,
  type DesignSystem,
  type LineSpec,
  type MekkoSpec,
  type PieSpec,
  type SankeySpec,
  type Rect,
  type SlideElement,
  type WaterfallSpec,
} from '@/model';
import { lineHeightEmu, type TextMeasurer } from '@/render/measureText';
import { defaultMeasurer } from '@/render/measureText';
import { formatSet } from './format/number';
import { deriveGrid, type GridDerived } from './derive/grid';
import { deriveWaterfall } from './derive/waterfall';
import { maxTicksFor, solveFrame, type FrameLayout } from './layout/frame';
import { makeScale, niceDomain, type LinearScale } from './scale/linear';
import { categoryCenters, placeColumnBar } from './place/columnBar';
import { placeCartesianFurniture, projector, type LegendItem } from './place/cartesian';
import {
  comboColumnBand,
  lineCategoryCenters,
  placeLineArea,
  type LineLikeSpec,
} from './place/lineArea';
import { placePie } from './place/pie';
import { placeSankey } from './place/sankey';
import { placeWaterfall, waterfallCenters } from './place/waterfall';
import { mekkoCenters, placeMekko } from './place/mekko';
import { placeXY } from './place/xy';
import { placeAnnotations } from './decorate/annotations';
import { resolveChartTheme, type ChartTheme } from './theme';
import { emitMarks } from './emit';
import { layoutFrame, snapQuarterTurn, turnElements } from './turn';
import type { Mark } from './mark';

export interface CompileDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface CompileResult {
  elements: SlideElement[];
  diagnostics: CompileDiagnostic[];
}

/** Every chart kind the engine can draw. */
export const SUPPORTED_KINDS: ChartSpec['kind'][] = [
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
  'sankey',
  'mekko',
];

export const isSupported = (spec: ChartSpec): boolean => SUPPORTED_KINDS.includes(spec.kind);

export function compileChart(
  chart: ChartInstance,
  ds: DesignSystem,
  measurer: TextMeasurer = defaultMeasurer(),
): CompileResult {
  const diagnostics: CompileDiagnostic[] = [];
  const { spec } = chart;

  if (!isSupported(spec)) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart-kind-unsupported',
      message: `"${spec.kind}" charts aren't drawn yet — the chart is on the slide but renders empty.`,
    });
    return { elements: [], diagnostics };
  }

  const theme = resolveChartTheme(spec, ds);

  // The turn, and the box the layout is solved in so the turn lands back
  // inside the chart's own frame — see `layoutFrame` in `turn.ts`. Kinds that
  // can't be turned are compiled upright whatever angle they carry, so an old
  // deck with a turned scatter in it comes back readable rather than sideways.
  const rotation = supportsTurn(spec.kind) ? snapQuarterTurn(chart.rotation ?? 0) : 0;
  const frame = layoutFrame(chart.frame, rotation);
  const laid: ChartInstance = frame === chart.frame ? chart : { ...chart, frame };

  const marks =
    spec.kind === 'sankey'
      ? compileSankey(laid, spec, theme, measurer, diagnostics)
      : spec.kind === 'scatter' || spec.kind === 'bubble'
        ? compileXY(laid, theme, measurer, diagnostics)
        : compileCartesian(laid, theme, measurer, diagnostics);

  if (!marks.length) return { elements: [], diagnostics };

  // The chart AREA, first so it sits under everything. Without it a chart is
  // only clickable on its own marks — you can see a chart, press in the middle
  // of it, and get a marquee instead of a selection, which reads as broken.
  // Invisible by default, but it's a real fill, so it hit-tests and can later
  // be given a background.
  const backdrop: Mark = {
    kind: 'rect',
    ref: { chartId: chart.id, part: 'plot' },
    name: 'Chart area',
    rect: frame,
    fill: theme.plotBackground
      ? { kind: 'solid', color: theme.plotBackground }
      : { kind: 'solid', color: token('surface.base'), alpha: 0 },
  };

  // Laid out upright, then turned — see `turn.ts`. At 0° this is identity.
  const elements = turnElements(emitMarks([backdrop, ...marks], chart.groupId), frame, rotation);

  return { elements, diagnostics };
}

/* ------------------------------------------------------------------ */
/* Sankey                                                             */
/* ------------------------------------------------------------------ */

/**
 * A Sankey is neither cartesian nor x/y: it has no axes to solve a gutter for,
 * only a title and a plot. It gets its own branch rather than being threaded
 * through `compileCartesian` behind a third set of `if`s.
 */
function compileSankey(
  chart: ChartInstance,
  spec: SankeySpec,
  theme: ChartTheme,
  measurer: TextMeasurer,
  diagnostics: CompileDiagnostic[],
): Mark[] {
  if (!spec.data.nodes.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart-empty',
      message: 'This chart has no data yet.',
    });
    return [];
  }

  const layout = solveFrame({
    frame: chart.frame,
    theme,
    measurer,
    horizontal: false,
    tickLabels: [],
    categoryLabels: [],
    showValueAxisLabels: false,
    showCategoryAxisLabels: false,
    title: spec.title,
    padding: spec.plotPadding,
  });

  const { marks, diagnostics: layoutDiagnostics } = placeSankey({
    chartId: chart.id,
    spec,
    plot: layout.plot,
    theme,
    measurer,
  });
  diagnostics.push(...layoutDiagnostics);

  if (!marks.length) return [];

  return [
    ...marks,
    ...placeCartesianFurniture({
      chartId: chart.id,
      theme,
      measurer,
      layout,
      proj: projector(layout.plot, makeScale(0, 1, 1), false),
      scale: makeScale(0, 1, 1),
      bounds: chart.frame,
      tickLabels: [],
      categoryLabels: [],
      categoryCenters: [],
      showValueAxisLabels: false,
      showCategoryAxisLabels: false,
      showValueAxisLine: false,
      showCategoryAxisLine: false,
      gridlines: false,
      title: spec.title,
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* Category-axis charts                                               */
/* ------------------------------------------------------------------ */

function compileCartesian(
  chart: ChartInstance,
  theme: ChartTheme,
  measurer: TextMeasurer,
  diagnostics: CompileDiagnostic[],
): Mark[] {
  const spec = chart.spec;
  const horizontal = isHorizontal(spec);
  const isPie = spec.kind === 'pie' || spec.kind === 'donut';

  // Derive first — everything downstream reads the resolved numbers, not the
  // authored ones.
  const waterfall = spec.kind === 'waterfall' ? deriveWaterfall(spec) : null;
  const derived: GridDerived = waterfall
    ? {
        data: waterfall.data.map((d, i) => ({
          seriesKey: 's0',
          seriesName: 'Value',
          seriesIndex: 0,
          pointKey: d.key,
          pointLabel: d.label,
          pointIndex: i,
          value: d.value,
          base: d.base,
          top: d.top,
          labelValue: d.value,
        })),
        totals: waterfall.data.map((d) => d.value),
        extent: waterfall.extent,
        series: [{ key: 's0', name: 'Value', values: waterfall.data.map((d) => d.value) }],
        categoryLabels: waterfall.labels,
      }
    : deriveGrid(
        isGridSpec(spec) ? spec.data : { categories: [], series: [] },
        'stack' in spec ? spec.stack : 'clustered',
      );

  if (!derived.series.length || !derived.categoryLabels.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart-empty',
      message: 'This chart has no data yet.',
    });
    return [];
  }

  const valueAxis = spec.axes.y;
  const categoryAxis = spec.axes.x;
  const pct = 'stack' in spec && spec.stack === 'stacked100';
  const numberFormat = pct
    ? { ...spec.numberFormat, style: 'percent' as const }
    : (valueAxis.numberFormat ?? spec.numberFormat);

  const tickStyle = {
    font: theme.text.tick.font,
    sizePt: theme.text.tick.sizePt,
    bold: theme.text.tick.bold,
  };
  const tickLineH = lineHeightEmu(tickStyle);
  const divisor = valueAxis.unitDivisor && valueAxis.unitDivisor > 0 ? valueAxis.unitDivisor : 1;

  const solve = (maxTicks: number): { scale: LinearScale; ticks: string[] } => {
    if (pct || spec.kind === 'mekko') {
      const scale = makeScale(0, 1, 0.25);
      return { scale, ticks: formatSet(scale.ticks, { ...numberFormat, style: 'percent' }).map((f) => f.text) };
    }
    // Pick the nice domain in DISPLAY units, then scale it back up. Choosing
    // ticks on the raw values and dividing afterwards gives an axis of
    // 0.0 / 0.5 / 1.0 where the author asked for "in $M" and expected 0 / 1 / 2.
    const display = niceDomain(
      derived.extent.map((v) => v / divisor),
      {
        maxTicks,
        // A line chart that doesn't have to include zero can use the whole
        // plot for its actual range, which is usually what makes it readable.
        includeZero: spec.kind !== 'line' || valueAxis.min === undefined,
        min: valueAxis.min === undefined ? undefined : valueAxis.min / divisor,
        max: valueAxis.max === undefined ? undefined : valueAxis.max / divisor,
        step: valueAxis.tickStep === undefined ? undefined : valueAxis.tickStep / divisor,
      },
    );
    const scale = makeScale(display.min * divisor, display.max * divisor, display.step * divisor);
    return { scale, ticks: formatSet(display.ticks, numberFormat).map((f) => f.text) };
  };

  const legendItems: LegendItem[] = isPie
    ? derived.data
        .filter((d) => d.seriesIndex === 0)
        .map((d) => {
          // A pie's legend lists SLICES, not series, so each entry takes its
          // colour from the slice's own override when there is one.
          const fill = derived.series[0]?.pointOverrides?.[d.pointKey]?.format?.fill;
          return {
            name: d.pointLabel,
            seriesKey: d.pointKey,
            color:
              fill?.kind === 'solid' ? fill.color : theme.seriesColor(d.pointIndex),
          };
        })
    : derived.series.map((s, i) => ({
        name: s.name,
        seriesKey: s.key,
        color:
          s.format?.fill?.kind === 'solid' ? s.format.fill.color : theme.seriesColor(i),
      }));

  const showAxes = !isPie;
  // Line and area place their categories ON the plot edges rather than in the
  // middle of a band, so their end labels overhang exactly as a continuous
  // axis's do.
  const edgeCategories = spec.kind === 'line' || spec.kind === 'area';

  // Labels that sit past the tip of a mark cost the plot real space, and the
  // frame has to know before it solves. `auto` resolves to outside-end for
  // anything unstacked, so it counts.
  const labelSpec = spec.decorations.labels;
  const outsideValueLabels =
    !isPie &&
    ((labelSpec.show &&
      !('stack' in spec && spec.stack !== 'clustered') &&
      ['auto', 'outsideEnd', 'above'].includes(labelSpec.placement)) ||
      (spec.decorations.totals?.show ?? false));

  const frameInputBase = {
    frame: chart.frame,
    theme,
    measurer,
    horizontal,
    outsideValueLabels,
    endLabels:
      spec.kind === 'line' && spec.endLabels ? derived.series.map((s) => s.name) : undefined,
    categoryLabels: derived.categoryLabels,
    showValueAxisLabels: showAxes && valueAxis.show,
    showCategoryAxisLabels: showAxes && categoryAxis.show,
    continuousCategoryAxis: edgeCategories,
    title: spec.title,
    valueAxisTitle: showAxes ? valueAxis.title : undefined,
    categoryAxisTitle: showAxes ? categoryAxis.title : undefined,
    unitNote: showAxes ? valueAxis.unitNote : undefined,
    legend: spec.legend.show
      ? { items: legendItems.map((i) => i.name), position: spec.legend.position }
      : undefined,
    padding: spec.plotPadding,
  };

  // Pass 1: guess the tick budget from the frame, since there's no plot yet.
  const firstExtent = horizontal ? chart.frame.w : chart.frame.h;
  let { scale, ticks } = solve(maxTicksFor(firstExtent, horizontal ? tickLineH * 3 : tickLineH));
  let layout: FrameLayout = solveFrame({ ...frameInputBase, tickLabels: ticks });

  // Pass 2: re-solve against the plot we actually got.
  const plotExtent = horizontal ? layout.plot.w : layout.plot.h;
  const budget = maxTicksFor(plotExtent, horizontal ? tickLineH * 3 : tickLineH);
  const second = solve(budget);
  if (second.scale.step !== scale.step || second.scale.max !== scale.max) {
    scale = second.scale;
    ticks = second.ticks;
    layout = solveFrame({ ...frameInputBase, tickLabels: ticks });
  }

  const proj = projector(layout.plot, scale, horizontal);
  const centers = centersFor(spec, derived);

  const body = placeBody(chart, spec, derived, proj, scale, theme, measurer, layout);

  if (isPie) {
    // A pie has no axes or gridlines; only its title and legend are furniture.
    const furniture = placeCartesianFurniture({
      chartId: chart.id,
      theme,
      measurer,
      layout,
      proj,
      scale,
      bounds: chart.frame,
      tickLabels: [],
      categoryLabels: [],
      categoryCenters: [],
      showValueAxisLabels: false,
      showCategoryAxisLabels: false,
      showValueAxisLine: false,
      showCategoryAxisLine: false,
      gridlines: false,
      title: spec.title,
      legend: spec.legend.show ? { ...spec.legend, items: legendItems } : undefined,
    });
    return [...furniture, ...body];
  }

  const furniture = placeCartesianFurniture({
    chartId: chart.id,
    theme,
    measurer,
    layout,
    proj,
    scale,
    bounds: chart.frame,
    tickLabels: ticks,
    categoryLabels: derived.categoryLabels,
    categoryCenters: centers,
    showValueAxisLabels: valueAxis.show,
    showCategoryAxisLabels: categoryAxis.show,
    continuousCategoryAxis: edgeCategories,
    showValueAxisLine: false,
    showCategoryAxisLine: categoryAxis.show,
    gridlines: spec.decorations.gridlines.major?.show ?? theme.gridlines.major,
    title: spec.title,
    valueAxisTitle: valueAxis.title,
    categoryAxisTitle: categoryAxis.title,
    unitNote: valueAxis.unitNote,
    legend: spec.legend.show ? { ...spec.legend, items: legendItems } : undefined,
  });

  const annotations = placeAnnotations({
    chartId: chart.id,
    spec,
    derived,
    proj,
    scale,
    theme,
    measurer,
    centers,
  });

  // Furniture first so marks paint over the gridlines; annotations last so
  // they're never buried by the data they're describing.
  return [...furniture, ...body, ...annotations];
}

/** 0..1 category positions, which differ by chart family. */
function centersFor(spec: ChartSpec, derived: GridDerived): number[] {
  switch (spec.kind) {
    case 'column':
    case 'bar':
      return categoryCenters(spec as ColumnBarSpec, derived);
    case 'line':
    case 'area':
      return lineCategoryCenters(derived.categoryLabels.length);
    case 'combo':
      return categoryCenters(
        { ...(spec as ComboSpec), kind: 'column' } as unknown as ColumnBarSpec,
        derived,
      );
    case 'waterfall':
      return waterfallCenters(spec as WaterfallSpec, derived.categoryLabels.length);
    case 'mekko':
      return mekkoCenters(spec as MekkoSpec, derived);
    default:
      return derived.categoryLabels.map((_, i) => (i + 0.5) / derived.categoryLabels.length);
  }
}

function placeBody(
  chart: ChartInstance,
  spec: ChartSpec,
  derived: GridDerived,
  proj: ReturnType<typeof projector>,
  scale: LinearScale,
  theme: ChartTheme,
  measurer: TextMeasurer,
  layout: FrameLayout,
): Mark[] {
  const common = { chartId: chart.id, derived, proj, scale, theme, measurer };

  switch (spec.kind) {
    case 'column':
    case 'bar':
      return placeColumnBar({ ...common, spec: spec as ColumnBarSpec });

    case 'line':
    case 'area':
      return placeLineArea({ ...common, spec: spec as LineSpec | AreaSpec });

    case 'combo': {
      const combo = spec as ComboSpec;
      const { columnKeys } = comboColumnBand(combo, derived);
      const columnSet = new Set(columnKeys);
      // Columns first, lines over them — a line hidden behind a column is the
      // one thing a combo chart must never do.
      const columns = placeColumnBar({
        ...common,
        spec: {
          ...combo,
          kind: 'column',
          data: { ...derived, categories: [], series: [] },
        } as unknown as ColumnBarSpec,
        derived: { ...derived, series: derived.series.filter((s) => columnSet.has(s.key)) },
      });
      const lines = placeLineArea({
        ...common,
        spec: combo as LineLikeSpec,
        onlySeries: new Set(derived.series.filter((s) => !columnSet.has(s.key)).map((s) => s.key)),
      });
      return [...columns, ...lines];
    }

    case 'pie':
    case 'donut':
      return placePie({
        chartId: chart.id,
        spec: spec as PieSpec,
        derived,
        plot: layout.plot,
        theme,
        measurer,
      });

    case 'waterfall':
      return placeWaterfall({
        chartId: chart.id,
        spec: spec as WaterfallSpec,
        derived: {
          data: derived.data.map((d) => ({
            key: d.pointKey,
            label: d.pointLabel,
            role: (spec as WaterfallSpec).data.items[d.pointIndex]?.role ?? 'delta',
            value: d.value ?? 0,
            base: d.base,
            top: d.top,
            negative: (d.value ?? 0) < 0,
            computed: (spec as WaterfallSpec).data.items[d.pointIndex]?.value === null,
            index: d.pointIndex,
          })),
          extent: derived.extent,
          labels: derived.categoryLabels,
        },
        proj,
        theme,
        measurer,
      });

    case 'mekko':
      return placeMekko({ ...common, spec: spec as MekkoSpec });

    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/* Two-value-axis charts                                              */
/* ------------------------------------------------------------------ */

function compileXY(
  chart: ChartInstance,
  theme: ChartTheme,
  measurer: TextMeasurer,
  diagnostics: CompileDiagnostic[],
): Mark[] {
  const spec = chart.spec as import('@/model').ScatterSpec | import('@/model').BubbleSpec;
  const points = spec.data.series.flatMap((s) => s.points);

  if (!points.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart-empty',
      message: 'This chart has no data yet.',
    });
    return [];
  }

  const tickStyle = {
    font: theme.text.tick.font,
    sizePt: theme.text.tick.sizePt,
    bold: theme.text.tick.bold,
  };
  const tickLineH = lineHeightEmu(tickStyle);

  const domainFor = (values: number[], axis: typeof spec.axes.x, maxTicks: number) =>
    niceDomain(values, {
      maxTicks,
      // A scatter's axes exist to spread the points out; forcing zero onto
      // them usually squashes the cloud into a corner.
      includeZero: false,
      min: axis.min,
      max: axis.max,
      step: axis.tickStep,
    });

  let xScale = domainFor(points.map((p) => p.x), spec.axes.x, 5);
  let yScale = domainFor(points.map((p) => p.y), spec.axes.y, 5);

  const legendItems: LegendItem[] = spec.data.series.map((s, i) => ({
    name: s.name,
    seriesKey: s.key,
    color: s.format?.fill?.kind === 'solid' ? s.format.fill.color : theme.seriesColor(i),
  }));

  const frameBase = {
    frame: chart.frame,
    theme,
    measurer,
    horizontal: false,
    showValueAxisLabels: spec.axes.y.show,
    showCategoryAxisLabels: spec.axes.x.show,
    continuousCategoryAxis: true,
    title: spec.title,
    valueAxisTitle: spec.axes.y.title,
    categoryAxisTitle: spec.axes.x.title,
    unitNote: spec.axes.y.unitNote,
    legend: spec.legend.show
      ? { items: legendItems.map((i) => i.name), position: spec.legend.position }
      : undefined,
    padding: spec.plotPadding,
  };

  const fmt = (scale: LinearScale, axis: typeof spec.axes.x) =>
    formatSet(scale.ticks, axis.numberFormat ?? spec.numberFormat).map((f) => f.text);

  let layout = solveFrame({
    ...frameBase,
    tickLabels: fmt(yScale, spec.axes.y),
    categoryLabels: fmt(xScale, spec.axes.x),
  });

  // Both axes are numeric here, so both get a space-driven tick budget.
  yScale = domainFor(points.map((p) => p.y), spec.axes.y, maxTicksFor(layout.plot.h, tickLineH));
  xScale = domainFor(points.map((p) => p.x), spec.axes.x, maxTicksFor(layout.plot.w, tickLineH * 3));
  layout = solveFrame({
    ...frameBase,
    tickLabels: fmt(yScale, spec.axes.y),
    categoryLabels: fmt(xScale, spec.axes.x),
  });

  const proj = projector(layout.plot, yScale, false);
  const xTicks = fmt(xScale, spec.axes.x);

  const furniture = placeCartesianFurniture({
    chartId: chart.id,
    theme,
    measurer,
    layout,
    proj,
    scale: yScale,
    bounds: chart.frame,
    tickLabels: fmt(yScale, spec.axes.y),
    categoryLabels: xTicks,
    // The x axis is continuous, so its "categories" are its own tick values.
    categoryCenters: xScale.ticks.map((t) => xScale.norm(t)),
    showValueAxisLabels: spec.axes.y.show,
    showCategoryAxisLabels: spec.axes.x.show,
    continuousCategoryAxis: true,
    showValueAxisLine: true,
    showCategoryAxisLine: true,
    gridlines: spec.decorations.gridlines.major?.show ?? theme.gridlines.major,
    title: spec.title,
    valueAxisTitle: spec.axes.y.title,
    categoryAxisTitle: spec.axes.x.title,
    unitNote: spec.axes.y.unitNote,
    legend: spec.legend.show ? { ...spec.legend, items: legendItems } : undefined,
  });

  const body = placeXY({
    chartId: chart.id,
    spec,
    plot: layout.plot,
    xScale,
    yScale,
    theme,
    measurer,
  });

  return [...furniture, ...body];
}

export type { Rect };
