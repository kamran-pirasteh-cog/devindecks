'use client';

/**
 * The floating panel that appears when you drill into a chart and select one of
 * its parts — a segment, a data label, an axis, a legend key.
 *
 * think-cell's model, which is the one worth copying: the chart is a single
 * object until you click INTO it, and once you are inside, the controls come to
 * whatever you touched rather than living in a properties dialog three clicks
 * away. So this panel is anchored to the part, is scoped to that part's kind,
 * and nothing else.
 *
 * "Scoped to that part's kind" is the whole discipline. A segment gets fill and
 * border; a line gets weight, dash and dots; anything carrying TEXT gets size,
 * weight and colour — and never the other two sets, because a control that
 * writes to the spec and moves nothing on screen is worse than a missing one.
 * `markRender` and `markCapabilities` are what answer "which of those is
 * this?", since a combo chart's series are not all drawn the same way — and
 * since which PLACER drew a mark decides its text just as much: only
 * `placeColumnBar` honours a label placement, and a line's only label is the
 * name at its end. A part with nothing to offer gets no panel rather than an
 * empty one.
 *
 * The hard rule, inherited from `ChartRef`: every control here writes to the
 * SPEC, never to the rectangle it is pointing at. A fill set on the emitted
 * element survives exactly until the next recompile, so the color would look
 * right until someone edited the data — see `applyChartFormat`, which decides on
 * its own whether an edit belongs to the series or to one point.
 *
 * `dd-format-bar` is load-bearing: the canvas mousedown resolver and Selecto
 * both check for it, so clicking a control neither clears the selection nor
 * starts a marquee.
 */
import {
  DEFAULT_AXIS,
  axisLineVisible,
  emuToPoints,
  hex as hexRef,
  addGanttColumn,
  elementIdFor,
  isGanttSpec,
  moveGanttColumn,
  nudgeGanttColumn,
  removeGanttColumn,
  isGridSpec,
  toEpochDay,
  type EMU,
  type GanttColumn,
  type GanttSpec,
  legendSeriesKey,
  pointsToEmu,
  supportsSecondaryAxis,
  token,
  type ChartInstance,
  type ChartRef,
  type ChartSpec,
  type ColorRef,
  type DashStyle,
  type DesignSystem,
  type GridSeries,
  type LabelContent,
  type LabelFont,
  type LabelPlacement,
  type LabelSpec,
  type LegendPosition,
  type MarkerShape,
  type Outline,
  type Slide,
} from '@/model';
import {
  labelHomeFor,
  labelSpecAt,
  legendEntryColor,
  patchLabelAt,
  recolorLegendEntry,
} from '@/store/chartActions';
import { useEditor } from '@/store/editorStore';
import { axisDateGrain } from '../chartDateMenu';
import { CustomColorSwatch, customHexOf } from '../color';
import { MOVEABLE_Z } from '../layers';
import { ganttItemFormLabel } from '@/model/chart/roles';
import { markCapabilities, markRender } from './markCaps';
import { DateFormatRow } from './DateFormatRow';
import { NumberFormatRows } from './NumberFormatRows';
import { Divider, FIELD, FIELD_NARROW, MiniButton, Row } from './panelChrome';
import {
  CHART_FACES,
  CHART_TYPE_SIZES,
  findTextDeco,
  partFontOf,
  textDecoName,
  type TextDecoDraft,
} from './partFont';

/** Where the panel hangs, in canvas px. */
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PANEL_W = 248;
const GAP = 10;
/** Never squeeze the panel below this, even on a very short slide: at that
 *  point it scrolls, and a scrolling panel beats a clipped one. */
const MIN_PANEL_H = 120;

/** Type sizes offered anywhere in the panel. Blank means "the brand's". */
const SIZES = CHART_TYPE_SIZES;

const LABEL_CONTENTS: { value: LabelContent['kind']; label: string }[] = [
  { value: 'value', label: 'Value' },
  { value: 'percent', label: 'Percent' },
  { value: 'category', label: 'Category' },
  { value: 'seriesName', label: 'Series name' },
];

/**
 * The placements a column or bar actually distinguishes.
 *
 * `above`, `below`, `left` and `right` are in the type but `labelPosition` in
 * `columnBar.ts` folds every one of them into `outsideEnd`, so offering them is
 * four ways to pick the same result. Every other placer ignores placement
 * entirely — see `markCapabilities`, which is what decides whether this row
 * appears at all.
 */
const PLACEMENT_LABELS: Record<LabelPlacement, string> = {
  auto: 'Auto',
  outsideEnd: 'Outside end',
  insideEnd: 'Inside end',
  insideCenter: 'Center',
  insideBase: 'Inside base',
  above: 'Above',
  below: 'Below',
  left: 'Left',
  right: 'Right',
};

const PLACEMENTS: LabelPlacement[] = [
  'auto',
  'outsideEnd',
  'insideEnd',
  'insideCenter',
  'insideBase',
];

const DASHES: { value: DashStyle; label: string; glyph: string }[] = [
  { value: 'solid', label: 'Solid', glyph: '───' },
  { value: 'dash', label: 'Dashed', glyph: '– –' },
  { value: 'dot', label: 'Dotted', glyph: '· · ·' },
];

const MARKERS: { value: MarkerShape; label: string; glyph: string }[] = [
  { value: 'none', label: 'No dots', glyph: '∅' },
  { value: 'circle', label: 'Round dots', glyph: '●' },
  { value: 'square', label: 'Square dots', glyph: '■' },
  { value: 'diamond', label: 'Diamond dots', glyph: '◆' },
  { value: 'triangle', label: 'Triangle dots', glyph: '▲' },
];

const DEFAULT_MARKER_PT = 5;
const DEFAULT_BORDER_PT = 1;
/** Line weights in points — a scale, not a spinner: nobody wants 2.37pt. */
const WEIGHTS = [0.75, 1, 1.5, 2, 3, 4];

/**
 * The legend's six parking spots. The arrows are the four gutters; the corner
 * glyphs are the two that float over the plot instead of taking one.
 */
const SIDES: { value: LegendPosition; glyph: string; title: string }[] = [
  { value: 'top', glyph: '↑', title: 'Legend above the chart' },
  { value: 'right', glyph: '→', title: 'Legend to the right' },
  { value: 'bottom', glyph: '↓', title: 'Legend below the chart' },
  { value: 'left', glyph: '←', title: 'Legend to the left' },
  { value: 'insideTopLeft', glyph: '◤', title: 'Inside the chart, top left' },
  { value: 'insideTopRight', glyph: '◥', title: 'Inside the chart, top right' },
];

const TICK_MARKS: { value: 'none' | 'out' | 'in'; label: string; title: string }[] = [
  { value: 'none', label: 'None', title: 'No tick marks' },
  { value: 'out', label: 'Out', title: 'Tick marks outside the plot' },
  { value: 'in', label: 'In', title: 'Tick marks inside the plot' },
];

/**
 * A number that may be blank, and blank means AUTO rather than zero.
 *
 * An axis bound left empty is fitted to the data, so clearing the field has to
 * write `undefined` — writing 0 would pin the axis to zero and look like the
 * chart had ignored the edit.
 */
function AxisNumber({
  value,
  onChange,
  title,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  title?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      placeholder="auto"
      title={title}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      className={`${FIELD} text-right`}
    />
  );
}

