/**
 * Column and bar charts — clustered, stacked and 100% stacked.
 *
 * One placer for all six combinations. `horizontal` swaps the axes and
 * `derive/grid.ts` has already resolved stacking into (base, top) ranges, so
 * the geometry here is genuinely the same code every time rather than six
 * near-copies that drift.
 */
import type { ColorRef, ColumnBarSpec, EMU, LabelSpec, PointOverride } from '@/model';
import { pointsToEmu } from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import { bandScale } from '../scale/band';
import type { LinearScale } from '../scale/linear';
import type { ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { MIN_MARK_EMU, rectFromEdges } from '../mark';
import type { GridDerived } from '../derive/grid';
import { stackTops } from '../derive/grid';
import { formatNumber } from '../format/number';
import type { Projector } from './cartesian';
import { textStyle } from './cartesian';

export interface ColumnBarInput {
  chartId: string;
  spec: ColumnBarSpec;
  derived: GridDerived;
  proj: Projector;
  scale: LinearScale;
  theme: ChartTheme;
  measurer: TextMeasurer;
  /**
   * Restrict the bars to these series — a combo chart's column members. The
   * series LIST stays whole so series indexes (and so colours and band slots)
   * mean the same thing they do everywhere else; only the data is scoped.
   */
  onlySeries?: Set<string>;
}

/** 0..1 centres of each category, for the shared axis furniture. */
export function categoryCenters(spec: ColumnBarSpec, derived: GridDerived): number[] {
  const band = bandFor(spec, derived);
  return derived.categoryLabels.map((_, i) => band.center(i));
}

function bandFor(spec: ColumnBarSpec, derived: GridDerived) {
  const stacked = spec.stack !== 'clustered';
  return bandScale({
    count: derived.categoryLabels.length,
    // A stack IS one bar — the series live inside it, not beside it.
    seriesCount: stacked ? 1 : derived.series.length,
    gapWidthPct: spec.gapWidthPct,
    overlapPct: stacked ? 100 : spec.overlapPct,
  });
}

/** Drop the data of the series this placer was told to leave alone. */
function scopeToSeries(input: ColumnBarInput): ColumnBarInput {
  const only = input.onlySeries;
  if (!only) return input;
  return {
    ...input,
    derived: { ...input.derived, data: input.derived.data.filter((d) => only.has(d.seriesKey)) },
  };
}

const overrideFor = (
  derived: GridDerived,
  seriesIndex: number,
  pointKey: string,
): PointOverride | undefined => derived.series[seriesIndex]?.pointOverrides?.[pointKey];

/** Spec default < series override < point override. Most specific wins. */
function labelSpecFor(
  chartDefault: LabelSpec,
  derived: GridDerived,
  seriesIndex: number,
  pointKey: string,
): LabelSpec {
  const series = derived.series[seriesIndex];
  const point = overrideFor(derived, seriesIndex, pointKey);
  return { ...chartDefault, ...(series?.labels ?? {}), ...(point?.label ?? {}) };
}

function seriesColor(
  theme: ChartTheme,
  derived: GridDerived,
  seriesIndex: number,
  pointKey: string,
): ColorRef {
  const point = overrideFor(derived, seriesIndex, pointKey);
  const pointFill = point?.format?.fill;
  if (pointFill?.kind === 'solid') return pointFill.color;
  const seriesFill = derived.series[seriesIndex]?.format?.fill;
  if (seriesFill?.kind === 'solid') return seriesFill.color;
  return theme.seriesColor(seriesIndex);
}

export function placeColumnBar(rawInput: ColumnBarInput): Mark[] {
  const input = scopeToSeries(rawInput);
  const { chartId, spec, derived, proj, theme } = input;
  const { horizontal } = proj;
  const band = bandFor(spec, derived);
  const stacked = spec.stack !== 'clustered';
  const marks: Mark[] = [];

  /* --- the bars --- */
  for (const d of derived.data) {
    if (d.value === null) continue;
    const point = overrideFor(derived, d.seriesIndex, d.pointKey);
    if (point?.hidden) continue;

    const seriesSlot = stacked ? 0 : d.seriesIndex;
    const c0 = band.barStart(d.pointIndex, seriesSlot);
    const c1 = c0 + band.barWidth;
    const catA = proj.category(c0);
    const catB = proj.category(c1);
    const valA = proj.value(d.base);
    const valB = proj.value(d.top);

    const rect = horizontal
      ? rectFromEdges(valA, catA, valB, catB)
      : rectFromEdges(catA, valA, catB, valB);

    // A zero-height bar would vanish but still occupy the selection tree; give
    // it a hairline so "there is a datum here" stays visible and clickable.
    if (horizontal) rect.w = Math.max(rect.w, MIN_MARK_EMU);
    else rect.h = Math.max(rect.h, MIN_MARK_EMU);

    marks.push({
      kind: 'rect',
      ref: { chartId, part: 'mark', series: d.seriesKey, point: d.pointKey },
      name: `${d.seriesName} · ${d.pointLabel}`,
      rect,
      fill: { kind: 'solid', color: seriesColor(theme, derived, d.seriesIndex, d.pointKey) },
      outline: point?.format?.outline ?? derived.series[d.seriesIndex]?.format?.outline,
    });
  }

  /* --- data labels --- */
  marks.push(...placeDataLabels(input, band, stacked));

  /* --- totals --- */
  const totals = spec.decorations.totals;
  if (totals?.show && stacked) {
    marks.push(...placeTotals(input, band));
  }

  return marks;
}

function placeDataLabels(
  input: ColumnBarInput,
  band: ReturnType<typeof bandFor>,
  stacked: boolean,
): Mark[] {
  const { chartId, spec, derived, proj, theme, measurer } = input;
  const { horizontal } = proj;
  const marks: Mark[] = [];
  const chartDefault = spec.decorations.labels;
  const peers = derived.data.map((d) => d.labelValue);

  for (const d of derived.data) {
    if (d.value === null) continue;
    const point = overrideFor(derived, d.seriesIndex, d.pointKey);
    if (point?.hidden) continue;

    const label = labelSpecFor(chartDefault, derived, d.seriesIndex, d.pointKey);
    if (!label.show) continue;

    const text = labelText(label, d, spec, peers);
    if (!text) continue;

    // Resolve the placement BEFORE the style: whether this label ends up
    // sitting on its own bar decides what colour it has to be.
    const placement = resolvePlacement(label.placement, stacked);
    // A stacked segment has no true outside — an "outside" label still lands
    // on the segment above — so stacking always counts as on-fill.
    const onFill = stacked || isInsidePlacement(placement);

    const style = textStyle(
      {
        ...theme.text.dataLabel,
        ...(label.font ?? {}),
        // An author's explicit colour always wins. Otherwise a label drawn on
        // top of a mark takes its ink from that mark, which is what keeps a
        // number legible on a saturated fill instead of near-black on indigo.
        color:
          label.font?.color ??
          (onFill
            ? theme.inkOn(seriesColor(theme, derived, d.seriesIndex, d.pointKey))
            : theme.text.dataLabel.color),
      },
      'center',
      'middle',
    );
    const h = lineHeightEmu(style);
    const w = measurer.measure(text, style).wEmu + pointsToEmu(2);

    const seriesSlot = stacked ? 0 : d.seriesIndex;
    const c0 = band.barStart(d.pointIndex, seriesSlot);
    const centreCat = proj.category(c0 + band.barWidth / 2);
    const valA = proj.value(d.base);
    const valB = proj.value(d.top);
    const thickness = Math.abs(valB - valA);

    // think-cell's sliver rule: a segment too small to hold its own label
    // shows nothing rather than shoving a number over its neighbours.
    const need = horizontal ? w : h;
    if (onFill && label.hideWhenSmaller !== undefined && thickness < Math.max(need, label.hideWhenSmaller)) {
      continue;
    }

    const pos = labelPosition({
      placement,
      horizontal,
      valA,
      valB,
      gap: theme.sizes.labelGapEmu,
      w,
      h,
    });

    const offset = point?.labelOffset;
    const rect = horizontal
      ? { x: Math.round(pos - w / 2), y: Math.round(centreCat - h / 2), w, h }
      : { x: Math.round(centreCat - w / 2), y: Math.round(pos - h / 2), w, h };
    if (offset) {
      rect.x += offset.dx;
      rect.y += offset.dy;
    }

    marks.push({
      kind: 'text',
      ref: { chartId, part: 'label', series: d.seriesKey, point: d.pointKey },
      name: `${d.seriesName} · ${d.pointLabel} label`,
      text,
      style,
      rect,
    });
  }
  return marks;
}

/**
 * `auto` means centred inside a stack (there is no outside) and just beyond
 * the tip otherwise — which is what a reader expects in both cases.
 */
const resolvePlacement = (
  placement: LabelSpec['placement'],
  stacked: boolean,
): LabelSpec['placement'] =>
  placement === 'auto' ? (stacked ? 'insideCenter' : 'outsideEnd') : placement;

/** Does this placement put the label on top of the mark it describes? */
const isInsidePlacement = (placement: LabelSpec['placement']): boolean =>
  placement === 'insideCenter' || placement === 'insideEnd' || placement === 'insideBase';

/** The value-axis coordinate a label centres on. */
function labelPosition(o: {
  /** Already resolved — `auto` never reaches here. */
  placement: LabelSpec['placement'];
  horizontal: boolean;
  valA: EMU;
  valB: EMU;
  gap: EMU;
  w: EMU;
  h: EMU;
}): EMU {
  const { valA, valB, gap, horizontal, w, h, placement } = o;
  const half = (horizontal ? w : h) / 2;
  // Which way is "outward" from the bar's tip, in screen coordinates.
  const outward = Math.sign(valB - valA) || (horizontal ? 1 : -1);

  switch (placement) {
    case 'insideCenter':
      return (valA + valB) / 2;
    case 'insideBase':
      return valA + outward * (half + gap);
    case 'insideEnd':
      return valB - outward * (half + gap);
    case 'outsideEnd':
    case 'above':
    case 'below':
    case 'left':
    case 'right':
    default:
      return valB + outward * (half + gap);
  }
}

function labelText(
  label: LabelSpec,
  d: GridDerived['data'][number],
  spec: ColumnBarSpec,
  peers: number[],
): string {
  const fmt = label.numberFormat ?? spec.numberFormat;
  const render = (c: LabelSpec['content']): string => {
    switch (c.kind) {
      case 'value':
        return formatNumber(d.labelValue, fmtFor(spec, fmt), { peers }).text;
      case 'percent':
        return d.share === undefined
          ? ''
          : formatNumber(d.share, { ...fmt, style: 'percent' }, { peers: [d.share] }).text;
      case 'category':
        return d.pointLabel;
      case 'seriesName':
        return d.seriesName;
      case 'custom':
        return c.text;
      case 'composite':
        return c.parts.map(render).filter(Boolean).join(c.separator);
    }
  };
  return render(label.content);
}

/**
 * 100% stacking already turned the values into shares, so their labels must be
 * percentages regardless of what the chart's number format says.
 */
const fmtFor = (spec: ColumnBarSpec, fmt: ColumnBarSpec['numberFormat']) =>
  spec.stack === 'stacked100' ? { ...fmt, style: 'percent' as const } : fmt;

function placeTotals(input: ColumnBarInput, band: ReturnType<typeof bandFor>): Mark[] {
  const { chartId, spec, derived, proj, theme, measurer } = input;
  const { horizontal } = proj;
  const totals = spec.decorations.totals!;
  const tops = stackTops(derived, derived.categoryLabels.length);
  const style = textStyle(
    { ...theme.text.totalLabel, ...(totals.font ?? {}), color: totals.font?.color ?? theme.text.totalLabel.color },
    'center',
    'middle',
  );
  const h = lineHeightEmu(style);
  const fmt = totals.numberFormat ?? spec.numberFormat;

  return derived.categoryLabels.map((_, i) => {
    // 100% stacks always total 100%, so show the underlying sum instead.
    const value = spec.stack === 'stacked100' ? derived.totals[i] : tops[i];
    const text = formatNumber(value, fmt, { peers: derived.totals }).text;
    const w = measurer.measure(text, style).wEmu + pointsToEmu(2);
    const centreCat = proj.category(band.center(i));
    const tip = proj.value(tops[i]);
    const outward = horizontal ? 1 : -1;
    const pos = tip + outward * (h / 2 + theme.sizes.labelGapEmu * 2);

    return {
      kind: 'text' as const,
      ref: {
        chartId,
        part: 'total' as const,
        point: derived.data.find((d) => d.pointIndex === i)?.pointKey ?? `c${i}`,
      },
      text,
      style,
      rect: horizontal
        ? { x: Math.round(pos - w / 2), y: Math.round(centreCat - h / 2), w, h }
        : { x: Math.round(centreCat - w / 2), y: Math.round(pos - h / 2), w, h },
    };
  });
}
