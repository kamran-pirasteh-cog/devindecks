/**
 * Derive: category grid -> the numbers a placer actually draws.
 *
 * This is where stacking, percentage normalization and totals happen, once,
 * before anything knows about geometry. Keeping it separate is what lets the
 * same placer draw clustered, stacked and 100%-stacked columns: it only ever
 * reads `base` and `top`.
 */
import type { GridData, GridSeries, StackMode } from '@/model';

export interface GridDatum {
  seriesKey: string;
  seriesName: string;
  seriesIndex: number;
  pointKey: string;
  pointLabel: string;
  pointIndex: number;
  /** The authored value. `null` is a gap — no mark is drawn for it. */
  value: number | null;
  /** Stack range on the value axis. Equal to (0, value) when unstacked. */
  base: number;
  top: number;
  /** What a data label should say: the value, or its share for stacked100. */
  labelValue: number;
  /** Share of its category's total, 0..1. Undefined when the total is zero. */
  share?: number;
}

export interface GridDerived {
  data: GridDatum[];
  /** Per-category sum of the non-null values. */
  totals: number[];
  /** Every value the value axis has to contain. */
  extent: number[];
  /**
   * The same, for the series on the SECONDARY axis — empty when there are none.
   * Kept apart rather than merged: the whole point of a second axis is that
   * those numbers are in other units, and one extent covering both is the
   * flat line at the bottom of the plot that the second axis exists to fix.
   */
  extentSecondary: number[];
  series: GridSeries[];
  categoryLabels: string[];
}

export interface DeriveOptions {
  /**
   * Series that sit OUTSIDE the stack — a combo chart's line and area members,
   * whose `stack` applies to the column members only. They run from zero, and
   * they stay out of the totals so a line tracking margin doesn't inflate the
   * column stack's total label or its 100% denominator.
   */
  unstacked?: ReadonlySet<string>;
  /**
   * Series plotted against the secondary value axis — see
   * `secondarySeriesKeys`. They are implicitly unstacked (a stack spanning two
   * scales means nothing), they stay out of the totals and the 100% denominator,
   * and their values go to `extentSecondary`.
   */
  secondary?: ReadonlySet<string>;
}

/**
 * Stacking sums positives and negatives on OPPOSITE sides of the baseline —
 * a -88 churn bar in a stack of positives has to hang below zero, not eat into
 * the bar beneath it. Two running accumulators, not one.
 */
export function deriveGrid(
  data: GridData,
  stack: StackMode,
  options: DeriveOptions = {},
): GridDerived {
  const { categories, series } = data;
  const stacked = stack === 'stacked' || stack === 'stacked100';
  const pct = stack === 'stacked100';
  const onSecondary = (s: GridSeries) => options.secondary?.has(s.key) ?? false;
  const inStack = (s: GridSeries) => !options.unstacked?.has(s.key) && !onSecondary(s);

  const totals = categories.map((_, ci) =>
    series.reduce((sum, s) => sum + (inStack(s) ? (s.values[ci] ?? 0) : 0), 0),
  );
  // 100% stacking divides by the total MAGNITUDE, so a category holding +10 and
  // -10 doesn't divide by zero and blow the chart up.
  const magnitudes = categories.map((_, ci) =>
    series.reduce((sum, s) => sum + (inStack(s) ? Math.abs(s.values[ci] ?? 0) : 0), 0),
  );

  const datums: GridDatum[] = [];
  const extent: number[] = [];
  const extentSecondary: number[] = [];

  categories.forEach((cat, ci) => {
    let up = 0;
    let down = 0;
    const denom = magnitudes[ci];

    series.forEach((s, si) => {
      const raw = s.values[ci] ?? null;
      const secondary = onSecondary(s);
      const share = denom > 0 && raw !== null ? Math.abs(raw) / denom : undefined;
      // A secondary series keeps its own units. Dividing it by the stack's
      // total would turn the rate the second axis exists for into a share of
      // something it isn't part of.
      const v = pct && !secondary
        ? raw === null
          ? null
          : denom > 0
            ? raw / denom
            : 0
        : raw;

      let base = 0;
      let top = v ?? 0;
      if (stacked && v !== null && inStack(s)) {
        if (v >= 0) {
          base = up;
          top = up + v;
          up = top;
        } else {
          base = down;
          top = down + v;
          down = top;
        }
      }

      if (v !== null) (secondary ? extentSecondary : extent).push(base, top);

      datums.push({
        seriesKey: s.key,
        seriesName: s.name,
        seriesIndex: si,
        pointKey: cat.key,
        pointLabel: cat.label,
        pointIndex: ci,
        value: raw,
        base,
        top,
        labelValue: pct && !secondary ? (share ?? 0) : (raw ?? 0),
        share,
      });
    });
  });

  // An all-null chart still needs an axis to render against.
  if (!extent.length) extent.push(0, pct ? 1 : 1);

  return {
    data: datums,
    totals,
    extent,
    extentSecondary,
    series,
    categoryLabels: categories.map((c) => c.label),
  };
}

/** The stack top per category — where a totals label sits. */
export function stackTops(derived: GridDerived, categoryCount: number): number[] {
  const tops = new Array(categoryCount).fill(0);
  for (const d of derived.data) {
    if (d.value === null) continue;
    tops[d.pointIndex] = Math.max(tops[d.pointIndex], d.top);
  }
  return tops;
}
