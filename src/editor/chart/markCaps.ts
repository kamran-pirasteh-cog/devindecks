/**
 * What a chart's series can be TOLD, part by part.
 *
 * Both format surfaces — the toolbar over a drilled-in chart and the popover
 * beside a selected part — have to answer the same question before they draw a
 * single control: does this control do anything to THIS mark? Answering it twice
 * is how the two panels drifted apart, so it is answered here once.
 */
import { isGanttSpec, type ChartRef, type ChartSpec, type LabelPlacement } from '@/model';

/**
 * How a mark is DRAWN, which is what decides its options.
 *
 * A combo chart's series are not all the same shape — one is a column and the
 * next is a line over it — so the panel can't read this off `spec.kind`. A
 * line's options (weight, dash, dots) are meaningless on a bar, and offering
 * them is worse than not offering them: they write to the spec and nothing on
 * screen moves.
 */
export type MarkRender =
  | 'column'
  | 'line'
  | 'area'
  | 'point'
  | 'dot'
  | 'slice'
  /**
   * A Gantt's marks, one class per shape.
   *
   * NOT one `'gantt'` class. A milestone and a bracket differ in exactly the
   * controls this file exists to gate — a bracket is a stroke with no fill and
   * no vertices, a milestone is a marker with no span — and collapsing them
   * recreates the failure the file was written to prevent: a control that
   * writes to the spec and moves nothing on screen.
   */
  | 'gantt.bar'
  | 'gantt.chevron'
  | 'gantt.milestone'
  | 'gantt.summary'
  | 'gantt.bracket';

export function seriesRender(spec: ChartSpec, key: string): MarkRender {
  switch (spec.kind) {
    case 'line':
      return 'line';
    // A dot plot's mark is a marker with a label beside it — a filled shape
    // whose SIZE and shape are the paint, and which carries a per-point label
    // it chooses the content of.
    case 'dotplot':
      return 'dot';
    case 'area':
      return 'area';
    case 'combo':
      return spec.render[key] ?? 'column';
    case 'scatter':
    case 'bubble':
      return 'point';
    case 'pie':
    case 'donut':
      return 'slice';
    default:
      return 'column';
  }
}

/**
 * How the mark this REF addresses is drawn.
 *
 * The entry point to prefer. `seriesRender` answers per series, which is as
 * fine as any kind here needs — but it is the series that varies on a combo,
 * and a kind whose marks differ WITHIN a series has no series-level answer to
 * give. Routing both panels through the ref means such a kind is a case here
 * rather than a second dispatch beside every control.
 */
export function markRender(spec: ChartSpec, ref: ChartRef): MarkRender | null {
  if (ref.part !== 'mark' && ref.part !== 'label' && ref.part !== 'legend.item') return null;
  // A Gantt's row holds several shapes at once, so the answer is per ITEM. This
  // is the case `seriesRender` structurally cannot give.
  if (isGanttSpec(spec) && ref.part !== 'legend.item') {
    const item = spec.items.find((i) => i.key === ref.point);
    return item ? (`gantt.${item.shape.form}` as MarkRender) : 'gantt.bar';
  }
  return seriesRender(spec, ref.series);
}

/**
 * What the selected mark can actually be told to do.
 *
 * The panel's one rule is that no control writes to the spec without moving
 * something on screen, and honouring it takes TWO facts that don't come from
 * the same place. How the mark is drawn decides the paint: a stroked path has a
 * weight, a dash and dots; a filled shape has a fill and a border. Which placer
 * drew it decides the text: only `placeColumnBar` reads `LabelPlacement`, only
 * a line chart draws end labels, and `placeLineArea` draws no per-point label
 * at all — so a line's "Place inside base" was a control that could only ever
 * do nothing.
 *
 * Reading `spec.kind` alone gets a combo chart's line series wrong; reading
 * `render` alone offers a pie a placement it ignores. Hence both.
 */
