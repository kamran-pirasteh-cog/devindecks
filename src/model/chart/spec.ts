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
import type { EMU, EpochDay } from '../units';
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
  | 'dotplot'
  | 'waterfall'
  | 'sankey'
  | 'mekko'
  | 'butterfly'
  | 'gantt';

export type StackMode = 'clustered' | 'stacked' | 'stacked100';

/**
 * A unit of calendar time.
 *
 * One vocabulary for the whole codebase: it names a timescale band on a Gantt,
 * and it is what `parseGrain` reports about a category label (as `DateGrain`,
 * which aliases this). `'half'` exists for the timescale only — no label
 * pattern produces it.
 */
export type GanttGrain = 'year' | 'half' | 'quarter' | 'month' | 'week' | 'day';

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
  /**
   * Italic. Carried here, next to `bold`, because emphasis on a SINGLE data
   * label is a real editorial act — "this is the number the estimate is least
   * sure about", "this one is pro-forma" — and a chart that can only bold has
   * one voice for two different jobs.
   *
   * `false` is meaningful and distinct from unset: it turns italic OFF against
   * an italic inherited from the series or the chart, which is why `fontOver`
   * checks for `!== undefined` rather than truthiness.
   */
  italic?: boolean;
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
   * A short caption for this one datum, printed BESIDE its data label rather
   * than instead of it — "Jan '24" under a dot plot's baseline marker, say.
   *
   * It answers "as of when" (or "on what basis"), which is per-datum and not
   * per-series: a progress chart's rows are often sampled at different times,
   * and folding the date into the series name would claim they weren't. Blank
   * or absent draws nothing.
   *
   * Only the dot plot draws it today — see `placeDotPlot`. It lives on
   * `PointOverride` rather than on `DotPlotSpec` because it is a property of a
   * datum, so a chart re-typed from a dot plot to a bar keeps its captions for
   * whenever the other placers learn to print them.
   */
  note?: string;
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
  /** Sparse per-point formatting, keyed by `XYPoint.key` — as `GridSeries`. */
  pointOverrides?: Record<string, PointOverride>;
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
  /**
   * This item's own label settings, over the chart's. A waterfall has no series
   * to hang a `PointOverride` on, so the item IS the narrowest node there is —
   * without it "make this one number bigger" could only be a chart-wide change.
   *
   * Named like `GridSeries.labels` — plural — because `label` on an item is
   * already its NAME, and one field called `label` meaning both would be a bug
   * waiting to happen.
   */
  labels?: LabelSpec;
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
   * Short rules at each tick, the way a printed axis is drawn. Off by default:
   * a business chart's gridlines already say where the values are, and adding
   * ticks on top is ink for nothing. Worth having when the gridlines are off and
   * the axis has to carry the scale on its own.
   */
  tickMarks?: 'none' | 'out' | 'in';
  /**
   * The rule drawn along the axis, independent of its labels.
   *
   * Undefined means the chart kind's default — a category chart draws the
   * baseline and lets gridlines carry the values, a scatter draws both — which
   * is what every chart did before this knob existed. Set it to pin the line on
   * or off: labelled axes with no rule, or a bare rule with no numbers, are
   * both real house styles, and `show` alone couldn't say either.
   */
  line?: boolean;
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
  /** Type for the rate beside the arrow. Unset falls through to the brand's. */
  font?: LabelFont;
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
  /** Type for the delta beside the arrow. Unset falls through to the brand's. */
  font?: LabelFont;
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
  /** Type for the label riding the line. Unset falls through to the brand's. */
  font?: LabelFont;
}

