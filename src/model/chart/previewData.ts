/**
 * The dummy data behind every chart preview in Admin.
 *
 * A style is judged against numbers, not against a style sheet: whether the
 * house column chart reads depends on how many series it carries and how close
 * two of them come. Three years by three segments is a fine default and the
 * wrong shape for a brand whose charts are always six quarters — so this is
 * editable, stored on the design system beside the style it exists to show off.
 *
 * It is PREVIEW SCAFFOLDING and nothing else. No chart on a slide reads it, no
 * exporter sees it, and it is deliberately not part of `ChartStyle`: a style is
 * formatting, and formatting that carried data would pin numbers onto every
 * chart inserted from it.
 */
import {
  isButterflySpec,
  isGridSpec,
  isWaterfallSpec,
  type ChartKind,
  type ChartSpec,
  type ComboSpec,
  type GridSeries,
} from './spec';
import { sampleComboGridData, sampleGridData } from './defaults';

export interface ChartPreviewSeries {
  name: string;
  /** Aligned to `categories`; short rows pad with gaps, long ones are trimmed. */
  values: (number | null)[];
}

export interface ChartPreviewData {
  categories: string[];
  series: ChartPreviewSeries[];
  /**
   * The row for a chart's RIGHT-HAND axis — a combo's line.
   *
   * Its own row rather than one more column in the table, because its numbers
   * aren't in the table's units: a margin in per cent beside three revenues in
   * millions is exactly the case a second axis exists for, and a preview that
   * can't express it can't show what the second axis does. Only the kinds that
   * carry a secondary axis read it; everything else previews on one scale.
   */
  secondary?: ChartPreviewSeries;
}

/** The built-in sample, in the editable shape — what "Reset" goes back to. */
export const DEFAULT_CHART_PREVIEW_DATA: ChartPreviewData = (() => {
  const g = sampleGridData();
  const rate = sampleComboGridData().series.find((s) => s.axis === 'secondary');
  return {
    categories: g.categories.map((c) => c.label),
    series: g.series.map((s) => ({ name: s.name, values: [...s.values] })),
    secondary: rate
      ? { name: rate.name, values: [...rate.values] }
      : { name: 'Rate', values: [] },
  };
})();

/**
 * Can this kind be driven by a category × series table?
 *
 * Scatter, bubble and Sankey can't: an x/y cloud and a flow network aren't
 * tables, and forcing one through — x from the row index — previews a line
 * chart wearing a scatter's clothes, which is worse than previewing the
 * built-in sample. Those keep theirs.
 */
export const previewDataAppliesTo = (kind: ChartKind): boolean =>
  // A Gantt joins them: a category × series table of numbers cannot drive a
  // schedule, whose data is spans of time against a row tree.
  kind !== 'scatter' && kind !== 'bubble' && kind !== 'sankey' && kind !== 'gantt';

/**
 * A spec redrawn on the given dummy data.
 *
 * Pure, and a no-op for anything it can't express — so a caller can hand it
 * every preview spec without asking what kind each one is.
 */
