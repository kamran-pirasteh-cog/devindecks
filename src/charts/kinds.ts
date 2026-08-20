/**
 * Display names for chart kinds.
 *
 * A `ChartKind` is a union of lowercase identifiers; every surface that shows
 * one to a person needs the same word for it, and there were three private
 * copies of this list before there was one shared one.
 */
import type { ChartKind } from '@/model';

export const CHART_KIND_LABELS: Record<ChartKind, string> = {
  column: 'Column',
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  combo: 'Column + line',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  bubble: 'Bubble',
  waterfall: 'Waterfall',
  sankey: 'Sankey',
  mekko: 'Mekko',
  butterfly: 'Butterfly',
};

/**
 * The kinds an admin can style, in the order they're offered.
 *
 * Every kind, deliberately — a house that draws Sankeys at all wants its
 * Sankeys on-brand, and leaving one out means its only route to a house look is
 * a template, which is the muddle this split exists to end.
 */
export const STYLEABLE_KINDS: ChartKind[] = [
  'column',
  'bar',
  'line',
  'area',
  'combo',
  'pie',
  'donut',
  'waterfall',
  'mekko',
  'scatter',
  'bubble',
  'sankey',
  'butterfly',
];
