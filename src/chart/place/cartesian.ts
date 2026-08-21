/**
 * The furniture every cartesian chart shares: axes, gridlines, tick and
 * category labels, axis titles, the unit note and the legend.
 *
 * Column, bar, line, area and combo all draw the same frame around different
 * marks, so this lives once and each placer only supplies its own geometry.
 */
import type { AxisId, AxisSpec, ColorRef, DashStyle, EMU, LegendSpec, Rect } from '@/model';
import { isInsideLegend, pointsToEmu, token } from '@/model';
import type { LinearScale } from '../scale/linear';
import type { ChartTheme } from '../theme';
import type { Mark, MarkTextStyle } from '../mark';
import { rectFromEdges } from '../mark';
import { fitted, type FrameLayout } from '../layout/frame';
import { categoryLabelStride } from '../layout/categoryTicks';
import { lineHeightEmu, type TextMeasurer } from '@/render/measureText';
import type { DateGrain } from '@/model';

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

/**
 * A chart label's style. NO WRAPPING by default — see `wrap` on
 * `MarkTextStyle`.
 *
 * Nearly every box a chart draws text in was measured from that text: a tick
 * label, a data label, a legend entry, a node name. The engine has already
 * decided the string sits on one line, so a renderer that disagrees by half a
 * point shouldn't get to break "1,250" across two of them — which is precisely
 * what an axis of five-digit ticks did, and it read as the chart being broken.
 *
 * The exceptions are boxes sized to something OTHER than their text — a title
 * across the frame, a category label given its whole band — and they ask for
 * wrapping explicitly by passing `wrap`.
 */
