/**
 * Which node's TYPE does this chart selection edit?
 *
 * Two surfaces ask it — the popover beside the part and the format bar above
 * the slide — and `markCaps.ts` says why that means it gets answered once: the
 * two panels drifted the last time a question was answered twice. The answer is
 * never "the element you clicked": a data label's size lives on the series (or
 * on one point of it), an axis number's on the axis, a callout's on the callout.
 * See `ChartRef` — every control writes to the SPEC, never to the rectangle.
 *
 * A part with no text on screen returns null rather than a no-op target: a size
 * dropdown that writes to a hidden label is worse than a missing one.
 */
import {
  FONTS,
  type ChartRef,
  type ChartSpec,
  type DesignSystem,
  type FontFamily,
  type LabelFont,
} from '@/model';
import { resolveChartTheme, type ChartTheme } from '@/chart/theme';
import { labelHomeFor, labelSpecAt, patchLabelAt } from '@/store/chartActions';
import { markCapabilities, markRender } from './markCaps';

/**
 * A decoration that puts TEXT on the plot, and which kind it is.
 *
 * Four unrelated nodes share one `part: 'decoration'` ref, and three of them
 * name their string `label` while a callout names it `text` — so a caller needs
 * the kind back, not just the node.
 */
export type TextDeco =
  | { kind: 'annotation'; node: ChartSpec['decorations']['annotations'][number] }
  | { kind: 'cagr'; node: ChartSpec['decorations']['cagr'][number] }
  | { kind: 'difference'; node: ChartSpec['decorations']['differences'][number] }
  | { kind: 'reference'; node: ChartSpec['decorations']['referenceLines'][number] };

/**
 * The writable face all four share, so one patcher serves them.
 *
 * Every field optional on purpose: that is what makes all four node types
 * assignable to it, and it means a caller writes `text` on a callout and
 * `label` on an arrow without a cast in either direction.
 */
export type TextDecoDraft = {
  label?: string;
  text?: string;
  connector?: boolean;
  font?: LabelFont;
};

/**
 * The pieces a bracket and a callout's leader are drawn from carry a DERIVED
 * id — `${id}-l`, `${id}-lead` — so clicking the left arm of a bracket has to
 * resolve back to the arrow it belongs to rather than finding nothing.
 */
const DERIVED_SUFFIX = /-(l|t|r|lead)$/;

export function findTextDeco(spec: ChartSpec, decoId: string): TextDeco | undefined {
  const d = spec.decorations;
  for (const id of [decoId, decoId.replace(DERIVED_SUFFIX, '')]) {
    const note = d.annotations.find((x) => x.id === id);
    if (note) return { kind: 'annotation', node: note };
    const cagr = d.cagr.find((x) => x.id === id);
    if (cagr) return { kind: 'cagr', node: cagr };
    const diff = d.differences.find((x) => x.id === id);
    if (diff) return { kind: 'difference', node: diff };
    const rule = d.referenceLines.find((x) => x.id === id);
    if (rule) return { kind: 'reference', node: rule };
  }
  return undefined;
}

export const textDecoName = (kind: TextDeco['kind']): string =>
  kind === 'annotation'
    ? 'Annotation'
    : kind === 'cagr'
      ? 'CAGR label'
      : kind === 'difference'
        ? 'Difference label'
        : 'Reference label';

/**
 * The three allowed faces — see `fonts.ts`, where the tiny list is the point.
 *
 * Shared by both chart surfaces: the popover shows each in its own face, the
 * format bar shows the family name, and neither invents a fourth.
 */
export const CHART_FACES: { value: FontFamily; label: string; css: string }[] = [
  { value: 'Geist', label: 'Sans', css: FONTS.Geist.cssStack },
  { value: 'Source Serif 4', label: 'Serif', css: FONTS['Source Serif 4'].cssStack },
  { value: 'Geist Mono', label: 'Mono', css: FONTS['Geist Mono'].cssStack },
];

/**
 * The type sizes both chart surfaces offer. Blank means the brand's.
 *
 * A short ladder rather than a spinner, and it tops out well below the text
 * box's 96pt: chart type competes with the data, not with the headline.
 */
export const CHART_TYPE_SIZES = [7, 8, 9, 10, 11, 12, 14, 16, 18, 24];

/** Which of the theme's type roles this part is drawn in. */
export type ChartTextRoleName = keyof ChartTheme['text'];

/** The type the selection edits: what it belongs to, what it says now, how to change it. */
export interface PartFont {
  /** What the type belongs to, for a tooltip — 'Data label', 'Y axis labels'. */
  name: string;
  /** The override in force. Undefined means the brand's is still standing. */
  font: LabelFont | undefined;
  /**
   * The brand role this part falls through to, so a panel can show what the
   * part is ACTUALLY drawn in rather than the word "inherited". See
   * `resolvedType`.
   */
  role: ChartTextRoleName;
  /** Mutates a DRAFT spec in place; call it inside `patchChart`. */
  apply: (draft: ChartSpec, patch: Partial<LabelFont>) => void;
}

/**
 * The face, size and weight this part is drawn in right now — override first,
 * the brand's role behind it.
 *
 * A panel that showed the override alone had to write "Brand" or "Auto" in the
 * dropdown for the (usual) case of no override, which tells the reader nothing:
 * the whole question they opened it to answer is what font the thing IS. The
 * text-box bar has always resolved this — `fontChoiceIdOf(run, ds.fonts.body)`
 * — and this is the same move for a chart, whose roles differ per part: the
 * ticks are mono, the legend is sans.
 */
