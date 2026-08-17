/**
 * Built-in chart templates.
 *
 * A template is a complete archetype — chart type, axes, labels, number format
 * and placeholder data — not just a style. An author picks "Revenue waterfall"
 * and gets a bridge already shaped like a revenue bridge, with the research
 * framing the Devin prompt needs baked in. Retyping that setup on every deck is
 * exactly the work this is meant to remove.
 *
 * One seed per sheet schema, deliberately, so every datasheet shape has a
 * worked example in the library.
 */
import {
  defaultChartSpec,
  pointsToEmu,
  token,
  type ChartSpec,
  type ColumnBarSpec,
  type DeepPartial,
  type ChartStyle,
  type LineSpec,
  type MekkoSpec,
  type BubbleSpec,
  type WaterfallSpec,
} from '@/model';
import type { ChartResearchHints } from './research';

export type ChartTemplateCategory =
  | 'Financial'
  | 'Market'
  | 'Operations'
  | 'Comparison'
  | 'Trend'
  | 'Custom';

export interface ChartTemplateDef {
  id: string;
  name: string;
  description: string;
  category: ChartTemplateCategory;
  /** Lower sorts first. */
  order?: number;
  buildSpec: () => ChartSpec;
  styleOverrides?: DeepPartial<ChartStyle>;
  research?: ChartResearchHints;
}

const cats = (labels: string[]) => labels.map((label, i) => ({ key: `c${i}`, label }));

