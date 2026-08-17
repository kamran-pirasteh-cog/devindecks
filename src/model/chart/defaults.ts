/**
 * Default specs — the shape a chart has the moment you insert it.
 *
 * Placeholder data is deliberately realistic (three years, three segments)
 * rather than 1/2/3: an author drops a chart in to see whether it fits the
 * slide, and flat dummy numbers make every chart look the same.
 */
import { token } from '../tokens';
import { pointsToEmu } from '../units';
import type { ColorRef } from '../tokens';
import {
  DEFAULT_AXIS,
  type ChartKind,
  type ChartSpec,
  type Decorations,
  type GridData,
  type LabelPlacement,
  type LabelSpec,
  type LegendSpec,
  type SankeyData,
  type SpecBase,
  type StackMode,
  type WaterfallData,
  type XYData,
} from './spec';
import { DEFAULT_CHART_STYLE, type ChartStyle } from './style';

export const DEFAULT_LABELS: LabelSpec = {
  // On by default. A chart whose bars carry their own numbers doesn't need the
  // axis, the gridlines or the reader's ruler — which is why the rest of the
  // house style can afford to delete them.
  show: true,
  content: { kind: 'value' },
  placement: 'auto',
  hideWhenSmaller: pointsToEmu(14),
  leaderLines: true,
};

export const DEFAULT_LEGEND: LegendSpec = { show: true, position: 'bottom' };

export const DEFAULT_DECORATIONS: Decorations = {
  labels: DEFAULT_LABELS,
  // Deliberately empty: an unset gridline rule falls through to the design
  // system, so editing the brand reflows charts nobody has touched.
  gridlines: {},
  cagr: [],
  differences: [],
  trendLines: [],
  referenceLines: [],
  annotations: [],
};

/**
 * Fallback palette for a design system with nothing usable in it at all.
 *
 * Deliberately SHORT. It used to run to five entries by including
 * `line.default` and `surface.subtle` — a hairline grey and an off-white — so
 * a four-series chart drew its last two series in colours you cannot see on a
 * white slide. Three real colours and then cycling beats five where two are
 * invisible.
 */
export const FALLBACK_PALETTE: ColorRef[] = [
  token('brand.accent'),
  token('ink.strong'),
  token('ink.muted'),
];

/**
 * The brand's label position, as a spec placement.
 *
 * `outside` — the default — becomes `auto` rather than a literal outside-end,
 * because auto already knows that a stacked segment has no outside and centres
 * there instead. Mapping it literally would put every stacked label in the air
 * above its own segment.
 */
const placementFor = (position: ChartStyle['labels']['position']): LabelPlacement =>
  position === 'inside' ? 'insideEnd' : position === 'center' ? 'insideCenter' : 'auto';

/**
 * A fresh spec's shared half, resolved against the BRAND rather than against
 * constants.
 *
 * `ChartStyle` carried gap width, label and axis-visibility knobs that Admin
 * has always been able to edit and nothing ever read. Threading the style
 * through here is what makes those knobs real: change the house gap width and
 * the next chart anyone inserts is drawn with it.
 */
function base(style: ChartStyle): SpecBase {
  return {
    version: 1,
    numberFormat: { ...style.numberFormats.value },
    axes: {
      x: { ...DEFAULT_AXIS, show: style.axis.showX },
      y: { ...DEFAULT_AXIS, show: style.axis.showY },
    },
    legend: { ...style.legend },
    decorations: {
      ...structuredClone(DEFAULT_DECORATIONS),
      labels: {
        ...DEFAULT_LABELS,
        show: style.labels.show,
        placement: placementFor(style.labels.position),
      },
      ...(style.labels.showTotals
        ? { totals: { ...DEFAULT_LABELS, show: true, placement: 'above' as const } }
        : {}),
    },
  };
}

const YEARS = ['FY23', 'FY24', 'FY25'];
const SEGMENTS = ['Enterprise', 'Mid-Market', 'SMB'];
const SAMPLE: number[][] = [
  [420, 512, 640],
  [260, 305, 372],
  [140, 158, 171],
];

