/**
 * The furniture every cartesian chart shares: axes, gridlines, tick and
 * category labels, axis titles, the unit note and the legend.
 *
 * Column, bar, line, area and combo all draw the same frame around different
 * marks, so this lives once and each placer only supplies its own geometry.
 */
import type { ColorRef, EMU, LegendSpec, Rect } from '@/model';
import { pointsToEmu } from '@/model';
import type { LinearScale } from '../scale/linear';
import type { ChartTheme } from '../theme';
import type { Mark, MarkTextStyle } from '../mark';
import { rectFromEdges } from '../mark';
import type { FrameLayout } from '../layout/frame';
import { lineHeightEmu, type TextMeasurer } from '@/render/measureText';

/**
 * Maps data coordinates onto the plot. Both axes go through here so a bar chart
 * is the same code as a column chart with `horizontal` flipped, rather than two
 * near-identical placers that drift apart.
 */
export interface Projector {
  horizontal: boolean;
  plot: Rect;
  /** A value on the value axis -> absolute EMU. */
  value(v: number): EMU;
  /** 0..1 along the category axis -> absolute EMU. */
  category(t: number): EMU;
  /** The value-axis coordinate of the chart's baseline. */
  baseline(): EMU;
}

export function projector(plot: Rect, scale: LinearScale, horizontal: boolean): Projector {
  const clamp01 = (t: number) => (Number.isFinite(t) ? Math.max(-2, Math.min(3, t)) : 0);
  return {
    horizontal,
    plot,
    value: (v) =>
      horizontal
        ? plot.x + plot.w * clamp01(scale.norm(v))
        : // Screen y grows downward; the value axis grows upward.
          plot.y + plot.h * (1 - clamp01(scale.norm(v))),
    category: (t) => (horizontal ? plot.y + plot.h * t : plot.x + plot.w * t),
    baseline() {
      const zero = scale.min <= 0 && scale.max >= 0 ? 0 : scale.min > 0 ? scale.min : scale.max;
      return this.value(zero);
    },
  };
}

export const textStyle = (
  role: ChartTheme['text'][keyof ChartTheme['text']],
  align: MarkTextStyle['align'],
  anchor: MarkTextStyle['anchor'],
  rotation?: number,
): MarkTextStyle => ({
  font: role.font,
  sizePt: role.sizePt,
  bold: role.bold,
  weight: role.weight,
  color: role.color,
  caps: role.caps,
  align,
  anchor,
  rotation,
});

export interface CartesianInput {
  chartId: string;
  theme: ChartTheme;
  measurer: TextMeasurer;
  layout: FrameLayout;
  proj: Projector;
  scale: LinearScale;
  tickLabels: string[];
  categoryLabels: string[];
  /** 0..1 centre of each category along the category axis. */
  categoryCenters: number[];
  showValueAxisLabels: boolean;
  showCategoryAxisLabels: boolean;
  /** Continuous x axis: labels centre on their tick rather than on a band. */
  continuousCategoryAxis?: boolean;
  /** The chart's frame. Nothing is allowed to escape it. */
  bounds: Rect;
  showValueAxisLine: boolean;
  showCategoryAxisLine: boolean;
  gridlines: boolean;
  title?: string;
  valueAxisTitle?: string;
  categoryAxisTitle?: string;
  unitNote?: string;
  legend?: LegendSpec & { items: LegendItem[] };
}

export interface LegendItem {
  name: string;
  seriesKey: string;
  color: ColorRef;
}

