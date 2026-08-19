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
import { resolveChartStyle, withChartStyleDefaults } from '@/model';
import type { ChartStyle, DeepPartial, DesignSystem } from '@/model';

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
