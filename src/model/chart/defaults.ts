/**
 * Default specs — the shape a chart has the moment you insert it.
 *
 * Placeholder data is deliberately realistic (three years, three segments)
 * rather than 1/2/3: an author drops a chart in to see whether it fits the
 * slide, and flat dummy numbers make every chart look the same.
 */
import { token } from '../tokens';
import { pointsToEmu, toEpochDay } from '../units';
import type { EpochDay } from '../units';
import type { ColorRef } from '../tokens';
import {
  DEFAULT_AXIS,
  type ChartKind,
  type ChartSpec,
  type Decorations,
  type GanttColumn,
  type GanttItem,
  type GanttRow,
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

/**
 * The combo's sample: two absolute series and a RATE, in its own row.
 *
 * A combo exists to put two things measured differently on one picture, and a
 * sample where all three rows are revenue in millions shows none of that — the
 * line lands among the columns and the second axis has nothing to say. A margin
 * in per cent is the case the chart is for.
 */
export function sampleComboGridData(): GridData {
  return {
    categories: YEARS.map((label, i) => ({ key: `c${i}`, label })),
    series: [
      { key: 's0', name: SEGMENTS[0], values: [...SAMPLE[0]] },
      { key: 's1', name: SEGMENTS[1], values: [...SAMPLE[1]] },
      { key: 's2', name: 'Margin %', values: [...COMBO_RATE], axis: 'secondary' },
    ],
  };
}

/**
 * A dot plot's sample: three moments, three rows.
 *
 * Not three years by three segments like everything else here. A dot plot's
 * subject is where a row SITS between its other numbers, so the placeholder is
 * the shape that shows it — a baseline, where it is now, and what it is aimed
 * at. Three markers is also the middle of the ladder the placer draws (see
 * `RUNGS`): the hollow start, the step, and the filled subject.
 */
export function sampleDotPlotData(): GridData {
  return {
    categories: SEGMENTS.map((label, i) => ({ key: `c${i}`, label })),
    series: [
      { key: 's0', name: 'FY23', values: [42, 31, 18] },
      { key: 's1', name: 'Today', values: [58, 40, 22] },
      { key: 's2', name: 'FY26 plan', values: [67, 49, 26] },
    ],
  };
}

/**
 * The Gantt sample: a two-quarter plan with a sub-row, a chevron, a milestone
 * and a roll-up.
 *
 * Anchored to a FIXED Monday rather than to today. `defaultChartSpec` is called
 * on every insert and in every admin preview, and a sample that moves with the
 * clock makes two screenshots of the same brand disagree — and would drag a
 * clock read into the pure part of the pipeline. See `GanttSpec.today`, which
 * is the one date the store stamps.
 */
const GANTT_EPOCH = toEpochDay(2026, 1, 5); // a Monday

export function sampleGanttRows(): GanttRow[] {
  return [
    { key: 'r0', label: 'Discovery & inventory', level: 0 },
    { key: 'r1', label: 'License & spend audit', level: 0 },
    { key: 'r2', label: 'Vendor renegotiation', level: 0 },
    { key: 'r3', label: 'Consolidate & migrate', level: 0 },
    { key: 'r4', label: 'Decommission legacy', level: 0 },
  ];
}

/**
 * Five overlapping phases and a closing milestone.
 *
 * Plain bars, deliberately. An earlier sample showed one of everything — a
 * roll-up, a chevron, a milestone — and it read as a catalogue of shapes rather
 * than as a plan: the reader's eye went to the odd silhouettes instead of to
 * when things happen. The vocabulary is still there for an author who means it;
 * a first insert should look like the chart people came for.
 */
export function sampleGanttItems(): GanttItem[] {
  const d = (n: number): EpochDay => GANTT_EPOCH + n;
  const phase = (key: string, row: string, from: number, to: number): GanttItem => ({
    key,
    row,
    from: d(from),
    to: d(to),
    shape: { form: 'bar' },
  });
  return [
    phase('i0', 'r0', 0, 35),
    phase('i1', 'r1', 21, 63),
    phase('i2', 'r2', 49, 105),
    phase('i3', 'r3', 84, 147),
    phase('i4', 'r4', 126, 175),
  ];
}

export function sampleGanttColumns(): GanttColumn[] {
  return [
    { key: 'col.task', header: 'Workstream', side: 'left', order: 0, source: 'label' },
    { key: 'col.owner', header: 'Owner', side: 'left', order: 1, source: 'text' },
  ];
}

export const sampleGanttCells = (): Record<string, Record<string, string>> => ({
  r0: { 'col.owner': 'AM' },
  r1: { 'col.owner': 'JR' },
  r2: { 'col.owner': 'KP' },
  r3: { 'col.owner': 'KP' },
  r4: { 'col.owner': 'AM' },
});

/** Per cent, so it belongs on an axis of its own — see `sampleComboGridData`. */
const COMBO_RATE = [18, 21, 24];

/** The right-hand axis a rate is read against: whole per cents, no thousands. */
export const SECONDARY_RATE_FORMAT = {
  style: 'number' as const,
  decimals: 0,
  thousands: false,
  suffix: '%',
};

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
        // The line is on its OWN axis, down the right — see
        // `sampleComboGridData`. A rate sharing the columns' scale draws as a
        // flat line along the floor, which is the picture a combo is meant to
        // replace.
        axes: {
          ...b.axes,
          y2: { ...DEFAULT_AXIS, show: true, numberFormat: SECONDARY_RATE_FORMAT },
        },
        data: sampleComboGridData(),
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
    case 'dotplot':
      return {
        ...b,
        kind,
        // Rows down the side, values across — see `DotPlotSpec.orientation`.
        orientation: 'horizontal',
        connector: 'range',
        decorations: {
          ...b.decorations,
          // A dot carries no length, so its position is read across the plot
          // against a rule — the same reason a line chart wants gridlines and a
          // column chart doesn't.
          gridlines: { major: { show: true } },
          // The numbers ARE the chart here: a dot plot with no labels asks the
          // reader to measure three positions off an axis by eye.
          labels: { ...b.decorations.labels, show: true },
        },
        data: sampleDotPlotData(),
      };
    case 'mekko':
      return { ...b, kind, width: { mode: 'total' }, stack: 'stacked100', data: sampleGridData() };
    case 'gantt':
      return {
        ...b,
        kind,
        rows: sampleGanttRows(),
        items: sampleGanttItems(),
        cells: sampleGanttCells(),
        columns: sampleGanttColumns(),
        timescale: {
          // Two rows — which quarter, and which month. `compileGantt` refines
          // the grain against the real plot width; this is the shape, not the
          // final answer.
          bands: [{ grain: 'quarter' }, { grain: 'month' }],
          weekStart: 1,
        },
        shading: { weekends: { show: false } },
        // No rules of any kind by default. A schedule is read by the LENGTH and
        // position of its bars, and a grid drawn behind them boxes every task
        // into a cell — which turns a plan into a spreadsheet and competes with
        // the one thing the reader is meant to look at. The timescale already
        // says where the months are; the bars say the rest.
        ruler: { rows: { show: false }, bands: { show: false } },
        banding: { show: false },
        // The value axis IS the timescale header, and a Gantt's rows are named
        // in the description table rather than on an axis — so neither of the
        // generic axes draws anything.
        axes: { x: { ...DEFAULT_AXIS, show: false }, y: { ...DEFAULT_AXIS, show: false } },
        // Nothing to key: the colours here separate workstreams, which the row
        // names already do.
        legend: { ...b.legend, show: false },
        decorations: {
          ...b.decorations,
          gridlines: { major: { show: false } },
          // The bars carry their dates in the description table; a label on
          // every bar as well is the same fact printed twice.
          labels: { ...b.decorations.labels, show: false },
        },
      };
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
