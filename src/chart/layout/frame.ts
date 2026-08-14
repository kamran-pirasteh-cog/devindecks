/**
 * Solve the plot rectangle inside a chart's frame.
 *
 * The chicken-and-egg: the value axis's gutter depends on how wide its tick
 * labels are, the tick labels depend on the domain, and how many ticks the
 * domain should have depends on how tall the plot is — which is what we're
 * solving for. Two passes converge in practice (the caller re-derives the
 * domain between them); a third is capped off as insurance, not as a plan.
 */
import type { EMU, Insets, Rect } from '@/model';
import { pointsToEmu } from '@/model';
import type { TextMeasurer, TextStyleMetrics } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import type { ChartTheme } from '../theme';

export interface FrameInput {
  frame: Rect;
  theme: ChartTheme;
  measurer: TextMeasurer;
  /** Value axis is horizontal (a bar chart lies on its side). */
  horizontal: boolean;
  /** Formatted tick labels, already scaled and rounded. */
  tickLabels: string[];
  categoryLabels: string[];
  showValueAxisLabels: boolean;
  showCategoryAxisLabels: boolean;
  /**
   * True when the category axis is CONTINUOUS (a scatter's x axis) rather than
   * banded. Continuous labels are centred on their tick, so the first and last
   * overhang the plot by half their width and the gutter has to allow for it —
   * a banded label is centred in its band and never overhangs.
   */
  continuousCategoryAxis?: boolean;
  title?: string;
  valueAxisTitle?: string;
  categoryAxisTitle?: string;
  unitNote?: string;
  legend?: { items: string[]; position: 'top' | 'right' | 'bottom' | 'left' };
  padding?: Insets;
  /**
   * Data labels (or totals) sit just PAST the tip of the tallest mark, so the
   * plot has to hand back a line of space at the value-axis end. Without it the
   * label on the tallest bar is drawn above the frame and clipped — which is
   * exactly what happens the moment labels default to on.
   */
  outsideValueLabels?: boolean;
  /**
   * Series names drawn at the end of each line, think-cell style. They extend
   * to the RIGHT of the last point and need a gutter of their own.
   */
  endLabels?: string[];
}

export interface FrameLayout {
  plot: Rect;
  title?: Rect;
  legend?: Rect;
  valueAxisTitle?: Rect;
  categoryAxisTitle?: Rect;
  unitNote?: Rect;
}

/** Never let the gutters eat the whole chart — a squeezed plot is still a plot. */
const MIN_PLOT_FRACTION = 0.25;

const styleOf = (r: ChartTheme['text'][keyof ChartTheme['text']]): TextStyleMetrics => ({
  font: r.font,
  sizePt: r.sizePt,
  bold: r.bold,
});

const widestOf = (
  labels: string[],
  style: TextStyleMetrics,
  m: TextMeasurer,
): EMU => labels.reduce((w, t) => Math.max(w, m.measure(t, style).wEmu), 0);

/**
 * How many value ticks a plot of this size should carry. Driven by available
 * space rather than a constant, so a 1.5in-tall chart doesn't try to render
 * eight gridlines.
 *
 * The spacing is deliberately generous and the cap deliberately low: the limit
 * that matters isn't when labels physically collide, it's when the gridlines
 * start competing with the data. A business chart wants four or five
 * gridlines, not the eleven that "as many as fit" produces.
 */
export function maxTicksFor(plotExtentEmu: EMU, labelExtentEmu: EMU): number {
  const per = Math.max(labelExtentEmu * 3, pointsToEmu(24));
  return Math.max(2, Math.min(7, Math.floor(plotExtentEmu / per)));
}

