/**
 * think-cell's signature annotations: CAGR arrows, difference arrows and
 * brackets, trend lines, reference lines and callouts.
 *
 * All of them anchor to DATA, never to coordinates. That is the entire
 * difference between one of these and a hand-drawn arrow: edit a value, resize
 * the chart or reorder the categories and the annotation follows, still saying
 * something true. An arrow drawn as a shape is a claim that silently goes stale.
 */
import {
  pointsToEmu,
  type Anchor,
  type ChartSpec,
  type EMU,
  type LabelFont,
  type Rect,
} from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import type { LinearScale } from '../scale/linear';
import { fontOver, type ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { rectFromEdges } from '../mark';
import { formatNumber } from '../format/number';
import type { GridDerived } from '../derive/grid';
import type { Projector } from './../place/cartesian';
import { textStyle } from './../place/cartesian';

export interface DecorateInput {
  chartId: string;
  spec: ChartSpec;
  derived: GridDerived;
  proj: Projector;
  scale: LinearScale;
  theme: ChartTheme;
  measurer: TextMeasurer;
  /** 0..1 category positions, from whichever placer is in charge. */
  centers: number[];
  /**
   * The secondary value axis and the series on it, when the chart has one. An
   * annotation follows its data, so an arrow on a right-axis line has to be
   * projected through that line's scale — through the primary's it would point
   * into empty space.
   */
  secondary?: { keys: ReadonlySet<string>; proj: Projector; scale: LinearScale } | null;
}

/** The projector a series is drawn with — the secondary one only if it's on it. */
const projFor = (input: DecorateInput, seriesKey: string): Projector =>
  input.secondary?.keys.has(seriesKey) ? input.secondary.proj : input.proj;

interface ResolvedPoint {
  /** Absolute EMU on the slide. */
  x: EMU;
  y: EMU;
  /** The underlying value, for arithmetic. */
  value: number;
  /** Category index, for period counts. */
  index: number;
}

/**
 * Turn a data anchor into a point on the slide.
 *
 * Returns null when the anchor no longer resolves — a series was deleted, a
 * category renamed away. A stale annotation disappears rather than pointing at
 * the wrong bar, which is the one failure mode worse than not drawing it.
 */
function resolve(anchor: Anchor, input: DecorateInput): ResolvedPoint | null {
  const { derived, centers } = input;
  const proj =
    anchor.at === 'point' || anchor.at === 'segmentTop'
      ? projFor(input, anchor.series)
      : input.proj;

  const place = (index: number, value: number): ResolvedPoint => {
    const along = proj.category(centers[index] ?? 0);
    const across = proj.value(value);
    return proj.horizontal
      ? { x: across, y: along, value, index }
      : { x: along, y: across, value, index };
  };

  switch (anchor.at) {
    case 'point':
    case 'segmentTop': {
      const d = derived.data.find(
        (x) => x.seriesKey === anchor.series && x.pointKey === anchor.point,
      );
      if (!d || d.value === null) return null;
      return place(d.pointIndex, anchor.at === 'segmentTop' ? d.top : d.top);
    }
    case 'columnTotal': {
      const index = derived.data.find((x) => x.pointKey === anchor.point)?.pointIndex;
      if (index === undefined) return null;
      const top = Math.max(
        0,
        ...derived.data.filter((x) => x.pointIndex === index && x.value !== null).map((x) => x.top),
      );
      return place(index, top);
    }
    case 'axisValue':
      return null; // handled by reference lines, which don't need a category
  }
}

export function placeAnnotations(input: DecorateInput): Mark[] {
  const { chartId, spec, theme } = input;
  const d = spec.decorations;
  const marks: Mark[] = [];

  for (const line of d.referenceLines) marks.push(...referenceLine(line, input));
  for (const trend of d.trendLines) marks.push(...trendLine(trend, input));
  for (const arrow of d.cagr) marks.push(...cagrArrow(arrow, input));
  for (const arrow of d.differences) marks.push(...differenceArrow(arrow, input));
  for (const note of d.annotations) marks.push(...annotation(note, input));

  void chartId;
  void theme;
  return marks;
}

/* ------------------------------------------------------------------ */

function referenceLine(
  line: ChartSpec['decorations']['referenceLines'][number],
  input: DecorateInput,
): Mark[] {
  const { chartId, theme, measurer } = input;
  // A reference line names a value ON an axis, so which axis it is matters:
  // "target 20%" against the right-hand scale is a different height on the plot
  // to 20 against the left's.
  const proj = line.axis === 'y2' && input.secondary ? input.secondary.proj : input.proj;
  const { plot, horizontal } = proj;
  const at = proj.value(line.value);
  const color = line.style?.color ?? theme.axisLine;
  const marks: Mark[] = [
    {
      kind: 'line',
      ref: { chartId, part: 'decoration', decoId: line.id },
      rect: horizontal
        ? rectFromEdges(at, plot.y, at, plot.y + plot.h)
        : rectFromEdges(plot.x, at, plot.x + plot.w, at),
      color,
      widthEmu: line.style?.widthEmu ?? pointsToEmu(1),
      dash: line.style?.dash ?? 'dash',
    },
  ];

  if (line.label) {
    // The label's ink defaults to the rule's, so recolouring the line carries
    // its label with it — but an explicit font colour wins, which is the whole
    // point of the override.
    const style = textStyle(
      { ...theme.text.dataLabel, color, ...fontOver(line.font) },
      'right',
      'middle',
    );
    const w = measurer.measure(line.label, style).wEmu + pointsToEmu(2);
    const h = lineHeightEmu(style);
    marks.push({
      kind: 'text',
      ref: { chartId, part: 'decoration', decoId: line.id, sub: 'label' },
      text: line.label,
      style,
      rect: {
        x: Math.round(plot.x + plot.w - w),
        y: Math.round(at - h - theme.sizes.labelGapEmu),
        w,
        h,
      },
    });
  }
  return marks;
}

function trendLine(
  trend: ChartSpec['decorations']['trendLines'][number],
  input: DecorateInput,
): Mark[] {
  const { chartId, derived, theme, centers } = input;
  const proj = projFor(input, trend.series);
  const points = derived.data
    .filter((d) => d.seriesKey === trend.series && d.value !== null)
    .sort((a, b) => a.pointIndex - b.pointIndex);
  if (points.length < 2) return [];

  let from: number;
  let to: number;

  if (trend.mode === 'average') {
    const mean = points.reduce((s, p) => s + (p.value ?? 0), 0) / points.length;
    from = mean;
    to = mean;
  } else {
    // Ordinary least squares on (index, value) — the honest fit, and the one
    // Excel draws, so a chart rebuilt there matches.
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.pointIndex, 0);
    const sumY = points.reduce((s, p) => s + (p.value ?? 0), 0);
    const sumXY = points.reduce((s, p) => s + p.pointIndex * (p.value ?? 0), 0);
    const sumXX = points.reduce((s, p) => s + p.pointIndex ** 2, 0);
    const denom = n * sumXX - sumX ** 2;
    if (!denom) return [];
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    from = intercept + slope * points[0].pointIndex;
    to = intercept + slope * points[n - 1].pointIndex;
  }

  const a = pointAt(points[0].pointIndex, from, proj, centers);
  const b = pointAt(points[points.length - 1].pointIndex, to, proj, centers);

  return [
    {
      kind: 'line',
      ref: { chartId, part: 'decoration', decoId: trend.id },
      rect: rectFromEdges(a.x, a.y, b.x, b.y),
      // A line box can't say which diagonal it runs along; `flipV` does.
      flipV: a.y > b.y,
      color: trend.style?.color ?? theme.text.dataLabel.color,
      widthEmu: trend.style?.widthEmu ?? pointsToEmu(1.25),
      dash: trend.style?.dash ?? 'dash',
    },
  ];
}

