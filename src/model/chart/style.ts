/**
 * Chart style — the brand's opinion about how charts look.
 *
 * This lives on the `DesignSystem`, next to `pageNumbers`, for the same reason
 * that one does: gridline ink, axis weight, the categorical palette and default
 * number formats are brand truth, and a chart that ignores them is off-brand in
 * exactly the way a wrong-coloured heading is. Colors are TOKEN IDS, never hex,
 * so a palette edit reflows every chart in every deck at once.
 *
 * Three layers resolve into one: design system < template overrides < instance
 * overrides. `resolveChartStyle` is the single place that knows the order.
 */
import type { DashStyle } from '../types';
import type { NumberFormat } from './format';
import type { ChartKind, LegendPosition } from './spec';

/** A reference into `DesignSystem.type`, with local tweaks. */
export interface TypeRoleRef {
  /**
   * Any role id in `DesignSystem.type`, including one an admin added — the
   * union this used to be couldn't name those. Resolve it through
   * `resolveTypeRole`, never by bare index: the role it names may have been
   * removed since this style was saved.
   */
  role: string;
  sizePt?: number;
  bold?: boolean;
  /**
   * Numeric weight for the face between regular and bold. Chart type lives or
   * dies on Medium: a data label needs to out-weigh its axis without going to
   * the 700 that makes a chart look like a warning notice.
   */
  weight?: number;
}

export interface ChartAxisStyle {
  showX: boolean;
  showY: boolean;
  lineTokenId: string;
  tickMarks: 'none' | 'outside';
  zeroLine: boolean;
}

export interface ChartGridlineStyle {
  horizontal: 'none' | 'major' | 'major+minor';
  vertical: 'none' | 'major';
  tokenId: string;
  dash: DashStyle;
}

export interface ChartLabelStyle {
  show: boolean;
  position: 'inside' | 'outside' | 'center';
  showTotals: boolean;
  /** Suppress labels on slivers below this share of the total, 0..1. */
  hideBelowPct: number;
}

export interface ChartStyle {
  /**
   * Categorical series palette as design-system token ids. Empty means "work
   * it out from the palette", which is what a brand-new design system gets.
   */
  paletteTokenIds: string[];
  paletteOverflow: 'cycle' | 'shade';
  fonts: {
    axis: TypeRoleRef;
    dataLabel: TypeRoleRef;
    legend: TypeRoleRef;
    title: TypeRoleRef;
  };
  axis: ChartAxisStyle;
  gridlines: ChartGridlineStyle;
  labels: ChartLabelStyle;
  gaps: { categoryGapPct: number; seriesOverlapPct: number };
  legend: { show: boolean; position: LegendPosition };
  numberFormats: { value: NumberFormat; axis: NumberFormat; percent: NumberFormat };
}

/**
 * The house style.
 *
 * These are think-cell's defaults, not PowerPoint's, and the difference is the
 * whole visual argument: label the data directly and delete the scaffolding
 * that exists to help a reader decode an unlabelled bar. Gridlines off, value
 * axis off, data labels ON, bars wide enough to be shapes rather than stripes.
 *
 * The type scale is a real hierarchy rather than three roles at the same size:
 * the number a reader came for is the largest and heaviest thing in the chart,
 * and the axis furniture recedes.
 */
export const DEFAULT_CHART_STYLE: ChartStyle = {
  paletteTokenIds: [],
  paletteOverflow: 'shade',
  fonts: {
    axis: { role: 'caption', sizePt: 8.5 },
    dataLabel: { role: 'caption', sizePt: 10.5, weight: 500 },
    legend: { role: 'caption', sizePt: 9, weight: 500 },
    title: { role: 'body', sizePt: 13, weight: 400 },
  },
  axis: {
    showX: true,
    // Both axes labelled by default. think-cell's own house style deletes the
    // value axis once every bar carries its own number — the tradeoff is real,
    // and it's one control away in the datasheet — but a new chart showing its
    // scale is the less surprising place to start.
    showY: true,
    lineTokenId: 'line.default',
    tickMarks: 'none',
    zeroLine: true,
  },
  gridlines: {
    horizontal: 'none',
    vertical: 'none',
    tokenId: 'line.default',
    dash: 'solid',
  },
  labels: {
    show: true,
    position: 'outside',
    showTotals: false,
    hideBelowPct: 0.03,
  },
  // A gap of 35% of a bar, not PowerPoint's 150%. At 150 the bars are thinner
  // than the space between them and the chart reads as a row of pinstripes.
  gaps: { categoryGapPct: 35, seriesOverlapPct: -10 },
  legend: { show: true, position: 'bottom' },
  numberFormats: {
    value: { style: 'number', thousands: true, scale: 'none', negative: 'minus' },
    axis: { style: 'number', thousands: true, scale: 'none', negative: 'minus' },
    percent: { style: 'percent', decimals: 0, negative: 'minus' },
  },
};

/** A partial at any depth, for the override layers. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Merge the three layers.
 *
 * DEEP, not shallow — a template that overrides only `gridlines.horizontal`
 * must not wipe `gridlines.tokenId` along with it. Arrays replace wholesale,
 * because a half-overridden palette is never what anyone means.
 */