export function solveFrame(input: FrameInput): FrameLayout {
  const {
    frame,
    theme,
    measurer,
    horizontal,
    tickLabels,
    categoryLabels,
    showValueAxisLabels,
    showCategoryAxisLabels,
    title,
    valueAxisTitle,
    categoryAxisTitle,
    unitNote,
    legend,
    padding,
    continuousCategoryAxis,
    outsideValueLabels,
    endLabels,
  } = input;

  const pad = padding ?? { l: 0, t: 0, r: 0, b: 0 };
  let left = frame.x + pad.l;
  let top = frame.y + pad.t;
  let right = frame.x + frame.w - pad.r;
  let bottom = frame.y + frame.h - pad.b;

  const out: FrameLayout = { plot: { x: 0, y: 0, w: 0, h: 0 } };

  const tickStyle = styleOf(theme.text.tick);
  const catStyle = styleOf(theme.text.category);
  const axisTitleStyle = styleOf(theme.text.axisTitle);
  const legendStyle = styleOf(theme.text.legend);
  const titleStyle = styleOf(theme.text.title);
  const dataLabelStyle = styleOf(theme.text.dataLabel);
  const gap = theme.sizes.axisGapEmu;

  // --- title, top ---
  if (title) {
    const h = lineHeightEmu(titleStyle);
    out.title = { x: left, y: top, w: right - left, h };
    top += h + gap;
  }

  // --- unit note, tucked above the value axis ---
  if (unitNote) {
    const h = lineHeightEmu(tickStyle);
    out.unitNote = { x: left, y: top, w: right - left, h };
    top += h;
  }

  // --- legend, on its side ---
  if (legend?.items.length) {
    const itemW = (t: string) =>
      theme.sizes.legendSwatchEmu + theme.sizes.labelGapEmu + measurer.measure(t, legendStyle).wEmu;
    if (legend.position === 'top' || legend.position === 'bottom') {
      const h = lineHeightEmu(legendStyle);
      if (legend.position === 'top') {
        out.legend = { x: left, y: top, w: right - left, h };
        top += h + gap;
      } else {
        out.legend = { x: left, y: bottom - h, w: right - left, h };
        bottom -= h + gap;
      }
    } else {
      const w = legend.items.reduce((m, t) => Math.max(m, itemW(t)), 0);
      if (legend.position === 'left') {
        out.legend = { x: left, y: top, w, h: bottom - top };
        left += w + gap;
      } else {
        out.legend = { x: right - w, y: top, w, h: bottom - top };
        right -= w + gap;
      }
    }
  }

  // --- axis titles ---
  // The value axis title is rotated, so its LINE HEIGHT is what costs width.
  if (valueAxisTitle) {
    const thickness = lineHeightEmu(axisTitleStyle);
    if (horizontal) {
      out.valueAxisTitle = { x: left, y: bottom - thickness, w: right - left, h: thickness };
      bottom -= thickness + gap;
    } else {
      out.valueAxisTitle = { x: left, y: top, w: thickness, h: bottom - top };
      left += thickness + gap;
    }
  }
  if (categoryAxisTitle) {
    const thickness = lineHeightEmu(axisTitleStyle);
    if (horizontal) {
      out.categoryAxisTitle = { x: left, y: top, w: thickness, h: bottom - top };
      left += thickness + gap;
    } else {
      out.categoryAxisTitle = { x: left, y: bottom - thickness, w: right - left, h: thickness };
      bottom -= thickness + gap;
    }
  }

  // --- data-label gutters ---
  // These come before the tick gutters because they're measured against the
  // frame's edges, not against the axis furniture.
  if (endLabels?.length) {
    right -= widestOf(endLabels, dataLabelStyle, measurer) + theme.sizes.labelGapEmu * 2;
    // Turned on its side, the last point is at the BOTTOM of the plot and its
    // label is centred on it, so half a line hangs below the plot as well as
    // the label's width hanging past its right.
    if (horizontal) bottom -= lineHeightEmu(dataLabelStyle) / 2;
  }
  if (outsideValueLabels) {
    if (horizontal) {
      // A bar's label runs off its right-hand tip, so the cost is the WIDTH of
      // the widest number. The tick labels are the same values in the same
      // format, which makes them a sound proxy — and one we already have,
      // before any data label has been formatted.
      right -= widestOf(tickLabels, dataLabelStyle, measurer) + theme.sizes.labelGapEmu * 2;
    } else {
      // Only the TOP is reserved. A label under a negative bar hangs into the
      // category-label gutter, which is already there; reserving both ends
      // would cost every ordinary chart two lines of plot to protect a case
      // most charts don't have.
      top += lineHeightEmu(dataLabelStyle) + theme.sizes.labelGapEmu * 2;
    }
  }

  // --- tick and category label gutters ---
  const tickW = showValueAxisLabels ? widestOf(tickLabels, tickStyle, measurer) : 0;
  const tickH = showValueAxisLabels ? lineHeightEmu(tickStyle) : 0;
  const catW = showCategoryAxisLabels ? widestOf(categoryLabels, catStyle, measurer) : 0;
  const catH = showCategoryAxisLabels ? lineHeightEmu(catStyle) : 0;

  if (horizontal) {
    // Values run along the bottom, categories down the left.
    if (showCategoryAxisLabels) left += catW + gap;
    if (showValueAxisLabels) bottom -= tickH + gap;
    // Half the first and last tick label overhang the plot horizontally.
    if (showValueAxisLabels) right -= tickW / 2;
    if (showCategoryAxisLabels && continuousCategoryAxis) {
      // The mirror of the vertical case below: a line or area places its first
      // and last categories ON the plot's edges, so half of each of those
      // labels hangs past the end of the plot — off the top and bottom here,
      // rather than off the left and right.
      top += catH / 2;
      bottom -= catH / 2;
    }
  } else {
    if (showValueAxisLabels) left += tickW + gap;
    if (showCategoryAxisLabels) bottom -= catH + gap;
    // The topmost tick label is centred on the plot's top edge.
    if (showValueAxisLabels) top += tickH / 2;
    if (showCategoryAxisLabels && continuousCategoryAxis) {
      // The end labels straddle the plot's edges; without this they run off
      // the chart entirely.
      left += catW / 2;
      right -= catW / 2;
    }
  }

  // --- clamp ---
  const minW = frame.w * MIN_PLOT_FRACTION;
  const minH = frame.h * MIN_PLOT_FRACTION;
  if (right - left < minW) right = left + minW;
  if (bottom - top < minH) bottom = top + minH;

  out.plot = {
    x: Math.round(left),
    y: Math.round(top),
    w: Math.round(right - left),
    h: Math.round(bottom - top),
  };
  return out;
}
