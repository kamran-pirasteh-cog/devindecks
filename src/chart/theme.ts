/**
 * The resolved look of a chart: palette, ink, fonts and sizes.
 *
 * Resolved from `DesignSystem.chart` — the brand's opinion — with the spec's
 * own overrides on top. Placers only ever read a `ChartTheme`, so where a
 * value came from is entirely this file's business.
 */
import { FALLBACK_PALETTE, hex, token, withChartStyleDefaults } from '@/model';
import type {
  ChartSpec,
  ChartStyle,
  ColorRef,
  DashStyle,
  DesignSystem,
  EMU,
  FontFamily,
  LabelFont,
  TypeRoleRef,
} from '@/model';
import { pointsToEmu, resolveColor } from '@/model';
import { buildRamp, inkOn, isTooPale, shadeOf, tooSimilar } from './color';

export interface ChartTextRole {
  font: FontFamily;
  sizePt: number;
  bold?: boolean;
  /**
   * Numeric weight. Charts lean on Medium (500) constantly — a data label has
   * to out-weigh a tick label without shouting the way bold does — and the run
   * model, the renderer and the .pptx exporter all already carry weight.
   */
  weight?: number;
  color: ColorRef;
  /** Uppercased before measurement and emit — see `displayText`. */
  caps?: boolean;
}

export interface ChartTheme {
  palette: ColorRef[];
  axisLine: ColorRef;
  gridline: ColorRef;
  gridlineDash: DashStyle;
  /**
   * The brand's gridline rule. A spec may override it per chart, but when it
   * doesn't, editing this in Admin reflows every existing chart — which is the
   * whole point of putting chart style on the design system.
   */
  gridlines: { major: boolean; minor: boolean };
  plotBackground?: ColorRef;
  /**
   * The grey everything that isn't the point recedes to: annotations, and the
   * comparator lines of a line chart.
   */
  mutedInk: ColorRef;
  /**
   * The brand's strong ink. Marks that are STRUCTURE rather than data draw in
   * it — a Sankey's node bars are gates the flow passes through, not one more
   * category competing with the ribbons for a palette slot.
   */
  strongInk: ColorRef;
  text: {
    tick: ChartTextRole;
    category: ChartTextRole;
    axisTitle: ChartTextRole;
    dataLabel: ChartTextRole;
    totalLabel: ChartTextRole;
    /**
     * A series label at the end of a line. Mono and mixed-case, unlike the rest
     * of the annotation set: it carries a NAME as well as a number, and a column
     * of uppercased series names reads as shouting rather than as instrumentation.
     * Its colour is overridden per series by the placer.
     */
    endLabel: ChartTextRole;
    /** The end label of the emphasised line: the sans face, and heavy. */
    endLabelEmphasis: ChartTextRole;
    legend: ChartTextRole;
    title: ChartTextRole;
  };
  sizes: {
    axisWidthEmu: EMU;
    gridlineWidthEmu: EMU;
    legendSwatchEmu: EMU;
    /** Breathing room between a label and the mark it belongs to. */
    labelGapEmu: EMU;
    /** Space between the plot and the tick labels beside it. */
    axisGapEmu: EMU;
  };
  /** The colour series `i` draws in, honouring the brand's overflow rule. */
  seriesColor(i: number): ColorRef;
  /** A `ColorRef` as a concrete hex, against the design system in force. */
  resolve(ref: ColorRef): string;
  /**
   * The ink a label must use to sit legibly ON `fill`.
   *
   * Any label placed inside a mark has to ask — a data label centred in a
   * saturated segment is the single most visible way a chart looks broken.
   */
  inkOn(fill: ColorRef): ColorRef;
}

/** Series colours must never be near-white; they'd vanish into the slide. */
const legible = (h: string) => !isTooPale(h);

