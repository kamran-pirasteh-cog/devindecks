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
  isInsideLegend,
  supportsTurn,
  token,
  type AreaSpec,
  type ChartInstance,
  type ChartSpec,
  type ColumnBarSpec,
  type ComboSpec,
  type DesignSystem,
  type GridSeries,
  type LegendPosition,
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
import { dsForChartVariant } from '@/charts/style';
import { formatSet } from './format/number';
import { deriveGrid, type GridDerived } from './derive/grid';
import { deriveWaterfall } from './derive/waterfall';
import { insideLegendSlot, maxTicksFor, solveFrame, type FrameLayout } from './layout/frame';
import { makeScale, niceDomain, type LinearScale } from './scale/linear';
import { categoryCenters, placeColumnBar } from './place/columnBar';
import {
  placeCartesianFurniture,
  placeLegend,
  projector,
  type LegendItem,
} from './place/cartesian';
import {
  comboColumnBand,
  comboUnstackedKeys,
  endLabelTexts,
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
import { layoutFrame, snapQuarterTurn, turnBox, turnElements, type QuarterTurn } from './turn';
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

/**
 * The furniture that belongs to the chart's BOX rather than to the picture in
 * it, and so sits out the turn: the title, the unit note under it, the legend.
 *
 * All three are solved against the chart's real frame and drawn upright there.
 * Turning them buys nothing — a title spanning the frame becomes a strip down
 * the side, where horizontal type only fits by eating inches of the chart's
 * width — and costs the one place a reader looks first.
 */
const isLegend = (mark: Mark): boolean =>
  mark.ref.part === 'legend.item' || mark.ref.part === 'legend.box';

const isChrome = (mark: Mark): boolean =>
  mark.ref.part === 'title' ||
  isLegend(mark) ||
  (mark.ref.part === 'axis' && mark.ref.sub === 'unitNote');

/** What a `compile*` pass hands back: its marks, and the box they turn about. */
interface Placed {
  marks: Mark[];
  /** Transposed at 90° and 270° so the turn lands back on the chart's box. */
  innerFrame: Rect;
}

export function compileChart(
  chart: ChartInstance,
  designSystem: DesignSystem,
  measurer: TextMeasurer = defaultMeasurer(),
): CompileResult {
  const diagnostics: CompileDiagnostic[] = [];
  const { spec } = chart;

  /**
   * The chart's own style variant, folded into the design system before
   * anything reads it.
   *
   * One swap here rather than a variant-aware branch in `resolveChartTheme`,
   * the layout passes and each exporter: everything downstream already takes a
   * `DesignSystem` and reads `ds.chart`, so a chart inserted as "Column /
   * gridless" is gridless on the canvas, in a thumbnail and in the .pptx
   * without any of them knowing variants exist.
   *
   * A chart with no `variantId` gets `designSystem` back untouched.
   */
  const ds = chart.variantId ? dsForChartVariant(designSystem, chart.variantId) : designSystem;

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

  const { marks, innerFrame } =
    spec.kind === 'sankey'
      ? compileSankey(chart, spec, theme, measurer, rotation, diagnostics)
      : spec.kind === 'scatter' || spec.kind === 'bubble'
        ? compileXY(chart, theme, measurer, diagnostics)
        : compileCartesian(chart, theme, measurer, rotation, diagnostics);

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
    // The chart's real box, whatever the turn: the backdrop is the thing being
    // turned, not a thing that turns.
    rect: chart.frame,
    fill: theme.plotBackground
      ? { kind: 'solid', color: theme.plotBackground }
      : { kind: 'solid', color: token('surface.base'), alpha: 0 },
  };

  // Only the chart proper turns. Its title, unit note and legend belong to the
  // BOX rather than to the picture inside it — a title reading up the side of a
  // turned chart is nobody's idea of a title — so they were solved against the
  // real frame and are left where they are. See `isChrome`.
  //
  // An inside legend is chrome too — upright, in real coordinates, out of the
  // turn — but it can't be painted with the rest of it. Chrome goes down FIRST,
  // under the data, which is exactly right for furniture in its own gutter and
  // exactly wrong for a legend sitting on top of the bars: it would be buried
  // by the series it names. So it comes out into its own pass, drawn last.
  const overlay = spec.legend.show && isInsideLegend(spec.legend.position);
  const chrome = marks.filter((m) => isChrome(m) && !(overlay && isLegend(m)));
  const inner = marks.filter((m) => !isChrome(m));

  const elements = [
    ...emitMarks([backdrop, ...chrome], chart.groupId),
    // Laid out upright in `innerFrame`, then turned onto the real one — see
    // `turn.ts`. At 0° this is identity.
    ...turnElements(emitMarks(inner, chart.groupId), innerFrame, rotation),
    ...(overlay ? emitMarks(marks.filter(isLegend), chart.groupId) : []),
  ];

  return { elements, diagnostics };
}