export function sampleGridData(seriesCount = 3): GridData {
  const n = Math.max(1, Math.min(seriesCount, SEGMENTS.length));
  return {
    categories: YEARS.map((label, i) => ({ key: `c${i}`, label })),
    series: Array.from({ length: n }, (_, i) => ({
      key: `s${i}`,
      name: SEGMENTS[i],
      values: [...SAMPLE[i]],
    })),
  };
}

function sampleXYData(withSize: boolean): XYData {
  const pts = [
    { x: 12, y: 34, size: 18 },
    { x: 28, y: 51, size: 42 },
    { x: 44, y: 39, size: 27 },
    { x: 61, y: 72, size: 55 },
    { x: 77, y: 64, size: 31 },
  ];
  return {
    series: [
      {
        key: 's0',
        name: 'Accounts',
        points: pts.map((p, i) => ({
          key: `p${i}`,
          x: p.x,
          y: p.y,
          ...(withSize ? { size: p.size } : {}),
        })),
      },
    ],
  };
}

/**
 * A bridge, in one direction or the other.
 *
 * The two are different charts to think with, not just different numbers: a
 * build-UP explains how a base grew into a bigger total, a build-DOWN explains
 * how a starting pool got whittled to what survived. Offering both as their own
 * starting points saves an author retyping every sign.
 */
export function sampleWaterfallData(direction: WaterfallDirection = 'up'): WaterfallData {
  if (direction === 'down') {
    return {
      items: [
        { key: 'w0', label: 'Pipeline', role: 'start', value: 1540 },
        { key: 'w1', label: 'Unqualified', role: 'delta', value: -320 },
        { key: 'w2', label: 'No decision', role: 'delta', value: -210 },
        { key: 'w3', label: 'Lost', role: 'delta', value: -180 },
        { key: 'w4', label: 'Closed won', role: 'total', value: null },
      ],
    };
  }
  return {
    items: [
      { key: 'w0', label: 'FY24 revenue', role: 'start', value: 1040 },
      { key: 'w1', label: 'New logos', role: 'delta', value: 260 },
      { key: 'w2', label: 'Expansion', role: 'delta', value: 145 },
      { key: 'w3', label: 'Upsell', role: 'delta', value: 95 },
      { key: 'w4', label: 'FY25 revenue', role: 'total', value: null },
    ],
  };
}

export type WaterfallDirection = 'up' | 'down';

/**
 * One total splitting evenly five ways.
 *
 * Deliberately the SIMPLEST shape a Sankey can have. A multi-stage sample looks
 * impressive in the picker and is miserable to edit into your own diagram —
 * you're deleting someone else's network before you can build yours. One
 * source and five equal branches reads instantly, and every edit from here is
 * additive.
 */
function sampleSankeyData(): SankeyData {
  const branches = ['Segment A', 'Segment B', 'Segment C', 'Segment D', 'Segment E'];
  return {
    nodes: [
      { key: 'n0', label: 'Total' },
      ...branches.map((label, i) => ({ key: `n${i + 1}`, label })),
    ],
    links: branches.map((_, i) => ({
      key: `f${i}`,
      from: 'n0',
      to: `n${i + 1}`,
      value: 100,
    })),
  };
}

/**
 * A ready-to-render spec for a freshly inserted chart of this kind.
 *
 * `style` is the brand's chart style; omit it and the house defaults apply.
 * Callers that have a design system to hand should pass it, so an inserted
 * chart is on-brand from its first frame rather than after a reformat.
 */
