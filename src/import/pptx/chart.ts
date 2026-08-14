/**
 * Embedded charts: a `c:chart` part -> a live `ChartSpec`.
 *
 * This is the highest-value part of the importer. A pasted PowerPoint chart
 * could have come in as a picture, or as a pile of dumb rectangles — instead it
 * arrives as a chart the datasheet can edit, the brand can recolour and the
 * chart engine will re-lay-out on resize. That's only possible because the
 * chart part carries a CACHE of its categories and values (`c:numCache`,
 * `c:strCache`) alongside the workbook reference: we read the cache, so no
 * embedded .xlsx has to be opened.
 *
 * Anything whose shape we can't honestly represent (radar, surface, stock,
 * of-pie) is reported, not silently mangled.
 */
import {
  defaultChartSpec,
  type CategoryDef,
  type ChartKind,
  type ChartSpec,
  type ColorRef,
  type DesignSystem,
  type GridSeries,
  type StackMode,
  type XYSeries,
} from '@/model';
import { attr, child, children, descendants, numAttr, textOf, type XmlNode } from '../xml';
import { resolveFillColor, toColorRef, type ColorContext } from './color';

export interface ChartImportResult {
  spec: ChartSpec;
  /** Non-fatal fidelity notes, surfaced in the import dialog. */
  notes: string[];
}

/** Plot elements we can map, in the order we prefer them for combo charts. */
const PLOT_KINDS = [
  'barChart',
  'bar3DChart',
  'lineChart',
  'line3DChart',
  'areaChart',
  'area3DChart',
  'pieChart',
  'pie3DChart',
  'doughnutChart',
  'scatterChart',
  'bubbleChart',
] as const;

const UNSUPPORTED_LABEL: Record<string, string> = {
  radarChart: 'radar',
  stockChart: 'stock',
  surfaceChart: 'surface',
  surface3DChart: '3-D surface',
  ofPieChart: 'pie-of-pie',
};

export function parseChartPart(
  chartSpace: XmlNode,
  ctx: ColorContext,
  ds: DesignSystem,
): ChartImportResult | null {
  const notes: string[] = [];
  const plotArea = child(child(chartSpace, 'chart'), 'plotArea');
  if (!plotArea) return null;

  for (const [name, label] of Object.entries(UNSUPPORTED_LABEL)) {
    if (child(plotArea, name)) {
      notes.push(`A ${label} chart has no equivalent here; imported as a column chart.`);
    }
  }

  const plots = plotArea.children.filter((c) =>
    (PLOT_KINDS as readonly string[]).includes(c.name),
  );
  if (!plots.length) return null;

  if (plots.some((p) => p.name.includes('3D'))) {
    notes.push('A 3-D chart was flattened to 2-D — depth never survives a redraw anyway.');
  }

  const isXY = plots[0].name === 'scatterChart' || plots[0].name === 'bubbleChart';
  const spec = isXY
    ? buildXYSpec(plots[0], ctx, ds, notes)
    : buildGridSpec(plots, plotArea, ctx, ds, notes);
  if (!spec) return null;

  const title = chartTitle(chartSpace);
  if (title) spec.title = title;

  const legendPos = attr(child(child(chartSpace, 'chart'), 'legend')?.children.find(
    (c) => c.name === 'legendPos',
  ), 'val');
  const hasLegend = !!child(child(chartSpace, 'chart'), 'legend');
  spec.legend = {
    show: hasLegend,
    position:
      legendPos === 'r' ? 'right'
      : legendPos === 'l' ? 'left'
      : legendPos === 't' ? 'top'
      : 'bottom',
  };

  return { spec, notes };
}

/* ------------------------------------------------------------------ */
/* Grid charts (category × series)                                     */
/* ------------------------------------------------------------------ */

