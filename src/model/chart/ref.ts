/**
 * The reverse map from a compiled primitive back to the spec node that made it.
 *
 * This is what lets every gesture on the canvas write to the SPEC rather than
 * to the element. Recoloring a bar has to become a `PointOverride`, not a fill
 * on that rect — the next recompile would erase the fill, and the datasheet and
 * the canvas would disagree about what the chart says. One address type, one
 * command surface.
 */
import type { AxisId } from './spec';

export type ChartRef =
  | { chartId: string; part: 'plot' | 'title' | 'legend.box' }
  | { chartId: string; part: 'mark'; series: string; point: string }
  | { chartId: string; part: 'label'; series: string; point: string }
  | { chartId: string; part: 'total'; point: string }
  | {
      chartId: string;
      part: 'axis';
      axis: AxisId;
      // `tick` is the NUMBER; `tickMark` is the little rule beside it.
      sub: 'line' | 'title' | 'tick' | 'tickMark' | 'grid' | 'unitNote';
      i?: number;
      /**
       * Which ROW of a multi-level axis header this belongs to, coarsest first.
       *
       * A Gantt's timescale is a stack of bands — which quarter over which
       * month — and both bands number their cells from zero. Without this the
       * year band's cell 0 and the month band's cell 0 mint the same element
       * id, and `reconcileChartElements` diffs on ids: one whole band would
       * vanish, silently. Unset on every single-row axis, which is all of them
       * but this one.
       */
      tier?: number;
    }
  | { chartId: string; part: 'legend.item'; series: string }
  | { chartId: string; part: 'decoration'; decoId: string; sub?: string }
  /**
   * A Gantt's row furniture: its name in the table, the tint behind it, and the
   * rule under it.
   *
   * The BARS are not here — they are `mark`s addressed `series: rowKey,
   * point: itemKey`, which is what makes every existing gesture work on them:
   * `applyChartFormat`'s "every point of a series selected means the series
   * changed" becomes "recolour every bar in a row and the ROW takes the colour,
   * so a bar added later matches", and `shiftClickParts` already narrows a
   * range to one series, so shift-clicking two bars in a row selects that row
   * alone with no new selection code at all.
   */
  | { chartId: string; part: 'gantt.row'; row: string; sub: 'label' | 'band' | 'divider' }
  /** A description table cell, or the heading over its column. */
  | { chartId: string; part: 'gantt.column'; column: string; sub: 'header' | 'cell'; row?: string }
  /**
   * A full-height stripe over the plot: the non-working days, and the today
   * rule.
   *
   * Its OWN part rather than a `decoration`, and that is load-bearing rather
   * than tidiness: `previewHitTest` ranks a decoration at 0 — the most specific
   * class there is — so weekend shading routed through it would win the click
   * over every bar it crosses.
   */
  | { chartId: string; part: 'gantt.band'; sub: 'weekend' | 'holiday' | 'today'; i?: number };

export type ChartPart = ChartRef['part'];

/**
 * The deterministic element id for a part. Ids MUST be stable across
 * recompiles: `reconcileChartElements` diffs on them, and a fresh id every
 * keystroke would blow away z-order, selection and React's reconciliation.
 */
export function partKey(ref: ChartRef): string {
  switch (ref.part) {
    case 'plot':
    case 'title':
    case 'legend.box':
      return ref.part;
    case 'mark':
      return `mark.${ref.series}.${ref.point}`;
    case 'label':
      return `label.${ref.series}.${ref.point}`;
    case 'total':
      return `total.${ref.point}`;
    case 'axis': {
      const tier = ref.tier === undefined ? '' : `.t${ref.tier}`;
      return ref.i === undefined
        ? `axis.${ref.axis}.${ref.sub}${tier}`
        : `axis.${ref.axis}.${ref.sub}${tier}.${ref.i}`;
    }
    case 'legend.item':
      return `legend.item.${ref.series}`;
    case 'decoration':
      return ref.sub ? `deco.${ref.decoId}.${ref.sub}` : `deco.${ref.decoId}`;
    case 'gantt.row':
      return `row.${ref.sub}.${ref.row}`;
    case 'gantt.column':
      return ref.sub === 'header' ? `head.${ref.column}` : `cell.${ref.column}.${ref.row}`;
    case 'gantt.band':
      return ref.i === undefined ? `band.${ref.sub}` : `band.${ref.sub}.${ref.i}`;
  }
}

export const elementIdFor = (ref: ChartRef): string =>
  `${ref.chartId}::${partKey(ref)}`;

/**
 * What a part IS, for the purpose of formatting several at once.
 *
 * Coarser than `partKey`, which addresses one node: every bar in the chart is
 * one kind, every data label is another. This is what a shift-click gathers, so
 * "make these three labels 14pt" is one gesture and one edit — and the panel
 * that opens is always about a single kind, rather than the intersection of a
 * bar, a tick and a legend key, which is nothing.
 *
 * The axis is split by which axis and which piece of it: the y ticks and the x
 * ticks are different populations, and so are a tick and the axis title.
 */
export function partKind(ref: ChartRef): string {
  switch (ref.part) {
    case 'axis':
      return `axis.${ref.axis}.${ref.sub}`;
    case 'decoration':
      return `decoration.${ref.sub ?? ''}`;
    case 'gantt.row':
      return `gantt.row.${ref.sub}`;
    // Split PER COLUMN: a shift-range that wandered sideways across a table
    // would be a rectangle nobody asked for. The only run that means anything
    // in a table is the one down a single column.
    case 'gantt.column':
      return ref.sub === 'header' ? 'gantt.column.header' : `gantt.column.cell.${ref.column}`;
    case 'gantt.band':
      return `gantt.band.${ref.sub}`;
    default:
      return ref.part;
  }
}

/** The chart an element belongs to, from its id alone. */
export function chartIdOfElementId(id: string): string | null {
  const i = id.indexOf('::');
  return i > 0 ? id.slice(0, i) : null;
}

/**
 * The data series a legend entry stands for.
 *
 * A legend entry is TWO marks — the swatch and its text — and their ids have to
 * differ, so the text's ref carries a `.label`-suffixed series key (see
 * `legendMarks`). That suffix is an id device, not a series: anything asking
 * "which series did the user just click?" must strip it, or it looks up a series
 * that doesn't exist and silently finds nothing.
 */
export const legendSeriesKey = (
  ref: Extract<ChartRef, { part: 'legend.item' }>,
): string => (ref.series.endsWith('.label') ? ref.series.slice(0, -'.label'.length) : ref.series);

/** True when this ref addresses a single data point (bar, marker, slice). */
export const isPointRef = (
  ref: ChartRef,
): ref is Extract<ChartRef, { part: 'mark' | 'label' }> =>
  ref.part === 'mark' || ref.part === 'label';