export interface Annotation {
  id: string;
  anchor: Anchor;
  text: string;
  offset: { dx: EMU; dy: EMU };
  connector?: boolean;
  /**
   * Type for the callout. Unset falls through to the brand's data-label role —
   * the same escape hatch `AxisSpec.font` and `LegendSpec.font` are, and the
   * reason a callout can be the loudest thing on the plot when it needs to be.
   */
  font?: LabelFont;
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

/**
 * Where a legend sits.
 *
 * The four sides take a gutter out of the chart and push the plot in. The two
 * `inside*` positions don't: the legend floats over the plot, top-aligned with
 * the top of the value axis and tucked into the left or right of the chart
 * body. That's the placement a chart with a wide, empty top corner wants —
 * think-cell's and Excel's "inside" legends both do it — because it costs the
 * data no space at all.
 */
export type LegendPosition =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'insideTopLeft'
  | 'insideTopRight';

/** Floats over the plot instead of reserving a gutter beside it. */
export const isInsideLegend = (p: LegendPosition): boolean =>
  p === 'insideTopLeft' || p === 'insideTopRight';

export interface LegendSpec {
  show: boolean;
  position: LegendPosition;
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
/* The author's brief                                                 */
/* ------------------------------------------------------------------ */

/**
 * Who is responsible for a remembered field.
 *
 * The distinction the whole record exists for. 'stated' is the author's own
 * words; 'inferred' is us filling a hole — a span counted back from today, a
 * client name lifted off a deck tag. A prompt may print a 'stated' value as
 * fact; an 'inferred' one may only ever be printed as a question, because a
 * confident wrong subject is the most expensive failure mode there is.
 *
 * 'derived' is the honest middle: no new information, only a restatement of
 * what was typed — "arr" cased up to "ARR", the twenty quarters between the two
 * the author named spelled out end to end. Printed as fact, kept separate so a
 * bug in the restatement can be told from a bug in the reading.
 */
export type BriefFieldSource = 'stated' | 'derived' | 'inferred';

/**
 * What the author asked for, in their own words, kept on the chart.
 *
 * NOT a copy of the parsed brief. Categories, series names and the number
 * format are already on the spec, and a second copy of them here would be a
 * second source of truth that drifts the moment anyone touches the datasheet.
 * What survives is only the part the spec CANNOT hold: the sentence, and which
 * of the chart's facts were stated versus filled in for them.
 *
 * Every field carries its own origin, because the fields are not equally
 * trustworthy and a research prompt has to treat them differently.
 */
export interface AuthorChartBrief {
  /**
   * The brief's own schema marker — deliberately not `SpecBase.version`, so
   * this record can change shape without dragging every ChartSpec through a
   * migration.
   */
  v: 1;
  /** What the author typed, verbatim and untouched. Never re-parsed. */
  description: string;
  /** The date "the last 8 quarters" was counted back from, when it was. */
  asOf?: string;

  subject?: string;
  /**
   * 'described' is the author naming the entity in their own sentence — the
   * strongest signal there is. Everything else is us looking around the deck,
   * and a deck title is as often a file name as it is a company.
   */
  subjectFrom: 'described' | 'tag' | 'slide' | 'deck' | 'unknown';

  measure?: string;
  measureFrom: BriefFieldSource;
  /** The rate riding over the top, when one was asked for as well. */
  secondaryMeasure?: string;
  /** Every measure named, in the order named — a scatter needs two. */
  measures: string[];

  dimension?: string;
  dimensionFrom: BriefFieldSource;

  /**
   * The span as ASKED FOR — deliberately not the span the chart now shows. The
   * categories are the truth of what is plotted; this is the record of what was
   * requested, which is the only thing that makes an invented range detectable
   * later. Endpoints rather than labels, so it can never pass for data.
   */
  period?: { grain: GanttGrain; from: string; to: string; count: number };
  periodFrom: BriefFieldSource;

  /** "in $M" — the scale note, when the sentence carried one. */
  unitNote?: string;
  unitFrom: BriefFieldSource;

  /** What the sentence didn't say, verbatim from the brief that read it. */
  gaps: string[];

