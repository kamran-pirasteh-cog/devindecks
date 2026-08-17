/**
 * The chart spec — the single source of truth a chart is compiled from.
 *
 * Two rules make everything else work:
 *
 * 1. **Stable string keys, never indices.** Categories and series carry a `key`
 *    that never changes once minted. Per-point overrides are a `Record` keyed by
 *    that string, so renaming a series or reordering categories can't silently
 *    reassign someone's hand-picked color to the wrong bar.
 *
 * 2. **Decorations anchor to data, never to coordinates.** A CAGR arrow points
 *    at `{series, point}`, not at an (x, y). Edit a value, resize the chart or
 *    reorder the categories and the arrow follows — which is the whole
 *    difference between a real chart annotation and a hand-drawn shape.
 */
import type { EMU } from '../units';
import type { ColorRef } from '../tokens';
import type { FontFamily } from '../fonts';
import type { DashStyle, Fill, Insets, Outline } from '../types';
import type { NumberFormat } from './format';

/* ------------------------------------------------------------------ */
/* Kinds                                                              */
/* ------------------------------------------------------------------ */

export type ChartKind =
  | 'column'
  | 'bar'
  | 'line'
  | 'area'
  | 'combo'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'bubble'
  | 'waterfall'
  | 'sankey'
  | 'mekko'
  | 'butterfly';

export type StackMode = 'clustered' | 'stacked' | 'stacked100';

/* ------------------------------------------------------------------ */
/* Per-series and per-point formatting                                */
/* ------------------------------------------------------------------ */

export type MarkerShape = 'none' | 'circle' | 'square' | 'diamond' | 'triangle';

export interface MarkerFormat {
  shape: MarkerShape;
  sizeEmu: EMU;
  fill?: Fill;
  outline?: Outline;
}

export interface SeriesFormat {
  fill?: Fill;
  outline?: Outline;
  marker?: MarkerFormat;
  lineWidthEmu?: EMU;
  dash?: DashStyle;
}

export type LabelContent =
  | { kind: 'value' }
  | { kind: 'percent' }
  | { kind: 'category' }
  | { kind: 'seriesName' }
  | { kind: 'custom'; text: string }
  | { kind: 'composite'; parts: LabelContent[]; separator: string };

export type LabelPlacement =
  | 'auto'
  | 'insideEnd'
  | 'insideCenter'
  | 'insideBase'
  | 'outsideEnd'
  | 'above'
  | 'below'
  | 'left'
  | 'right';

export interface LabelFont {
  /** Unset means the brand's size for this role — see `fontOver` in `theme.ts`. */
  sizePt?: number;
  bold?: boolean;
  color?: ColorRef;
  font?: FontFamily;
}

export interface LabelSpec {
  show: boolean;
  content: LabelContent;
  placement: LabelPlacement;
  numberFormat?: NumberFormat;
  font?: LabelFont;
  /**
   * Suppress a label whose segment is thinner than this. Without it a 100%
   * stacked column with a 0.4% sliver renders a label wider than its own bar.
   */
  hideWhenSmaller?: EMU;
  leaderLines?: boolean;
}

export interface PointOverride {
  format?: SeriesFormat;
  label?: LabelSpec;
  hidden?: boolean;
  /**
   * Manual nudge from the computed anchor, applied AFTER the collision solve —
   * and it pins the label, so the solver routes other labels around it rather
   * than shoving it back.
   */
  labelOffset?: { dx: EMU; dy: EMU };
}

/* ------------------------------------------------------------------ */
/* Data shapes                                                        */
/* ------------------------------------------------------------------ */

export interface CategoryDef {
  key: string;
  label: string;
}

export interface GridSeries {
  key: string;
  name: string;
  /** Aligned to `categories`. `null` is a GAP, not a zero — they draw differently. */
  values: (number | null)[];
  format?: SeriesFormat;
  labels?: LabelSpec;
  numberFormat?: NumberFormat;
  axis?: 'primary' | 'secondary';
  /**
   * Sparse per-point formatting, keyed by `CategoryDef.key`. Never an array —
   * see the file header. Named apart from `XYSeries.points`, which is DATA;
   * one field called `points` meaning both would be a bug waiting to happen.
   */
  pointOverrides?: Record<string, PointOverride>;
}