/**
 * Series colours. Three sources, most specific first:
 *
 * 1. the spec's own palette, so one chart can deviate deliberately;
 * 2. the brand's `paletteTokenIds`, filtered for legibility — an admin can
 *    pick a near-white token by accident and must not get invisible bars;
 * 3. a ramp built from the brand's accent.
 *
 * (3) returns hex rather than token refs, which looks like it breaks the
 * "tokens, never hex" rule. It doesn't: the ramp is DERIVED from the design
 * system on every compile and never stored on a spec, so editing the brand
 * still reflows every chart at once. What it avoids is the previous
 * behaviour — scavenging whatever tokens happened to exist, which handed
 * series three and four the muted-grey and hairline-border tokens.
 */
export function resolvePalette(spec: ChartSpec, ds: DesignSystem): ColorRef[] {
  if (spec.palette?.length) return spec.palette;

  const style = withChartStyleDefaults(ds.chart);
  const branded = style.paletteTokenIds
    .map((id) => ds.colors.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c && legible(c.hex));

  // Two adjacent series the reader can't tell apart are worse than a palette
  // one colour shorter, whoever chose them.
  const distinct: typeof branded = [];
  for (const c of branded) {
    if (distinct.some((k) => tooSimilar(k.hex, c.hex))) continue;
    distinct.push(c);
  }
  if (distinct.length) return distinct.map((c) => token(c.id));

  const seed = seedColor(ds);
  return seed ? buildRamp(seed, 6).map(hex) : FALLBACK_PALETTE;
}

/** The brand colour a generated ramp is built around. */
function seedColor(ds: DesignSystem): string | null {
  for (const id of ['brand.accent', 'brand.primary', 'ink.strong']) {
    const found = ds.colors.find((c) => c.id === id);
    if (found && legible(found.hex)) return found.hex;
  }
  const any = ds.colors.find((c) => !c.id.startsWith('surface.') && legible(c.hex));
  return any?.hex ?? null;
}

/**
 * Cycle the palette when a chart has more series than it has colours.
 *
 * Kept for callers that only hold a palette; prefer `theme.seriesColor`, which
 * also honours the brand's `paletteOverflow` rule.
 */
export const paletteColor = (palette: ColorRef[], i: number): ColorRef =>
  palette[((i % palette.length) + palette.length) % palette.length] ?? FALLBACK_PALETTE[0];

/**
 * Chart text is never the prose face.
 *
 * Type roles exist for prose — a serif body role is a deliberate choice for
 * paragraphs and a bad one for a column of axis numbers, where the job is to be
 * legible at 9pt and to disappear. Charts take their SIZE from the design system
 * and pin the family.
 *
 * Titles and legends get the sans; everything that annotates the data — ticks,
 * category names, data labels, totals — gets MONO, UPPERCASE and MUTED. Mono
 * because a column of figures that doesn't align digit-to-digit is harder to
 * compare than one that does, and because it reads as instrumentation rather
 * than as prose. Muted and uppercase because these are annotations on the data,
 * not the data: the marks should carry the colour and the weight.
 */
const CHART_FONT: FontFamily = 'Geist';
const LABEL_FONT: FontFamily = 'Geist Mono';

/** The annotation treatment, applied on top of a design-system role. */
const ANNOTATION = { font: LABEL_FONT, caps: true } as const;

/**
 * A spec's own font override, as a partial role. Written out field by field
 * because a spread of the whole `LabelFont` would set `color: undefined` and
 * wipe the resolved token.
 */
function fontOver(font?: LabelFont): Partial<ChartTextRole> {
  if (!font) return {};
  return {
    ...(font.sizePt !== undefined ? { sizePt: font.sizePt } : {}),
    ...(font.bold !== undefined ? { bold: font.bold } : {}),
    ...(font.color !== undefined ? { color: font.color } : {}),
    ...(font.font !== undefined ? { font: font.font } : {}),
  };
}

/** A design-system type role plus the style's local tweaks. */
function textRole(ds: DesignSystem, ref: TypeRoleRef, over: Partial<ChartTextRole> = {}): ChartTextRole {
  const base = ds.type[ref.role];
  return {
    font: CHART_FONT,
    sizePt: ref.sizePt ?? base.sizePt,
    bold: ref.bold ?? base.bold,
    weight: ref.weight,
    color: token(base.colorToken),
    ...over,
  };
}