  /**
   * The author was asked what the chart shows and declined. Has to stay
   * distinguishable from carrying no brief at all: an older chart's labels may
   * be hand-typed and worth reading, whereas these are ours and mean nothing.
   */
  askedAndSkipped?: boolean;
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
  /**
   * What the author asked for. Absent on charts picked straight off the grid
   * and on every chart made before this existed — and absence is meaningful, so
   * it is never backfilled: it means "read the chart, nobody told us".
   */
  authorBrief?: AuthorChartBrief;
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

/**
 * A dot plot — points on a line.
 *
 * Each category is a TRACK, and each series contributes one marker on it. It is
 * the chart for "where does this sit between these other numbers": a current
 * value against a baseline and a target, us against the peer set, this year
 * against last. A clustered bar chart answers the same question with six inches
 * of ink, and the bars' lengths invite a comparison of areas that nobody asked
 * for; a dot plot spends its ink on the positions, which is the whole argument.
 *
 * Grid data, deliberately: the datasheet, the Devin contract and the type
 * switcher all already know how to handle a category × series grid, so this
 * kind arrives with a working editor rather than one of its own.
 */
export interface DotPlotSpec extends SpecBase {
  kind: 'dotplot';
  /**
   * Unset means HORIZONTAL — the value axis runs left to right and the
   * categories stack down the side, which is the opposite default to every
   * other cartesian kind here. A dot plot's category labels are the row names
   * of a small table ("Enterprise", "Peer median"), and standing those on end
   * to save the reader nothing is how the chart stops being readable.
   */
  orientation?: 'vertical' | 'horizontal';
  /**
   * What is drawn THROUGH each track's points.
   *
   * - `range` — min to max, the reference line the markers sit on. The default:
   *   it says "these numbers belong to one row" without adding a scale of its
   *   own, and it is what makes a two-series dot plot read as a gap.
   * - `axis` — a stem from the baseline to each point (a lollipop), for when the
   *   distance from zero is the point rather than the spread.
   * - `none` — bare markers.
   */
  connector?: 'range' | 'axis' | 'none';
  /** Thickness of that connector across its own length. */
  connectorWidthEmu?: EMU;
  /**
   * The series drawn as the SUBJECT: the top rung of the marker ladder — a
   * filled accent disc at full size, its number set half again as large in the
   * emphasis face. Every other series climbs towards it; see `RUNGS` in
   * `place/dotPlot.ts`.
   *
   * Unset means the LAST series — the opposite of `LineSpec.emphasis`, and for
   * a reason: a dot plot's rows are read left to right as a progression toward
   * the number the slide is about ("was, is, target"), so the last marker is
   * the one the reader came for. A series key names a different subject; `null`
   * turns emphasis off and draws every marker alike.
   */
  emphasis?: string | null;
  /**
   * The SUBJECT's marker diameter, which the whole ladder is scaled from — the
   * comparators keep their proportions to it rather than each needing a knob of
   * their own. A series' own `format.marker.sizeEmu` still wins outright.
   */
  markerSizeEmu?: EMU;
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

/* ------------------------------------------------------------------ */
/* Gantt                                                              */
/* ------------------------------------------------------------------ */

/**
 * One row of the schedule.
 *
 * Rows are a FLAT list with an explicit `level`, not a nested tree. Row order
 * is layout order, so an in-order traversal of the tree is the array anyway;
 * the datasheet rebuilds this on every keystroke, and reconstructing a tree
 * from indentation while preserving stable keys is a graph rebuild per
 * keypress. "The descendants of row i" is a forward scan while
 * `level > level[i]`, which is the only place the tree is actually wanted.
 */
export interface GanttRow {
  key: string;
  label: string;
  /** 0 is top-level; a row is a CHILD of the nearest row above with a smaller level. */
  level: number;
  /** Hide this row's descendants. The row itself always draws. */
  collapsed?: boolean;
  /**
   * Paint every item in this row takes unless it names its own — the node
   * "colour this whole workstream" writes to. Without it that gesture would
   * litter the spec with one override per bar, and a bar added later would
   * come back the wrong colour.
   */
  format?: SeriesFormat;
  labels?: LabelSpec;
  hidden?: boolean;
}

/**
 * What an item is DRAWN as.
 *
 * A tagged union rather than a flat enum because three of the forms carry
 * geometry of their own, and a `headEmu` sitting on every bar that will never
 * read it is how a spec starts lying about itself.
 */
export type GanttItemShape =
  | { form: 'bar'; rounded?: boolean }
  /** A process arrow. `headEmu` is the point's length along the time axis. */
  | { form: 'chevron'; headEmu?: EMU }
  /** The flat-topped roll-up with tapered feet, drawn over a group of children. */
  | { form: 'summary' }
  /** A point in time. `to` is ignored. */
  | { form: 'milestone'; marker?: MarkerShape }
  /** A span brace, drawn clear of the bars rather than among them. */
  | { form: 'bracket'; side?: 'above' | 'below' };

export interface GanttItem {
  key: string;
  /** `GanttRow.key`. Several items may name the same row — that IS the feature. */
  row: string;
  label?: string;
  /**
   * Half-open `[from, to)` in epoch days: a task "ending 31 Mar" has `to` = 1
   * Apr.
   *
   * Half-open because every piece of arithmetic a schedule does — duration,
   * abutment, "does this overlap that" — is off by one under inclusive ends,
   * and the one place the convention shows (the End column, the end label) is a
   * single `to - 1` in the formatter. Getting this backwards is the single most
   * common Gantt bug, so it is stated here rather than discovered later.
   *
   * `to` unset means a point in time, whatever shape the item carries.
   */
  from: EpochDay;
  to?: EpochDay;
  shape: GanttItemShape;
  /** 0..1, drawn as a darker inner bar. */
  progress?: number;
  /** Stacking slot when two items in one row overlap in time; unset = solved. */
  lane?: number;
  format?: SeriesFormat;
  labels?: LabelSpec;
  hidden?: boolean;
}

/**
 * One column of the description table beside the chart body.
 *
 * `side` and `order` together are the whole "reorder it relative to the chart"
 * gesture: crossing the plot is a change to `side`, passing a neighbour is a
 * change to `order`. Both survive an add or a remove because `key` never
 * changes — the rule the rest of this file follows.
 */
export interface GanttColumn {
  key: string;
  header: string;
  side: 'left' | 'right';
  /** Ascending, left to right, WITHIN a side. Gaps are fine. */
  order: number;
  /**
   * What fills the cells.
   *
   * - `label` — the row's own name, indented by its level. At most one.
   * - `text` — authored per row, in `GanttSpec.cells`.
   * - `start` / `end` / `duration` — DERIVED from the row's items, so a table
   *   beside the chart can never contradict the bars it sits next to.
   */
  source: 'label' | 'text' | 'start' | 'end' | 'duration';
  /** Unset means measured from the widest cell — see `solveGanttFrame`. */
  widthEmu?: EMU;
  align?: 'left' | 'center' | 'right';
  /** For `start`/`end`: a pattern for `formatDate`, e.g. "d MMM ''yy". */
  dateFormat?: string;
  font?: LabelFont;
  headerFont?: LabelFont;
}

/** One row of the multi-level timescale header. */
export interface GanttTimescaleBand {
  grain: GanttGrain;
  /** Unset takes the grain's house pattern — see `DEFAULT_BAND_FORMAT`. */
  format?: string;
  font?: LabelFont;
  /** Alternating cell tint, the way a printed calendar header is set. */
  banded?: boolean;
}

export interface GanttShadedSpan {
  id: string;
  from: EpochDay;
  to: EpochDay;
  label?: string;
  color?: ColorRef;
  alpha?: number;
}

/** A dependency between two items, by item key. */
export interface GanttLink {
  id: string;
  from: string;
  to: string;
  /** Finish-to-start by default, the only one most plans use. */
  type?: 'FS' | 'SS' | 'FF' | 'SF';
  style?: ArrowStyle;
}

/**
 * A Gantt chart — the one kind here that answers "when", not "how big".
 *
 * Horizontal by construction and never turned: time runs left to right and the
 * rows stack down the side. See `supportsTurn`, which excludes it explicitly —
 * that predicate is permissive by default, so a Gantt would otherwise be handed
 * a rotation handle that puts the calendar on its end.
 *
 * Its own data shape rather than a grid: a row holds SEVERAL items, each a span
 * rather than a number, and the description table beside it is authored
 * columns. See `dataShapeOf`.
 */
export interface GanttSpec extends SpecBase {
  kind: 'gantt';
  rows: GanttRow[];
  items: GanttItem[];
  /** Authored text for `source: 'text'` columns: rowKey -> columnKey -> text. */
  cells?: Record<string, Record<string, string>>;
  columns: GanttColumn[];