export interface GridData {
  categories: CategoryDef[];
  series: GridSeries[];
}

export interface XYPoint {
  key: string;
  x: number;
  y: number;
  /** Bubble only. */
  size?: number;
  label?: string;
}

export interface XYSeries {
  key: string;
  name: string;
  points: XYPoint[];
  format?: SeriesFormat;
  labels?: LabelSpec;
}

export interface XYData {
  series: XYSeries[];
}

export type WaterfallRole = 'start' | 'delta' | 'subtotal' | 'total' | 'spacer';

export interface WaterfallItem {
  key: string;
  label: string;
  role: WaterfallRole;
  /**
   * For 'delta' this is the change; for 'start'/'total' the absolute level.
   * `null` on a subtotal or total means "compute it from everything above".
   */
  value: number | null;
  format?: SeriesFormat;
}

export interface WaterfallData {
  items: WaterfallItem[];
}

/* ------------------------------------------------------------------ */
/* Sankey                                                             */
/* ------------------------------------------------------------------ */

export interface SankeyNode {
  key: string;
  label: string;
  /**
   * Pin this node to a column. Unset means the layout works it out from the
   * links, which is what you want almost always — pinning exists for the case
   * where two unconnected nodes belong side by side anyway.
   */
  layer?: number;
  format?: SeriesFormat;
}