export const textStyle = (
  role: ChartTheme['text'][keyof ChartTheme['text']],
  align: MarkTextStyle['align'],
  anchor: MarkTextStyle['anchor'],
  rotation?: number,
  wrap = false,
): MarkTextStyle => ({
  font: role.font,
  sizePt: role.sizePt,
  bold: role.bold,
  italic: role.italic,
  weight: role.weight,
  color: role.color,
  caps: role.caps,
  align,
  anchor,
  rotation,
  wrap,
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
  /**
   * The grain the category labels denote, when they are dated. Only the stride
   * reads it: a dated axis thins its labels in weeks or quarters rather than in
   * whatever integer happens to fit. See `categoryLabelStride`.
   */
  categoryGrain?: DateGrain | null;
  /** The chart's frame. Nothing is allowed to escape it. */
  bounds: Rect;
  showValueAxisLine: boolean;
  showCategoryAxisLine: boolean;
  gridlines: boolean;
  /** Short rules at each tick, per axis. Unset means none — see `AxisSpec`. */
  valueTickMarks?: AxisSpec['tickMarks'];
  categoryTickMarks?: AxisSpec['tickMarks'];
  /**
   * The SECONDARY value axis, drawn on the far side of the plot — the right on
   * a column chart, the top on a bar. Unset means the chart has one value axis.
   *
   * It carries its own scale rather than reading the primary's: that is the
   * whole point of it. No gridlines of its own, though — a second set of rules
   * across the same plot at different heights reads as a mistake, and the
   * caller aligns the two tick counts so the primary's rules serve both.
   */
  secondary?: {
    scale: LinearScale;
    tickLabels: string[];
    showLabels: boolean;
    showLine?: boolean;
    tickMarks?: AxisSpec['tickMarks'];
    title?: string;
  };
  title?: string;
  valueAxisTitle?: string;
  categoryAxisTitle?: string;
  unitNote?: string;
  legend?: LegendSpec & { items: LegendItem[] };
  /**
   * The chart will be turned and its labels stood back up. Every label box
   * below is therefore laid out on its SIDE, matching the gutters `solveFrame`
   * cut for it under the same flag; `standUp` trades the sides back.
   */
  uprightText?: boolean;
}

export interface LegendItem {
  name: string;
  seriesKey: string;
  color: ColorRef;
  /**
   * Set for a series DRAWN as a line — a combo's line rows, and every series
   * on a line chart. Its key then reads as a line in the legend too, at the
   * same width and dash it is stroked with in the plot.
   *
   * A filled square standing for a line is the one legend that can be read
   * wrong rather than merely plainly: on a combo it says "another column",
   * which is exactly the thing the line is not — and on a dashed receded line
   * the dash is the only thing telling it from its neighbours.
   */
  line?: { widthEmu: EMU; dash: DashStyle };
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
    valueTickMarks,
    categoryTickMarks,
    continuousCategoryAxis,
    categoryGrain,
    bounds,
    gridlines,
    title,
    valueAxisTitle,
    categoryAxisTitle,
    unitNote,
    legend,
    uprightText,
    secondary,
  } = input;

  const { plot, horizontal } = proj;
  // The same swap `solveFrame` reserves its gutters with — see `uprightText`.
  const xExtent = (w: EMU, h: EMU): EMU => (uprightText ? h : w);
  const yExtent = (w: EMU, h: EMU): EMU => (uprightText ? w : h);

  /**
   * A label box, sized the way the words will end up and placed by the footprint
   * it occupies until then.
   *
   * On an unturned chart the two are the same box. On a turned one they differ
   * by a quarter turn: the gutter was cut for a label lying on its side, so the
   * FOOTPRINT (`fw` × `fh`) is what decides where the box sits, while the box
   * itself keeps the proportions the upright words need. Both share a centre,
   * which is the only thing `standUp` carries across.
   */
  const boxAt = (cx: EMU, cy: EMU, w: EMU, h: EMU): Rect => ({
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w: Math.round(w),
    h: Math.round(h),
  });
  const marks: Mark[] = [];
  const gap = theme.sizes.axisGapEmu;
  const valueAxisId = horizontal ? 'x' : 'y';
  const categoryAxisId = horizontal ? 'y' : 'x';

  /**
   * Every nth category label — and the same nth for the category tick marks,
   * because a tick mark under nothing reads as a label that failed to render.
   *
   * Solved here rather than in `solveFrame` because it is a function of the
   * PLOT, which the frame has already cut by the time this runs. The gutter the
   * frame reserved is the widest label's either way, so thinning can only ever
   * leave room over — never take a label outside its own gutter.
   */
  const catStyle = textStyle(theme.text.category, horizontal ? 'right' : 'center', 'middle');
  const catLineH = lineHeightEmu(catStyle);
  /**
   * What label `i` costs along the category axis, with room to breathe.
   *
   * A BANDED label is measured by its longest word rather than by the whole
   * string, because that label wraps: "Distribution centre" over two lines is
   * the axis working as designed, and thinning it away would throw out a label
   * that fits. A continuous label doesn't wrap — it is one line centred on its
   * tick — so the whole string is what has to clear.
   */
  const catAlong = (i: number): EMU => {
    const label = categoryLabels[i] ?? '';
    const wraps = !horizontal && !continuousCategoryAxis;
    const words = wraps ? label.split(/\s+/).filter(Boolean) : [label];
    const widest = words.reduce((w, t) => Math.max(w, measurer.measure(t, catStyle).wEmu), 0);
    const text = fitted(widest) + pointsToEmu(2);
    return horizontal ? yExtent(text, catLineH) : xExtent(text, catLineH);
  };
  const categoryStride = showCategoryAxisLabels
    ? categoryLabelStride({
        centers: categoryCenters,
        extentEmu: horizontal ? plot.h : plot.w,
        sizeEmu: catAlong,
        grain: categoryGrain,
      })
    : 1;
  const writesCategory = (i: number): boolean => i % categoryStride === 0;

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

  /* --- tick marks --- */
  // Drawn from the plot's edge, outwards into the gap the frame already left
  // for the labels or inwards over the plot, so switching them on never moves
  // anything else. See `sizes.tickMarkEmu`.
  const tickMark = (axis: 'x' | 'y', at: EMU, dir: 'out' | 'in') => {
    const len = theme.sizes.tickMarkEmu;
    // Which edge a tick hangs off is the axis's own: the value axis runs up the
    // left (or along the bottom, turned), the category axis the other way.
    const alongValue = axis === valueAxisId;
    const vertical = alongValue !== horizontal;
    if (vertical) {
      // A rule reaching sideways from the plot's left edge.
      const x0 = plot.x;
      const x1 = dir === 'out' ? plot.x - len : plot.x + len;
      return rectFromEdges(Math.min(x0, x1), at, Math.max(x0, x1), at);
    }
    const y0 = plot.y + plot.h;
    const y1 = dir === 'out' ? y0 + len : y0 - len;
    return rectFromEdges(at, Math.min(y0, y1), at, Math.max(y0, y1));
  };

  const pushTicks = (
    axis: 'x' | 'y',
    mode: AxisSpec['tickMarks'],
    positions: EMU[],
    writes: (i: number) => boolean = () => true,
  ) => {
    if (!mode || mode === 'none') return;
    positions.forEach((at, i) => {
      if (!writes(i)) return;
      marks.push({
        kind: 'line',
        ref: { chartId, part: 'axis', axis, sub: 'tickMark', i },
        rect: tickMark(axis, at, mode),
        color: theme.axisLine,
        widthEmu: theme.sizes.axisWidthEmu,
        dash: 'solid',
      });
    });
  };

  pushTicks(valueAxisId, valueTickMarks, scale.ticks.map((t) => proj.value(t)));
  pushTicks(
    categoryAxisId,
    categoryTickMarks,
    categoryCenters.map((t) => proj.category(t)),
    writesCategory,
  );

  /* --- value axis tick labels --- */
  if (showValueAxisLabels) {
    const style = textStyle(theme.text.tick, horizontal ? 'center' : 'right', 'middle');
    const h = lineHeightEmu(style);
    // `fitted`, and the same call in `solveFrame`: the gutter the frame reserved
    // and the box the label is drawn in are the same measurement, and they have
    // to stay the same measurement or the labels sit outside their own gutter.
    const w = Math.max(
      fitted(Math.max(...tickLabels.map((t) => measurer.measure(t, style).wEmu))),
      pointsToEmu(1),
    );
    // Footprint: what the label costs the gutter on the way to standing up.
    const fw = xExtent(w, h);
    const fh = yExtent(w, h);
    scale.ticks.forEach((t, i) => {
      const at = proj.value(t);
      marks.push({
        kind: 'text',
        ref: { chartId, part: 'axis', axis: valueAxisId, sub: 'tick', i },
        text: tickLabels[i] ?? '',
        style,
        rect: horizontal
          ? boxAt(at, plot.y + plot.h + gap + fh / 2, w, h)
          : boxAt(plot.x - gap - fw / 2, at, w, h),
      });
    });
  }

  /* --- the secondary value axis, on the far side of the plot --- */
  if (secondary) {
    const sProj = projector(plot, secondary.scale, horizontal);
    // Which edge it hangs off: the right of an upright chart, the top of one
    // lying on its side — always the side the primary axis is not on.
    const farEdge = horizontal ? plot.y : plot.x + plot.w;

    if (secondary.showLine) {
      marks.push({
        kind: 'line',
        ref: { chartId, part: 'axis', axis: 'y2', sub: 'line' },
        rect: horizontal
          ? rectFromEdges(plot.x, farEdge, plot.x + plot.w, farEdge)
          : rectFromEdges(farEdge, plot.y, farEdge, plot.y + plot.h),
        color: theme.axisLine,
        widthEmu: theme.sizes.axisWidthEmu,
        dash: 'solid',
      });
    }

    if (secondary.tickMarks && secondary.tickMarks !== 'none') {
      const len = theme.sizes.tickMarkEmu;
      // Outwards is away from the plot, which on this axis means the other
      // direction to the primary's.
      const out = secondary.tickMarks === 'out' ? 1 : -1;
      secondary.scale.ticks.forEach((t, i) => {
        const at = sProj.value(t);
        const a = farEdge;
        const b = horizontal ? farEdge - len * out : farEdge + len * out;
        marks.push({
          kind: 'line',
          ref: { chartId, part: 'axis', axis: 'y2', sub: 'tickMark', i },
          rect: horizontal
            ? rectFromEdges(at, Math.min(a, b), at, Math.max(a, b))
            : rectFromEdges(Math.min(a, b), at, Math.max(a, b), at),
          color: theme.axisLine,
          widthEmu: theme.sizes.axisWidthEmu,
          dash: 'solid',
        });
      });
    }

    if (secondary.showLabels) {
      const style = textStyle(theme.text.tick, horizontal ? 'center' : 'left', 'middle');
      const h = lineHeightEmu(style);
      const w = Math.max(
        fitted(Math.max(...secondary.tickLabels.map((t) => measurer.measure(t, style).wEmu))),
        pointsToEmu(1),
      );
      const fw = xExtent(w, h);
      const fh = yExtent(w, h);
      secondary.scale.ticks.forEach((t, i) => {
        const at = sProj.value(t);
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'axis', axis: 'y2', sub: 'tick', i },
          text: secondary.tickLabels[i] ?? '',
          style,
          rect: horizontal
            ? boxAt(at, plot.y - gap - fh / 2, w, h)
            : boxAt(plot.x + plot.w + gap + fw / 2, at, w, h),
        });
      });
    }

    if (secondary.title && layout.secondaryAxisTitle) {
      marks.push(
        rotatedAxisTitle(
          chartId,
          'y2',
          secondary.title,
          layout.secondaryAxisTitle,
          theme,
          horizontal,
        ),
      );
    }
  }

  /* --- category labels --- */
  if (showCategoryAxisLabels) {
    const style = catStyle;
    const h = catLineH;
    const slot = categoryCenters.length > 1 ? 1 / categoryCenters.length : 1;
    categoryLabels.forEach((label, i) => {
      if (!writesCategory(i)) return;
      const centre = proj.category(categoryCenters[i] ?? 0);
      if (horizontal) {
        const widest = Math.max(
          fitted(Math.max(...categoryLabels.map((t) => measurer.measure(t, style).wEmu))),
          pointsToEmu(1),
        );
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'axis', axis: categoryAxisId, sub: 'tick', i },
          text: label,
          style,
          rect: boxAt(plot.x - gap - xExtent(widest, h) / 2, centre, widest, h),
        });
      } else {
        // A banded label gets its whole band, so long names centre and wrap
        // rather than colliding. A continuous one is sized to its own text —
        // a band would be meaningless and would overlap its neighbours.
        const own = Math.round(fitted(measurer.measure(label, style).wEmu) + pointsToEmu(2));
        // A thinned axis hands each surviving label the bands of the ones it
        // stands in for: the neighbour is `stride` bands away, so the box can
        // grow to match without ever reaching it.
        const band = Math.round(plot.w * slot * categoryStride);
        const widest = Math.max(
          fitted(Math.max(...categoryLabels.map((t) => measurer.measure(t, style).wEmu))),
          pointsToEmu(1),
        );
        // A band is a SLOT, not a text extent: it keeps its size whichever way
        // round the chart ends up, and turns from a width into a height. The
        // gutter it sits across is the text extent, and that one trades sides.
        const box = continuousCategoryAxis
          ? { w: own, h }
          : uprightText
            ? { w: widest, h: band }
            : { w: band, h };
        const fw = continuousCategoryAxis ? xExtent(own, h) : band;
        const fh = continuousCategoryAxis ? yExtent(own, h) : yExtent(widest, h);
        // The first and last labels of a continuous axis are centred on the
        // plot's edges, so half of each would hang outside the chart. Nudging
        // them inward beats letting them escape the frame — Excel does the
        // same, and nobody notices a few points of off-centring at the ends.
        const cx = clampTo(centre - fw / 2, fw, bounds) + fw / 2;
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'axis', axis: categoryAxisId, sub: 'tick', i },
          text: label,
          // The banded case is the one label on a chart that genuinely wants to
          // wrap: its box is the band, not the text, and a long category name
          // reads better on two lines than overlapping its neighbour.
          //
          // That box is one line tall, so a wrapped label grows out of it; a
          // middle anchor spends half that growth UPWARDS, over the category
          // axis it sits under. Anchoring to the top spends all of it
          // downwards, away from the chart. (Upright labels wrap across the
          // band instead — their overflow runs sideways within their own slot,
          // and their anchor becomes an alignment once stood up.)
          style: continuousCategoryAxis
            ? style
            : { ...style, wrap: true, ...(uprightText ? {} : { anchor: 'top' as const }) },
          rect: boxAt(cx, plot.y + plot.h + gap + fh / 2, box.w, box.h),
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
      // Sized to the frame, not to the string: a long title SHOULD wrap.
      style: textStyle(theme.text.title, 'left', 'top', undefined, true),
      rect: layout.title,
    });
  }
  if (unitNote && layout.unitNote) {
    marks.push({
      kind: 'text',
      ref: { chartId, part: 'axis', axis: valueAxisId, sub: 'unitNote' },
      text: unitNote,
      style: textStyle(theme.text.tick, 'left', 'top', undefined, true),
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
  axis: AxisId,
  text: string,
  slot: Rect,
  theme: ChartTheme,
  horizontalSlot: boolean,
): Mark {
  // Given the whole gutter rather than its own width, so a long title wraps
  // inside the slot instead of running out of the chart.
  const style = textStyle(
    theme.text.axisTitle,
    'center',
    'middle',
    horizontalSlot ? undefined : -90,
    true,
  );
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

export function placeLegend(
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
  const inside = isInsideLegend(legend.position);
  const marks: Mark[] = [];

  // The legend's own box, behind its entries and invisible, exactly as the
  // chart backdrop is: without it the legend is only ever hit through a 6pt
  // swatch or a word, and a swatch MEANS the series — it drills to the bars.
  // So "select the legend" — to move it, restyle it, or delete it — had no
  // target at all. Pressing on the space around the entries is that target.
  //
  // Inside the plot the same box stops being invisible and starts earning its
  // keep: it's the only thing between a series name and the gridlines running
  // under it. Not opaque, though — a legend that blanks out the data behind it
  // reads as a hole punched in the chart.
  marks.push({
    kind: 'rect',
    ref: { chartId, part: 'legend.box' },
    name: 'Legend',
    rect: slot,
    fill: {
      kind: 'solid',
      color: theme.plotBackground ?? token('surface.base'),
      alpha: inside ? 0.85 : 0,
    },
  });

  const horizontal = legend.position === 'top' || legend.position === 'bottom';
  // `fitted`, like every other box measured to its own string: a series name
  // that wrapped inside its legend entry used to overlap the entry beneath it.
  const widths = legend.items.map((it) => sw + gap + fitted(measurer.measure(it.name, style).wEmu));

  if (horizontal) {
    const spacing = theme.sizes.axisGapEmu * 2;
    const total = widths.reduce((a, w) => a + w, 0) + spacing * (widths.length - 1);
    let x = slot.x + Math.max(0, (slot.w - total) / 2);
    legend.items.forEach((it, i) => {
      // A row of many long series names can be wider than the slot it's centred
      // in. Its boxes are still not allowed out of the chart — an element whose
      // rect leaves the frame is one that survives a crop, an export and a
      // thumbnail as a stray label floating beside the chart.
      const w = Math.min(widths[i], Math.max(0, slot.x + slot.w - x));
      marks.push(...legendItem(chartId, it, x, slot.y, sw, gap, h, w, style));
      x += widths[i] + spacing;
    });
  } else {
    // Centred in its gutter on a side, but flush with the top of the box when
    // it's inside one: the box's top IS the top of the value axis, and an
    // inside legend that drifted down from it would just look dropped.
    let y = inside ? slot.y : slot.y + Math.max(0, (slot.h - legend.items.length * h) / 2);
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
  const mid = Math.round(y + h / 2);
  return [
    item.line
      ? {
          kind: 'line',
          ref: { chartId, part: 'legend.item', series: item.seriesKey },
          // Full swatch width and zero height: the key is a stroke, so it wants
          // the run to read as one, not a square's worth of it.
          rect: rectFromEdges(Math.round(x), mid, Math.round(x + sw), mid),
          color: item.color,
          widthEmu: item.line.widthEmu,
          dash: item.line.dash,
        }
      : {
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
      // `w` is the whole entry and the swatch takes the front of it. Clamped at
      // zero: a legend squeezed narrower than its own swatch must still emit a
      // box with a real size, not a negative one.
      rect: {
        x: Math.round(x + sw + gap),
        y: Math.round(y),
        w: Math.max(0, Math.round(w - sw - gap)),
        h,
      },
    },
  ];
}
