/**
 * A design system as one chart template sees it.
 *
 * `ChartStyle` has always had three layers — brand, template, instance — and
 * `resolveChartStyle` has always known the order. Nothing ever asked it: a
 * template's `styleOverrides` were saved and then read by no one, so the
 * built-in that asks for gridlines off drew them anyway.
 *
 * Every surface that compiles a template — the Admin grid, the template
 * editor, the insert picker — goes through here, so the layering can't be
 * right in one of them and missing in the next.
 */
import { defaultVariantFor, findChartVariant, resolveChartStyle, withChartStyleDefaults } from '@/model';
import type { ChartKind, ChartStyle, DeepPartial, DesignSystem } from '@/model';

export function chartStyleFor(
  ds: DesignSystem,
  overrides?: DeepPartial<ChartStyle>,
): ChartStyle {
  return resolveChartStyle(withChartStyleDefaults(ds.chart), overrides);
}

/**
 * The same, as a whole design system, for the compiler and the renderer —
 * both of which take a `DesignSystem` rather than a bare style.
 *
 * Returns `ds` itself when there's nothing to override, so callers can key a
 * `useMemo` off the result without recompiling on every render.
 */
export function dsForChartTemplate(
  ds: DesignSystem,
  overrides?: DeepPartial<ChartStyle>,
): DesignSystem {
  if (!overrides) return ds;
  return { ...ds, chart: chartStyleFor(ds, overrides) };
}

/* ------------------------------------------------------------------ */
/* Variants                                                           */
/* ------------------------------------------------------------------ */

/**
 * The style a chart draws with, given the variant it was inserted as.
 *
 * Four layers now, in the only order that makes sense: brand conventions, then
 * the named variant this chart was inserted as, then whatever a template
 * pinned, then the instance's own overrides. The variant sits ABOVE conventions
 * and BELOW the template because a house template is a deliberate archetype and
 * should win over "how we usually draw columns".
 *
 * `variantId` undefined means NO VARIANT — the conventions alone. It emphati-
 * cally does not mean "this kind's default", even though a bare insert uses
 * that default: the default is looked up once at insert time and STAMPED onto
 * the instance (`defaultVariantIdFor`). If compile-time resolution silently
 * substituted the default instead, an admin adding a first variant to a kind
 * would restyle every chart of that kind ever made, including ones deliberately
 * left on the plain house look.
 *
 * An id that no longer resolves also falls through to the conventions, so
 * deleting a variant degrades a deck rather than breaking it.
 */
export function chartStyleForVariant(
  ds: DesignSystem,
  variantId?: string,
  ...overrides: (DeepPartial<ChartStyle> | undefined)[]
): ChartStyle {
  const variant = findChartVariant(ds.chartVariants, variantId);
  return resolveChartStyle(
    withChartStyleDefaults(ds.chart),
    variant?.overrides,
    ...overrides,
  );
}

/** The variant a bare insert of this kind should be stamped with, if any. */
export const defaultVariantIdFor = (
  ds: DesignSystem,
  kind: ChartKind,
): string | undefined => defaultVariantFor(ds.chartVariants, kind)?.id;

/** The same, as a whole design system, for the compiler and the renderer. */
export function dsForChartVariant(
  ds: DesignSystem,
  variantId?: string,
  ...overrides: (DeepPartial<ChartStyle> | undefined)[]
): DesignSystem {
  const chart = chartStyleForVariant(ds, variantId, ...overrides);
  return { ...ds, chart };
}