/**
 * Reserve the chrome against the chart's REAL box, before any turn.
 *
 * Returns the bands the title, unit note and legend occupy, and — as `plot` —
 * the box left over for the chart itself. Everything downstream is solved
 * inside that leftover box, which is what keeps the turn from ever reaching the
 * chrome. Passing no axis labels is deliberate: this pass knows nothing about
 * ticks, and reserving them twice would push the plot in by two gutters.
 */
function solveChrome(input: {
  frame: Rect;
  theme: ChartTheme;
  measurer: TextMeasurer;
  horizontal: boolean;
  title?: string;
  unitNote?: string;
  legend?: { items: string[]; position: LegendPosition };
}): FrameLayout {
  return solveFrame({
    ...input,
    tickLabels: [],
    categoryLabels: [],
    showValueAxisLabels: false,
    showCategoryAxisLabels: false,
  });
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
  rotation: QuarterTurn,
  diagnostics: CompileDiagnostic[],
): Placed {
  const empty = { marks: [], innerFrame: chart.frame };
  if (!spec.data.nodes.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart-empty',
      message: 'This chart has no data yet.',
    });
    return empty;
  }

  const chrome = solveChrome({
    frame: chart.frame,
    theme,
    measurer,
    horizontal: false,
    title: spec.title,
  });
  const innerFrame = layoutFrame(chrome.plot, rotation);

  const layout = solveFrame({
    frame: innerFrame,
    theme,
    measurer,
    horizontal: false,
    tickLabels: [],
    categoryLabels: [],
    showValueAxisLabels: false,
    showCategoryAxisLabels: false,
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

  if (!marks.length) return empty;

  return {
    innerFrame,
    marks: [
      ...marks,
      ...placeCartesianFurniture({
        chartId: chart.id,
        theme,
        measurer,
        layout: chrome,
        proj: projector(chrome.plot, makeScale(0, 1, 1), false),
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
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Category-axis charts                                               */
/* ------------------------------------------------------------------ */

function compileCartesian(
  chart: ChartInstance,
  theme: ChartTheme,
  measurer: TextMeasurer,
  rotation: QuarterTurn,
  diagnostics: CompileDiagnostic[],
): Placed {
  const spec = chart.spec;
  const horizontal = isHorizontal(spec);
  // A quarter turn stands the labels back up afterwards, so the gutters they
  // sit in have to be cut for horizontal type — see `uprightText` in
  // `frame.ts`. A half turn leaves every label the way up it already was.
  const uprightText = rotation === 90 || rotation === 270;
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
        { unstacked: spec.kind === 'combo' ? comboUnstackedKeys(spec) : undefined },
      );

  if (!derived.series.length || !derived.categoryLabels.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart-empty',
      message: 'This chart has no data yet.',
    });
    return { marks: [], innerFrame: chart.frame };
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

  /**
   * A hidden mark takes its legend key with it.
   *
   * Deleting a series on the canvas hides every one of its points, and a key
   * still sitting in the legend for a series with nothing left in the plot
   * reads as a bug — an entry pointing at empty space.
   */
  const allPointsHidden = (s: GridSeries): boolean => {
    const keys = derived.data.filter((d) => d.seriesKey === s.key).map((d) => d.pointKey);
    return keys.length > 0 && keys.every((k) => s.pointOverrides?.[k]?.hidden);
  };

  const legendItems: LegendItem[] = isPie
    ? derived.data
        .filter((d) => d.seriesIndex === 0 && !derived.series[0]?.pointOverrides?.[d.pointKey]?.hidden)
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
    : derived.series
        // Colour comes from the series' own index, so the drop happens inside
        // the map — filtering first would recolour everything below the gap.
        .map((s, i): LegendItem | null =>
          allPointsHidden(s)
            ? null
            : {
                name: s.name,
                seriesKey: s.key,
                color:
                  s.format?.fill?.kind === 'solid' ? s.format.fill.color : theme.seriesColor(i),
              },
        )
        .filter((item): item is LegendItem => item !== null);

  /**
   * The legend, when it floats over the plot instead of beside it.
   *
   * Deferred to a callback because it needs the FINISHED plot: `solveFrame`
   * reserves nothing for it (that's the point), so there's nothing to place
   * until the axes have taken their gutters. Handed the plot in the chart's
   * real coordinates, never the turned box's — the legend sits out the turn
   * with the rest of the chrome, so it has to be solved where it will be drawn.
   */
  const insideLegend = (plot: Rect): Mark[] =>
    spec.legend.show && isInsideLegend(spec.legend.position) && legendItems.length
      ? placeLegend(
          chart.id,
          { ...spec.legend, items: legendItems },
          insideLegendSlot(
            plot,
            legendItems.map((i) => i.name),
            spec.legend.position,
            theme,
            measurer,
          ),
          theme,
          measurer,
        )
      : [];

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

  // The chart's own box first — title, unit note, legend — then the turn, then
  // the axes inside whatever is left. Solving the chrome against the real frame
  // is what lets it sit out the turn; see `solveChrome`.
  const chrome = solveChrome({
    frame: chart.frame,
    theme,
    measurer,
    horizontal,
    title: spec.title,
    unitNote: showAxes ? valueAxis.unitNote : undefined,
    legend: spec.legend.show
      ? { items: legendItems.map((i) => i.name), position: spec.legend.position }
      : undefined,
  });
  const innerFrame = layoutFrame(chrome.plot, rotation);

  const frameInputBase = {
    frame: innerFrame,
    theme,
    measurer,
    horizontal,
    uprightText,
    outsideValueLabels,
    endLabels:
      spec.kind === 'line' && spec.endLabels ? endLabelTexts(spec, derived) : undefined,
    categoryLabels: derived.categoryLabels,
    showValueAxisLabels: showAxes && valueAxis.show,
    showCategoryAxisLabels: showAxes && categoryAxis.show,
    continuousCategoryAxis: edgeCategories,
    valueAxisTitle: showAxes ? valueAxis.title : undefined,
    categoryAxisTitle: showAxes ? categoryAxis.title : undefined,
    padding: spec.plotPadding,
  };

  // The extent one tick label costs ALONG its own axis. Upright labels on a
  // turned chart lie across that axis instead, so the two swap and a turned
  // value axis budgets for the width of "1,250" rather than for a line height.
  const tickAlong = uprightText === horizontal ? tickLineH : tickLineH * 3;

  // Pass 1: guess the tick budget from the frame, since there's no plot yet.
  const firstExtent = horizontal ? innerFrame.w : innerFrame.h;
  let { scale, ticks } = solve(maxTicksFor(firstExtent, tickAlong));
  let layout: FrameLayout = solveFrame({ ...frameInputBase, tickLabels: ticks });

  // Pass 2: re-solve against the plot we actually got.
  const plotExtent = horizontal ? layout.plot.w : layout.plot.h;
  const second = solve(maxTicksFor(plotExtent, tickAlong));
  if (second.scale.step !== scale.step || second.scale.max !== scale.max) {
    scale = second.scale;
    ticks = second.ticks;
    layout = solveFrame({ ...frameInputBase, tickLabels: ticks });
  }

  const proj = projector(layout.plot, scale, horizontal);
  const centers = centersFor(spec, derived);

  const body = placeBody(chart, spec, derived, proj, scale, theme, measurer, layout, uprightText);

  if (isPie) {
    // A pie has no axes or gridlines; only its title and legend are furniture,
    // and both are chrome — solved against the real frame, left out of the turn.
    const furniture = placeCartesianFurniture({
      chartId: chart.id,
      theme,
      measurer,
      layout: chrome,
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
    // A pie has no axes, so its plot IS the box the chrome left over.
    return { marks: [...furniture, ...body, ...insideLegend(chrome.plot)], innerFrame };
  }

  // The chrome, drawn against the real frame …
  const outer = placeCartesianFurniture({
    chartId: chart.id,
    theme,
    measurer,
    layout: chrome,
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
    unitNote: valueAxis.unitNote,
    legend: spec.legend.show ? { ...spec.legend, items: legendItems } : undefined,
  });

  // … and the axes, drawn inside the turned box. `bounds` is that box too: the
  // clamp that keeps an end label on the chart has to be measured in the space
  // the label is actually laid out in.
  const furniture = placeCartesianFurniture({
    chartId: chart.id,
    theme,
    measurer,
    layout,
    proj,
    scale,
    bounds: innerFrame,
    uprightText,
    tickLabels: ticks,
    categoryLabels: derived.categoryLabels,
    categoryCenters: centers,
    showValueAxisLabels: valueAxis.show,
    showCategoryAxisLabels: categoryAxis.show,
    continuousCategoryAxis: edgeCategories,
    showValueAxisLine: false,
    showCategoryAxisLine: categoryAxis.show,
    valueTickMarks: valueAxis.tickMarks,
    categoryTickMarks: categoryAxis.tickMarks,
    gridlines: spec.decorations.gridlines.major?.show ?? theme.gridlines.major,
    valueAxisTitle: valueAxis.title,
    categoryAxisTitle: categoryAxis.title,
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
  return {
    marks: [
      ...outer,
      ...furniture,
      ...body,
      ...annotations,
      // The plot as it lands on the slide: `layout.plot` is solved in the
      // transposed box, and an upright legend hung off those coordinates would
      // sit wherever the chart isn't. See `turnBox`.
      ...insideLegend(turnBox(layout.plot, innerFrame, rotation)),
    ],
    innerFrame,
  };
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
  uprightText: boolean,
): Mark[] {
  const common = { chartId: chart.id, derived, proj, scale, theme, measurer, uprightText };

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
        onlySeries: columnSet,
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
): Placed {
  const spec = chart.spec as import('@/model').ScatterSpec | import('@/model').BubbleSpec;
  const points = spec.data.series.flatMap((s) => s.points);
  // An x/y plot is never turned — `supportsTurn` refuses it — so it is solved
  // in its own frame and the split below costs it nothing.
  const innerFrame = chart.frame;

  if (!points.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart-empty',
      message: 'This chart has no data yet.',
    });
    return { marks: [], innerFrame };
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
    valueTickMarks: spec.axes.y.tickMarks,
    categoryTickMarks: spec.axes.x.tickMarks,
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

  // An inside legend reserved no gutter, so it's solved from the finished plot
  // and drawn over the cloud — see `insideLegendSlot`. A scatter never turns,
  // so the plot is already in the chart's real coordinates.
  const inside =
    spec.legend.show && isInsideLegend(spec.legend.position) && legendItems.length
      ? placeLegend(
          chart.id,
          { ...spec.legend, items: legendItems },
          insideLegendSlot(
            layout.plot,
            legendItems.map((i) => i.name),
            spec.legend.position,
            theme,
            measurer,
          ),
          theme,
          measurer,
        )
      : [];

  return { marks: [...furniture, ...body, ...inside], innerFrame };
}

export type { Rect };