export function resolvedType(
  spec: ChartSpec,
  ds: DesignSystem,
  part: PartFont,
): { font: FontFamily; sizePt: number; bold: boolean; italic: boolean } {
  const role = resolveChartTheme(spec, ds).text[part.role];
  return {
    font: part.font?.font ?? role.font,
    sizePt: part.font?.sizePt ?? role.sizePt,
    bold: part.font?.bold ?? role.bold ?? false,
    italic: part.font?.italic ?? role.italic ?? false,
  };
}

const merged = (cur: LabelFont | undefined, patch: Partial<LabelFont>): LabelFont => ({
  ...cur,
  ...patch,
});

/**
 * The text node a selection of chart parts formats, or null when it has none.
 *
 * Reads the FIRST ref for the part: both selection paths — `shiftClickParts`
 * and `toggleClickParts` — refuse to mix kinds, so a selection is one kind of
 * thing throughout, and a data-label selection spanning several points is
 * handled by `dataLabelFont` rather than by looking at each ref's part again.
 */
export function partFontOf(spec: ChartSpec, refs: ChartRef[]): PartFont | null {
  const first = refs[0];
  if (!first) return null;

  switch (first.part) {
    case 'title':
      return {
        name: 'Chart title',
        font: spec.titleFont,
        role: 'title',
        apply: (d, p) => (d.titleFont = merged(d.titleFont, p)),
      };

    case 'axis': {
      // The rule and its tick marks carry no text; only the numbers, the title
      // and the unit note beside them do.
      if (first.sub !== 'tick' && first.sub !== 'title' && first.sub !== 'unitNote') return null;
      const axis = first.axis;
      const name =
        first.sub === 'tick'
          ? `${axis.toUpperCase()} axis labels`
          : first.sub === 'title'
            ? 'Axis title'
            : 'Axis units';
      return {
        name,
        font: spec.axes[axis]?.font,
        // The category axis has its own role — a size and a half above the
        // value axis's ticks, which is why they can't share one entry.
        role: first.sub !== 'tick' ? 'axisTitle' : axis === 'x' ? 'category' : 'tick',
        apply: (d, p) => {
          const a = d.axes[axis];
          if (a) a.font = merged(a.font, p);
        },
      };
    }

    case 'legend.item':
    case 'legend.box':
      return {
        name: 'Legend',
        font: spec.legend.font,
        role: 'legend',
        apply: (d, p) => (d.legend.font = merged(d.legend.font, p)),
      };

    case 'total': {
      // Totals off means there is no total on screen to retype.
      if (!spec.decorations.totals?.show) return null;
      return {
        name: 'Total labels',
        font: spec.decorations.totals.font,
        role: 'totalLabel',
        apply: (d, p) => {
          if (d.decorations.totals) d.decorations.totals.font = merged(d.decorations.totals.font, p);
        },
      };
    }

    case 'decoration': {
      const deco = findTextDeco(spec, first.decoId);
      if (!deco) return null;
      const id = deco.node.id;
      return {
        name: textDecoName(deco.kind),
        font: deco.node.font,
        // An arrow's label is drawn on a plate in the total's role; a callout
        // and a reference-line label take the data label's. See `annotations.ts`.
        role: deco.kind === 'cagr' || deco.kind === 'difference' ? 'totalLabel' : 'dataLabel',
        // By id rather than by object identity: the draft is a fresh tree, so
        // the node has to be found again in it.
        apply: (d, p) => {
          const found = findTextDeco(d, id);
          if (found) (found.node as TextDecoDraft).font = merged(found.node.font, p);
        },
      };
    }

    case 'mark':
    case 'label':
      return dataLabelFont(spec, refs);

    default:
      return null;
  }
}

/**
 * A data label's type, filed on the narrowest node that owns it.
 *
 * `labelHomeFor` decides the node, because it already knows the three rules a
 * hand-rolled "group by series, sweep the categories" version gets wrong: a
 * line chart's `end` label belongs to the series (`pointOverrides.end` is read
 * by nobody), a waterfall has ITEMS rather than series so the item is the
 * narrowest node there is, and a shape with nothing narrower than itself — a
 * sankey — lands on the chart. Getting the second one wrong is why a selected
 * waterfall label had no type controls at all.
 *
 * What is left here is the capability gate: whether there is text on screen for
 * the type to change.
 */
function dataLabelFont(spec: ChartSpec, refs: ChartRef[]): PartFont | null {
  const home = labelHomeFor(spec, refs);
  if (!home) return null;

  const render = markRender(spec, refs[0]!);
  const caps = render ? markCapabilities(spec, render) : null;
  if (!caps || caps.labels === 'none') return null;

  // An end label is drawn from `spec.endLabels`, not from `labels.show` — and
  // on a line chart that flag is off by default, so gating it on `show` would
  // leave the one piece of text a line HAS with no controls.
  const endOnly = caps.labels === 'end';
  if (endOnly && !(spec.kind === 'line' && spec.endLabels)) return null;

  const effective = labelSpecAt(spec, home);
  // Labels off means nothing on screen for a size or an ink to change.
  if (!endOnly && !effective.show) return null;

  return {
    name: endOnly ? 'Series name' : 'Data label',
    font: effective.font,
    role: endOnly ? 'endLabel' : 'dataLabel',
    // A home is keys, not object references, so it reads the same on the draft.
    // Merged onto the font in force AT the home so a change compounds rather
    // than replacing what the node above contributed.
    apply: (d, p) =>
      void patchLabelAt(d, home, { font: merged(labelSpecAt(d, home).font, p) }),
  };
}
