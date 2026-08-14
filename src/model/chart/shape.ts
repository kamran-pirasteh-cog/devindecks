/**
 * Data shapes.
 *
 * Twelve chart kinds do NOT need twelve datasheets. They need four data
 * shapes — a category grid, x/y points, a waterfall ledger and a butterfly
 * pair — and the datasheet switches on the shape, not the kind. Adding a chart
 * type is then one line in `dataShapeOf` plus a placer, with no grid changes
 * at all.
 */
import type { ChartKind, ChartSpec, GridData, GridSeries, XYData } from './spec';
import { isButterflySpec, isGridSpec, isSankeySpec, isWaterfallSpec, isXYSpec } from './spec';
import { defaultChartSpec } from './defaults';

export type DataShape =
  | { form: 'grid'; seriesLimit?: number; valueHeader: string }
  | { form: 'xy'; fields: ('x' | 'y' | 'size' | 'label')[] }
  | { form: 'waterfall' }
  | { form: 'sankey' }
  | { form: 'butterfly' };

export function dataShapeOf(kind: ChartKind): DataShape {
  switch (kind) {
    case 'pie':
    case 'donut':
      // One ring of slices — a second series has nowhere to go.
      return { form: 'grid', seriesLimit: 1, valueHeader: 'Value' };
    case 'scatter':
      return { form: 'xy', fields: ['label', 'x', 'y'] };
    case 'bubble':
      return { form: 'xy', fields: ['label', 'x', 'y', 'size'] };
    case 'waterfall':
      return { form: 'waterfall' };
    // A Sankey's data is a list of FLOWS, not a category grid: one row per
    // link, and the nodes fall out of the endpoints.
    case 'sankey':
      return { form: 'sankey' };
    case 'butterfly':
      return { form: 'butterfly' };
    default:
      return { form: 'grid', valueHeader: 'Value' };
  }
}

export const sameShape = (a: ChartKind, b: ChartKind): boolean =>
  dataShapeOf(a).form === dataShapeOf(b).form;

/* ------------------------------------------------------------------ */
/* Cross-shape data carry-over                                        */
/* ------------------------------------------------------------------ */

const gridOf = (spec: ChartSpec): GridData | null => {
  if (isGridSpec(spec)) return spec.data;
  if (isButterflySpec(spec)) {
    return { categories: spec.categories, series: [...spec.left, ...spec.right] };
  }
  if (isWaterfallSpec(spec)) {
    return {
      categories: spec.data.items.map((it) => ({ key: it.key, label: it.label })),
      series: [
        {
          key: 's0',
          name: 'Value',
          values: spec.data.items.map((it) => it.value),
        },
      ],
    };
  }
  if (isSankeySpec(spec)) {
    // Each flow becomes a category — "Inbound → Qualified" — carrying its own
    // value. It's the only honest flattening: a grid has nowhere to put the
    // network, so the network becomes the row labels.
    const labelOf = new Map(spec.data.nodes.map((n) => [n.key, n.label] as const));
    return {
      categories: spec.data.links.map((l) => ({
        key: l.key,
        label: `${labelOf.get(l.from) ?? l.from} → ${labelOf.get(l.to) ?? l.to}`,
      })),
      series: [{ key: 's0', name: 'Value', values: spec.data.links.map((l) => l.value) }],
    };
  }
  if (isXYSpec(spec)) {
    // x becomes the category axis; each series contributes its y values.
    const first = spec.data.series[0];
    return {
      categories: (first?.points ?? []).map((p) => ({
        key: p.key,
        label: p.label ?? String(p.x),
      })),
      series: spec.data.series.map((s) => ({
        key: s.key,
        name: s.name,
        values: s.points.map((p) => p.y),
      })),
    };
  }
  return null;
};

const xyFromGrid = (grid: GridData): XYData => ({
  series: grid.series.map((s: GridSeries) => ({
    key: s.key,
    name: s.name,
    points: grid.categories.map((c, i) => ({
      key: c.key,
      // No x column existed, so the category index is the only honest x.
      x: i,
      y: s.values[i] ?? 0,
      label: c.label,
    })),
  })),
});

/**
 * Switch chart type, carrying as much data across as the target shape can hold.
 *
 * Style, axes, decorations and provenance ride along from `from`; only the
 * kind-specific fields are rebuilt from the target's defaults. Conversions that
 * genuinely lose information (a grid has no x column, so grid -> scatter must
 * invent one) use the category index and say so in the code rather than
 * silently fabricating plausible numbers.
 */
export function convertData(from: ChartSpec, to: ChartKind): ChartSpec {
  if (from.kind === to) return from;

  const fresh = defaultChartSpec(to, 'stack' in from ? from.stack : 'clustered');
  const carried = {
    ...fresh,
    title: from.title,
    palette: from.palette,
    numberFormat: from.numberFormat,
    legend: from.legend,
    plotPadding: from.plotPadding,
    provenance: from.provenance,
    // Pie/donut deliberately hide their axes; don't resurrect them.
    axes: fresh.kind === 'pie' || fresh.kind === 'donut' ? fresh.axes : from.axes,
    decorations: fresh.kind === 'pie' || fresh.kind === 'donut'
      ? fresh.decorations
      : from.decorations,
  } as ChartSpec;

  const grid = gridOf(from);
  if (!grid) return carried;

  if (isGridSpec(carried)) {
    const limit = dataShapeOf(to).form === 'grid' ? dataShapeOf(to) : null;
    const cap = limit && limit.form === 'grid' ? limit.seriesLimit : undefined;
    carried.data = {
      categories: grid.categories,
      series: cap ? grid.series.slice(0, cap) : grid.series,
    };
    return carried;
  }

  if (isXYSpec(carried)) {
    carried.data = xyFromGrid(grid);
    return carried;
  }

  if (isSankeySpec(carried)) {
    // Every cell of the grid becomes a flow from its category to its series:
    // "FY23 -> Enterprise, 420". That's the reading that makes a stacked
    // column and a Sankey show the same thing, which is what someone
    // switching between the two is asking for.
    const nodes = [
      ...grid.categories.map((c) => ({ key: `n-${c.key}`, label: c.label })),
      ...grid.series.map((s) => ({ key: `n-${s.key}`, label: s.name })),
    ];
    const links = grid.categories.flatMap((c, ci) =>
      grid.series.flatMap((s) => {
        const value = s.values[ci];
        return value === null || value === undefined || value <= 0
          ? []
          : [{ key: `f-${c.key}-${s.key}`, from: `n-${c.key}`, to: `n-${s.key}`, value }];
      }),
    );
    carried.data = { nodes, links };
    return carried;
  }

  if (isWaterfallSpec(carried)) {
    const s = grid.series[0];
    carried.data = {
      items: grid.categories.map((c, i) => ({
        key: c.key,
        label: c.label,
        // Every carried row is a delta; the author promotes one to a total.
        role: 'delta' as const,
        value: s?.values[i] ?? null,
      })),
    };
    return carried;
  }

  if (isButterflySpec(carried)) {
    carried.categories = grid.categories;
    carried.left = grid.series.slice(0, 1);
    carried.right = grid.series.slice(1, 2);
    return carried;
  }

  return carried;
}