export function resolveChartStyle(
  base: ChartStyle,
  ...layers: (DeepPartial<ChartStyle> | undefined)[]
): ChartStyle {
  return layers.reduce<ChartStyle>(
    (acc, layer) => deepMerge(acc, layer) as ChartStyle,
    base,
  );
}

function deepMerge<T>(base: T, over?: DeepPartial<T>): T {
  if (!over) return base;
  if (Array.isArray(base)) return (over as unknown as T) ?? base;
  if (typeof base !== 'object' || base === null) return (over as T) ?? base;

  const out = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(over as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] =
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
        ? deepMerge(current, value as DeepPartial<unknown>)
        : value;
  }
  return out as T;
}

/**
 * Backfill a stored style.
 *
 * A shallow `{...DEFAULT, ...stored}` looks right and still crashes on
 * `style.axis.showX` the moment someone's stored copy predates the `axis`
 * section — which is exactly the shape every stored design system is in the
 * first time this ships.
 */
export const withChartStyleDefaults = (stored?: DeepPartial<ChartStyle>): ChartStyle =>
  resolveChartStyle(DEFAULT_CHART_STYLE, stored);

/* ------------------------------------------------------------------ */
/* Per-kind style variants                                            */
/* ------------------------------------------------------------------ */

/**
 * One named way this brand draws one kind of chart.
 *
 * The layer between "how all our charts look" and "how this particular chart
 * looks": a house can want a plain column chart AND a gridline-less one with
 * the last bar picked out, and neither is a template — there's no data and no
 * archetype in a variant, only formatting. `overrides` is the same partial
 * shape a template's `styleOverrides` is, and it occupies the same slot in
 * `resolveChartStyle`, so a variant costs the resolver nothing new.
 *
 * Exactly one variant per kind carries `isDefault`; that's what a bare insert
 * of that kind draws. `defaultVariantFor` falls back to the first in the list
 * rather than trusting the flag to be present, because a stored design system
 * edited by hand is allowed to be missing it.
 */
export interface ChartStyleVariant {
  id: string;
  kind: ChartKind;
  name: string;
  /** The one this kind inserts as, when nobody picks. One per kind. */
  isDefault?: boolean;
  overrides: DeepPartial<ChartStyle>;
}

export const variantsForKind = (
  variants: ChartStyleVariant[] | undefined,
  kind: ChartKind,
): ChartStyleVariant[] => (variants ?? []).filter((v) => v.kind === kind);

export const findChartVariant = (
  variants: ChartStyleVariant[] | undefined,
  id: string | undefined,
): ChartStyleVariant | undefined =>
  id === undefined ? undefined : (variants ?? []).find((v) => v.id === id);

/**
 * The variant a bare insert of this kind uses.
 *
 * Undefined means "no variants defined for this kind", which resolves to the
 * conventions alone — the behaviour every chart had before variants existed.
 */
export const defaultVariantFor = (
  variants: ChartStyleVariant[] | undefined,
  kind: ChartKind,
): ChartStyleVariant | undefined => {
  const forKind = variantsForKind(variants, kind);
  return forKind.find((v) => v.isDefault) ?? forKind[0];
};

/**
 * Set `isDefault` on one variant and clear it across that kind's siblings.
 *
 * Two defaults for one kind is not a state the UI should be able to reach, so
 * the flip is a single function rather than two edits Admin has to remember to
 * pair.
 */
export const withDefaultVariant = (
  variants: ChartStyleVariant[],
  id: string,
): ChartStyleVariant[] => {
  const target = variants.find((v) => v.id === id);
  if (!target) return variants;
  return variants.map((v) =>
    v.kind !== target.kind ? v : { ...v, isDefault: v.id === id },
  );
};

/**
 * What `over` says that `base` doesn't — the inverse of `deepMerge`.
 *
 * This is what lets a variant editor drive the SAME controls the conventions
 * use: edit a fully-resolved style, then store only the difference. Writing a
 * separate partial-aware editor for every control was the alternative, and it
 * would have drifted from the conventions panel by the second control anyone
 * added.
 *
 * Arrays compare by value and replace wholesale, matching `deepMerge`, so a
 * variant either has its own palette or inherits the brand's entirely.
 */
export function diffChartStyle(
  base: ChartStyle,
  over: ChartStyle,
): DeepPartial<ChartStyle> {
  // `diff` returns undefined for "no difference" so that nested empty objects
  // collapse away; the top level promises an object, so an untouched style is
  // an empty one rather than undefined.
  return (diff(base, over) ?? {}) as DeepPartial<ChartStyle>;
}

function diff(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(over)) {
    return JSON.stringify(base) === JSON.stringify(over) ? undefined : over;
  }
  if (
    typeof base !== 'object' ||
    base === null ||
    typeof over !== 'object' ||
    over === null
  ) {
    return Object.is(base, over) ? undefined : over;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(over as Record<string, unknown>)) {
    const d = diff((base as Record<string, unknown>)[key], value);
    if (d !== undefined) out[key] = d;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Does this variant say anything at all, or is it pure inheritance? */
export const variantOverridesCount = (over: DeepPartial<ChartStyle>): number =>
  countLeaves(over);

function countLeaves(v: unknown): number {
  if (v === undefined) return 0;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 1;
  return Object.values(v as Record<string, unknown>).reduce<number>(
    (n, x) => n + countLeaves(x),
    0,
  );
}