export function applyPreviewData(spec: ChartSpec, data?: ChartPreviewData): ChartSpec {
  if (!data) return spec;
  const categories = data.categories.length ? data.categories : DEFAULT_CHART_PREVIEW_DATA.categories;
  const series = data.series.length ? data.series : DEFAULT_CHART_PREVIEW_DATA.series;

  const cats = categories.map((label, i) => ({ key: `c${i}`, label }));
  const gridSeries = (): GridSeries[] =>
    series.map((s, i) => ({
      key: `s${i}`,
      name: s.name,
      values: cats.map((_, c) => s.values[c] ?? null),
    }));

  if (isGridSpec(spec)) {
    const built = gridSeries();
    // A combo draws the table as its columns and the secondary row as its line,
    // whatever the table's shape. Reading the line off a column of the table
    // instead — as `render: { s2: 'line' }` alone does — turns whichever series
    // happens to sit third into a line, in the table's units, on the columns'
    // axis.
    if (spec.kind === 'combo') {
      const row = data.secondary ?? DEFAULT_CHART_PREVIEW_DATA.secondary;
      const line: GridSeries[] = row
        ? [
            {
              key: `s${built.length}`,
              name: row.name,
              values: cats.map((_, c) => row.values[c] ?? null),
              axis: 'secondary',
            },
          ]
        : [];
      const combo: ComboSpec = {
        ...spec,
        render: Object.fromEntries(line.map((l) => [l.key, 'line' as const])),
        data: { categories: cats, series: [...built, ...line] },
      };
      return combo;
    }
    return { ...spec, data: { categories: cats, series: built } };
  }

  if (isButterflySpec(spec)) {
    const s = gridSeries();
    // A butterfly needs a side each. One series drawn on both sides is a
    // mirror, which at least shows the style; drawing nothing shows nothing.
    return { ...spec, categories: cats, left: [s[0]], right: [s[1] ?? s[0]] };
  }

  if (isWaterfallSpec(spec)) {
    const values = cats.map((_, i) => series[0]?.values[i] ?? null);
    return {
      ...spec,
      data: {
        items: cats.map((c, i) => {
          const last = i === cats.length - 1;
          return {
            key: `w${i}`,
            label: c.label,
            // First row is the base, last is the total the bridge lands on —
            // and its value is left computed, so the total can't contradict the
            // deltas above it.
            role: i === 0 ? ('start' as const) : last ? ('total' as const) : ('delta' as const),
            value: last && cats.length > 1 ? null : values[i],
          };
        }),
      },
    };
  }

  return spec;
}

/* ------------------------------------------------------------------ */
/* Editing                                                            */
/* ------------------------------------------------------------------ */

/** Category count the editor grows to when a row is added. */
export function addPreviewCategory(data: ChartPreviewData): ChartPreviewData {
  return {
    ...data,
    categories: [...data.categories, `Row ${data.categories.length + 1}`],
    series: data.series.map((s) => ({ ...s, values: [...s.values, null] })),
    ...(data.secondary
      ? { secondary: { ...data.secondary, values: [...data.secondary.values, null] } }
      : {}),
  };
}

export function removePreviewCategory(data: ChartPreviewData, i: number): ChartPreviewData {
  if (data.categories.length <= 1) return data;
  return {
    ...data,
    categories: data.categories.filter((_, x) => x !== i),
    series: data.series.map((s) => ({ ...s, values: s.values.filter((_, x) => x !== i) })),
    ...(data.secondary
      ? {
          secondary: {
            ...data.secondary,
            values: data.secondary.values.filter((_, x) => x !== i),
          },
        }
      : {}),
  };
}

export function addPreviewSeries(data: ChartPreviewData): ChartPreviewData {
  return {
    ...data,
    series: [
      ...data.series,
      { name: `Series ${data.series.length + 1}`, values: data.categories.map(() => null) },
    ],
  };
}

export function removePreviewSeries(data: ChartPreviewData, i: number): ChartPreviewData {
  if (data.series.length <= 1) return data;
  return { ...data, series: data.series.filter((_, x) => x !== i) };
}

export function setPreviewValue(
  data: ChartPreviewData,
  s: number,
  c: number,
  value: number | null,
): ChartPreviewData {
  return {
    ...data,
    series: data.series.map((ser, i) =>
      i === s ? { ...ser, values: ser.values.map((v, x) => (x === c ? value : v)) } : ser,
    ),
  };
}

/* --- the right-hand axis row --- */

/** Its name, or its numbers. `-1` as the column writes the name. */
export function setPreviewSecondary(
  data: ChartPreviewData,
  change: { name?: string; at?: number; value?: number | null },
): ChartPreviewData {
  const row =
    data.secondary ?? {
      name: DEFAULT_CHART_PREVIEW_DATA.secondary?.name ?? 'Rate',
      values: data.categories.map(() => null),
    };
  const values =
    change.at === undefined
      ? row.values
      : data.categories.map((_, i) => (i === change.at ? (change.value ?? null) : (row.values[i] ?? null)));
  return { ...data, secondary: { name: change.name ?? row.name, values } };
}
