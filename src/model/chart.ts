/**
 * Chart configuration — editor-only metadata (not part of the safe-primitive
 * export model). A slide's `chart` field, when present, is the source of
 * truth the chart's composed primitives were generated from, so the editor
 * can reopen the spreadsheet/design popup and regenerate them on save.
 */
import type { ColorRef } from './tokens';

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';
export type ChartOrientation = 'vertical' | 'horizontal';

export interface ChartSeries {
  name: string;
  color: ColorRef;
  values: number[];
}

export interface ChartData {
  categories: string[];
  series: ChartSeries[];
}

export interface ChartBox {
  w: number;
  h: number;
}

export interface SlideChartConfig {
  type: ChartType;
  orientation: ChartOrientation;
  data: ChartData;
  box: ChartBox;
  xLabel?: string;
  yLabel?: string;
}