export const CHART_TEMPLATES: ChartTemplateDef[] = [
  {
    id: 'chart.revenue-waterfall',
    name: 'Revenue waterfall',
    description: 'A bridge from last period to this, broken into the movements that explain it.',
    category: 'Financial',
    order: 10,
    research: {
      guidance:
        'Use reported segment revenue. The movements must sum to the closing figure; if the source only gives opening and closing totals, say so rather than inventing a split.',
      preferredSources: ['10-K', '10-Q', 'Annual report', 'Investor presentation'],
    },
    buildSpec: () => {
      const spec = defaultChartSpec('waterfall') as WaterfallSpec;
      spec.title = 'Revenue bridge';
      spec.axes.y.title = 'Revenue';
      spec.numberFormat = { style: 'currency', currency: 'USD', thousands: true, decimals: 0 };
      spec.axes.y.unitDivisor = 1_000_000;
      spec.axes.y.unitNote = 'in millions';
      return spec;
    },
  },
  {
    id: 'chart.market-share',
    name: 'Market share',
    description: '100% stacked bars comparing share across competitors over time.',
    category: 'Market',
    order: 20,
    research: {
      guidance:
        'Shares must total 100% per period. Include an "Other" bucket rather than dropping the tail, and state the denominator (revenue, units, subscribers) explicitly.',
    },
    buildSpec: () => {
      const spec = defaultChartSpec('bar', 'stacked100') as ColumnBarSpec;
      spec.title = 'Share of market';
      spec.data.categories = cats(['FY23', 'FY24', 'FY25']);
      spec.data.series = [
        { key: 's0', name: 'Us', values: [22, 26, 31] },
        { key: 's1', name: 'Competitor A', values: [38, 35, 32] },
        { key: 's2', name: 'Competitor B', values: [24, 23, 22] },
        { key: 's3', name: 'Other', values: [16, 16, 15] },
      ];
      spec.decorations.labels = { ...spec.decorations.labels, show: true, placement: 'insideCenter' };
      return spec;
    },
  },
  {
    id: 'chart.arr-trend',
    name: 'ARR trend',
    description: 'A quarterly line with the series labelled at its end instead of in a legend.',
    category: 'Trend',
    order: 30,
    research: {
      guidance:
        'Use exit ARR for each quarter, not average. If the company reports ARR only annually, return nulls for the intermediate quarters rather than interpolating.',
    },
    buildSpec: () => {
      const spec = defaultChartSpec('line') as LineSpec;
      spec.title = 'ARR by quarter';
      spec.axes.y.title = 'ARR';
      spec.endLabels = true;
      spec.legend = { show: false, position: 'bottom' };
      spec.data.categories = cats(["Q1'24", "Q2'24", "Q3'24", "Q4'24", "Q1'25", "Q2'25"]);
      spec.data.series = [
        { key: 's0', name: 'Enterprise', values: [412, 448, 495, 560, 618, 690] },
        { key: 's1', name: 'Mid-Market', values: [220, 238, 251, 274, 296, 318] },
      ];
      spec.numberFormat = { style: 'currency', currency: 'USD', scale: 'auto', decimals: 1 };
      return spec;
    },
  },
  {
    id: 'chart.segment-mekko',
    name: 'Segment Mekko',
    description: 'Share within each segment, with column widths showing segment size.',
    category: 'Market',
    order: 40,
    research: {
      guidance:
        'Two numbers per segment: the total size (which sets the column width) and the split within it. State the units for both.',
    },
    buildSpec: () => {
      const spec = defaultChartSpec('mekko') as MekkoSpec;
      spec.title = 'Share by segment';
      spec.data.categories = cats(['Enterprise', 'Mid-Market', 'SMB']);
      spec.data.series = [
        { key: 's0', name: 'Us', values: [340, 180, 60] },
        { key: 's1', name: 'Competitors', values: [660, 520, 340] },
      ];
      spec.decorations.labels = { ...spec.decorations.labels, show: true };
      return spec;
    },
  },
  {
    id: 'chart.cost-benchmark',
    name: 'Cost benchmark',
    description: 'Clustered bars comparing us against a peer set on one measure.',
    category: 'Comparison',
    order: 50,
    research: {
      guidance:
        'Normalize for scale — per employee, per unit or as a percentage of revenue — and say which. Raw totals across differently sized companies are not comparable.',
    },
    buildSpec: () => {
      const spec = defaultChartSpec('bar', 'clustered') as ColumnBarSpec;
      spec.title = 'Cost per unit vs peers';
      spec.data.categories = cats(['Us', 'Peer A', 'Peer B', 'Peer C', 'Peer median']);
      spec.data.series = [{ key: 's0', name: 'Cost per unit', values: [42, 51, 47, 58, 49] }];
      spec.legend = { show: false, position: 'bottom' };
      spec.decorations.labels = { ...spec.decorations.labels, show: true };
      return spec;
    },
  },
  {
    id: 'chart.effort-impact',
    name: 'Effort / impact',
    description: 'A bubble chart placing initiatives by effort and impact, sized by value.',
    category: 'Operations',
    order: 60,
    research: {
      guidance:
        'Effort and impact need a stated scale (for example 1-10, or estimated FTE-months and dollars). An unlabelled axis makes the chart unreadable.',
    },
    buildSpec: () => {
      const spec = defaultChartSpec('bubble') as BubbleSpec;
      spec.title = 'Initiatives by effort and impact';
      spec.axes.x.title = 'Effort';
      spec.axes.y.title = 'Impact';
      spec.decorations.labels = { ...spec.decorations.labels, show: true };
      spec.sizeScale = { mode: 'area', maxDiameterEmu: pointsToEmu(40) };
      return spec;
    },
  },
  {
    id: 'chart.growth-by-segment',
    name: 'Growth by segment',
    description: 'Stacked columns with totals, for a revenue build over several years.',
    category: 'Financial',
    order: 70,
    buildSpec: () => {
      const spec = defaultChartSpec('column', 'stacked') as ColumnBarSpec;
      spec.title = 'Revenue by segment';
      spec.axes.y.title = 'Revenue';
      spec.decorations.totals = { show: true, content: { kind: 'value' }, placement: 'above' };
      spec.numberFormat = { style: 'currency', currency: 'USD', thousands: true, decimals: 0 };
      return spec;
    },
    styleOverrides: { gridlines: { horizontal: 'none' } },
  },
  {
    id: 'chart.mix-shift',
    name: 'Mix shift',
    description: 'A 100% stacked area showing how a mix moved over time.',
    category: 'Trend',
    order: 80,
    buildSpec: () => {
      const spec = defaultChartSpec('area', 'stacked100');
      spec.title = 'Revenue mix';
      spec.palette = [token('brand.accent'), token('ink.strong'), token('ink.muted')];
      return spec;
    },
  },
];

export const getChartTemplate = (id: string): ChartTemplateDef | undefined =>
  CHART_TEMPLATES.find((t) => t.id === id);

export const CHART_TEMPLATE_CATEGORIES: ChartTemplateCategory[] = [
  'Financial',
  'Market',
  'Trend',
  'Comparison',
  'Operations',
  'Custom',
];