/**
 * The palette, inline rather than behind a swatch popup.
 *
 * Recoloring is the reason people click a bar in the first place; putting it one
 * click deeper than the panel itself would waste the whole gesture. `onClear`
 * gets a chip of its own — "back to the brand's colour" is a real answer, and
 * without it a colour set by accident can only be undone.
 */
function Swatches({
  ds,
  current,
  onPick,
  onClear,
  // One size everywhere. The fill row used to be a size larger than the ink
  // rows below it, which made two swatch grids in one panel look like two
  // different controls — and at 20px a row of eight wrapped where a row of
  // 16px ones does not.
  size = 'h-4 w-4',
}: {
  ds: DesignSystem;
  /** What's set now — a token, a hex, or nothing (following the brand). */
  current?: ColorRef;
  onPick: (color: ColorRef) => void;
  onClear?: () => void;
  size?: string;
}) {
  const currentToken = tokenOf(current);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ds.colors.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(token(c.id))}
          title={c.name}
          aria-label={c.name}
          aria-pressed={currentToken === c.id}
          className={`${size} rounded ${
            currentToken === c.id
              ? 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-zinc-900'
              : 'ring-1 ring-black/10 dark:ring-zinc-600'
          }`}
          style={{ background: c.hex }}
        />
      ))}
      <CustomColorSwatch
        value={customHexOf(current)}
        active={current?.kind === 'hex'}
        onPick={(h) => onPick(hexRef(h))}
        size={size}
      />
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          title="Use the brand's colour"
          aria-label="Use the brand's colour"
          className={`${size} rounded text-[10px] leading-none text-zinc-400 ring-1 ring-black/10 hover:bg-zinc-100 dark:ring-zinc-600 dark:hover:bg-zinc-800`}
        >
          ⌀
        </button>
      ) : null}
    </div>
  );
}

/** The token a `ColorRef` names, or undefined for a raw hex. */
const tokenOf = (ref?: ColorRef): string | undefined =>
  ref?.kind === 'token' ? ref.token : undefined;

/**
 * Size, weight and colour for anything that renders as TEXT.
 *
 * One component for the title, the axis, the data labels, the totals and the
 * legend, because they are the same three questions every time and answering
 * them differently per part is how a format panel turns into thirty dropdowns.
 * A blank size means the brand's, which is what `fontOver` in `theme.ts` reads.
 */
function TextRows({
  ds,
  font,
  onPatch,
}: {
  ds: DesignSystem;
  font: LabelFont | undefined;
  onPatch: (patch: Partial<LabelFont>) => void;
}) {
  return (
    <>
      {/* Face and size in one row, and the face as a DROPDOWN rather than three
          buttons: "Sans / Serif / Mono" spelled out as chips was a row of its
          own, and the panel already asks enough questions of anyone who clicked
          a bar to change its colour. Blank means the brand's. */}
      <Row label="Font">
        <select
          value={font?.font ?? ''}
          onChange={(e) => onPatch({ font: (e.target.value || undefined) as LabelFont['font'] })}
          aria-label="Typeface"
          className={FIELD}
        >
          <option value="">Brand</option>
          {CHART_FACES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={font?.sizePt ?? ''}
          onChange={(e) =>
            onPatch({ sizePt: e.target.value === '' ? undefined : parseFloat(e.target.value) })
          }
          aria-label="Type size"
          className={FIELD_NARROW}
        >
          <option value="">Auto</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s} pt
            </option>
          ))}
        </select>
      </Row>
      {/* Bold, italic and ink are the same decision — how do I mark THIS number
          out from its neighbours — so they answer it on one line. */}
      <Row label="Ink">
        <MiniButton
          active={font?.bold ?? false}
          onClick={() => onPatch({ bold: !font?.bold })}
          title="Bold (⌘B)"
        >
          <span className="font-bold">B</span>
        </MiniButton>
        <MiniButton
          active={font?.italic ?? false}
          onClick={() => onPatch({ italic: !font?.italic })}
          title="Italic (⌘I)"
        >
          <span className="italic">I</span>
        </MiniButton>
        <Swatches
          ds={ds}
          current={font?.color}
          onPick={(color) => onPatch({ color })}
          onClear={() => onPatch({ color: undefined })}
        />
      </Row>
    </>
  );
}

/**
 * Show / weight / dash / ink for anything drawn as a RULE.
 *
 * One block, four consumers: the gridlines it was written for, and a Gantt's
 * row dividers, band rules and today line. They are the same four questions
 * about the same four fields (`GridlineSpec` and `LineStyle` differ only in
 * carrying `show`), and keeping four copies is how the two format panels
 * drifted apart in the first place.
 */
function LineRows({
  ds,
  showLabel,
  show,
  style,
  onToggle,
  onPatch,
}: {
  ds: DesignSystem;
  showLabel: string;
  show: boolean;
  style: { color?: ColorRef; widthEmu?: EMU; dash?: DashStyle } | undefined;
  onToggle: () => void;
  onPatch: (fn: (s: { color?: ColorRef; widthEmu?: EMU; dash?: DashStyle }) => void) => void;
}) {
  return (
    <>
      <Row label={showLabel}>
        <MiniButton active={show} onClick={onToggle}>
          Show
        </MiniButton>
      </Row>
      <Row label="Weight">
        <select
          value={style?.widthEmu ? Number(emuToPoints(style.widthEmu).toFixed(2)) : ''}
          onChange={(e) =>
            onPatch((g) => {
              g.widthEmu =
                e.target.value === '' ? undefined : pointsToEmu(parseFloat(e.target.value));
            })
          }
          aria-label={`${showLabel} weight`}
          className={FIELD}
        >
          <option value="">Auto</option>
          {WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {w} pt
            </option>
          ))}
        </select>
      </Row>
      <Row label="Dash">
        {DASHES.map((d) => (
          <MiniButton
            key={d.value}
            active={(style?.dash ?? 'solid') === d.value}
            title={d.label}
            onClick={() => onPatch((g) => (g.dash = d.value))}
          >
            {d.glyph}
          </MiniButton>
        ))}
      </Row>
      <Row label="Ink">
        <Swatches
          ds={ds}
          current={style?.color}
          onPick={(color) => onPatch((g) => (g.color = color))}
          onClear={() => onPatch((g) => (g.color = undefined))}
        />
      </Row>
    </>
  );
}

/**
 * Today, as an epoch day.
 *
 * THE one place in the chart path allowed to read a clock, and it is here
 * rather than in the compiler on purpose: `compileChart` is pure by contract —
 * same instance in, byte-identical elements out — which is what lets the
 * canvas, an SSR thumbnail and a .pptx agree. A `Date.now()` in a placer breaks
 * that on the first render. So the date is STAMPED into the spec by a gesture,
 * and the deck's "today" is a fact about the deck rather than about when it was
 * last opened. `Date` is used only to ask the host what day it is; the civil
 * fields go straight to `toEpochDay`, so no timezone survives the call.
 */
