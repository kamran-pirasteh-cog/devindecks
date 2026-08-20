/**
 * Dot plot — points on a line.
 *
 * One track per category, one marker per series on it. The geometry is a band
 * scale across the categories and the value scale along the track, so a dot
 * plot is a bar chart that spends its ink on positions instead of lengths, and
 * `horizontal` swaps the two axes here exactly as it does in `columnBar`.
 *
 * The look is a LADDER rather than a palette — see `RUNGS`. A dot plot's series
 * are a sequence ("was, is, target"), not a set of categories, so the markers
 * climb from a hollow circle in muted ink to a filled accent disc, and the
 * reader's eye lands on the last one without consulting a legend. A series that
 * names its own fill still gets it, which is the escape hatch for the
 * genuinely categorical case (us against three peers).
 */
import {
  pointsToEmu,
  type ColorRef,
  type DotPlotSpec,
  type EMU,
  type Fill,
  type LabelSpec,
  type MarkerShape,
  type Outline,
  type Rect,
  token,
} from '@/model';
import { lineHeightEmu, type TextMeasurer } from '@/render/measureText';
import type { LinearScale } from '../scale/linear';
import { fontOver, type ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { MIN_MARK_EMU, rectFromEdges } from '../mark';
import type { GridDerived } from '../derive/grid';
import { formatNumber } from '../format/number';
import { textStyle, type Projector } from './cartesian';
import { labelRole, labelSpecFor } from './labelSpec';

export interface DotPlotInput {
  chartId: string;
  spec: DotPlotSpec;
  derived: GridDerived;
  proj: Projector;
  scale: LinearScale;
  theme: ChartTheme;
  measurer: TextMeasurer;
  /** Restrict the markers to these series, as `placeColumnBar`'s. */
  onlySeries?: Set<string>;
  /**
   * The chart will be turned and its labels stood back up, so a label's
   * FOOTPRINT is its height rather than its width — the same trade
   * `placeLineArea` makes for an end label.
   */
  uprightText?: boolean;
}

/** 0..1 centres of each track, for the shared axis furniture. */
export const dotCategoryCenters = (count: number): number[] =>
  Array.from({ length: Math.max(0, count) }, (_, i) => (i + 0.5) / Math.max(1, count));

/**
 * The series drawn as the subject.
 *
 * The LAST series by default, not the first — see `DotPlotSpec.emphasis`. An
 * `emphasis` naming a series that has since been deleted falls back to that
 * default rather than to nothing, so a renamed series doesn't silently flatten
 * the chart.
 */
export function dotEmphasisKey(spec: DotPlotSpec, seriesKeys: string[]): string | null {
  if (spec.emphasis === null || !seriesKeys.length) return null;
  if (spec.emphasis && seriesKeys.includes(spec.emphasis)) return spec.emphasis;
  return seriesKeys[seriesKeys.length - 1];
}

/* ------------------------------------------------------------------ */
/* The ladder                                                         */
/* ------------------------------------------------------------------ */

/** Where a rung's ink comes from. Resolved against the theme, never hex. */
type RungInk = 'hollow' | 'muted' | 'strong' | 'accentSoft' | 'accent';

interface Rung {
  shape: MarkerShape;
  /** Diameter, as a fraction of the subject's. */
  scale: number;
  ink: RungInk;
}

/**
 * Five rungs, faintest first, the subject last.
 *
 * Shape carries identity and size carries focus, deliberately both: two markers
 * a hue apart are one photocopy away from being the same marker, and a dot plot
 * is a chart people print. The diamond in the middle is what makes a three-dot
 * track read as a step rather than as a row of peas.
 */
const RUNGS: Rung[] = [
  { shape: 'circle', scale: 5 / 9, ink: 'hollow' },
  { shape: 'circle', scale: 5.5 / 9, ink: 'muted' },
  { shape: 'diamond', scale: 6.5 / 9, ink: 'strong' },
  { shape: 'circle', scale: 7.5 / 9, ink: 'accentSoft' },
  { shape: 'circle', scale: 1, ink: 'accent' },
];

/**
 * Which rungs the LEADING markers use, by how many there are.
 *
 * Counted back from the subject, which always takes the top rung: a two-dot
 * chart and a five-dot chart draw the same emphasised marker, so adding a
 * column to the datasheet never restyles the number the slide is about.
 *
 * Past four leading markers the ladder gives up and puts them all on rung 2 —
 * six graded dots on one track is a scale of its own, and the chart has stopped
 * being a dot plot.
 */
const LEADING_PICKS: number[][] = [[], [0], [0, 2], [0, 1, 2], [0, 1, 2, 3]];

const DEFAULT_SUBJECT: EMU = pointsToEmu(9);
const DEFAULT_TRACK: EMU = pointsToEmu(3.5);
/** The track is the ground the markers are read against, never a mark itself. */
const TRACK_ALPHA = 0.22;
/** A stem carries a length, so it can afford more ink than a range track. */
const STEM_ALPHA = 0.35;

export interface DotRung extends Rung {
  /** Diameter in EMU, with `markerSizeEmu` already applied. */
  sizeEmu: EMU;
  /** The rung's ink as a colour. `hollow` reports its OUTLINE's colour here. */
  color: ColorRef;
  emphasized: boolean;
}

const inkColor = (ink: RungInk, theme: ChartTheme): ColorRef => {
  switch (ink) {
    case 'hollow':
    case 'muted':
      return theme.mutedInk;
    case 'strong':
      return theme.strongInk;
    case 'accentSoft':
    case 'accent':
      // The palette's FIRST colour, not the series' own slot. A dot plot's
      // subject is always the brand's strongest voice; taking slot 3 is how
      // the emphasised dot ended up a pale tint smaller charts never showed.
      return theme.seriesColor(0);
  }
};

/**
 * The ladder resolved for one chart, aligned to `seriesKeys`.
 *
 * Exported because the legend has to agree with the dots: entries coloured from
 * `theme.seriesColor(i)` beside markers coloured from the ramp is a key that
 * points at the wrong dot.
 */
export function dotRungs(
  spec: DotPlotSpec,
  seriesKeys: string[],
  theme: ChartTheme,
): DotRung[] {
  const emphasisKey = dotEmphasisKey(spec, seriesKeys);
  const subject = spec.markerSizeEmu ?? DEFAULT_SUBJECT;
  const leading = seriesKeys.filter((k) => k !== emphasisKey);
  const picks =
    LEADING_PICKS[leading.length] ?? leading.map(() => 1 /* flat, past the ladder */);

  return seriesKeys.map((key) => {
    const emphasized = key === emphasisKey;
    const rung = emphasized
      ? RUNGS[RUNGS.length - 1]
      : (RUNGS[picks[leading.indexOf(key)] ?? 0] ?? RUNGS[0]);
    return {
      ...rung,
      sizeEmu: Math.max(Math.round(subject * rung.scale), MIN_MARK_EMU),
      color: inkColor(rung.ink, theme),
      emphasized,
    };
  });
}

/** The subject's colour, for the track and anything else that follows it. */
export const dotSubjectColor = (
  spec: DotPlotSpec,
  seriesKeys: string[],
  theme: ChartTheme,
): ColorRef =>
  dotRungs(spec, seriesKeys, theme).find((r) => r.emphasized)?.color ?? theme.mutedInk;

/**
 * A rung's paint, with the series' own overrides on top.
 *
 * An authored fill wins outright, and it wins the OUTLINE too — a hollow rung
 * given a real colour becomes a filled marker in it, rather than a ring the
 * author never asked for.
 */
function paintFor(
  rung: DotRung,
  authored: Fill | undefined,
  outline: Outline | undefined,
): { fill: Fill; outline?: Outline } {
  if (authored) return { fill: authored, outline };
  if (rung.ink === 'hollow') {
    return {
      fill: { kind: 'solid', color: token('surface.base') },
      outline: outline ?? { color: rung.color, widthEmu: pointsToEmu(1), dash: 'solid' },
    };
  }
  return {
    fill: { kind: 'solid', color: rung.color, ...(rung.ink === 'accentSoft' ? { alpha: 0.55 } : {}) },
    outline,
  };
}

/* ------------------------------------------------------------------ */
/* Placement                                                          */
/* ------------------------------------------------------------------ */

export function placeDotPlot(input: DotPlotInput): Mark[] {
  const { chartId, spec, derived, proj, theme, measurer, onlySeries, uprightText } = input;
  const { horizontal } = proj;
  const centers = dotCategoryCenters(derived.categoryLabels.length);
  const seriesKeys = derived.series.map((s) => s.key);
  const rungs = dotRungs(spec, seriesKeys, theme);
  const rungOf = (i: number): DotRung => rungs[i] ?? rungs[rungs.length - 1] ?? RUNGS[0] as DotRung;
  const connector = spec.connector ?? 'range';
  const trackW = Math.max(spec.connectorWidthEmu ?? DEFAULT_TRACK, MIN_MARK_EMU);
  const trackColor = dotSubjectColor(spec, seriesKeys, theme);

  const marks: Mark[] = [];

  /** A box of `along` × `across` at (value, category), whichever way up we are. */
  const box = (value: EMU, category: EMU, along: EMU, across: EMU): Rect =>
    horizontal
      ? rectFromEdges(value - along / 2, category - across / 2, value + along / 2, category + across / 2)
      : rectFromEdges(category - across / 2, value - along / 2, category + across / 2, value + along / 2);

  /** The fill this datum was given by hand, if any. Point beats series. */
  const authoredFill = (seriesIndex: number, pointKey: string): Fill | undefined => {
    const point = derived.series[seriesIndex]?.pointOverrides?.[pointKey]?.format?.fill;
    if (point?.kind === 'solid') return point;
    const series = derived.series[seriesIndex]?.format?.fill;
    return series?.kind === 'solid' ? series : undefined;
  };

  /** The ink a LABEL takes: its own dot's colour, whatever painted it. */
  const labelInk = (seriesIndex: number, pointKey: string): ColorRef =>
    authoredFill(seriesIndex, pointKey)?.kind === 'solid'
      ? (authoredFill(seriesIndex, pointKey) as Extract<Fill, { kind: 'solid' }>).color
      : rungOf(seriesIndex).color;

  derived.categoryLabels.forEach((_, ci) => {
    const center = proj.category(centers[ci] ?? 0);
    const points = derived.data
      .filter(
        (d) =>
          d.pointIndex === ci &&
          d.value !== null &&
          (!onlySeries || onlySeries.has(d.seriesKey)) &&
          !derived.series[d.seriesIndex]?.pointOverrides?.[d.pointKey]?.hidden,
      )
      // Along the track, so the label solver below sees them in reading order.
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));

    if (!points.length) return;

    /* --- the track --- */

    const values = points.map((d) => d.value ?? 0);

    if (connector === 'range' && points.length > 1) {
      marks.push({
        kind: 'rect',
        // Not addressed to a series: the track spans all of them, and hanging
        // it off one would make "recolour this series" recolour the row.
        ref: { chartId, part: 'mark', series: 'track', point: points[0].pointKey },
        name: `${derived.categoryLabels[ci]} range`,
        rect: box(
          (proj.value(Math.min(...values)) + proj.value(Math.max(...values))) / 2,
          center,
          Math.abs(proj.value(Math.max(...values)) - proj.value(Math.min(...values))),
          trackW,
        ),
        // A tint, never the full colour: at full strength the ground competes
        // with the markers standing on it.
        fill: { kind: 'solid', color: trackColor, alpha: TRACK_ALPHA },
      });
    }

    if (connector === 'axis') {
      for (const d of points) {
        const tip = proj.value(d.value ?? 0);
        const base = proj.baseline();
        marks.push({
          kind: 'rect',
          ref: { chartId, part: 'mark', series: 'track', point: d.pointKey + '.' + d.seriesKey },
          name: `${d.seriesName} · ${d.pointLabel} stem`,
          rect: box((tip + base) / 2, center, Math.abs(tip - base), Math.max(trackW / 2, MIN_MARK_EMU)),
          fill: { kind: 'solid', color: labelInk(d.seriesIndex, d.pointKey), alpha: STEM_ALPHA },
        });
      }
    }

    /* --- the markers --- */

    for (const d of points) {
      const marker = derived.series[d.seriesIndex]?.format?.marker;
      if (marker?.shape === 'none') continue;
      const rung = rungOf(d.seriesIndex);
      const paint = paintFor(rung, authoredFill(d.seriesIndex, d.pointKey), marker?.outline);
      const size = Math.max(marker?.sizeEmu || rung.sizeEmu, MIN_MARK_EMU);
      const at = proj.value(d.value ?? 0);

      marks.push({
        kind: 'marker',
        ref: { chartId, part: 'mark', series: d.seriesKey, point: d.pointKey },
        name: `${d.seriesName} · ${d.pointLabel}`,
        shape: marker?.shape ?? rung.shape,
        rect: box(at, center, size, size),
        fill: marker?.fill ?? paint.fill,
        outline: paint.outline,
      });
    }

    /* --- the labels --- */

    /**
     * The subject's label goes on the NEAR side of the track — below it on a
     * horizontal chart — and every other label prefers the far side. It is the
     * biggest label on the chart by half again, and letting it queue for space
     * above the track with the small ones is how it ends up shouldered off its
     * own dot.
     *
     * Within a side, a label that would land on the one before it flips to the
     * other side rather than sliding along the axis: two markers a per cent
     * apart is the case a dot plot is FOR, and a label nudged along the track no
     * longer belongs to a dot.
     */
    const spans: Record<'near' | 'far', { from: EMU; to: EMU } | null> = { near: null, far: null };
    const ordered = [
      ...points.filter((d) => rungOf(d.seriesIndex).emphasized),
      ...points.filter((d) => !rungOf(d.seriesIndex).emphasized),
    ];

    for (const d of ordered) {
      const override = derived.series[d.seriesIndex]?.pointOverrides?.[d.pointKey];
      const labels = labelSpecFor(spec.decorations.labels, derived.series[d.seriesIndex]?.labels, override?.label);

      const rung = rungOf(d.seriesIndex);
      const base = labelRole(theme, labels.font);
      const value = labels.show ? labelText(labels, d, spec, values) : '';
      // A caption is authored per datum in the datasheet — "Jan '24" under the
      // baseline dot — and it draws whether or not the numbers do: turning the
      // data labels off is a decision about the numbers, not about the dates.
      const note = override?.note?.trim() ?? '';
      if (!value && !note) continue;

      /**
       * The number, then its caption, stacked away from the dot.
       *
       * One block, so a two-line label queues for space as one thing: sizing
       * the collision on the number alone is how a wide date ends up printed
       * over the next dot's, and letting the caption take a side of its own
       * would separate it from the number it dates.
       */
      const lines: { text: string; style: ReturnType<typeof textStyle>; w: EMU; h: EMU }[] = [];
      const line = (text: string, role: Parameters<typeof textStyle>[0]) => {
        if (!text) return;
        const style = textStyle(role, 'center', 'middle');
        lines.push({
          text,
          style,
          w: measurer.measure(text, style).wEmu + pointsToEmu(2),
          h: lineHeightEmu(style),
        });
      };

      // The subject's number is set in the emphasis face — sans and heavy,
      // like a line chart's emphasised end label — at half again the size, and
      // in its own dot's colour. Those three together are what make "75%" read
      // as the answer rather than as one more data label.
      const role = rung.emphasized
        ? {
            ...theme.text.endLabelEmphasis,
            ...fontOver(labels.font),
            sizePt: labels.font?.sizePt ?? base.sizePt * EMPHASIS_TYPE_SCALE,
          }
        : base;
      line(value, {
        ...role,
        // Its own dot's ink, subject or not: a label the same grey as the
        // marker it names is what lets a three-dot track drop its legend.
        color: labels.font?.color ?? labelInk(d.seriesIndex, d.pointKey),
      });
      // Muted and smaller, whichever dot it belongs to, and never the dot's
      // colour: the caption is instrumentation, and a date set in the subject's
      // accent competes with the number that IS the answer.
      line(note, {
        ...base,
        sizePt: base.sizePt * NOTE_TYPE_SCALE,
        bold: false,
        color: theme.mutedInk,
      });

      const marker = derived.series[d.seriesIndex]?.format?.marker;
      const size = marker?.sizeEmu || rung.sizeEmu;
      const at = proj.value(d.value ?? 0);
      // The block's extent ALONG the track, which is what two neighbouring
      // labels collide over. A turned chart stands its labels back up, so the
      // footprint and the box swap — see `uprightText`.
      const along = Math.max(
        ...lines.map((l) => (horizontal ? (uprightText ? l.h : l.w) : uprightText ? l.w : l.h)),
      );
      const span = { from: at - along / 2, to: at + along / 2 };
      const clear = (side: 'near' | 'far') => {
        const prev = spans[side];
        return !prev || prev.to <= span.from || span.to <= prev.from;
      };

      // `far` is above the track on a horizontal chart and left of it on a
      // vertical one: perpendicular to the value axis, so a label never sits
      // between a marker and the number it is nearest to.
      const wants: 'near' | 'far' =
        rung.emphasized || labels.placement === 'below' || labels.placement === 'left'
          ? 'near'
          : 'far';
      const side = clear(wants) ? wants : wants === 'far' ? 'near' : 'far';
      spans[side] = span;

      // Away from the dot, line after line: the number sits at the label gap
      // and the caption beyond it, so adding a date never moves the number.
      const outward = (side === 'near' ? 1 : -1) * (horizontal ? 1 : -1);
      let reach = size / 2 + theme.sizes.labelGapEmu;

      lines.forEach((l, li) => {
        const across = center + outward * (reach + (horizontal ? l.h : l.w) / 2);
        reach += horizontal ? l.h : l.w;
        marks.push({
          kind: 'text',
          // The caption is addressed as a label of its own — a suffixed point,
          // like the stems above — so selecting a date on the canvas can't be
          // mistaken for selecting the number beside it.
          ref: {
            chartId,
            part: 'label',
            series: d.seriesKey,
            point: li === 0 && value ? d.pointKey : d.pointKey + '.note',
          },
          text: l.text,
          style: l.style,
          rect: horizontal
            ? { x: Math.round(at - l.w / 2), y: Math.round(across - l.h / 2), w: l.w, h: l.h }
            : { x: Math.round(across - l.w / 2), y: Math.round(at - l.h / 2), w: l.w, h: l.h },
        });
      });
    }
  });

  return marks;
}

/** How much bigger the subject's number is set than its comparators'. */
const EMPHASIS_TYPE_SCALE = 1.5;

/**
 * How much smaller a per-datum caption is set than the number it dates.
 *
 * Small enough to read as a footnote at a glance, not so small that a date
 * printed on a slide stops being legible from the back of the room.
 */
const NOTE_TYPE_SCALE = 0.85;

/** Same resolution as `placeColumnBar`'s: the content kind decides the text. */
function labelText(
  label: LabelSpec,
  d: GridDerived['data'][number],
  spec: DotPlotSpec,
  peers: number[],
): string {
  const fmt = label.numberFormat ?? spec.numberFormat;
  const render = (c: LabelSpec['content']): string => {
    switch (c.kind) {
      case 'value':
        return formatNumber(d.labelValue, fmt, { peers }).text;
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