export function defaultChartSpec(
  kind: ChartKind,
  stack: StackMode = 'clustered',
  style: ChartStyle = DEFAULT_CHART_STYLE,
): ChartSpec {
  const b = base(style);
  const gapWidthPct = style.gaps.categoryGapPct;
  const overlapFor = (s: StackMode) =>
    s === 'clustered' ? style.gaps.seriesOverlapPct : 100;

  switch (kind) {
    case 'column':
    case 'bar':
      return { ...b, kind, stack, gapWidthPct, overlapPct: overlapFor(stack), data: sampleGridData() };
    case 'line':
      return {
        ...b,
        kind,
        // think-cell's series labels at the right-hand end of each line. A
        // legend makes the reader look away from the data to decode a colour;
        // an end label puts the series name where the line already led them.
        endLabels: true,
        legend: { ...b.legend, show: false },
        decorations: {
          ...b.decorations,
          // The one chart family that wants gridlines. A column's height is
          // read against the baseline it stands on; a line's level is read
          // across the plot, and without a rule to carry the eye the reader is
          // measuring with a finger against the screen.
          gridlines: { major: { show: true } },
          // Every point carrying a number turns a trend line into a table with a
          // shape; the end label plus the axis is enough.
          labels: { ...b.decorations.labels, show: false },
        },
        data: sampleGridData(),
      };
    case 'area':
      return {
        ...b,
        kind,
        stack: stack === 'clustered' ? 'stacked' : stack,
        decorations: { ...b.decorations, labels: { ...b.decorations.labels, show: false } },
        data: sampleGridData(),
      };
    case 'combo':
      // The stack argument reaches the columns, same as it would on a plain
      // column chart — it used to be dropped here, so asking for a clustered
      // combo quietly returned a stacked one.
      return {
        ...b,
        kind,
        render: { s2: 'line' },
        stack,
        gapWidthPct,
        overlapPct: overlapFor(stack),
        data: sampleGridData(),
      };
    case 'pie':
    case 'donut':
      return {
        ...b,
        kind,
        legend: { show: true, position: 'right' },
        decorations: {
          ...b.decorations,
          gridlines: { major: { show: false } },
          // A pie exists to show shares, so the label is the share. Reading a
          // raw value off a wedge is the one thing a pie is worst at.
          labels: { ...b.decorations.labels, show: true, content: { kind: 'percent' } },
        },
        axes: { x: { ...DEFAULT_AXIS, show: false }, y: { ...DEFAULT_AXIS, show: false } },
        ...(kind === 'donut' ? { innerRadiusPct: 55 } : {}),
        data: sampleGridData(1),
      };
    case 'scatter':
      return {
        ...b,
        kind,
        // A scatter labels the points worth naming, not all of them, and it
        // needs both axes to mean anything.
        axes: { x: { ...DEFAULT_AXIS, show: true }, y: { ...DEFAULT_AXIS, show: true } },
        decorations: { ...b.decorations, labels: { ...b.decorations.labels, show: false } },
        data: sampleXYData(false),
      };
    case 'bubble':
      return {
        ...b,
        kind,
        axes: { x: { ...DEFAULT_AXIS, show: true }, y: { ...DEFAULT_AXIS, show: true } },
        decorations: { ...b.decorations, labels: { ...b.decorations.labels, show: false } },
        sizeScale: { mode: 'area', maxDiameterEmu: pointsToEmu(36) },
        data: sampleXYData(true),
      };
    case 'waterfall':
      return {
        ...b,
        kind,
        orientation: 'column',
        // A bridge has one implicit series, so a legend reading "Value" is
        // pure noise — the colours mean increase/decrease/total, which the
        // bars themselves make obvious.
        legend: { show: false, position: 'bottom' },
        connectors: true,
        colors: {
          increase: token('brand.accent'),
          decrease: token('ink.muted'),
          total: token('ink.strong'),
        },
        gapWidthPct,
        decorations: { ...b.decorations, labels: { ...b.decorations.labels, show: true } },
        data: sampleWaterfallData(),
      };
    case 'sankey':
      return {
        ...b,
        kind,
        // Left to right is the canonical Sankey; the orientation control can
        // stand it on end.
        orientation: 'horizontal',
        // Node names carry the meaning here, so there's nothing for a legend
        // or a pair of axes to add.
        legend: { show: false, position: 'bottom' },
        axes: { x: { ...DEFAULT_AXIS, show: false }, y: { ...DEFAULT_AXIS, show: false } },
        decorations: {
          ...b.decorations,
          gridlines: { major: { show: false } },
          // Labels on means each node shows its own throughput next to its name.
          labels: { ...b.decorations.labels, show: true },
        },
        data: sampleSankeyData(),
      };
    case 'mekko':
      return { ...b, kind, width: { mode: 'total' }, stack: 'stacked100', data: sampleGridData() };
    case 'butterfly': {
      const g = sampleGridData(2);
      return {
        ...b,
        kind,
        categories: g.categories,
        left: [g.series[0]],
        right: [g.series[1]],
      };
    }
  }
}
