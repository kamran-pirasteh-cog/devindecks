/**
 * The catalog of layouts a chart can be started from — the picker's tiles.
 *
 * It lives here, away from the picker, because two things now read it: the grid
 * of tiles someone browses by hand, and the recommender that reads a typed
 * description and points at one of them. A recommendation that named a layout
 * the picker doesn't offer would be a dead end, so both sides share one list
 * rather than agreeing by convention.
 */
import type { ChartKind, StackMode, WaterfallDirection } from '@/model';

export type LayoutGroup =
  | 'Bars'
  | 'Trends'
  | 'Combo'
  | 'Waterfall'
  | 'Composition'
  | 'Relationships'
  | 'Timelines';

export interface ChartLayout {
  id: string;
  name: string;
  kind: ChartKind;
  stack: StackMode;
  group: LayoutGroup;
  /**
   * A variant of the same KIND, differing only in its starting data. A bridge
   * that builds up and one that builds down are the same chart type and two
   * genuinely different things to say with it.
   */
  waterfall?: WaterfallDirection;
  /**
   * Combo only: which series are drawn as something other than columns. The
   * combo variants are one kind with different per-series render modes, so the
   * layout carries the map rather than there being a kind per combination.
   */
  render?: Record<string, 'column' | 'line' | 'area'>;
  /**
   * What this layout is FOR, in one line. Written for the recommender to quote
   * back as its reason, which is also the honest test of whether a tile has a
   * job distinct from its neighbours.
   */
  purpose: string;
}

/**
 * Twelve layouts, not fifteen.
 *
 * The six column/bar tiles collapsed to three: vertical and horizontal are the
 * same three charts seen from a different side, and orientation is a control
 * here rather than a doubling of the grid. Donut is an option ON a pie and
 * area an option on a line, for the same reason — a tile each bought two
 * near-identical pictures and hid the fact that they're one chart with a
 * switch. Mekko and butterfly are gone from the picker; the engine still draws
 * a stored one, so no existing deck loses a chart.
 */
export const CHART_LAYOUTS: ChartLayout[] = [
  {
    id: 'clustered',
    name: 'Clustered',
    kind: 'column',
    stack: 'clustered',
    group: 'Bars',
    purpose: 'compares a few things side by side, period by period',
  },
  {
    id: 'stacked',
    name: 'Stacked',
    kind: 'column',
    stack: 'stacked',
    group: 'Bars',
    purpose: 'shows a total and what it is made of at the same time',
  },
  {
    id: 'stacked100',
    name: '100% stacked',
    kind: 'column',
    stack: 'stacked100',
    group: 'Bars',
    purpose: 'shows how a mix shifts when the total itself does not matter',
  },

  // A dot plot sits in Bars because it answers a bar chart's question — how do
  // these few numbers compare — with a tenth of the ink. It earns its own tile
  // rather than being an option ON the bar tiles because the data it wants is
  // different: a handful of rows carrying two or three moments each, where a
  // clustered column wants many periods.
  {
    id: 'dotplot',
    name: 'Dot plot',
    kind: 'dotplot',
    stack: 'clustered',
    group: 'Bars',
    purpose: 'shows where each row sits between two or three points on one scale',
  },

  {
    id: 'line',
    name: 'Line',
    kind: 'line',
    stack: 'clustered',
    group: 'Trends',
    purpose: 'carries a trend across many periods, several subjects at once',
  },

  // A combo is how a slide says "these two things are measured differently but
  // belong on the same picture" — a rate over a build, a target over actuals.
  // The columns underneath can stack or cluster, and that's a real choice about
  // what's being read, so it's a layout rather than a setting to find
  // afterwards. Area + line isn't offered: two filled bands and a stroke on one
  // plot is three things competing for the same space, and the line stops
  // reading.
  {
    id: 'combo-stacked-line',
    name: 'Stacked + line',
    kind: 'combo',
    stack: 'stacked',
    group: 'Combo',
    render: { s2: 'line' },
    purpose: 'puts a rate or a margin over a build of its components',
  },
  {
    id: 'combo-clustered-line',
    name: 'Clustered + line',
    kind: 'combo',
    stack: 'clustered',
    group: 'Combo',
    render: { s2: 'line' },
    purpose: 'puts a rate or a margin over figures compared side by side',
  },

  {
    id: 'waterfall-up',
    name: 'Build up',
    kind: 'waterfall',
    stack: 'clustered',
    group: 'Waterfall',
    waterfall: 'up',
    purpose: 'walks from one total to a bigger one and names each driver',
  },
  {
    id: 'waterfall-down',
    name: 'Build down',
    kind: 'waterfall',
    stack: 'clustered',
    group: 'Waterfall',
    waterfall: 'down',
    purpose: 'walks from a starting pool down to what survived it',
  },

  {
    id: 'pie',
    name: 'Pie',
    kind: 'pie',
    stack: 'clustered',
    group: 'Composition',
    purpose: 'shows one moment split into shares of a whole',
  },
  {
    id: 'sankey',
    name: 'Sankey',
    kind: 'sankey',
    stack: 'clustered',
    group: 'Composition',
    purpose: 'traces where a quantity flows from and to',
  },

  {
    id: 'scatter',
    name: 'Scatter',
    kind: 'scatter',
    stack: 'clustered',
    group: 'Relationships',
    purpose: 'tests whether two measures move together',
  },
  {
    id: 'bubble',
    name: 'Bubble',
    kind: 'bubble',
    stack: 'clustered',
    group: 'Relationships',
    purpose: 'relates two measures with a third carried in the size',
  },
  // The only group whose axis is TIME rather than a quantity, which is why it
  // is a group of its own rather than a tile under Bars: everything else here
  // answers "how big", and a Gantt answers "when".
  {
    id: 'gantt',
    name: 'Gantt',
    kind: 'gantt',
    stack: 'clustered',
    group: 'Timelines',
    purpose: 'shows when each workstream runs, and what it has to finish before',
  },

];

export const LAYOUT_GROUPS: LayoutGroup[] = [
  'Bars',
  'Trends',
  'Combo',
  'Waterfall',
  'Composition',
  'Relationships',
  'Timelines',
];

export const layoutById = (id: string): ChartLayout | undefined =>
  CHART_LAYOUTS.find((l) => l.id === id);

/**
 * The layout a bare KIND means.
 *
 * A brand style variant names a kind ("our gridless column") and no archetype,
 * so anything that needs a layout for one — the setup step, which asks its
 * questions per layout — has to resolve it. The first tile of that kind is the
 * plain reading of it: clustered for a column, build-up for a waterfall.
 */
export const layoutForKind = (kind: ChartKind): ChartLayout | undefined =>
  CHART_LAYOUTS.find((l) => l.kind === kind);

/**
 * The layout a chart that already EXISTS was made from, as best it can be told.
 *
 * The stored answers name their layout, and that is the answer whenever it still
 * describes the chart — a waterfall that builds down has to keep asking a
 * build-down's questions. When the kind has been changed out from under it (the
 * datasheet's type select does exactly that), the stored layout is no longer
 * about this chart, and the plain reading of the new kind and stacking is.
 */
export const layoutForChart = (
  kind: ChartKind,
  stack: StackMode | undefined,
  storedId?: string,
): ChartLayout | undefined => {
  const stored = storedId ? layoutById(storedId) : undefined;
  if (stored && stored.kind === kind && (stack === undefined || stored.stack === stack)) {
    return stored;
  }
  return (
    (stack === undefined
      ? undefined
      : CHART_LAYOUTS.find((l) => l.kind === kind && l.stack === stack)) ?? layoutForKind(kind)
  );
};