export function placeCartesianFurniture(input: CartesianInput): Mark[] {
  const {
    chartId,
    theme,
    measurer,
    layout,
    proj,
    scale,
    tickLabels,
    categoryLabels,
    categoryCenters,
    showValueAxisLabels,
    showCategoryAxisLabels,
    showValueAxisLine,
    showCategoryAxisLine,
    continuousCategoryAxis,
    bounds,
    gridlines,
    title,
    valueAxisTitle,
    categoryAxisTitle,
    unitNote,
    legend,
  } = input;

  const { plot, horizontal } = proj;
  const marks: Mark[] = [];
  const gap = theme.sizes.axisGapEmu;
  const valueAxisId = horizontal ? 'x' : 'y';
  const categoryAxisId = horizontal ? 'y' : 'x';

  /* --- gridlines, first so everything else draws over them --- */
  if (gridlines) {
    scale.ticks.forEach((t, i) => {
      const at = proj.value(t);
      marks.push({
        kind: 'line',
        ref: { chartId, part: 'axis', axis: valueAxisId, sub: 'grid', i },
        rect: horizontal
          ? rectFromEdges(at, plot.y, at, plot.y + plot.h)
          : rectFromEdges(plot.x, at, plot.x + plot.w, at),
        color: theme.gridline,
        widthEmu: theme.sizes.gridlineWidthEmu,
        dash: theme.gridlineDash,
      });
    });
  }

  /* --- axis lines --- */
  if (showCategoryAxisLine) {
    // The category axis sits at the value baseline, so a chart with negatives
    // gets its axis through the middle rather than pinned to the floor.
    const at = proj.baseline();
    marks.push({
      kind: 'line',
      ref: { chartId, part: 'axis', axis: categoryAxisId, sub: 'line' },
      rect: horizontal
        ? rectFromEdges(at, plot.y, at, plot.y + plot.h)
        : rectFromEdges(plot.x, at, plot.x + plot.w, at),
      color: theme.axisLine,
      widthEmu: theme.sizes.axisWidthEmu,
      dash: 'solid',
    });
  }
  if (showValueAxisLine) {
    marks.push({
      kind: 'line',
      ref: { chartId, part: 'axis', axis: valueAxisId, sub: 'line' },
      rect: horizontal
        ? rectFromEdges(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h)
        : rectFromEdges(plot.x, plot.y, plot.x, plot.y + plot.h),
      color: theme.axisLine,
      widthEmu: theme.sizes.axisWidthEmu,
      dash: 'solid',
    });
  }

  /* --- value axis tick labels --- */
  if (showValueAxisLabels) {
    const style = textStyle(theme.text.tick, horizontal ? 'center' : 'right', 'middle');
    const h = lineHeightEmu(style);
    const w = Math.max(
      ...tickLabels.map((t) => measurer.measure(t, style).wEmu),
      pointsToEmu(1),
    );
    scale.ticks.forEach((t, i) => {
      const at = proj.value(t);
      marks.push({
        kind: 'text',
        ref: { chartId, part: 'axis', axis: valueAxisId, sub: 'tick', i },
        text: tickLabels[i] ?? '',
        style,
        rect: horizontal
          ? { x: Math.round(at - w / 2), y: Math.round(plot.y + plot.h + gap), w, h }
          : { x: Math.round(plot.x - gap - w), y: Math.round(at - h / 2), w, h },
      });
    });
  }

  /* --- category labels --- */
  if (showCategoryAxisLabels) {
    const style = textStyle(theme.text.category, horizontal ? 'right' : 'center', 'middle');
    const h = lineHeightEmu(style);
    const slot = categoryCenters.length > 1 ? 1 / categoryCenters.length : 1;
    categoryLabels.forEach((label, i) => {
      const centre = proj.category(categoryCenters[i] ?? 0);
      if (horizontal) {
        const w = Math.max(
          ...categoryLabels.map((t) => measurer.measure(t, style).wEmu),
          pointsToEmu(1),
        );
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'axis', axis: categoryAxisId, sub: 'tick', i },
          text: label,
          style,
          rect: { x: Math.round(plot.x - gap - w), y: Math.round(centre - h / 2), w, h },
        });
      } else {
        // A banded label gets its whole band, so long names centre and wrap
        // rather than colliding. A continuous one is sized to its own text —
        // a band would be meaningless and would overlap its neighbours.
        const w = continuousCategoryAxis
          ? Math.round(measurer.measure(label, style).wEmu + pointsToEmu(2))
          : Math.round(plot.w * slot);
        // The first and last labels of a continuous axis are centred on the
        // plot's edges, so half of each would hang outside the chart. Nudging
        // them inward beats letting them escape the frame — Excel does the
        // same, and nobody notices a few points of off-centring at the ends.
        const x = clampTo(centre - w / 2, w, bounds);
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'axis', axis: categoryAxisId, sub: 'tick', i },
          text: label,
          style,
          rect: { x: Math.round(x), y: Math.round(plot.y + plot.h + gap), w, h },
        });
      }
    });
  }

  /* --- titles and unit note --- */
  if (title && layout.title) {
    marks.push({
      kind: 'text',
      ref: { chartId, part: 'title' },
      text: title,
      style: textStyle(theme.text.title, 'left', 'top'),
      rect: layout.title,
    });
  }
  if (unitNote && layout.unitNote) {
    marks.push({
      kind: 'text',
      ref: { chartId, part: 'axis', axis: valueAxisId, sub: 'unitNote' },
      text: unitNote,
      style: textStyle(theme.text.tick, 'left', 'top'),
      rect: layout.unitNote,
    });
  }
  if (valueAxisTitle && layout.valueAxisTitle) {
    marks.push(rotatedAxisTitle(chartId, valueAxisId, valueAxisTitle, layout.valueAxisTitle, theme, horizontal));
  }
  if (categoryAxisTitle && layout.categoryAxisTitle) {
    marks.push(
      rotatedAxisTitle(chartId, categoryAxisId, categoryAxisTitle, layout.categoryAxisTitle, theme, !horizontal),
    );
  }

  /* --- legend --- */
  if (legend?.show && legend.items.length && layout.legend) {
    marks.push(...placeLegend(chartId, legend, layout.legend, theme, measurer));
  }

  return marks;
}

