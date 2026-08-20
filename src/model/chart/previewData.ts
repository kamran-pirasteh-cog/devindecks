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
  type GridSeries,
} from './spec';
import { sampleGridData } from './defaults';

export interface ChartPreviewSeries {
  name: string;
  /** Aligned to `categories`; short rows pad with gaps, long ones are trimmed. */
  values: (number | null)[];
}

export interface ChartPreviewData {
  categories: string[];
  series: ChartPreviewSeries[];
}

/** The built-in sample, in the editable shape — what "Reset" goes back to. */
export const DEFAULT_CHART_PREVIEW_DATA: ChartPreviewData = (() => {
  const g = sampleGridData();
  return {
    categories: g.categories.map((c) => c.label),
    series: g.series.map((s) => ({ name: s.name, values: [...s.values] })),
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
  kind !== 'scatter' && kind !== 'bubble' && kind !== 'sankey';

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
    return { ...spec, data: { categories: cats, series: gridSeries() } };
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
    categories: [...data.categories, `Row ${data.categories.length + 1}`],
    series: data.series.map((s) => ({ ...s, values: [...s.values, null] })),
  };
}

export function removePreviewCategory(data: ChartPreviewData, i: number): ChartPreviewData {
  if (data.categories.length <= 1) return data;
  return {
    categories: data.categories.filter((_, x) => x !== i),
    series: data.series.map((s) => ({ ...s, values: s.values.filter((_, x) => x !== i) })),
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