function buildGridSpec(
  plots: XmlNode[],
  plotArea: XmlNode,
  ctx: ColorContext,
  ds: DesignSystem,
  notes: string[],
): ChartSpec | null {
  const primary = plots[0];
  const grouping = attr(child(primary, 'grouping'), 'val') ?? 'clustered';
  const stack: StackMode =
    grouping === 'stacked' ? 'stacked'
    : grouping === 'percentStacked' ? 'stacked100'
    : 'clustered';

  const barDir = attr(child(primary, 'barDir'), 'val');
  let kind: ChartKind = kindOf(primary.name, barDir);

  // More than one plot element on one axis pair IS a combo chart.
  const isCombo = plots.length > 1 && !plots.every((p) => p.name === plots[0].name);
  if (isCombo) kind = 'combo';

  const allSeries: { node: XmlNode; plot: string }[] = plots.flatMap((p) =>
    children(p, 'ser').map((s) => ({ node: s, plot: p.name })),
  );
  if (!allSeries.length) return null;

  // Categories come from the first series that has a cache; every series in a
  // grid chart shares them.
  const categories = readCategories(allSeries.map((s) => s.node));
  const palette: ColorRef[] = [];

  const series: GridSeries[] = allSeries.map((s, i) => {
    const values = readNumCache(child(s.node, 'val'), categories.length);
    const fill = seriesColor(s.node, ctx, ds);
    if (fill) palette[i] = fill;
    return {
      key: `s${i + 1}`,
      name: seriesName(s.node) || `Series ${i + 1}`,
      values,
      axis: attr(child(s.node, 'order'), 'val') && isSecondary(s.node, plotArea) ? 'secondary' : undefined,
    };
  });

  const base = defaultChartSpec(kind, stack, ds.chart);
  if (base.kind === 'scatter' || base.kind === 'bubble' || base.kind === 'sankey') return null;

  const spec = { ...base } as Extract<ChartSpec, { data: { categories: CategoryDef[] } }>;
  spec.data = { categories, series };
  if (palette.filter(Boolean).length === series.length) spec.palette = palette;

  if (spec.kind === 'column' || spec.kind === 'bar' || spec.kind === 'combo') {
    const gap = numAttr(child(primary, 'gapWidth'), 'val');
    if (gap !== undefined) spec.gapWidthPct = gap;
    const overlap = numAttr(child(primary, 'overlap'), 'val');
    if (overlap !== undefined) spec.overlapPct = overlap;
  }

  if (spec.kind === 'combo') {
    spec.render = {};
    allSeries.forEach((s, i) => {
      spec.render[`s${i + 1}`] =
        s.plot.startsWith('line') ? 'line' : s.plot.startsWith('area') ? 'area' : 'column';
    });
  }

  if (spec.kind === 'donut') {
    const hole = numAttr(child(plots[0], 'holeSize'), 'val');
    if (hole !== undefined) spec.innerRadiusPct = hole;
  }

  if ((spec.kind === 'pie' || spec.kind === 'donut') && series.length > 1) {
    notes.push('A multi-ring pie was reduced to its first ring.');
    spec.data = { categories, series: [series[0]] };
  }

  // Axis titles, when the deck bothered to write them.
  const axisTitles = readAxisTitles(plotArea);
  if (axisTitles.x) spec.axes = { ...spec.axes, x: { ...spec.axes.x, title: axisTitles.x } };
  if (axisTitles.y) spec.axes = { ...spec.axes, y: { ...spec.axes.y, title: axisTitles.y } };

  // Data labels: honour whether the source chart showed them at all.
  const showLabels = attr(descendants(primary, 'showVal')[0], 'val');
  if (showLabels !== undefined) {
    spec.decorations = {
      ...spec.decorations,
      labels: { ...spec.decorations.labels, show: showLabels === '1' },
    };
  }

  return spec as ChartSpec;
}

function kindOf(plotName: string, barDir: string | undefined): ChartKind {
  switch (plotName) {
    case 'barChart':
    case 'bar3DChart':
      return barDir === 'bar' ? 'bar' : 'column';
    case 'lineChart':
    case 'line3DChart':
      return 'line';
    case 'areaChart':
    case 'area3DChart':
      return 'area';
    case 'pieChart':
    case 'pie3DChart':
      return 'pie';
    case 'doughnutChart':
      return 'donut';
    default:
      return 'column';
  }
}

/** Does this series plot against the secondary value axis? */
function isSecondary(ser: XmlNode, plotArea: XmlNode): boolean {
  const valAxes = children(plotArea, 'valAx');
  if (valAxes.length < 2) return false;
  // The series' parent plot carries the axIds; the second valAx is secondary.
  const secondaryId = attr(child(valAxes[1], 'axId'), 'val');
  const parentPlot = plotArea.children.find((p) => p.children.includes(ser));
  return children(parentPlot, 'axId').some((a) => attr(a, 'val') === secondaryId);
}

/* ------------------------------------------------------------------ */
/* XY charts                                                           */
/* ------------------------------------------------------------------ */