export function resolveChartTheme(spec: ChartSpec, ds: DesignSystem): ChartTheme {
  const style: ChartStyle = withChartStyleDefaults(ds.chart);
  const ink = ds.colors.some((c) => c.id === 'ink.strong') ? token('ink.strong') : token('brand.primary');
  // Grey for every annotation. Falls back to the strong ink rather than
  // inventing a hex, so a design system without a muted token still reads.
  const muted = ds.colors.some((c) => c.id === 'ink.muted') ? token('ink.muted') : ink;
  const palette = resolvePalette(spec, ds);
  const resolve = (ref: ColorRef) => resolveColor(ref, ds);

  return {
    palette,
    axisLine: token(style.axis.lineTokenId),
    gridline: token(style.gridlines.tokenId),
    gridlineDash: style.gridlines.dash,
    mutedInk: muted,
    strongInk: ink,
    gridlines: {
      major: style.gridlines.horizontal !== 'none',
      minor: style.gridlines.horizontal === 'major+minor',
    },
    text: {
      // The value axis's own font override reaches its ticks and its title; the
      // category axis's reaches the category names. Both fall through to the
      // brand when the chart has no opinion.
      tick: textRole(ds, style.fonts.axis, {
        ...ANNOTATION,
        color: muted,
        ...fontOver(spec.axes?.y?.font),
      }),
      category: textRole(ds, style.fonts.axis, {
        ...ANNOTATION,
        sizePt: (style.fonts.axis.sizePt ?? 9) + 1.5,
        color: muted,
        ...fontOver(spec.axes?.x?.font),
      }),
      axisTitle: textRole(ds, style.fonts.axis, {
        ...ANNOTATION,
        sizePt: (style.fonts.axis.sizePt ?? 9) + 0.5,
        weight: 500,
        color: muted,
        ...fontOver(spec.axes?.y?.font),
      }),
      dataLabel: textRole(ds, style.fonts.dataLabel, { ...ANNOTATION, color: muted }),
      endLabel: textRole(ds, style.fonts.dataLabel, {
        font: LABEL_FONT,
        weight: 500,
        color: muted,
      }),
      endLabelEmphasis: textRole(ds, style.fonts.dataLabel, {
        font: CHART_FONT,
        sizePt: (style.fonts.dataLabel.sizePt ?? 10.5) + 0.5,
        weight: 700,
        color: ink,
      }),
      totalLabel: textRole(ds, style.fonts.dataLabel, {
        ...ANNOTATION,
        sizePt: (style.fonts.dataLabel.sizePt ?? 10.5) + 0.5,
        weight: 600,
        color: muted,
      }),
      legend: textRole(ds, style.fonts.legend, fontOver(spec.legend?.font)),
      title: textRole(ds, style.fonts.title, { color: ink, ...fontOver(spec.titleFont) }),
    },
    sizes: {
      axisWidthEmu: pointsToEmu(0.75),
      gridlineWidthEmu: pointsToEmu(0.5),
      legendSwatchEmu: pointsToEmu(7),
      labelGapEmu: pointsToEmu(3),
      axisGapEmu: pointsToEmu(5),
    },
    seriesColor(i: number): ColorRef {
      const n = palette.length;
      if (n === 0) return FALLBACK_PALETTE[0];
      const index = ((i % n) + n) % n;
      const base = palette[index];
      if (style.paletteOverflow !== 'shade') return base;
      // Series 9 in a 5-colour palette should be a SHADE of series 4, not an
      // exact repeat of it — otherwise the legend has two identical swatches.
      const cycle = Math.floor(((i % (n * 8)) + n * 8) % (n * 8) / n);
      return cycle === 0 ? base : hex(shadeOf(resolve(base), cycle));
    },
    resolve,
    inkOn(fill: ColorRef): ColorRef {
      return hex(inkOn(resolve(fill)));
    },
  };
}

/**
 * Should this chart draw gridlines? The spec wins when it has an opinion;
 * otherwise the brand decides, so a design-system edit reaches charts nobody
 * has touched since.
 */
export const showsGridlines = (spec: ChartSpec, ds: DesignSystem): boolean =>
  spec.decorations.gridlines.major?.show ?? resolveChartTheme(spec, ds).gridlines.major;
