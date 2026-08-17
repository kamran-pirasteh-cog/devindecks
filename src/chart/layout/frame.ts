/**
 * Solve the plot rectangle inside a chart's frame.
 *
 * The chicken-and-egg: the value axis's gutter depends on how wide its tick
 * labels are, the tick labels depend on the domain, and how many ticks the
 * domain should have depends on how tall the plot is — which is what we're
 * solving for. Two passes converge in practice (the caller re-derives the
 * domain between them); a third is capped off as insurance, not as a plan.
 */
import type { EMU, Insets, LegendPosition, Rect } from '@/model';
import { isInsideLegend, pointsToEmu } from '@/model';
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
  legend?: { items: string[]; position: LegendPosition };
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
  /**
   * This layout will be turned a quarter of the way round, and its labels will
   * be stood back up afterwards — see `standUp` in `turn.ts`.
   *
   * It changes the arithmetic of every text gutter and nothing else. A label
   * that ends up horizontal in the finished chart lies on its SIDE in the box
   * solved here, so it costs its height where it would have cost its width and
   * its width where it would have cost its height. Reserve the unturned extents
   * and the labels come out standing in gutters cut for lying down: a category
   * name a line-height wide, spilling across the plot.
   */
  uprightText?: boolean;
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
  // Carried, not dropped: the gutter this file solves is measured from these
  // labels, and an uppercase label is wider than the one that was typed.
  caps: r.caps,
});

/**
 * The slack every box measured to its own text carries.
 *
 * A measurement is an ESTIMATE of what a font engine will do — the canvas
 * measurer is exact about advance widths and still can't account for the
 * renderer rounding the box to whole pixels, hinting a glyph a hair wider, or
 * substituting a face before the webfont lands. A box sized to the measurement
 * exactly is therefore a coin flip, and losing it is not subtle: the label wraps
 * mid-number, so a 5-tick axis paints "1," over "250" across two lines and the
 * whole gutter reads as garbage. One point of slack costs a rounding error's
 * worth of plot and takes that failure off the table.
 *
 * Belt and braces with `wrap: false` (see `textStyle`): the slack keeps the
 * label inside its box, and the no-wrap keeps a label that outgrows its box
 * anyway on one line, where it overhangs by a hair instead of stacking.
 */
export const TEXT_SLACK: EMU = pointsToEmu(1);

/** A measured extent, plus the slack a real font engine needs. */
export const fitted = (measured: EMU): EMU => (measured > 0 ? measured + TEXT_SLACK : 0);

/**
 * One legend entry's width: swatch, gap, and the name.
 *
 * `fitted`, matching `placeLegend`: the box a legend reserves and the box its
 * entries are drawn in are the same measurement, or the last name wraps.
 */
const legendItemWidth = (
  text: string,
  theme: ChartTheme,
  m: TextMeasurer,
  style: TextStyleMetrics,
): EMU =>
  theme.sizes.legendSwatchEmu + theme.sizes.labelGapEmu + fitted(m.measure(text, style).wEmu);

/**
 * The box an inside legend occupies, measured against the finished plot.
 *
 * Solved after the plot rather than before it, which is the whole point of an
 * inside legend: it costs the data no gutter, so the plot can't depend on it.
 * The box's TOP is the plot's top — level with the top of the value axis, the
 * one line a reader's eye already follows across the chart — and it hugs
 * whichever side was asked for, inset by a gap so the entries don't sit on the
 * axis line or on the last gridline's end.
 *
 * Never wider or taller than the plot: a legend that outgrew the chart body
 * would defeat the point of putting it inside one.
 */