function todayEpochDay(): number {
  const now = new Date();
  return toEpochDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Human name for what the drill-in landed on, for the panel's header. */
function describe(spec: ChartSpec, refs: ChartRef[]): string {
  if (!refs.length) return 'Chart';
  const ref = refs[0]!;
  const many = refs.length > 1;

  // Every kind must resolve its own keys. A kind that falls through prints
  // nanoids at the reader — "g-a4Kd1 · r-9xQ2p" — which is worse than a generic
  // noun, because it looks like a bug rather than like a heading.
  const categoryLabel = (key: string): string => {
    if (isGridSpec(spec)) return spec.data.categories.find((c) => c.key === key)?.label ?? key;
    if (spec.kind === 'waterfall') return spec.data.items.find((i) => i.key === key)?.label ?? key;
    if (isGanttSpec(spec)) {
      const item = spec.items.find((i) => i.key === key);
      return item?.label ?? (item ? ganttItemFormLabel(item.shape.form) : key);
    }
    return key;
  };
  const seriesName = (key: string): string =>
    (isGridSpec(spec)
      ? spec.data.series.find((s) => s.key === key)?.name
      : isGanttSpec(spec)
        ? spec.rows.find((r) => r.key === key)?.label
        : undefined) ?? key;
  const columnHeader = (key: string): string =>
    (isGanttSpec(spec) ? spec.columns.find((c) => c.key === key)?.header : undefined) ?? key;

  switch (ref.part) {
    case 'mark':
      if (many) return `${seriesName(ref.series)} · ${refs.length} bars`;
      return spec.kind === 'waterfall'
        ? categoryLabel(ref.point)
        : `${seriesName(ref.series)} · ${categoryLabel(ref.point)}`;
    case 'label':
      return many ? `${refs.length} data labels` : `Label · ${categoryLabel(ref.point)}`;
    case 'total':
      return `Total · ${categoryLabel(ref.point)}`;
    case 'axis':
      return ref.sub === 'grid'
        ? 'Gridlines'
        : ref.sub === 'title'
          ? 'Axis title'
          : ref.sub === 'tick'
            ? `${ref.axis.toUpperCase()} axis labels`
            : `${ref.axis.toUpperCase()} axis`;
    case 'legend.item':
      return `Legend · ${seriesName(legendSeriesKey(ref))}`;
    case 'legend.box':
      return 'Legend';
    case 'title':
      return 'Chart title';
    case 'decoration': {
      const found = findTextDeco(spec, ref.decoId);
      return found ? textDecoName(found.kind) : 'Annotation';
    }
    case 'plot':
      return 'Plot area';
    case 'gantt.row':
      return ref.sub === 'label'
        ? `Task · ${seriesName(ref.row)}`
        : ref.sub === 'divider'
          ? (many ? `${refs.length} row dividers` : 'Row divider')
          : 'Row band';
    case 'gantt.column':
      return ref.sub === 'header'
        ? `Column · ${columnHeader(ref.column)}`
        : many
          ? `${columnHeader(ref.column)} · ${refs.length} cells`
          : `${columnHeader(ref.column)} · ${seriesName(ref.row ?? '')}`;
    case 'gantt.band':
      return ref.sub === 'today'
        ? 'Today line'
        : ref.sub === 'weekend'
          ? 'Non-working days'
          : 'Holiday';
  }
}

export function ChartPartPopover({
  chart,
  slide,
  selectedIds,
  ds,
  anchor,
  canvas,
}: {
  chart: ChartInstance;
  slide: Slide;
  selectedIds: string[];
  ds: DesignSystem;
  anchor: Anchor;
  /** Display size of the slide, so the panel can stay on it. */
  canvas: { w: number; h: number };
}) {
  const store = useEditor.getState;
  const spec = chart.spec;

  const selected = slide.elements.filter((e) => selectedIds.includes(e.id));
  const refs = selected.map((e) => e.chartRef).filter(Boolean) as ChartRef[];
  if (!refs.length) return null;

  const markRefs = refs.filter((r): r is Extract<ChartRef, { part: 'mark' }> => r.part === 'mark');
  const labelRefs = refs.filter(
    (r): r is Extract<ChartRef, { part: 'label' }> => r.part === 'label',
  );
  // Marks and labels are formatted through the same spec nodes, so a selection
  // of either is driven by the same series/point pair.
  const dataRefs = markRefs.length ? markRefs : labelRefs;
  const seriesKeys = [...new Set(dataRefs.map((r) => r.series))];
  const seriesKey = seriesKeys.length === 1 ? seriesKeys[0]! : null;
  const pointKeys = dataRefs.map((r) => r.point);

  const series: GridSeries | undefined =
    isGridSpec(spec) && seriesKey ? spec.data.series.find((s) => s.key === seriesKey) : undefined;
  const allPoints = isGridSpec(spec) ? spec.data.categories.map((c) => c.key) : [];
  // The same test `applyChartFormat` applies: every point selected means the
  // edit belongs to the series, so the panel says so rather than leaving the
  // user to guess which one they just changed.
  const wholeSeries =
    !!series && allPoints.length > 0 && allPoints.every((k) => pointKeys.includes(k));

  /**
   * How the selected series is DRAWN, which is what decides its controls.
   *
   * Not `spec.kind`: a combo chart's second series is a line over the columns,
   * and offering it a fill and a border formats nothing anybody can see.
   */
  // Through the REF, not the series key: a kind whose marks differ within one
  // series has no series-level answer to give — see `markRender`. Still gated
  // on a single series, so a mixed selection offers nothing, as before.
  const render = seriesKey && dataRefs[0] ? markRender(spec, dataRefs[0]) : null;
  const caps = render ? markCapabilities(spec, render) : null;
  const isStroked = !!caps?.stroked;

  /** Every mark of a series, for the "select the whole series" action. */
  const seriesMarkIds = (key: string): string[] =>
    slide.elements
      .filter(
        (e) =>
          e.chartRef?.part === 'mark' &&
          e.chartRef.chartId === chart.id &&
          e.chartRef.series === key,
      )
      .map((e) => e.id);

  /**
   * Which spec node owns the labels of this selection, and the two functions
   * that read and write it.
   *
   * `labelHomeFor` rather than a series lookup here, for the reason its own
   * comment gives: a waterfall has ITEMS instead of series, so a series lookup
   * came back empty and this whole section — the toggle, the content, the
   * placement, the type — disappeared for a selected waterfall label. The
   * keyboard path already asked it; now the panel it was named for does too.
   */
  const labelHome = labelHomeFor(spec, refs);
  const effectiveLabel = (): LabelSpec =>
    labelHome ? labelSpecAt(spec, labelHome) : spec.decorations.labels;

  const patchLabel = (patch: Partial<LabelSpec>) => {
    if (!labelHome) return;
    store().patchChart(chart.id, (draft) => {
      patchLabelAt(draft, labelHome, patch);
    });
  };

  /** Drop every per-point override, returning the points to the series style. */
  const resetPoints = () => {
    if (!seriesKey) return;
    store().patchChart(chart.id, (draft) => {
      if (!isGridSpec(draft)) return;
      const ser = draft.data.series.find((s) => s.key === seriesKey);
      if (!ser?.pointOverrides) return;
      for (const key of pointKeys) delete ser.pointOverrides[key];
    });
  };

  /**
   * Stroke settings live on the SERIES, never on a point.
   *
   * A line is one path through every category — there is no such thing as
   * dotting the third point of it — so unlike fill, these have no per-point
   * scope to resolve and write straight through `patchChart`.
   */
  /**
   * Which value axis this series is read against.
   *
   * On the series, like the stroke settings above it: a series is on one axis
   * or the other for all of its points. The `y2` spec is created on the way in
   * and dropped when the last series leaves, so a chart never draws an axis
   * with nothing on it.
   */
  const seriesAxis = series?.axis === 'secondary' ? 'secondary' : 'primary';
  const setSeriesAxis = (axis: 'primary' | 'secondary') => {
    if (!seriesKey) return;
    store().patchChart(chart.id, (draft) => {
      if (!isGridSpec(draft)) return;
      const ser = draft.data.series.find((s) => s.key === seriesKey);
      if (!ser) return;
      ser.axis = axis === 'secondary' ? 'secondary' : undefined;
      if (axis === 'secondary') {
        draft.axes.y2 ??= { ...DEFAULT_AXIS };
      } else if (!draft.data.series.some((s) => s.axis === 'secondary')) {
        draft.axes.y2 = undefined;
      }
    });
  };

  /** Shown only where a second value axis is a thing this kind can have. */
  const axisRow =
    series && supportsSecondaryAxis(spec.kind) ? (
      <Row label="Axis">
        <select
          value={seriesAxis}
          onChange={(e) => setSeriesAxis(e.target.value as 'primary' | 'secondary')}
          aria-label="Value axis"
          className={FIELD}
        >
          <option value="primary">Left</option>
          <option value="secondary">Right</option>
        </select>
      </Row>
    ) : null;

  const patchSeriesFormat = (fn: (f: NonNullable<GridSeries['format']>) => void) => {
    if (!seriesKey) return;
    store().patchChart(chart.id, (draft) => {
      if (!isGridSpec(draft)) return;
      const ser = draft.data.series.find((s) => s.key === seriesKey);
      if (!ser) return;
      ser.format = { ...ser.format };
      fn(ser.format);
    });
  };

  const label = effectiveLabel();
  const axisRef = refs.find((r): r is Extract<ChartRef, { part: 'axis' }> => r.part === 'axis');
  const legendRef = refs.find(
    (r): r is Extract<ChartRef, { part: 'legend.item' | 'legend.box' }> =>
      r.part === 'legend.item' || r.part === 'legend.box',
  );
  /**
   * The series (or, in a pie's legend, the slice) the legend entry stands for,
   * and the colour it is drawn in — the swatch IS the series, so clicking it is
   * how you recolour all of it at once.
   */
  const legendKey =
    legendRef?.part === 'legend.item' ? legendSeriesKey(legendRef) : null;
  const legendColor = legendKey ? legendEntryColor(spec, legendKey) : null;

  const setLegendColor = (color: ColorRef | null) => {
    if (!legendKey) return;
    store().patchChart(chart.id, (d) => {
      recolorLegendEntry(d, legendKey, color === null ? undefined : { kind: 'solid', color });
    });
  };

  const rowRef = refs.find(
    (r): r is Extract<ChartRef, { part: 'gantt.row' }> => r.part === 'gantt.row',
  );
  const colRef = refs.find(
    (r): r is Extract<ChartRef, { part: 'gantt.column' }> => r.part === 'gantt.column',
  );
  const bandRef = refs.find(
    (r): r is Extract<ChartRef, { part: 'gantt.band' }> => r.part === 'gantt.band',
  );
  const gantt = isGanttSpec(spec) ? spec : null;
  const column = gantt && colRef ? gantt.columns.find((c) => c.key === colRef.column) : undefined;

  /** Patch the Gantt spec, seeding the node if it isn't there yet. */
  const patchGantt = (mutate: (g: GanttSpec) => void) =>
    store().patchChart(chart.id, (d) => {
      if (isGanttSpec(d)) mutate(d);
    });

  const totalRef = refs.find((r): r is Extract<ChartRef, { part: 'total' }> => r.part === 'total');
  const titleRef = refs.find((r): r is Extract<ChartRef, { part: 'title' }> => r.part === 'title');

  /**
   * The decoration a `decoration` ref names, when that decoration carries TEXT.
   *
   * A callout, a CAGR rate, a difference delta and a reference-line label are
   * four different nodes that all put a string on the plot, so they all answer
   * the same three questions — what does it say, in what type, in what ink. A
   * trend line carries no text and so still gets no panel.
   */
  const decoRef = refs.find(
    (r): r is Extract<ChartRef, { part: 'decoration' }> => r.part === 'decoration',
  );
  const deco = decoRef ? findTextDeco(spec, decoRef.decoId) : undefined;

  /**
   * Edit the decoration the popover is open on.
   *
   * By kind and id rather than by object identity: `spec` here is the rendered
   * snapshot and the draft is a fresh tree, so the node has to be found again.
   */
  const patchDeco = (mutate: (node: TextDecoDraft) => void) => {
    if (!deco) return;
    store().patchChart(chart.id, (d) => {
      const found = findTextDeco(d, deco.node.id);
      if (found) mutate(found.node);
    });
  };

  /**
   * Which axis carries numbers, and so has a range and a step to set.
   *
   * The value axis always does. The x axis does only where it's continuous —
   * a scatter's — because a banded category axis has a list of names, not a
   * domain: "from 1000 to 2000, every 250" means nothing to FY23, FY24, FY25.
   */
  const numericAxis =
    !!axisRef &&
    (axisRef.axis !== 'x' || spec.kind === 'scatter' || spec.kind === 'bubble');

  /**
   * The grain of a dated category axis, or null — the axis that carries DATES
   * rather than numbers, and the one with a date format to pick. Read off the
   * labels themselves, so it appears exactly when it means something.
   */
  const tickGrain =
    axisRef && axisRef.axis === 'x' && !numericAxis ? axisDateGrain(spec) : null;

  /** Edit the axis the popover is open on. */
  const patchAxis = (mutate: (a: NonNullable<ChartSpec['axes']['y']>) => void) => {
    if (!axisRef) return;
    store().patchChart(chart.id, (d) => {
      const ax = d.axes[axisRef.axis];
      if (ax) mutate(ax);
    });
  };

  /**
   * The major gridlines, and the one place that edits them.
   *
   * Absent means "never touched", not "off", so the node is minted on first
   * write — `show: false` so that the toggle's flip below reads as turning them
   * ON rather than off.
   */
  const gridline = spec.decorations.gridlines.major;
  const patchGrid = (
    mutate: (g: NonNullable<ChartSpec['decorations']['gridlines']['major']>) => void,
  ) => {
    store().patchChart(chart.id, (d) => {
      d.decorations.gridlines.major ??= { show: false };
      mutate(d.decorations.gridlines.major);
    });
  };

  /**
   * The type this selection edits, and the one place that writes it.
   *
   * Shared with the format bar over the slide — see `partFontOf`. Every
   * `TextRows` below reads from it, so the panel no longer decides per section
   * which node a size lands on: the selection already decided.
   */
  const partFont = partFontOf(spec, refs);
  const applyFont = (patch: Partial<LabelFont>) =>
    store().patchChart(chart.id, (d) => partFont?.apply(d, patch));

  /**
   * The border in force on the selection, for the swatch's "current" ring.
   *
   * Reads the point override first for the same reason `effectiveLabel` does:
   * one recoloured bar in a series has its own answer, and showing the series'
   * would point at a colour that isn't on screen.
   */
  const currentOutline: Outline | undefined = (() => {
    const first = pointKeys[0];
    const perPoint = first ? series?.pointOverrides?.[first]?.format?.outline : undefined;
    return perPoint ?? series?.format?.outline;
  })();

  /** The fill in force on the mark, read the same point-first way. */
  const markFill: ColorRef | undefined = (() => {
    const first = pointKeys[0];
    const perPoint = first ? series?.pointOverrides?.[first]?.format?.fill : undefined;
    const fill = perPoint ?? series?.format?.fill;
    return fill?.kind === 'solid' ? fill.color : undefined;
  })();

  const setOutline = (patch: Partial<Outline> | null) => {
    if (patch === null) {
      store().setOutline(selectedIds, undefined);
      return;
    }
    store().setOutline(selectedIds, {
      color: currentOutline?.color ?? token(ds.colors[0]?.id ?? 'ink.strong'),
      widthEmu: currentOutline?.widthEmu ?? pointsToEmu(DEFAULT_BORDER_PT),
      dash: currentOutline?.dash ?? 'solid',
      ...patch,
    });
  };

  const marker = series?.format?.marker;
  const lineWeightPt = series?.format?.lineWidthEmu
    ? Number(emuToPoints(series.format.lineWidthEmu).toFixed(2))
    : undefined;

  const nudged =
    pointKeys.length > 0 &&
    pointKeys.some((k) => series?.pointOverrides?.[k]?.labelOffset !== undefined);
  /** Is there per-point formatting to drop? Nothing to reset TO otherwise. */
  const overridden =
    pointKeys.length > 0 && pointKeys.some((k) => series?.pointOverrides?.[k] !== undefined);

  /**
   * Does any section have something to say about this selection?
   *
   * The plot area, a trend line and a reference line are all selectable and none
   * of them is formattable here, so without this the drill-in answered a click
   * with a panel containing nothing but its own title — which reads as a broken
   * panel rather than as "this part has no options".
   */
  const hasControls =
    (markRefs.length > 0 && (caps?.stroked || caps?.filled)) ||
    (!!labelHome &&
      !!caps &&
      caps.labels !== 'none' &&
      (markRefs.length > 0 || labelRefs.length > 0)) ||
    !!axisRef ||
    !!totalRef ||
    !!titleRef ||
    (!!legendRef && markRefs.length === 0) ||
    // Every new part must be named here, or clicking a divider opens NO panel
    // — which reads as the editor being broken rather than as "this part has
    // no options".
    !!rowRef ||
    !!colRef ||
    !!bandRef ||
    !!deco;
  if (!hasControls) return null;

  // Beside the part, never on top of it: the whole point is to recolor the thing
  // you are looking at, and a panel parked over it hides the result of every
  // click. Right first, left when there is no room, centered only when neither
  // side fits.
  //
  // Vertically it pins an EDGE rather than a computed top, so it stays on the
  // slide without anyone measuring its height — which changes with the part kind.
  // Over Moveable's own overlay. Selecting several parts (a whole series) makes
  // Moveable render `.moveable-area`, a transparent drag surface at z-index
  // 3000 covering the selection's bounds — which is exactly where this panel
  // wants to be. Underneath it the buttons take no clicks at all, and the press
  // falls through to the canvas, which hit-tests past the panel and selects the
  // bar behind it. One above the part highlights too (`ChartPartHighlights`),
  // which paint at MOVEABLE_Z + 1 and would otherwise tint the panel's corner.
  const style: React.CSSProperties = { width: PANEL_W, zIndex: MOVEABLE_Z + 2 };
  if (anchor.x + anchor.w + GAP + PANEL_W <= canvas.w) style.left = anchor.x + anchor.w + GAP;
  else if (anchor.x - GAP - PANEL_W >= 0) style.right = canvas.w - anchor.x + GAP;
  else style.left = Math.min(Math.max(GAP, anchor.x), Math.max(GAP, canvas.w - PANEL_W - GAP));
  //
  // The edge it pins is the one with more room, and it caps its own height to
  // that room: pinning the BOTTOM to a part low on the slide grew the panel
  // upwards past y=0, so a tall selection's panel hung off the top of the page
  // with its header and first rows unreachable. `max-h` in percent didn't save
  // it — 85% of the slide measured from the part's bottom edge still starts
  // above the slide when the part is near the foot of it.
  const roomBelow = canvas.h - anchor.y - GAP;
  const roomAbove = anchor.y + anchor.h - GAP;
  if (roomBelow >= roomAbove) {
    const top = Math.max(GAP, Math.min(anchor.y, canvas.h - GAP));
    style.top = top;
    style.maxHeight = Math.max(MIN_PANEL_H, canvas.h - top - GAP);
  } else {
    const bottom = Math.max(GAP, canvas.h - anchor.y - anchor.h);
    style.bottom = bottom;
    style.maxHeight = Math.max(MIN_PANEL_H, canvas.h - bottom - GAP);
  }

  return (
    <div
      className="dd-format-bar absolute flex flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={style}
      role="dialog"
      aria-label="Format chart part"
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Sticky, because the panel now scrolls when the slide is too short for
          it: the one line saying WHICH bar you are formatting is the last thing
          that should be allowed to scroll out of view. */}
      <div className="sticky top-0 -mx-2 -mt-2 flex items-center justify-between gap-2 bg-white px-2 pb-1 pt-2 dark:bg-zinc-900">
        <span className="truncate text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
          {describe(spec, refs)}
        </span>
        <button
          type="button"
          // Back out to the chart as a whole — the same step Escape takes.
          onClick={() => store().select(selectedIds)}
          title="Select the whole chart"
          aria-label="Select the whole chart"
          className="shrink-0 rounded px-1 text-[11px] text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ⤺
        </button>
      </div>

      {/* --- a line or an area: the stroke is the mark --- */}
      {markRefs.length && isStroked ? (
        <>
          {axisRow}
          <Row label="Color">
            <Swatches
              ds={ds}
              current={
                series?.format?.outline?.color ??
                (series?.format?.fill?.kind === 'solid' ? series.format.fill.color : undefined)
              }
              onPick={(color) =>
                patchSeriesFormat((f) => {
                  f.fill = { kind: 'solid', color };
                  // A line takes its colour from the outline; leaving the old
                  // one set would repaint the dots and leave the line grey.
                  f.outline = { ...f.outline, color } as Outline;
                })
              }
            />
          </Row>
          <Row label="Weight">
            <select
              value={lineWeightPt ?? ''}
              onChange={(e) =>
                patchSeriesFormat((f) => {
                  f.lineWidthEmu =
                    e.target.value === '' ? undefined : pointsToEmu(parseFloat(e.target.value));
                })
              }
              aria-label="Line weight"
              className={FIELD}
            >
              <option value="">Auto</option>
              {WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {w} pt
                </option>
              ))}
            </select>
          </Row>
          <Row label="Dash">
            {DASHES.map((d) => (
              <MiniButton
                key={d.value}
                active={(series?.format?.dash ?? 'solid') === d.value}
                title={d.label}
                onClick={() => patchSeriesFormat((f) => (f.dash = d.value))}
              >
                {d.glyph}
              </MiniButton>
            ))}
          </Row>
          {caps?.marker ? (
          <Row label="Dots">
            {MARKERS.map((m) => (
              <MiniButton
                key={m.value}
                active={(marker?.shape ?? 'none') === m.value}
                title={m.label}
                onClick={() =>
                  patchSeriesFormat((f) => {
                    f.marker =
                      m.value === 'none'
                        ? undefined
                        : {
                            ...f.marker,
                            shape: m.value,
                            sizeEmu: f.marker?.sizeEmu || pointsToEmu(DEFAULT_MARKER_PT),
                          };
                  })
                }
              >
                {m.glyph}
              </MiniButton>
            ))}
          </Row>
          ) : null}
        </>
      ) : null}

      {/* --- a segment, a slice, a bar: fill and border --- */}
      {markRefs.length && caps?.filled ? (
        <>
          {axisRow}
          <Row label="Fill">
            <Swatches
              ds={ds}
              current={markFill}
              onPick={(color) => store().setFill(selectedIds, { kind: 'solid', color })}
            />
          </Row>
          {/* Thickness FIRST, and present whether or not a border is set: the
              weight is what people come here to change, and hiding it until a
              colour was picked made "give these bars a hairline" a two-step
              gesture whose first step looked like the only one on offer. Picking
              a weight mints the border in the brand's darkest ink; "None" is how
              it goes away again. */}
          <Row label="Border">
            <select
              value={currentOutline ? Number(emuToPoints(currentOutline.widthEmu).toFixed(2)) : ''}
              onChange={(e) =>
                e.target.value === ''
                  ? setOutline(null)
                  : setOutline({ widthEmu: pointsToEmu(parseFloat(e.target.value)) })
              }
              aria-label="Border weight"
              className={FIELD_NARROW}
            >
              <option value="">None</option>
              {WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {w} pt
                </option>
              ))}
            </select>
            {/* The dash as a dropdown and not three glyph chips: beside the
                weight, three chips left the weight 60px wide and reading
                "Nor…". One row, two dropdowns, nothing clipped. */}
            <select
              value={currentOutline?.dash ?? 'solid'}
              disabled={!currentOutline}
              onChange={(e) => setOutline({ dash: e.target.value as DashStyle })}
              aria-label="Border dash"
              className={`${FIELD} disabled:opacity-40`}
            >
              {DASHES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Row>
          {currentOutline ? (
            <Row label="Edge ink">
              <Swatches
                ds={ds}
                current={currentOutline.color}
                onPick={(color) => setOutline({ color })}
                onClear={() => setOutline(null)}
              />
            </Row>
          ) : null}
        </>
      ) : null}

      {markRefs.length && seriesKey && !wholeSeries ? (
        <Row label="Scope">
          <MiniButton
            onClick={() => store().selectExact(seriesMarkIds(seriesKey))}
            title="Format every mark in this series at once"
          >
            Whole series
          </MiniButton>
        </Row>
      ) : null}

      {/* --- the number on the mark. Only where a placer draws one: a line's
              points carry no label, so `labels: 'none'` gets this whole block
              and its three text rows out of the way. --- */}
      {labelHome && caps?.labels === 'point' && (markRefs.length || labelRefs.length) ? (
        <>
          <Divider />
          <Row label="Label">
            <MiniButton
              active={label.show}
              onClick={() => patchLabel({ show: !label.show })}
              title="Show the data label"
            >
              123
            </MiniButton>
            {caps.content ? (
              <select
                value={label.content.kind}
                disabled={!label.show}
                onChange={(e) => patchLabel({ content: { kind: e.target.value } as LabelContent })}
                aria-label="Label content"
                className={`${FIELD} disabled:opacity-40`}
              >
                {LABEL_CONTENTS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : null}
          </Row>
          {caps.placement && label.show ? (
            <Row label="Place">
              <select
                value={label.placement}
                onChange={(e) => patchLabel({ placement: e.target.value as LabelPlacement })}
                aria-label="Label placement"
                className={FIELD}
              >
                {(caps.placements ?? PLACEMENTS).map((p) => (
                  <option key={p} value={p}>
                    {PLACEMENT_LABELS[p]}
                  </option>
                ))}
              </select>
            </Row>
          ) : null}
          {/* How the number is written, where the label IS a number: a category
              name or a series name has no format to choose. Reads through to
              the chart's format so the dropdowns show what is on screen, and
              writes to the label's own node, which is what makes a single
              restated figure — "1.2M" among a column of thousands — possible. */}
          {label.show && (label.content.kind === 'value' || label.content.kind === 'percent') ? (
            <NumberFormatRows
              value={label.numberFormat ?? spec.numberFormat}
              onChange={(numberFormat) => patchLabel({ numberFormat })}
            />
          ) : null}
          {/* Type controls follow the text: with the label off there is nothing
              on screen for a size, a face or an ink to change. */}
          {label.show ? (
            <>
              <Divider />
              <TextRows ds={ds} font={partFont?.font} onPatch={applyFont} />
            </>
          ) : null}
        </>
      ) : null}

      {/* --- a line chart's series labels, which are the only text a stroked
              series has: one name at the right-hand end, not one per point. --- */}
      {series && caps?.labels === 'end' && (markRefs.length || labelRefs.length) ? (
        <>
          <Row label="Names">
            <MiniButton
              active={spec.kind === 'line' && (spec.endLabels ?? false)}
              title="Name each line at its right-hand end, so the chart needs no legend."
              onClick={() =>
                store().patchChart(chart.id, (d) => {
                  if (d.kind === 'line') d.endLabels = !d.endLabels;
                })
              }
            >
              End labels
            </MiniButton>
          </Row>
          {spec.kind === 'line' && spec.endLabels ? (
            <TextRows
              ds={ds}
              font={partFont?.font}
              onPatch={applyFont}
            />
          ) : null}
        </>
      ) : null}

      {/* --- a Gantt's row furniture --- */}
      {gantt && rowRef && rowRef.sub === 'divider' ? (
        <LineRows
          ds={ds}
          showLabel="Divider"
          show={gantt.ruler?.rows?.show ?? false}
          style={gantt.ruler?.rows}
          onToggle={() =>
            patchGantt((g) => {
              g.ruler ??= {};
              g.ruler.rows = { ...g.ruler.rows, show: !(g.ruler.rows?.show ?? false) };
            })
          }
          onPatch={(fn) =>
            patchGantt((g) => {
              g.ruler ??= {};
              g.ruler.rows ??= { show: true };
              fn(g.ruler.rows);
            })
          }
        />
      ) : null}

      {gantt && rowRef && rowRef.sub === 'band' ? (
        <>
          <Row label="Banding">
            <MiniButton
              active={gantt.banding?.show ?? false}
              onClick={() =>
                patchGantt((g) => {
                  g.banding = { ...g.banding, show: !(g.banding?.show ?? false) };
                })
              }
            >
              Show
            </MiniButton>
          </Row>
          <Row label="Fill">
            <Swatches
              ds={ds}
              current={gantt.banding?.color}
              onPick={(color) =>
                patchGantt((g) => {
                  g.banding = { show: true, ...g.banding, color };
                })
              }
              onClear={() =>
                patchGantt((g) => {
                  if (g.banding) delete g.banding.color;
                })
              }
            />
          </Row>
        </>
      ) : null}

      {gantt && rowRef && rowRef.sub === 'label' ? (
        <Row label="Scope">
          <MiniButton
            title="Select every bar in this row"
            onClick={() =>
              store().selectExact(
                gantt.items
                  .filter((i) => i.row === rowRef.row)
                  .map((i) =>
                    elementIdFor({ chartId: chart.id, part: 'mark', series: i.row, point: i.key }),
                  ),
              )
            }
          >
            Bars in row
          </MiniButton>
        </Row>
      ) : null}

      {/* --- the today line and the non-working stripes --- */}
      {gantt && bandRef && bandRef.sub === 'today' ? (
        <>
          <LineRows
            ds={ds}
            showLabel="Today"
            show={gantt.today?.show ?? false}
            style={gantt.today?.style}
            onToggle={() =>
              patchGantt((g) => {
                // `at` is required when shown, and the compiler is pure — so
                // the date can only be stamped here. See `GanttSpec.today`.
                g.today = {
                  at: g.today?.at ?? todayEpochDay(),
                  ...g.today,
                  show: !(g.today?.show ?? false),
                };
              })
            }
            onPatch={(fn) =>
              patchGantt((g) => {
                g.today ??= { show: true, at: todayEpochDay() };
                g.today.style ??= {};
                fn(g.today.style);
              })
            }
          />
          <Row label="Date">
            <MiniButton
              title="Move the line to today's date"
              onClick={() =>
                patchGantt((g) => {
                  g.today = { show: true, ...g.today, at: todayEpochDay() };
                })
              }
            >
              Move to today
            </MiniButton>
          </Row>
          <Row label="Caption">
            <input
              value={gantt.today?.label ?? ''}
              placeholder="Today"
              onChange={(e) =>
                patchGantt((g) => {
                  g.today ??= { show: true, at: todayEpochDay() };
                  g.today.label = e.target.value || undefined;
                })
              }
              className={FIELD}
            />
          </Row>
        </>
      ) : null}

      {gantt && bandRef && bandRef.sub !== 'today' ? (
        <>
          <Row label="Non-working">
            <MiniButton
              active={gantt.shading?.weekends?.show ?? false}
              onClick={() =>
                patchGantt((g) => {
                  g.shading ??= {};
                  g.shading.weekends = {
                    ...g.shading.weekends,
                    show: !(g.shading.weekends?.show ?? false),
                  };
                })
              }
            >
              Show
            </MiniButton>
          </Row>
          <Row label="Fill">
            <Swatches
              ds={ds}
              current={gantt.shading?.weekends?.color}
              onPick={(color) =>
                patchGantt((g) => {
                  g.shading ??= {};
                  g.shading.weekends = { show: true, ...g.shading.weekends, color };
                })
              }
              onClear={() =>
                patchGantt((g) => {
                  if (g.shading?.weekends) delete g.shading.weekends.color;
                })
              }
            />
          </Row>
        </>
      ) : null}

      {/* --- a description column: which side of the chart, and how wide --- */}
      {gantt && column ? (
        <>
          <Row label="Heading">
            <input
              value={column.header}
              onChange={(e) =>
                patchGantt((g) => {
                  const c = g.columns.find((x: GanttColumn) => x.key === column.key);
                  if (c) c.header = e.target.value;
                })
              }
              className={FIELD}
            />
          </Row>
          {/* The side, and the order within it. Between them they are the whole
              "move it relative to the chart" gesture — crossing the plot is a
              change of side, passing a neighbour is a change of order. */}
          <Row label="Side">
            <MiniButton
              active={column.side === 'left'}
              title="Left of the chart"
              onClick={() => patchGantt((g) => moveGanttColumn(g, column.key, 'left'))}
            >
              ◀ Left
            </MiniButton>
            <MiniButton
              active={column.side === 'right'}
              title="Right of the chart"
              onClick={() => patchGantt((g) => moveGanttColumn(g, column.key, 'right'))}
            >
              Right ▶
            </MiniButton>
          </Row>
          <Row label="Order">
            <MiniButton
              title="Move one column toward the chart"
              onClick={() => patchGantt((g) => nudgeGanttColumn(g, column.key, -1))}
            >
              ←
            </MiniButton>
            <MiniButton
              title="Move one column away from the chart"
              onClick={() => patchGantt((g) => nudgeGanttColumn(g, column.key, 1))}
            >
              →
            </MiniButton>
          </Row>
          <Row label="Shows">
            <select
              value={column.source}
              onChange={(e) =>
                patchGantt((g) => {
                  const c = g.columns.find((x: GanttColumn) => x.key === column.key);
                  if (c) c.source = e.target.value as GanttColumn['source'];
                })
              }
              aria-label="Column contents"
              className={FIELD}
            >
              <option value="text">Typed in</option>
              <option value="label">Task name</option>
              {/* Computed from the bars, so the table can never contradict the
                  chart beside it. */}
              <option value="start">Start date</option>
              <option value="end">End date</option>
              <option value="duration">Duration</option>
            </select>
          </Row>
          <Row label="Column">
            <MiniButton
              title="Add a column beside this one"
              onClick={() => patchGantt((g) => addGanttColumn(g, { after: column.key }))}
            >
              + Add
            </MiniButton>
            <MiniButton
              title="Remove this column"
              onClick={() => patchGantt((g) => removeGanttColumn(g, column.key))}
            >
              − Remove
            </MiniButton>
          </Row>
          <Row label="Align">
            {(['left', 'center', 'right'] as const).map((a) => (
              <MiniButton
                key={a}
                active={(column.align ?? 'left') === a}
                title={a}
                onClick={() =>
                  patchGantt((g) => {
                    const c = g.columns.find((x: GanttColumn) => x.key === column.key);
                    if (c) c.align = a;
                  })
                }
              >
                {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
              </MiniButton>
            ))}
          </Row>
        </>
      ) : null}

      {/* --- an axis. Which PIECE of it was clicked decides the controls: the
              rule, the numbers, the gridlines and the title are four different
              things that happen to share a `part`. --- */}
      {axisRef && axisRef.sub === 'grid' ? (
        <LineRows
          ds={ds}
          showLabel="Grid"
          show={spec.decorations.gridlines.major?.show ?? false}
          style={gridline}
          onToggle={() => patchGrid((g) => (g.show = !g.show))}
          onPatch={(fn) => patchGrid(fn)}
        />
      ) : null}

      {/* --- the axis title, and the "in $M" note beside the numbers: text, and
              the string itself. Neither has a range, a tick or a rule. --- */}
      {axisRef && (axisRef.sub === 'title' || axisRef.sub === 'unitNote') ? (
        <>
          <Row label={axisRef.sub === 'title' ? 'Title' : 'Units'}>
            <input
              value={
                (axisRef.sub === 'title'
                  ? spec.axes[axisRef.axis]?.title
                  : spec.axes[axisRef.axis]?.unitNote) ?? ''
              }
              placeholder="(none)"
              onChange={(e) =>
                patchAxis((a) => {
                  const v = e.target.value || undefined;
                  if (axisRef.sub === 'title') a.title = v;
                  else a.unitNote = v;
                })
              }
              aria-label={axisRef.sub === 'title' ? 'Axis title' : 'Axis unit note'}
              className={FIELD}
            />
          </Row>
          <TextRows
            ds={ds}
            font={partFont?.font}
            onPatch={applyFont}
          />
        </>
      ) : null}

      {/* --- the rule and its numbers --- */}
      {axisRef && (axisRef.sub === 'line' || axisRef.sub === 'tick' || axisRef.sub === 'tickMark') ? (
        <>
          <Row label="Axis">
            <MiniButton
              active={spec.axes[axisRef.axis]?.show ?? true}
              onClick={() => patchAxis((a) => (a.show = !a.show))}
            >
              Visible
            </MiniButton>
            <MiniButton
              active={axisLineVisible(spec, axisRef.axis)}
              title="The rule along the axis, apart from its numbers."
              onClick={() =>
                patchAxis((a) => (a.line = !axisLineVisible(spec, axisRef.axis)))
              }
            >
              Line
            </MiniButton>
            <MiniButton
              active={spec.decorations.gridlines.major?.show ?? false}
              onClick={() => patchGrid((g) => (g.show = !g.show))}
            >
              Grid
            </MiniButton>
          </Row>
          {/* --- how far the axis runs, and how often it counts ---
                  Only the axis that carries NUMBERS gets these: a banded
                  category axis has no domain to bound and no step to set. */}
          {numericAxis ? (
            <>
              <Row label="Range">
                <AxisNumber
                  value={spec.axes[axisRef.axis]?.min}
                  title="Where the axis starts. Blank fits the data."
                  onChange={(v) => patchAxis((a) => (a.min = v))}
                />
                <span className="shrink-0 text-[10px] text-zinc-400">to</span>
                <AxisNumber
                  value={spec.axes[axisRef.axis]?.max}
                  title="Where the axis ends. Blank fits the data."
                  onChange={(v) => patchAxis((a) => (a.max = v))}
                />
              </Row>
              <Row label="Step">
                <AxisNumber
                  value={spec.axes[axisRef.axis]?.tickStep}
                  title="Distance between ticks. Blank picks a round number that fits."
                  onChange={(v) => patchAxis((a) => (a.tickStep = v))}
                />
              </Row>
              {/* The axis carries the same numbers the labels do, and often
                  wants them written differently — millions on the axis, exact
                  figures on the bars. Unset falls through to the chart's. */}
              <NumberFormatRows
                value={spec.axes[axisRef.axis]?.numberFormat ?? spec.numberFormat}
                onChange={(numberFormat) => patchAxis((a) => (a.numberFormat = numberFormat))}
              />
            </>
          ) : null}
          {/* --- how a DATED axis writes its periods ---
                  The counterpart of `NumberFormatRows` above: the axis that
                  carries dates has a form to pick too, and it is the same
                  question the tick's right-click menu asks. */}
          {tickGrain ? (
            <DateFormatRow
              grain={tickGrain}
              value={spec.axes[axisRef.axis]?.dateFormat}
              onChange={(dateFormat) => patchAxis((a) => (a.dateFormat = dateFormat))}
            />
          ) : null}
          <Row label="Ticks">
            {TICK_MARKS.map((t) => (
              <MiniButton
                key={t.value}
                active={(spec.axes[axisRef.axis]?.tickMarks ?? 'none') === t.value}
                title={t.title}
                onClick={() => patchAxis((a) => (a.tickMarks = t.value))}
              >
                {t.label}
              </MiniButton>
            ))}
          </Row>
          {/* The rule itself carries no type; only the numbers beside it do. */}
          {axisRef.sub === 'tick' ? (
            <TextRows
              ds={ds}
              font={partFont?.font}
              onPatch={applyFont}
            />
          ) : null}
        </>
      ) : null}

      {/* --- the total above a stack --- */}
      {totalRef ? (
        <>
          <Row label="Totals">
            <MiniButton
              active={spec.decorations.totals?.show ?? false}
              onClick={() =>
                store().patchChart(chart.id, (d) => {
                  d.decorations.totals = d.decorations.totals?.show
                    ? undefined
                    : { show: true, content: { kind: 'value' }, placement: 'above' };
                })
              }
            >
              Show
            </MiniButton>
          </Row>
          {spec.decorations.totals?.show ? (
            <TextRows
              ds={ds}
              font={partFont?.font}
              onPatch={applyFont}
            />
          ) : null}
        </>
      ) : null}

      {/* --- the chart's title --- */}
      {titleRef ? (
        <>
          <Row label="Title">
            <input
              value={spec.title ?? ''}
              placeholder="(none)"
              onChange={(e) =>
                store().patchChart(chart.id, (d) => (d.title = e.target.value || undefined))
              }
              aria-label="Chart title"
              className={FIELD}
            />
          </Row>
          <TextRows
            ds={ds}
            font={partFont?.font}
            onPatch={applyFont}
          />
        </>
      ) : null}

      {/* --- the legend. Position is also a drag on the canvas; the buttons are
              here because a legend already parked in a corner is a small target
              and "put it on the right" shouldn't need aim. --- */}
      {legendRef && !markRefs.length ? (
        <>
          {/* The swatch means the series, so this is the whole series' colour —
              first in the panel because it is why anyone clicks a legend key. */}
          {legendColor ? (
            <Row label="Color">
              <Swatches
                ds={ds}
                current={legendColor.fill?.kind === 'solid' ? legendColor.fill.color : undefined}
                onPick={(color) => setLegendColor(color)}
                onClear={() => setLegendColor(null)}
              />
            </Row>
          ) : null}
          <Row label="Legend">
            <MiniButton
              active={spec.legend.show}
              onClick={() => store().patchChart(chart.id, (d) => (d.legend.show = !d.legend.show))}
            >
              Show
            </MiniButton>
            {SIDES.map((s) => (
              <MiniButton
                key={s.value}
                active={spec.legend.position === s.value}
                title={s.title}
                onClick={() => store().patchChart(chart.id, (d) => (d.legend.position = s.value))}
              >
                {s.glyph}
              </MiniButton>
            ))}
          </Row>
          <TextRows
            ds={ds}
            font={partFont?.font}
            onPatch={applyFont}
          />
          {legendRef.part === 'legend.item' ? (
            <Row label="Series">
              <MiniButton
                onClick={() => store().selectExact(seriesMarkIds(legendSeriesKey(legendRef)))}
              >
                Select series
              </MiniButton>
            </Row>
          ) : null}
        </>
      ) : null}

      {/* --- text on the plot: a callout, or the label on an arrow or a rule.
              An arrow's label is DERIVED — the rate, the delta — so blank there
              means "keep computing it", which is why the placeholder says auto
              rather than empty. --- */}
      {deco ? (
        <>
          <Row label={deco.kind === 'annotation' ? 'Note' : 'Label'}>
            <input
              value={deco.kind === 'annotation' ? deco.node.text : (deco.node.label ?? '')}
              placeholder={deco.kind === 'annotation' ? '(empty)' : '(auto)'}
              onChange={(e) =>
                patchDeco((n) => {
                  if (deco.kind === 'annotation') n.text = e.target.value;
                  else n.label = e.target.value || undefined;
                })
              }
              aria-label={deco.kind === 'annotation' ? 'Annotation text' : 'Decoration label'}
              className={FIELD}
            />
          </Row>
          {deco.kind === 'annotation' ? (
            <Row label="Leader">
              <MiniButton
                active={deco.node.connector ?? false}
                title="Draw a line from the note to the point it is about."
                onClick={() =>
                  patchDeco((n) => (n.connector = !n.connector))
                }
              >
                Line
              </MiniButton>
            </Row>
          ) : null}
          <TextRows
            ds={ds}
            font={partFont?.font}
            onPatch={applyFont}
          />
        </>
      ) : null}

      {series && !wholeSeries && (overridden || nudged) ? (
        <div className="flex gap-1 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
          <MiniButton onClick={resetPoints} title="Drop this point's own formatting">
            Reset to series
          </MiniButton>
          {nudged ? (
            <MiniButton
              onClick={() =>
                store().patchChart(chart.id, (d) => {
                  if (!isGridSpec(d)) return;
                  const ser = d.data.series.find((s) => s.key === seriesKey);
                  for (const key of pointKeys) delete ser?.pointOverrides?.[key]?.labelOffset;
                })
              }
              title="Put the label back where the layout wants it"
            >
              Reset position
            </MiniButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
