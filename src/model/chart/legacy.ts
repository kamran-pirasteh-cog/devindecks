/**
 * The pre-engine chart config, kept only so stored decks can be migrated.
 *
 * Nothing new should reference these types. `Slide.chart` is read once by
 * `migrate.ts` on load, upgraded into a `ChartInstance`, and cleared.
 */
import type { ColorRef } from '../tokens';
// The live definition lives with the live orientation logic; the legacy config
// happens to spell it the same way, so it borrows rather than forking it.
import type { ChartOrientation } from './orientation';

export type LegacyChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';
/** @deprecated Old name for {@link LegacyChartType}; use `ChartKind` for new code. */
export type ChartType = LegacyChartType;

export interface LegacyChartSeries {
  name: string;
  color: ColorRef;
  values: number[];
}

export interface LegacyChartData {
  categories: string[];
  series: LegacyChartSeries[];
}

/** @deprecated Migrated into `ChartInstance` on load. */
export interface SlideChartConfig {
  type: LegacyChartType;
  orientation: ChartOrientation;
  data: LegacyChartData;
  box: { w: number; h: number };
  xLabel?: string;
  yLabel?: string;
}