export function insideLegendSlot(
  plot: Rect,
  items: string[],
  position: LegendPosition,
  theme: ChartTheme,
  measurer: TextMeasurer,
): Rect {
  const style = styleOf(theme.text.legend);
  const inset = theme.sizes.labelGapEmu;
  const w = Math.min(
    items.reduce((m, t) => Math.max(m, legendItemWidth(t, theme, measurer, style)), 0),
    Math.max(0, plot.w - inset * 2),
  );
  const h = Math.min(items.length * lineHeightEmu(style), plot.h);
  return {
    x: Math.round(
      position === 'insideTopRight' ? plot.x + plot.w - inset - w : plot.x + inset,
    ),
    y: Math.round(plot.y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

const widestOf = (
  labels: string[],
  style: TextStyleMetrics,
  m: TextMeasurer,
): EMU => fitted(labels.reduce((w, t) => Math.max(w, m.measure(t, style).wEmu), 0));

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
    uprightText,
  } = input;

  // Every text extent below is read through one of these two rather than taken
  // straight from the measurer. They are the identity for an upright chart; for
  // one that will be turned and its labels stood back up, they swap — which is
  // the whole of "the layout knows which way the type will end up". See
  // `uprightText`.
  const xExtent = (w: EMU, h: EMU): EMU => (uprightText ? h : w);
  const yExtent = (w: EMU, h: EMU): EMU => (uprightText ? w : h);

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
  // An INSIDE legend is skipped here on purpose: it floats over the plot, so it
  // reserves nothing and can't be solved yet anyway — its box is measured from
  // the finished plot by `insideLegendSlot`.
  if (legend?.items.length && !isInsideLegend(legend.position)) {
    const itemW = (t: string) => legendItemWidth(t, theme, measurer, legendStyle);
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
    // Measured in BOTH end-label faces and reserved for the wider: the frame is
    // solved before anyone knows which series is emphasised, and mono at 10.5pt
    // and sans at 11pt each win on different strings. Over-reserving by a hair
    // beats a label hanging off the slide.
    const endLabelStyle = styleOf(theme.text.endLabel);
    const widest = Math.max(
      widestOf(endLabels, endLabelStyle, measurer),
      widestOf(endLabels, styleOf(theme.text.endLabelEmphasis), measurer),
    );
    const endLine = lineHeightEmu(endLabelStyle);
    // Three gaps of clearance plus the padding the placer adds to the text box.
    right -= xExtent(widest, endLine) + theme.sizes.labelGapEmu * 3 + pointsToEmu(5);
    // Turned on its side, the last point is at the BOTTOM of the plot and its
    // label is centred on it, so half a line hangs below the plot as well as
    // the label's width hanging past its right.
    if (horizontal) bottom -= yExtent(widest, endLine) / 2;
  }
  if (outsideValueLabels) {
    // A bar's label runs off its right-hand tip, so the cost is the WIDTH of
    // the widest number. The tick labels are the same values in the same
    // format, which makes them a sound proxy — and one we already have, before
    // any data label has been formatted.
    const labelW = widestOf(tickLabels, dataLabelStyle, measurer);
    const labelH = lineHeightEmu(dataLabelStyle);
    if (horizontal) {
      right -= xExtent(labelW, labelH) + theme.sizes.labelGapEmu * 2;
    } else {
      // Only the TOP is reserved. A label under a negative bar hangs into the
      // category-label gutter, which is already there; reserving both ends
      // would cost every ordinary chart two lines of plot to protect a case
      // most charts don't have.
      top += yExtent(labelW, labelH) + theme.sizes.labelGapEmu * 2;
    }
  }

  // --- tick and category label gutters ---
  const tickW = showValueAxisLabels ? widestOf(tickLabels, tickStyle, measurer) : 0;
  const tickH = showValueAxisLabels ? lineHeightEmu(tickStyle) : 0;
  const catWidest = showCategoryAxisLabels ? widestOf(categoryLabels, catStyle, measurer) : 0;
  // A continuous axis's labels are centred on their tick rather than given a
  // band, and the placer pads each one by 2pt so neighbours don't touch. The
  // gutter has to reserve the same 2pt — same measurement, same box, the rule
  // `fitted` exists for — or the widest label hangs out of the chart by exactly
  // that much. Invisible while the label lay along its gutter; a visible notch
  // once the chart is turned and the label stands up across it.
  const catW = catWidest && continuousCategoryAxis ? catWidest + pointsToEmu(2) : catWidest;
  const catH = showCategoryAxisLabels ? lineHeightEmu(catStyle) : 0;

  if (horizontal) {
    // Values run along the bottom, categories down the left.
    if (showCategoryAxisLabels) left += xExtent(catW, catH) + gap;
    if (showValueAxisLabels) bottom -= yExtent(tickW, tickH) + gap;
    // Half the first and last tick label overhang the plot horizontally.
    if (showValueAxisLabels) right -= xExtent(tickW, tickH) / 2;
    if (showCategoryAxisLabels && continuousCategoryAxis) {
      // The mirror of the vertical case below: a line or area places its first
      // and last categories ON the plot's edges, so half of each of those
      // labels hangs past the end of the plot — off the top and bottom here,
      // rather than off the left and right.
      top += yExtent(catW, catH) / 2;
      bottom -= yExtent(catW, catH) / 2;
    }
  } else {
    if (showValueAxisLabels) left += xExtent(tickW, tickH) + gap;
    if (showCategoryAxisLabels) bottom -= yExtent(catW, catH) + gap;
    // The topmost tick label is centred on the plot's top edge.
    if (showValueAxisLabels) top += yExtent(tickW, tickH) / 2;
    if (showCategoryAxisLabels && continuousCategoryAxis) {
      // The end labels straddle the plot's edges; without this they run off
      // the chart entirely.
      left += xExtent(catW, catH) / 2;
      right -= xExtent(catW, catH) / 2;
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