  timescale: {
    /** Unset = derived from the items and rounded out to whole calendar cells. */
    min?: EpochDay;
    max?: EpochDay;
    /** Header rows, COARSEST first. Empty means no header at all. */
    bands: GanttTimescaleBand[];
    /** 0 = Sunday. Drives week bands and weekend shading. */
    weekStart?: 0 | 1;
    /** Days that count as working, 0..6. Unset means Mon–Fri. */
    workdays?: number[];
  };

  /**
   * The today line.
   *
   * `at` is REQUIRED when shown, and is NOT a default the compiler fills in.
   * `compileChart` is pure by contract — same instance in, byte-identical
   * elements out — which is what lets the canvas, an SSR thumbnail and a .pptx
   * agree. A `Date.now()` inside a placer breaks that on the first render. The
   * store stamps `at` when the chart is inserted and refreshes it on an
   * explicit "move to today", so the deck's date is a fact about the deck.
   */
  today?: { show: boolean; at: EpochDay; label?: string; style?: LineStyle };

  shading?: {
    weekends?: { show: boolean; color?: ColorRef; alpha?: number };
    spans?: GanttShadedSpan[];
  };

  ruler?: {
    /** The rule between two rows. */
    rows?: GridlineSpec;
    /** The vertical rules dropped from the finest timescale band. */
    bands?: GridlineSpec;
  };