export interface MarkCapabilities {
  /** A stroked path — weight, dash and dots ARE the mark. */
  stroked: boolean;
  /** A filled shape — a fill, and a border it can carry. */
  filled: boolean;
  /**
   * Which text this mark has: a label per point, one end label for the whole
   * series (a line chart's), or none, which is a combo's line and every area.
   */
  labels: 'point' | 'end' | 'none';
  /** Whether the placer honours `LabelPlacement`. */
  placement: boolean;
  /** Whether the label's text is chosen rather than fixed by the placer. */
  content: boolean;
  /**
   * Whether a marker shape and size ARE part of this mark.
   *
   * Not the same question as `stroked`, though every mark that is stroked today
   * also carries dots. They come apart the moment a stroked mark is a rule
   * rather than a data path — an outline with no vertices has nowhere to put a
   * dot, and offering the picker there writes a `MarkerFormat` nothing reads.
   */
  marker: boolean;
  /**
   * The silhouette is a choice rather than fixed by the placer. Unset means no.
   */
  shape?: boolean;
  /** Corner radius. Only where the silhouette has corners to round. */
  rounding?: boolean;
  /**
   * Which placements this placer HONOURS, when that is narrower or wider than
   * the panels' default five. Unset means the default set.
   *
   * It exists because the default set is itself a claim about the placers —
   * that none of them distinguishes `left` from `right` — and a placer that
   * does would otherwise be given a control that lies.
   */
  placements?: LabelPlacement[];
  /** The mark occupies a span along the value axis, so it has two ends. */
  spans?: boolean;
}

/**
 * The placements a Gantt bar honours.
 *
 * The first mark here that tells `left` from `right`. Every other placer folds
 * them into `outsideEnd`, which is why the panels' default list has five
 * entries and a comment explaining that offering the other four is four names
 * for one result. A bar with two ends on a horizontal axis genuinely has a left
 * and a right, so it names its own set rather than being handed a control that
 * lies.
 */
const GANTT_BAR_PLACEMENTS: LabelPlacement[] = [
  'auto',
  'insideCenter',
  'insideEnd',
  'insideBase',
  'left',
  'right',
  'above',
];

export function markCapabilities(spec: ChartSpec, render: MarkRender): MarkCapabilities {
  switch (render) {
    case 'gantt.bar':
      return {
        stroked: false,
        filled: true,
        labels: 'point',
        placement: true,
        content: true,
        marker: false,
        shape: true,
        rounding: true,
        placements: GANTT_BAR_PLACEMENTS,
        spans: true,
      };
    case 'gantt.chevron':
      // No rounding: a chevron's corners are structural — see `ROUNDABLE_PRESETS`.
      return {
        stroked: false,
        filled: true,
        labels: 'point',
        placement: true,
        content: true,
        marker: false,
        shape: true,
        placements: ['auto', 'insideCenter', 'left', 'right', 'above'],
        spans: true,
      };
    case 'gantt.summary':
      return {
        stroked: false,
        filled: true,
        labels: 'point',
        placement: true,
        content: true,
        marker: false,
        shape: true,
        placements: ['auto', 'above', 'left', 'right'],
        spans: true,
      };
    case 'gantt.milestone':
      // A point in time: the marker's shape and size ARE the mark, and it has
      // no span, so nothing inside it to place a label in.
      return {
        stroked: false,
        filled: true,
        labels: 'point',
        placement: true,
        content: true,
        marker: true,
        placements: ['auto', 'left', 'right', 'above', 'below'],
      };
    case 'gantt.bracket':
      // A brace: an outline with no vertices. `marker: false` is what keeps the
      // Dots row off it — the row used to key off `stroked`, and a bracket is
      // the first stroked mark with nowhere to put a dot.
      return {
        stroked: true,
        filled: false,
        labels: 'point',
        placement: true,
        content: true,
        marker: false,
        placements: ['auto', 'above', 'below'],
        spans: true,
      };
    case 'line':
    case 'area':
      return {
        stroked: true,
        filled: false,
        labels: spec.kind === 'line' ? 'end' : 'none',
        placement: false,
        content: false,
        marker: true,
      };
    case 'point':
      // `placeXY` labels a point with the point's own name, so there is no
      // content to pick and nowhere else to put it.
      return {
        stroked: false,
        filled: true,
        labels: 'point',
        placement: false,
        content: false,
        marker: false,
      };
    case 'dot':
      // `placeDotPlot` reads the label's content kind, and puts the label on the
      // side of the track that is free — so there is content to pick and no
      // placement to pick.
      return {
        stroked: false,
        filled: true,
        labels: 'point',
        placement: false,
        content: true,
        marker: false,
      };
    case 'slice':
      return {
        stroked: false,
        filled: true,
        labels: 'point',
        placement: false,
        content: true,
        marker: false,
      };
    default:
      return {
        stroked: false,
        filled: true,
        labels: 'point',
        placement: spec.kind === 'column' || spec.kind === 'bar' || spec.kind === 'combo',
        // A Mekko cell always reports its share — `placeMekko` never reads the
        // content kind, because the width already carries the other number.
        content: spec.kind !== 'mekko',
        marker: false,
      };
  }
}