function buildXYSpec(
  plot: XmlNode,
  ctx: ColorContext,
  ds: DesignSystem,
  notes: string[],
): ChartSpec | null {
  const bubble = plot.name === 'bubbleChart';
  const sers = children(plot, 'ser');
  if (!sers.length) return null;

  const palette: ColorRef[] = [];
  const series: XYSeries[] = sers.map((s, i) => {
    const xs = readNumCache(child(s, 'xVal'), 0);
    const ys = readNumCache(child(s, 'yVal'), 0);
    const sizes = bubble ? readNumCache(child(s, 'bubbleSize'), 0) : [];
    const fill = seriesColor(s, ctx, ds);
    if (fill) palette[i] = fill;
    const count = Math.max(xs.length, ys.length);
    return {
      key: `s${i + 1}`,
      name: seriesName(s) || `Series ${i + 1}`,
      points: Array.from({ length: count }, (_, j) => ({
        key: `p${j + 1}`,
        x: xs[j] ?? 0,
        y: ys[j] ?? 0,
        ...(bubble ? { size: sizes[j] ?? 1 } : {}),
      })),
    };
  });

  const base = defaultChartSpec(bubble ? 'bubble' : 'scatter', 'clustered', ds.chart);
  if (base.kind !== 'scatter' && base.kind !== 'bubble') return null;
  const spec = { ...base, data: { series } };
  if (palette.filter(Boolean).length === series.length) spec.palette = palette;
  if (!bubble && attr(child(plot, 'scatterStyle'), 'val')?.includes('line')) {
    notes.push('A scatter chart with connecting lines imported as points only.');
  }
  return spec;
}

/* ------------------------------------------------------------------ */
/* Cache readers                                                       */
/* ------------------------------------------------------------------ */

function readCategories(sers: XmlNode[]): CategoryDef[] {
  for (const s of sers) {
    const cat = child(s, 'cat');
    const pts = descendants(cat, 'pt');
    if (!pts.length) continue;
    const labels: string[] = [];
    for (const pt of pts) {
      const idx = numAttr(pt, 'idx') ?? labels.length;
      labels[idx] = textOf(child(pt, 'v'));
    }
    return labels.map((label, i) => ({ key: `c${i + 1}`, label: label ?? '' }));
  }
  // No category cache at all (common for a chart built from a formula range
  // that was never opened): fall back to 1..n from the value count.
  const count = descendants(child(sers[0], 'val'), 'pt').length;
  return Array.from({ length: count }, (_, i) => ({ key: `c${i + 1}`, label: `${i + 1}` }));
}

/**
 * Read a `<c:numCache>`'s points into a dense array.
 *
 * Points are SPARSE and carry their own `idx` — a gap in the source data has no
 * `pt` at all, and that gap must stay `null` (a hole in a line), not become a
 * zero (a dive to the axis).
 */
function readNumCache(container: XmlNode | undefined, minLength: number): (number | null)[] {
  const pts = descendants(container, 'pt');
  const count = Math.max(
    minLength,
    numAttr(descendants(container, 'ptCount')[0], 'val') ?? 0,
    ...pts.map((p) => (numAttr(p, 'idx') ?? 0) + 1),
  );
  const out: (number | null)[] = Array.from({ length: count }, () => null);
  for (const pt of pts) {
    const idx = numAttr(pt, 'idx') ?? 0;
    const raw = textOf(child(pt, 'v'));
    const n = Number(raw);
    out[idx] = raw !== '' && Number.isFinite(n) ? n : null;
  }
  return out;
}

const seriesName = (ser: XmlNode): string =>
  textOf(descendants(child(ser, 'tx'), 'v')[0]).trim();

function seriesColor(
  ser: XmlNode,
  ctx: ColorContext,
  ds: DesignSystem,
): ColorRef | undefined {
  const spPr = child(ser, 'spPr');
  const solid = child(spPr, 'solidFill') ?? child(child(spPr, 'ln'), 'solidFill');
  const c = solid ? resolveFillColor(solid, ctx) : undefined;
  return c ? toColorRef(c.hex, ds) : undefined;
}

function chartTitle(chartSpace: XmlNode): string | undefined {
  const title = child(child(chartSpace, 'chart'), 'title');
  if (!title) return undefined;
  const text = descendants(title, 't').map(textOf).join('').trim();
  return text || undefined;
}

function readAxisTitles(plotArea: XmlNode): { x?: string; y?: string } {
  const titleOf = (ax: XmlNode | undefined) => {
    const t = descendants(child(ax, 'title'), 't').map(textOf).join('').trim();
    return t || undefined;
  };
  return {
    x: titleOf(children(plotArea, 'catAx')[0] ?? children(plotArea, 'valAx')[0]),
    y: titleOf(children(plotArea, 'valAx')[children(plotArea, 'catAx').length ? 0 : 1]),
  };
}