const pointAt = (
  index: number,
  value: number,
  proj: Projector,
  centers: number[],
): { x: EMU; y: EMU } => {
  const along = proj.category(centers[index] ?? 0);
  const across = proj.value(value);
  return proj.horizontal ? { x: across, y: along } : { x: along, y: across };
};

/**
 * A CAGR arrow: the compound annual growth rate between two points, drawn as
 * an arc-less arrow with the rate as its label.
 */
function cagrArrow(
  arrow: ChartSpec['decorations']['cagr'][number],
  input: DecorateInput,
): Mark[] {
  const a = resolve(arrow.from, input);
  const b = resolve(arrow.to, input);
  if (!a || !b) return [];

  const periods = arrow.periods ?? Math.abs(b.index - a.index);
  // CAGR is undefined across a sign change or from zero; saying nothing beats
  // printing an imaginary number.
  const valid = periods > 0 && a.value > 0 && b.value > 0;
  const rate = valid ? (b.value / a.value) ** (1 / periods) - 1 : null;

  const label =
    arrow.label ??
    (rate === null
      ? 'n/m'
      : `CAGR ${formatNumber(rate, arrow.numberFormat ?? { style: 'percent', decimals: 1 }, { peers: [rate] }).text}`);

  return connector(input, arrow.id, a, b, label, { arrowhead: true, font: arrow.font });
}

function differenceArrow(
  arrow: ChartSpec['decorations']['differences'][number],
  input: DecorateInput,
): Mark[] {
  const a = resolve(arrow.from, input);
  const b = resolve(arrow.to, input);
  if (!a || !b) return [];

  const abs = b.value - a.value;
  const pct = a.value !== 0 ? abs / Math.abs(a.value) : null;
  const fmt = arrow.numberFormat ?? { style: 'number' as const, thousands: true };

  const parts: string[] = [];
  if (arrow.mode === 'absolute' || arrow.mode === 'both') {
    parts.push((abs > 0 ? '+' : '') + formatNumber(abs, fmt, { peers: [abs] }).text);
  }
  if ((arrow.mode === 'percent' || arrow.mode === 'both') && pct !== null) {
    parts.push(
      (pct > 0 ? '+' : '') +
        formatNumber(pct, { style: 'percent', decimals: 1 }, { peers: [pct] }).text,
    );
  }

  return connector(input, arrow.id, a, b, arrow.label ?? parts.join(' · '), {
    arrowhead: !arrow.bracket,
    bracket: arrow.bracket,
    font: arrow.font,
  });
}

