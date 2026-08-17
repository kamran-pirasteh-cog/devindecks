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
import type { LegendPosition } from './spec';

/** A reference into `DesignSystem.type`, with local tweaks. */
export interface TypeRoleRef {
  role: 'title' | 'subtitle' | 'heading' | 'body' | 'caption' | 'kpiValue';
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
    legend: { role: 'caption', sizePt: 9 },
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
  template?: DeepPartial<ChartStyle>,
  instance?: DeepPartial<ChartStyle>,
): ChartStyle {
  return deepMerge(deepMerge(base, template), instance) as ChartStyle;
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