  /** Alternating row tint, read under the bars. */
  banding?: { show: boolean; color?: ColorRef; alpha?: number };

  /** Unset = the plot's height divided by the visible rows. */
  rowHeightEmu?: EMU;
  /** How much of a row band a bar fills across. Unset = the house value. */
  barHeightPct?: number;

  links?: GanttLink[];
}

export type ChartSpec =
  | ColumnBarSpec
  | LineSpec
  | AreaSpec
  | ComboSpec
  | PieSpec
  | ScatterSpec
  | BubbleSpec
  | DotPlotSpec
  | WaterfallSpec
  | SankeySpec
  | MekkoSpec
  | ButterflySpec
  | GanttSpec;

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
  | MekkoSpec
  | DotPlotSpec;

export const isGridSpec = (s: ChartSpec): s is GridSpec =>
  s.kind === 'column' ||
  s.kind === 'bar' ||
  s.kind === 'line' ||
  s.kind === 'area' ||
  s.kind === 'combo' ||
  s.kind === 'pie' ||
  s.kind === 'donut' ||
  s.kind === 'mekko' ||
  s.kind === 'dotplot';

export const isXYSpec = (s: ChartSpec): s is ScatterSpec | BubbleSpec =>
  s.kind === 'scatter' || s.kind === 'bubble';

/**
 * Is this axis's rule drawn, once `AxisSpec.line` has had its say?
 *
 * The one place that knows the per-kind default, so the popover's toggle and
 * the compiler can't disagree about what "on" looks like before anyone touches
 * it: an XY chart draws both rules, a category chart draws the baseline under
 * its labels and lets the gridlines carry the values.
 */
export function axisLineVisible(spec: ChartSpec, axis: AxisId): boolean {
  const ax = spec.axes[axis];
  if (ax?.line !== undefined) return ax.line;
  if (isXYSpec(spec)) return axis !== 'y2';
  return axis === 'x' && (ax?.show ?? true);
}

export const isWaterfallSpec = (s: ChartSpec): s is WaterfallSpec =>
  s.kind === 'waterfall';

export const isDotPlotSpec = (s: ChartSpec): s is DotPlotSpec => s.kind === 'dotplot';

export const isSankeySpec = (s: ChartSpec): s is SankeySpec => s.kind === 'sankey';

export const isButterflySpec = (s: ChartSpec): s is ButterflySpec =>
  s.kind === 'butterfly';

export const isGanttSpec = (s: ChartSpec): s is GanttSpec => s.kind === 'gantt';

/** Does this kind stack its marks? Drives label content and totals. */
export const isStacked = (s: ChartSpec): boolean =>
  'stack' in s && (s.stack === 'stacked' || s.stack === 'stacked100');

export const isStacked100 = (s: ChartSpec): boolean =>
  'stack' in s && s.stack === 'stacked100';

/**
 * Can this kind carry a SECOND value axis on the far side?
 *
 * The kinds whose series are measured quantities that might be measured in
 * different units — a rate over a build, a headcount beside a cost. A pie has
 * no value axis to pair, a mekko's is fixed at 100%, and a waterfall is one
 * series by construction, so none of them can.
 */
export const supportsSecondaryAxis = (kind: ChartKind): boolean =>
  kind === 'column' ||
  kind === 'bar' ||
  kind === 'line' ||
  kind === 'area' ||
  kind === 'combo';

/**
 * The series plotted against the secondary axis.
 *
 * The `axis` field is per series and authored — a combo's line is on the right
 * only because someone (or `defaultChartSpec`) said so. Kinds that can't carry
 * a second axis return nothing, so a stray `axis: 'secondary'` surviving a type
 * change can't split a pie's scale in two.
 */
export const secondarySeriesKeys = (spec: ChartSpec): Set<string> =>
  isGridSpec(spec) && supportsSecondaryAxis(spec.kind)
    ? new Set(spec.data.series.filter((s) => s.axis === 'secondary').map((s) => s.key))
    : new Set();

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
  // A dot plot is the other way up by default — see `DotPlotSpec.orientation`.
  (s.kind === 'dotplot' && s.orientation !== 'vertical') ||
  // A Sankey flows left to right unless told otherwise — the opposite default
  // to everything else here, because that IS the canonical Sankey.
  (s.kind === 'sankey' && s.orientation !== 'vertical') ||
  // A Gantt has no other way up: time runs left to right, always.
  s.kind === 'gantt';