/** Keep a box of width `w` inside `bounds` on the horizontal axis. */
const clampTo = (x: EMU, w: EMU, bounds: Rect): EMU =>
  Math.max(bounds.x, Math.min(x, bounds.x + bounds.w - w));

/**
 * An axis title running along a vertical gutter has to be rotated. The element
 * rotates about its own centre, so the box is laid out horizontally at the
 * gutter's midpoint and then turned — which is also exactly what PowerPoint
 * does, so the export matches.
 */
function rotatedAxisTitle(
  chartId: string,
  axis: 'x' | 'y',
  text: string,
  slot: Rect,
  theme: ChartTheme,
  horizontalSlot: boolean,
): Mark {
  const style = textStyle(theme.text.axisTitle, 'center', 'middle', horizontalSlot ? undefined : -90);
  if (horizontalSlot) {
    return { kind: 'text', ref: { chartId, part: 'axis', axis, sub: 'title' }, text, style, rect: slot };
  }
  const h = lineHeightEmu(style);
  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h / 2;
  return {
    kind: 'text',
    ref: { chartId, part: 'axis', axis, sub: 'title' },
    text,
    style,
    rect: {
      x: Math.round(cx - slot.h / 2),
      y: Math.round(cy - h / 2),
      w: Math.round(slot.h),
      h,
    },
  };
}

function placeLegend(
  chartId: string,
  legend: NonNullable<CartesianInput['legend']>,
  slot: Rect,
  theme: ChartTheme,
  measurer: TextMeasurer,
): Mark[] {
  const style = textStyle(theme.text.legend, 'left', 'middle');
  const sw = theme.sizes.legendSwatchEmu;
  const gap = theme.sizes.labelGapEmu;
  const h = lineHeightEmu(style);
  const marks: Mark[] = [];

  const horizontal = legend.position === 'top' || legend.position === 'bottom';
  const widths = legend.items.map((it) => sw + gap + measurer.measure(it.name, style).wEmu);

  if (horizontal) {
    const spacing = theme.sizes.axisGapEmu * 2;
    const total = widths.reduce((a, w) => a + w, 0) + spacing * (widths.length - 1);
    let x = slot.x + Math.max(0, (slot.w - total) / 2);
    legend.items.forEach((it, i) => {
      marks.push(...legendItem(chartId, it, x, slot.y, sw, gap, h, widths[i], style));
      x += widths[i] + spacing;
    });
  } else {
    let y = slot.y + Math.max(0, (slot.h - legend.items.length * h) / 2);
    legend.items.forEach((it, i) => {
      marks.push(...legendItem(chartId, it, slot.x, y, sw, gap, h, widths[i], style));
      y += h;
    });
  }
  return marks;
}

function legendItem(
  chartId: string,
  item: LegendItem,
  x: EMU,
  y: EMU,
  sw: EMU,
  gap: EMU,
  h: EMU,
  w: EMU,
  style: MarkTextStyle,
): Mark[] {
  return [
    {
      kind: 'rect',
      ref: { chartId, part: 'legend.item', series: item.seriesKey },
      rect: { x: Math.round(x), y: Math.round(y + (h - sw) / 2), w: sw, h: sw },
      fill: { kind: 'solid', color: item.color },
    },
    {
      kind: 'text',
      ref: { chartId, part: 'legend.item', series: `${item.seriesKey}.label` },
      text: item.name,
      style,
      rect: { x: Math.round(x + sw + gap), y: Math.round(y), w: Math.round(w - sw - gap), h },
    },
  ];
}
