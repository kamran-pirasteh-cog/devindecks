/**
 * Waterfall (bridge) placement.
 *
 * Two things distinguish a real bridge from a column chart with floating bars:
 * the connectors that carry the eye from one bar's top to the next bar's base,
 * and the fact that increases, decreases and milestones are coloured by ROLE
 * rather than by series.
 */
import { pointsToEmu, type ColorRef, type WaterfallSpec } from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import { bandScale } from '../scale/band';
import type { ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { MIN_MARK_EMU, rectFromEdges } from '../mark';
import type { WaterfallDerived } from '../derive/waterfall';
import { formatNumber } from '../format/number';
import type { Projector } from './cartesian';
import { textStyle } from './cartesian';

export interface WaterfallInput {
  chartId: string;
  spec: WaterfallSpec;
  derived: WaterfallDerived;
  proj: Projector;
  theme: ChartTheme;
  measurer: TextMeasurer;
}

export function waterfallBand(spec: WaterfallSpec, count: number) {
  return bandScale({
    count,
    seriesCount: 1,
    gapWidthPct: spec.gapWidthPct,
    overlapPct: 100,
  });
}

export const waterfallCenters = (spec: WaterfallSpec, count: number): number[] => {
  const band = waterfallBand(spec, count);
  return Array.from({ length: count }, (_, i) => band.center(i));
};

export function placeWaterfall(input: WaterfallInput): Mark[] {
  const { chartId, spec, derived, proj, theme, measurer } = input;
  const { horizontal } = proj;
  const band = waterfallBand(spec, derived.data.length);
  const marks: Mark[] = [];

  const itemFormat = new Map(spec.data.items.map((i) => [i.key, i.format]));

  /**
   * The role colours are the DEFAULT, not the last word: an item's own format
   * wins over them.
   *
   * A waterfall has no series, so recolouring one bar has nowhere to go but
   * `WaterfallItem.format` — which is where `applyChartFormat` writes it. Read
   * it here or that write is inert and the bar snaps back to its role colour on
   * the next recompile.
   */
  const colorFor = (d: WaterfallDerived['data'][number]): ColorRef => {
    const own = itemFormat.get(d.key)?.fill;
    if (own?.kind === 'solid') return own.color;
    if (d.role === 'total' || d.role === 'subtotal' || d.role === 'start') return spec.colors.total;
    return d.negative ? spec.colors.decrease : spec.colors.increase;
  };

  /* --- connectors, under the bars --- */
  if (spec.connectors) {
    for (let i = 0; i < derived.data.length - 1; i++) {
      const a = derived.data[i];
      const b = derived.data[i + 1];
      if (a.role === 'spacer' || b.role === 'spacer') continue;
      // The connector leaves the top of one bar and meets the next at the same
      // level, which is exactly the running total being carried forward.
      const level = proj.value(a.role === 'delta' ? a.top : a.top);
      const from = proj.category(band.barStart(i, 0) + band.barWidth);
      const to = proj.category(band.barStart(i + 1, 0));
      marks.push({
        kind: 'line',
        ref: { chartId, part: 'decoration', decoId: `connector-${a.key}` },
        rect: horizontal
          ? rectFromEdges(level, from, level, to)
          : rectFromEdges(from, level, to, level),
        color: theme.gridline,
        widthEmu: theme.sizes.gridlineWidthEmu,
        dash: 'dash',
      });
    }
  }

  /* --- bars --- */
  for (const d of derived.data) {
    if (d.role === 'spacer') continue;
    const c0 = band.barStart(d.index, 0);
    const c1 = c0 + band.barWidth;
    const catA = proj.category(c0);
    const catB = proj.category(c1);
    const valA = proj.value(d.base);
    const valB = proj.value(d.top);

    const rect = horizontal
      ? rectFromEdges(valA, catA, valB, catB)
      : rectFromEdges(catA, valA, catB, valB);
    if (horizontal) rect.w = Math.max(rect.w, MIN_MARK_EMU);
    else rect.h = Math.max(rect.h, MIN_MARK_EMU);

    marks.push({
      kind: 'rect',
      ref: { chartId, part: 'mark', series: 's0', point: d.key },
      name: d.label,
      rect,
      fill: { kind: 'solid', color: colorFor(d) },
      outline: itemFormat.get(d.key)?.outline,
    });
  }

  /* --- labels --- */
  const labels = spec.decorations.labels;
  if (labels.show) {
    const style = textStyle(
      { ...theme.text.dataLabel, ...(labels.font ?? {}), color: labels.font?.color ?? theme.text.dataLabel.color },
      'center',
      'middle',
    );
    const h = lineHeightEmu(style);
    const peers = derived.data.map((d) => d.value);

    for (const d of derived.data) {
      if (d.role === 'spacer') continue;
      // A delta reads as a movement, so it carries its sign explicitly; a
      // milestone is a level and doesn't.
      const signed = d.role === 'delta' && d.value > 0;
      const text =
        (signed ? '+' : '') + formatNumber(d.value, spec.numberFormat, { peers }).text;
      const w = measurer.measure(text, style).wEmu + pointsToEmu(2);
      const centre = proj.category(band.center(d.index));
      const tip = proj.value(d.top);
      const outward = d.top >= d.base ? (horizontal ? 1 : -1) : horizontal ? -1 : 1;
      const pos = tip + outward * (h / 2 + theme.sizes.labelGapEmu);

      marks.push({
        kind: 'text',
        ref: { chartId, part: 'label', series: 's0', point: d.key },
        text,
        style,
        rect: horizontal
          ? { x: Math.round(pos - w / 2), y: Math.round(centre - h / 2), w, h }
          : { x: Math.round(centre - w / 2), y: Math.round(pos - h / 2), w, h },
      });
    }
  }

  return marks;
}