export interface SankeyLink {
  key: string;
  /** `SankeyNode.key` at each end. Keys, never indices — see the file header. */
  from: string;
  to: string;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

/* ------------------------------------------------------------------ */
/* Axes                                                               */
/* ------------------------------------------------------------------ */

export type AxisId = 'x' | 'y' | 'y2';

export interface AxisSpec {
  show: boolean;
  title?: string;
  /** undefined = auto (nice domain from the data). */
  min?: number;
  max?: number;
  tickStep?: number;
  scale: 'linear' | 'log';
  logBase?: number;
  reversed?: boolean;
  /** Divide values by this before formatting; pairs with `unitNote`. */
  unitDivisor?: number;
  /** e.g. "in $M" — rendered near the axis so the numbers aren't ambiguous. */
  unitNote?: string;
  numberFormat?: NumberFormat;
  /**
   * Per-chart type override for this axis's labels. The brand sets the size for
   * every chart; one chart on a crowded slide sometimes needs its own, and
   * without this the only way to get it was editing the design system.
   */
  font?: LabelFont;
  labelRotationDeg?: number;
  crossesAtZero?: boolean;
}

export const DEFAULT_AXIS: AxisSpec = { show: true, scale: 'linear' };

/* ------------------------------------------------------------------ */
/* Decorations                                                        */
/* ------------------------------------------------------------------ */

/** Where a decoration attaches. Always data, never pixels. */
export type Anchor =
  | { at: 'point'; series: string; point: string }
  | { at: 'segmentTop'; series: string; point: string }
  | { at: 'columnTotal'; point: string }
  | { at: 'axisValue'; axis: AxisId; value: number };

export interface LineStyle {
  color?: ColorRef;
  widthEmu?: EMU;
  dash?: DashStyle;
}

export interface ArrowStyle extends LineStyle {
  headSizeEmu?: EMU;
}

export interface GridlineSpec {
  show: boolean;
  color?: ColorRef;
  dash?: DashStyle;
  widthEmu?: EMU;
}

export interface CagrArrow {
  id: string;
  from: Anchor;
  to: Anchor;
  /** Periods between the endpoints; undefined = derive from category distance. */
  periods?: number;
  numberFormat?: NumberFormat;
  label?: string;
  style?: ArrowStyle;
}

export interface DifferenceArrow {
  id: string;
  from: Anchor;
  to: Anchor;
  mode: 'absolute' | 'percent' | 'both';
  bracket?: boolean;
  numberFormat?: NumberFormat;
  label?: string;
  style?: ArrowStyle;
}

export interface TrendLine {
  id: string;
  series: string;
  mode: 'linear' | 'average' | 'custom';
  custom?: { from: Anchor; to: Anchor };
  style?: LineStyle;
}

export interface ReferenceLine {
  id: string;
  axis: AxisId;
  value: number;
  label?: string;
  style?: LineStyle;
}

export interface Annotation {
  id: string;
  anchor: Anchor;
  text: string;
  offset: { dx: EMU; dy: EMU };
  connector?: boolean;
}

export interface Decorations {
  /** Chart-wide default; a series or point may override it. */
  labels: LabelSpec;
  totals?: LabelSpec;
  gridlines: { major?: GridlineSpec; minor?: GridlineSpec };
  cagr: CagrArrow[];
  differences: DifferenceArrow[];
  trendLines: TrendLine[];
  referenceLines: ReferenceLine[];
  annotations: Annotation[];
}

export interface LegendSpec {
  show: boolean;
  position: 'top' | 'right' | 'bottom' | 'left';
  /**
   * Per-chart type override for the legend's entries, the same escape hatch
   * `AxisSpec.font` is. Unset falls through to the brand's `fonts.legend`.
   */
  font?: LabelFont;
}

/* ------------------------------------------------------------------ */
/* Provenance                                                         */
/* ------------------------------------------------------------------ */

/**
 * Which template and brand version this chart was built on — the same
 * mechanism `Deck.designSystemId`/`designSystemVersion` uses, so "apply brand"
 * and "template updated" can both re-resolve without touching data.
 */
export interface ChartProvenance {
  templateId?: string;
  templateVersion?: number;
  designSystemId: string;
  designSystemVersion: number;
}

/* ------------------------------------------------------------------ */
/* The spec union                                                     */
/* ------------------------------------------------------------------ */

export interface SpecBase {
  version: 1;
  title?: string;
  /** Type override for the title alone; unset takes the brand's title role. */
  titleFont?: LabelFont;
  /** Series palette override; unset falls through to the design system. */
  palette?: ColorRef[];
  numberFormat: NumberFormat;
  axes: { x: AxisSpec; y: AxisSpec; y2?: AxisSpec };
  legend: LegendSpec;
  decorations: Decorations;
  plotPadding?: Insets;
  provenance?: ChartProvenance;
}

export interface ColumnBarSpec extends SpecBase {
  kind: 'column' | 'bar';
  stack: StackMode;
  /** PowerPoint's gap width: 150 = gap is 1.5× a bar. */
  gapWidthPct: number;
  /** Cluster overlap: -27 is PowerPoint's clustered default, 100 = stacked. */
  overlapPct: number;
  data: GridData;
}

export interface LineSpec extends SpecBase {
  kind: 'line';
  smooth?: boolean;
  /** think-cell's series labels at the right-hand end of each line. */
  endLabels?: boolean;
  /**
   * End labels carry the series' last value as well as its name — "Peer C ·
   * 4,533". Unset means yes: the number at the end of the line is the one the
   * reader came for, and printing it there is what lets a line chart delete its
   * legend AND its data labels and still answer "how big is it".
   */
  endLabelValues?: boolean;
  /**
   * The one line drawn in full colour; every other line recedes to grey with a
   * dash pattern of its own.
   *
   * Unset means the FIRST series — a line chart is nearly always an argument
   * about one line against a field of comparators, and colouring all of them
   * equally makes the reader work out which one the slide is about. A series
   * key names a different subject; `null` turns emphasis off and gives every
   * line its own palette colour.
   */
  emphasis?: string | null;
  /** Unset means vertical. See `orientation.ts` for the flip across kinds. */
  orientation?: 'vertical' | 'horizontal';
  data: GridData;
}

export interface AreaSpec extends SpecBase {
  kind: 'area';
  stack: StackMode;
  orientation?: 'vertical' | 'horizontal';
  data: GridData;
}

export interface ComboSpec extends SpecBase {
  kind: 'combo';
  /** Per-series render mode, keyed by series key; unlisted default to column. */
  render: Record<string, 'column' | 'line' | 'area'>;
  /** Applies to the column members only. */
  stack: StackMode;
  gapWidthPct: number;
  overlapPct: number;
  orientation?: 'vertical' | 'horizontal';
  data: GridData;
}

export interface PieSpec extends SpecBase {
  kind: 'pie' | 'donut';
  /** series[0] only; the categories are the slices. */
  data: GridData;
  innerRadiusPct?: number;
  startAngleDeg?: number;
  /** categoryKey -> offset as a fraction of the radius. */
  explode?: Record<string, number>;
}

export interface ScatterSpec extends SpecBase {
  kind: 'scatter';
  data: XYData;
}

export interface BubbleSpec extends SpecBase {
  kind: 'bubble';
  sizeScale: { mode: 'area' | 'diameter'; maxDiameterEmu: EMU };
  data: XYData;
}

export interface WaterfallSpec extends SpecBase {
  kind: 'waterfall';
  orientation: 'column' | 'bar';
  connectors: boolean;
  colors: { increase: ColorRef; decrease: ColorRef; total: ColorRef };
  gapWidthPct: number;
  data: WaterfallData;
}

export interface SankeySpec extends SpecBase {
  kind: 'sankey';
  data: SankeyData;
  /**
   * Which way the flow runs. `horizontal` — left to right — is the canonical
   * Sankey and the default; `vertical` sends it top to bottom.
   */
  orientation?: 'vertical' | 'horizontal';
  /** Thickness of a node bar across the flow direction. */
  nodeThicknessEmu?: EMU;
  /** Clear space between two nodes stacked in the same column. */
  nodePaddingEmu?: EMU;
  /**
   * Ribbon opacity. Unset means OPAQUE: ribbons are told apart by tone, stepped
   * down the brand hue by where each one sits in the stack. Set it below 1 for
   * the tangled diagram that has to show its crossings through each other.
   */
  linkAlpha?: number;
}

export interface MekkoSpec extends SpecBase {
  kind: 'mekko';
  /** Column widths: proportional to each column's total, or explicit. */
  width: { mode: 'total' } | { mode: 'explicit'; values: number[] };
  stack: 'stacked' | 'stacked100';
  data: GridData;
}

export interface ButterflySpec extends SpecBase {
  kind: 'butterfly';
  categories: CategoryDef[];
  left: GridSeries[];
  right: GridSeries[];
  centerLabelWidthEmu?: EMU;
}

export type ChartSpec =
  | ColumnBarSpec
  | LineSpec
  | AreaSpec
  | ComboSpec
  | PieSpec
  | ScatterSpec
  | BubbleSpec
  | WaterfallSpec
  | SankeySpec
  | MekkoSpec
  | ButterflySpec;

/* ------------------------------------------------------------------ */
/* Narrowing helpers                                                  */
/* ------------------------------------------------------------------ */

/** Specs whose data is the category × series grid — most of them. */
export type GridSpec =
  | ColumnBarSpec
  | LineSpec
  | AreaSpec
  | ComboSpec
  | PieSpec
  | MekkoSpec;

export const isGridSpec = (s: ChartSpec): s is GridSpec =>
  s.kind === 'column' ||
  s.kind === 'bar' ||
  s.kind === 'line' ||
  s.kind === 'area' ||
  s.kind === 'combo' ||
  s.kind === 'pie' ||
  s.kind === 'donut' ||
  s.kind === 'mekko';

export const isXYSpec = (s: ChartSpec): s is ScatterSpec | BubbleSpec =>
  s.kind === 'scatter' || s.kind === 'bubble';

export const isWaterfallSpec = (s: ChartSpec): s is WaterfallSpec =>
  s.kind === 'waterfall';

export const isSankeySpec = (s: ChartSpec): s is SankeySpec => s.kind === 'sankey';

export const isButterflySpec = (s: ChartSpec): s is ButterflySpec =>
  s.kind === 'butterfly';

/** Does this kind stack its marks? Drives label content and totals. */
export const isStacked = (s: ChartSpec): boolean =>
  'stack' in s && (s.stack === 'stacked' || s.stack === 'stacked100');

export const isStacked100 = (s: ChartSpec): boolean =>
  'stack' in s && s.stack === 'stacked100';

/**
 * Horizontal value axis?
 *
 * Three kinds spell this differently for reasons that are each defensible on
 * their own — a bar IS a sideways column in OOXML, a waterfall carries a
 * column/bar field, and line-likes carry a plain orientation — so this is the
 * single place that answers the question for the compiler.
 */
export const isHorizontal = (s: ChartSpec): boolean =>
  s.kind === 'bar' ||
  (s.kind === 'waterfall' && s.orientation === 'bar') ||
  ((s.kind === 'line' || s.kind === 'area' || s.kind === 'combo') &&
    s.orientation === 'horizontal') ||
  // A Sankey flows left to right unless told otherwise — the opposite default
  // to everything else here, because that IS the canonical Sankey.
  (s.kind === 'sankey' && s.orientation !== 'vertical');