/**
 * The shared body of an arrow or bracket: a connecting line, an optional
 * arrowhead, and a label sitting off the midpoint.
 *
 * The arrowhead is a `rightArrow` preset rotated to the line's bearing —
 * a native OOXML shape, so it survives export intact rather than becoming a
 * hand-built triangle.
 */
function connector(
  input: DecorateInput,
  decoId: string,
  a: ResolvedPoint,
  b: ResolvedPoint,
  label: string,
  opts: { arrowhead?: boolean; bracket?: boolean; font?: LabelFont },
): Mark[] {
  const { chartId, theme, measurer } = input;
  const color = theme.text.dataLabel.color;
  const width = pointsToEmu(1.25);
  const marks: Mark[] = [];

  if (opts.bracket) {
    // A bracket spans the two points with short returns at each end, which
    // reads as "this range" rather than "this direction".
    const lift = pointsToEmu(10);
    const top = Math.min(a.y, b.y) - lift;
    marks.push(
      lineMark(chartId, `${decoId}-l`, { x: a.x, y: a.y }, { x: a.x, y: top }, color, width),
      lineMark(chartId, `${decoId}-t`, { x: a.x, y: top }, { x: b.x, y: top }, color, width),
      lineMark(chartId, `${decoId}-r`, { x: b.x, y: top }, { x: b.x, y: b.y }, color, width),
    );
  } else {
    marks.push({
      kind: 'line',
      ref: { chartId, part: 'decoration', decoId },
      rect: rectFromEdges(a.x, a.y, b.x, b.y),
      flipV: a.y > b.y,
      color,
      widthEmu: width,
      dash: 'solid',
    });
  }

  if (label) {
    const style = textStyle(
      { ...theme.text.totalLabel, color, ...fontOver(opts.font) },
      'center',
      'middle',
    );
    const w = measurer.measure(label, style).wEmu + pointsToEmu(6);
    const h = lineHeightEmu(style);
    const mx = (a.x + b.x) / 2;
    const my = opts.bracket ? Math.min(a.y, b.y) - pointsToEmu(10) : (a.y + b.y) / 2;

    // A white plate behind the label keeps it readable where it crosses its
    // own connector or a gridline.
    const rect: Rect = {
      x: Math.round(mx - w / 2),
      y: Math.round(my - h / 2 - pointsToEmu(6)),
      w,
      h,
    };
    marks.push(
      {
        kind: 'rect',
        ref: { chartId, part: 'decoration', decoId, sub: 'plate' },
        rect,
        fill: { kind: 'solid', color: theme.plotBackground ?? { kind: 'token', token: 'surface.base' } },
      },
      {
        kind: 'text',
        ref: { chartId, part: 'decoration', decoId, sub: 'label' },
        text: label,
        style,
        rect,
      },
    );
  }

  return marks;
}

const lineMark = (
  chartId: string,
  decoId: string,
  a: { x: EMU; y: EMU },
  b: { x: EMU; y: EMU },
  color: ChartTheme['axisLine'],
  width: EMU,
): Mark => ({
  kind: 'line',
  ref: { chartId, part: 'decoration', decoId },
  rect: rectFromEdges(a.x, a.y, b.x, b.y),
  flipV: a.y > b.y,
  color,
  widthEmu: width,
  dash: 'solid',
});

function annotation(
  note: ChartSpec['decorations']['annotations'][number],
  input: DecorateInput,
): Mark[] {
  const { chartId, theme, measurer } = input;
  const at = resolve(note.anchor, input);
  if (!at) return [];

  const style = textStyle({ ...theme.text.dataLabel, ...fontOver(note.font) }, 'left', 'middle');
  const w = measurer.measure(note.text, style).wEmu + pointsToEmu(4);
  const h = lineHeightEmu(style);
  const x = at.x + note.offset.dx;
  const y = at.y + note.offset.dy;

  const marks: Mark[] = [];
  if (note.connector) {
    marks.push(
      lineMark(
        chartId,
        `${note.id}-lead`,
        { x: at.x, y: at.y },
        { x, y },
        theme.gridline,
        pointsToEmu(0.75),
      ),
    );
  }
  marks.push({
    kind: 'text',
    ref: { chartId, part: 'decoration', decoId: note.id },
    text: note.text,
    style,
    rect: { x: Math.round(x), y: Math.round(y - h / 2), w, h },
  });
  return marks;
}
