'use client';

/**
 * The datasheet's contextual controls — think-cell's model.
 *
 * What replaced a wall of thirty dropdowns. A chart has a lot of settings, but
 * nobody is ever adjusting all of them: they are looking at one part and want
 * that part's options. So the panel shows the options for whatever was clicked
 * IN THE PREVIEW and nothing else, and with nothing selected it shows only the
 * handful that belong to the chart as a whole.
 *
 * Two rules it keeps:
 *
 * - **Everything writes to the SPEC**, through `patchChart`, so undo behaves the
 *   same whether the change came from here, the datasheet or the canvas.
 * - **One row, always.** The panel sits above the sheet and the preview, and the
 *   moment it grows into a second wall of controls it has failed at its job.
 *   A part with more options than fit is a sign the part is too coarse, not a
 *   reason to make the panel taller.
 *
 * It is deliberately NOT `ChartPartPopover`: that one is anchored to a selection
 * on the canvas and driven by Moveable and the element selection. This is driven
 * by a `ChartRef` from a preview hit-test, with no canvas underneath it.
 *
 * It takes a `patch` callback rather than reaching into the editor store, so the
 * SAME row edits a chart on a slide and a chart TEMPLATE in Admin. Whoever owns
 * the spec decides what a write means — a history entry here, local template
 * state there.
 */
import {
  axisLineVisible,
  canSwapAxes,
  convertData,
  chartOrientation,
  emuToPoints,
  hex as hexRef,
  isGridSpec,
  isXYSpec,
  legendSeriesKey,
  pointsToEmu,
  setChartOrientation,
  supportsOrientation,
  supportsSecondaryAxis,
  swapAxes,
  token,
  DEFAULT_AXIS,
  type AxisId,
  type AxisSpec,
  type ChartKind,
  type ChartRef,
  type ChartSpec,
  type ColorRef,
  type DashStyle,
  type DesignSystem,
  type GridSeries,
  type LabelContent,
  type LabelPlacement,
  type LabelSpec,
  type MarkerShape,
  type NumberFormat,
  type SeriesFormat,
  type XYSeries,
} from '@/model';
import { SUPPORTED_KINDS } from '@/chart/compile';
import { CHART_KIND_LABELS } from '@/charts/kinds';
import {
  DEFAULT_TICK_FORMAT,
  TICK_FORMAT_CHOICES,
  sampleTick,
} from '@/chart/format/dateAxis';
import { legendEntryColor, recolorLegendEntry } from '@/store/chartActions';
import { emphasisSeriesKey } from '@/chart/place/lineArea';
import { CustomColorSwatch, customHexOf } from '../color';
import { markCapabilities, markRender } from './markCaps';
import { axisDateGrain } from '../chartDateMenu';
import { DatePatternInput } from './DateFormatRow';
import { NumberPatternInput } from './NumberFormatRows';
import { describePart } from './previewHitTest';

/** Mutate the spec in place. The owner turns that into whatever a write means. */
export type ChartPatch = (fn: (spec: ChartSpec) => void) => void;

const FIELD =
  'h-6 rounded border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

/**
 * Seven types, not twelve. Column and bar are one entry because orientation is
 * its own control; donut is a variant of pie and area of line.
 *
 * Each entry pairs the kind it WRITES with the kind whose word names it. They
 * differ for the collapsed bar family: the value is `column` because that is
 * what an unoriented bar chart is stored as, but the word has to be the
 * orientation-free "Bar" rather than `column`'s own label.
 */
const KIND_OPTIONS: { value: ChartKind; label: string }[] = (
  [
    ['column', 'bar'],
    ['line', 'line'],
    ['combo', 'combo'],
    ['waterfall', 'waterfall'],
    ['pie', 'pie'],
    ['sankey', 'sankey'],
    ['dotplot', 'dotplot'],
    ['scatter', 'scatter'],
    ['bubble', 'bubble'],
    ['gantt', 'gantt'],
  ] satisfies [ChartKind, ChartKind][]
).map(([value, labelKind]) => ({ value, label: CHART_KIND_LABELS[labelKind] }));

const displayKind = (kind: ChartKind): ChartKind =>
  kind === 'bar' ? 'column' : kind === 'donut' ? 'pie' : kind === 'area' ? 'line' : kind;

/** The single-field kinds. `custom` and `composite` need an editor of their own. */
type SimpleContent = Extract<LabelContent, { kind: 'value' | 'percent' | 'category' | 'seriesName' }>;

const LABEL_CONTENTS: { value: SimpleContent['kind']; label: string }[] = [
  { value: 'value', label: 'Value' },
  { value: 'percent', label: 'Share' },
  { value: 'category', label: 'Category' },
  { value: 'seriesName', label: 'Series' },
];

/** Grid and XY series differ in their DATA; everything formattable is shared. */
type AnySeries = GridSeries | XYSeries;

/** The series with this key, whichever data shape the spec carries. */
function findSeries(spec: ChartSpec, key: string): AnySeries | undefined {
  if (isGridSpec(spec)) return spec.data.series.find((s) => s.key === key);
  if (isXYSpec(spec)) return spec.data.series.find((s) => s.key === key);
  return undefined;
}

const DASHES: { value: DashStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dash', label: 'Dashed' },
  { value: 'dot', label: 'Dotted' },
];

const MARKER_SHAPES: { value: MarkerShape; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'triangle', label: 'Triangle' },
];

const DEFAULT_MARKER_PT = 5;

const PLACEMENT_LABELS: Record<LabelPlacement, string> = {
  auto: 'Auto',
  outsideEnd: 'Outside',
  insideEnd: 'Inside end',
  insideCenter: 'Center',
  insideBase: 'Inside base',
  above: 'Above',
  below: 'Below',
  left: 'Left',
  right: 'Right',
};

/** The five `placeColumnBar` distinguishes — it folds `above`, `below`, `left`
 *  and `right` into `outsideEnd`, so offering those is four names for one. A
 *  placer that DOES tell them apart names its own set; see
 *  `MarkCapabilities.placements`. */
const PLACEMENTS: LabelPlacement[] = [
  'auto',
  'outsideEnd',
  'insideEnd',
  'insideCenter',
  'insideBase',
];

/* ------------------------------------------------------------------ */
/* Controls                                                           */
/* ------------------------------------------------------------------ */

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex shrink-0 flex-col gap-0.5">
      <span className="whitespace-nowrap text-[10px] text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="flex h-6 items-center gap-1">{children}</span>
    </label>
  );
}

function Toggle({
  on,
  onClick,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`h-6 rounded border px-1.5 text-[11px] ${
        on
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-black'
          : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

/** A number input where blank genuinely means "auto", not zero. */
function AutoNumber({
  value,
  onChange,
  placeholder = 'auto',
  width = 'w-16',
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  width?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      className={`${FIELD} ${width} text-right`}
    />
  );
}

function Swatches({
  ds,
  current,
  onPick,
}: {
  ds: DesignSystem;
  /** What's set now — a token id, a hex, or nothing (following the brand). */
  current?: ColorRef;
  onPick: (color: ColorRef) => void;
}) {
  const currentToken = current?.kind === 'token' ? current.token : undefined;
  return (
    <span className="flex items-center gap-1">
      {ds.colors.slice(0, 7).map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(token(c.id))}
          title={c.name}
          aria-label={c.name}
          className={`h-4 w-4 rounded-full ring-1 ${
            currentToken === c.id ? 'ring-2 ring-indigo-500' : 'ring-black/15'
          }`}
          style={{ background: c.hex }}
        />
      ))}
      <CustomColorSwatch
        value={customHexOf(current)}
        active={current?.kind === 'hex'}
        onPick={(h) => onPick(hexRef(h))}
        size="h-4 w-4"
        shape="rounded-full"
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */

export function ChartPartOptions({
  spec,
  ds,
  part,
  patch,
  onClear,
  trailing,
}: {
  spec: ChartSpec;
  ds: DesignSystem;
  /** The part clicked in the preview, or null for the chart as a whole. */
  part: ChartRef | null;
  patch: ChartPatch;
  onClear: () => void;
  /** Owner-specific controls, pinned right — Admin's orientation note, say. */
  trailing?: React.ReactNode;
}) {
  // Keyed by `AxisId`, which includes the optional secondary value axis — a
  // combo chart's `y2` is a real axis somebody can click.
  const setAxis = (axis: AxisId, fn: (a: AxisSpec) => void) =>
    patch((s) => {
      const ax = s.axes[axis];
      if (ax) fn(ax);
    });
  const setFormat = (fn: (f: NumberFormat) => void) => patch((s) => fn(s.numberFormat));
  const setLabels = (fn: (l: ChartSpec['decorations']['labels']) => void) =>
    patch((s) => fn(s.decorations.labels));

  const seriesKey =
    part && (part.part === 'mark' || part.part === 'label')
      ? part.series
      : part?.part === 'legend.item'
        ? legendSeriesKey(part)
        : null;
  const series = seriesKey ? findSeries(spec, seriesKey) : undefined;

  /** Edit the selected series in place — grid or XY, one path for both. */
  const setSeries = (fn: (s: AnySeries) => void) =>
    patch((s) => {
      if (!seriesKey) return;
      const ser = findSeries(s, seriesKey);
      if (ser) fn(ser);
    });

  const setSeriesFormat = (fn: (f: SeriesFormat) => void) =>
    setSeries((s) => {
      s.format = { ...s.format };
      fn(s.format);
    });

  /**
   * The series' own label settings, which fall through to the chart's.
   *
   * `LabelSpec` is required-field, and a series override is a partial of it in
   * practice — the placers spread `{...chartDefault, ...series.labels}`. Seeded
   * from the chart default on first write so the stored object is a valid one.
   */
  const setSeriesLabels = (fn: (l: LabelSpec) => void) =>
    patch((draft) => {
      if (!seriesKey) return;
      const ser = findSeries(draft, seriesKey);
      if (!ser) return;
      ser.labels = { ...draft.decorations.labels, ...ser.labels };
      fn(ser.labels);
    });

  /**
   * Move a series between the two value axes.
   *
   * The `y2` axis is created on the way in and dropped again when the last
   * series leaves it: an axis spec with nothing plotted against it is a gutter
   * of numbers that mean nothing, and the compiler draws one only while a
   * series is actually on it.
   */
  const setSeriesAxis = (axis: 'primary' | 'secondary') =>
    patch((s) => {
      if (!seriesKey || !isGridSpec(s)) return;
      const ser = s.data.series.find((x) => x.key === seriesKey);
      if (!ser) return;
      ser.axis = axis === 'secondary' ? 'secondary' : undefined;
      if (axis === 'secondary') {
        s.axes.y2 ??= { ...DEFAULT_AXIS };
      } else if (!s.data.series.some((x) => x.axis === 'secondary')) {
        s.axes.y2 = undefined;
      }
    });

  const onSecondary =
    isGridSpec(spec) && !!seriesKey
      ? spec.data.series.find((s) => s.key === seriesKey)?.axis === 'secondary'
      : false;

  /**
   * Which axis this series is read against — the whole point of a combo, and
   * of any chart carrying a rate beside an absolute.
   */
  const axisPicker =
    series && seriesKey && supportsSecondaryAxis(spec.kind) ? (
      <Group label="Plot on">
        <select
          value={onSecondary ? 'secondary' : 'primary'}
          onChange={(e) => setSeriesAxis(e.target.value as 'primary' | 'secondary')}
          className={`${FIELD} w-24`}
        >
          <option value="primary">Left axis</option>
          <option value="secondary">Right axis</option>
        </select>
      </Group>
    ) : null;

  const rows = (() => {
    switch (part?.part) {
      /* --- axis: the label, the ticks, the type size --- */
      case 'axis': {
        const axis = part.axis;
        const ax = spec.axes[axis];
        // The axis that carries NUMBERS — the value axis, or a scatter's
        // continuous x — is the one with a range and a step to set. A banded
        // category axis has a list of names instead of a domain.
        const value =
          axis !== 'x' || spec.kind === 'scatter' || spec.kind === 'bubble';
        // The grain the labels are at, which decides whether a date format is a
        // question worth asking. See `axisDateGrain`.
        const dateGrain = axis === 'x' ? axisDateGrain(spec) : null;
        return (
          <>
            <Group label="Show">
              <Toggle on={ax?.show ?? true} onClick={() => setAxis(axis, (a) => (a.show = !a.show))}>
                Axis
              </Toggle>
              {/* The rule, separately from the numbers beside it: an axis
                  labelled but unruled is a house style, and `show` alone
                  couldn't ask for it. */}
              <Toggle
                on={axisLineVisible(spec, axis)}
                onClick={() =>
                  setAxis(axis, (a) => (a.line = !axisLineVisible(spec, axis)))
                }
              >
                Line
              </Toggle>
              {value ? (
                <Toggle
                  on={spec.decorations.gridlines.major?.show ?? false}
                  onClick={() =>
                    patch((s) => {
                      s.decorations.gridlines.major = {
                        ...s.decorations.gridlines.major,
                        show: !s.decorations.gridlines.major?.show,
                      };
                    })
                  }
                >
                  Grid
                </Toggle>
              ) : null}
            </Group>

            <Group label="Title">
              <input
                value={ax?.title ?? ''}
                placeholder="(none)"
                onChange={(e) =>
                  setAxis(axis, (a) => (a.title = e.target.value || undefined))
                }
                className={`${FIELD} w-32`}
              />
            </Group>

            {value ? (
              <>
                <Group label="Min">
                  <AutoNumber value={ax?.min} onChange={(v) => setAxis(axis, (a) => (a.min = v))} />
                </Group>
                <Group label="Max">
                  <AutoNumber value={ax?.max} onChange={(v) => setAxis(axis, (a) => (a.max = v))} />
                </Group>
                <Group label="Ticks every">
                  <AutoNumber
                    value={ax?.tickStep}
                    onChange={(v) => setAxis(axis, (a) => (a.tickStep = v))}
                  />
                </Group>
                <Group label="Divide by">
                  <select
                    value={ax?.unitDivisor ?? 1}
                    onChange={(e) =>
                      setAxis(axis, (a) => {
                        const d = Number(e.target.value);
                        a.unitDivisor = d === 1 ? undefined : d;
                        // The note is the only thing telling a reader the axis
                        // is scaled, so it moves with the divisor unless they
                        // have written their own.
                        const auto: Record<number, string> = {
                          1000: 'in thousands',
                          1000000: 'in millions',
                          1000000000: 'in billions',
                        };
                        if (!a.unitNote || Object.values(auto).includes(a.unitNote)) {
                          a.unitNote = auto[d];
                        }
                      })
                    }
                    className={`${FIELD} w-24`}
                  >
                    <option value={1}>—</option>
                    <option value={1000}>Thousands</option>
                    <option value={1000000}>Millions</option>
                    <option value={1000000000}>Billions</option>
                  </select>
                </Group>
              </>
            ) : null}

            {/* A dated category axis has a FORM as well as a font — "2Q25"
                or "Q2 2025" — and it is the same list the tick's right-click
                menu offers. Absent for an axis whose labels aren't periods. */}
            {!value && dateGrain ? (
              <Group label="Dates">
                <select
                  value={ax?.dateFormat ?? ''}
                  onChange={(e) =>
                    setAxis(axis, (a) => (a.dateFormat = e.target.value || undefined))
                  }
                  aria-label="Date format"
                  title="How each period is written. Auto follows the axis's own grain."
                  className={`${FIELD} w-24`}
                >
                  <option value="">{`Auto (${sampleTick(dateGrain, DEFAULT_TICK_FORMAT[dateGrain])})`}</option>
                  {TICK_FORMAT_CHOICES[dateGrain].map((p) => (
                    <option key={p} value={p}>
                      {sampleTick(dateGrain, p)}
                    </option>
                  ))}
                  {/* A pattern typed into the box joins the list for as long as
                      it is the answer — a select with no matching option would
                      otherwise show blank. */}
                  {ax?.dateFormat && !TICK_FORMAT_CHOICES[dateGrain].includes(ax.dateFormat) ? (
                    <option value={ax.dateFormat}>{sampleTick(dateGrain, ax.dateFormat)}</option>
                  ) : null}
                </select>
                <DatePatternInput
                  value={ax?.dateFormat}
                  onChange={(dateFormat) => setAxis(axis, (a) => (a.dateFormat = dateFormat))}
                  className={`${FIELD} w-20`}
                />
              </Group>
            ) : null}

            <Group label="Tick marks">
              <select
                value={ax?.tickMarks ?? 'none'}
                onChange={(e) =>
                  setAxis(axis, (a) => (a.tickMarks = e.target.value as typeof a.tickMarks))
                }
                className={`${FIELD} w-20`}
              >
                <option value="none">None</option>
                <option value="out">Outside</option>
                <option value="in">Inside</option>
              </select>
            </Group>

            <Group label="Type size">
              <AutoNumber
                value={ax?.font?.sizePt}
                width="w-14"
                onChange={(v) =>
                  setAxis(axis, (a) => {
                    a.font = v === undefined ? undefined : { ...a.font, sizePt: v };
                  })
                }
              />
            </Group>
          </>
        );
      }

      /* --- a bar, or the number on it --- */
      case 'mark':
      case 'label': {
        const labels = spec.decorations.labels;
        // Through the REF, not the series key: a kind whose marks differ within
        // one series has no series-level answer to give — see `markRender`.
        const render = seriesKey ? markRender(spec, part) : null;
        // The same table the popover reads, so the two surfaces can't disagree
        // about whether a slice has a label placement.
        const caps = render ? markCapabilities(spec, render) : null;
        const colorPicker = series ? (
          <Group label="Color">
            <Swatches
              ds={ds}
              current={
                series.format?.fill?.kind === 'solid' ? series.format.fill.color : undefined
              }
              onPick={(color) =>
                setSeriesFormat((f) => {
                  f.fill = { kind: 'solid', color };
                  // A line takes its colour from the outline; leaving the old
                  // one set would repaint the dots and leave the line grey.
                  if (f.outline) f.outline = { ...f.outline, color };
                })
              }
            />
          </Group>
        ) : null;

        /* --- a line, its dots, and which line the chart is about --- */
        if (series && seriesKey && (render === 'line' || render === 'area')) {
          const marker = series.format?.marker;
          const focused =
            spec.kind === 'line' &&
            emphasisSeriesKey(
              spec,
              isGridSpec(spec) ? spec.data.series.map((s) => s.key) : [],
            ) === seriesKey;
          return (
            <>
              {colorPicker}
              {axisPicker}

              {spec.kind === 'line' ? (
                <Group label="Focus">
                  <Toggle
                    on={focused}
                    title={
                      focused
                        ? 'This is the subject of the chart. Turn it off to draw every line in its own colour.'
                        : 'Draw this line in full colour and let the others recede to grey.'
                    }
                    onClick={() =>
                      patch((s) => {
                        if (s.kind !== 'line') return;
                        s.emphasis = focused ? null : seriesKey;
                      })
                    }
                  >
                    Main line
                  </Toggle>
                </Group>
              ) : null}

              {render === 'line' ? (
                <>
                  <Group label="Weight">
                    <AutoNumber
                      width="w-14"
                      value={
                        series.format?.lineWidthEmu === undefined
                          ? undefined
                          : Number(emuToPoints(series.format.lineWidthEmu).toFixed(2))
                      }
                      onChange={(v) =>
                        setSeriesFormat((f) => {
                          f.lineWidthEmu = v === undefined ? undefined : pointsToEmu(v);
                        })
                      }
                    />
                  </Group>

                  <Group label="Dash">
                    <select
                      value={series.format?.dash ?? ''}
                      onChange={(e) =>
                        setSeriesFormat((f) => {
                          f.dash = (e.target.value || undefined) as DashStyle | undefined;
                        })
                      }
                      className={`${FIELD} w-20`}
                    >
                      <option value="">Auto</option>
                      {DASHES.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </Group>

                  <Group label="Dots">
                    <select
                      value={marker?.shape ?? 'none'}
                      onChange={(e) => {
                        const shape = e.target.value as MarkerShape;
                        setSeriesFormat((f) => {
                          f.marker =
                            shape === 'none'
                              ? undefined
                              : {
                                  ...f.marker,
                                  shape,
                                  sizeEmu: f.marker?.sizeEmu || pointsToEmu(DEFAULT_MARKER_PT),
                                };
                        });
                      }}
                      className={`${FIELD} w-24`}
                    >
                      {MARKER_SHAPES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    {marker && marker.shape !== 'none' ? (
                      <AutoNumber
                        width="w-12"
                        placeholder={String(DEFAULT_MARKER_PT)}
                        value={
                          marker.sizeEmu
                            ? Number(emuToPoints(marker.sizeEmu).toFixed(1))
                            : undefined
                        }
                        onChange={(v) =>
                          setSeriesFormat((f) => {
                            if (!f.marker) return;
                            f.marker = {
                              ...f.marker,
                              sizeEmu: pointsToEmu(v ?? DEFAULT_MARKER_PT),
                            };
                          })
                        }
                      />
                    ) : null}
                  </Group>
                </>
              ) : null}

              {spec.kind === 'line' ? (
                <Group label="End labels">
                  <Toggle
                    on={spec.endLabels ?? false}
                    title="Name each line at its right-hand end, so the chart doesn't need a legend."
                    onClick={() =>
                      patch((s) => {
                        if (s.kind === 'line') s.endLabels = !s.endLabels;
                      })
                    }
                  >
                    Show
                  </Toggle>
                </Group>
              ) : null}

              {/* A stroked series' only text is a line chart's end label, and
                  only when it is switched on — `placeLineArea` draws no
                  per-point label at all, so with them off this sizes nothing. */}
              {spec.kind === 'line' && spec.endLabels ? (
                <Group label="Name size">
                  <AutoNumber
                    width="w-14"
                    placeholder={String(labels.font?.sizePt ?? 'auto')}
                    value={series.labels?.font?.sizePt}
                    onChange={(v) =>
                      setSeriesLabels((l) => {
                        l.font = v === undefined ? undefined : { ...l.font, sizePt: v };
                      })
                    }
                  />
                </Group>
              ) : null}
            </>
          );
        }

        return (
          <>
            {colorPicker}
            {axisPicker}

            <Group label="Labels">
              <Toggle on={labels.show} onClick={() => setLabels((l) => (l.show = !l.show))}>
                Show
              </Toggle>
            </Group>
            {/* A scatter labels a point with the point's own name, and a Mekko
                cell always reports its share: neither reads the content kind. */}
            {caps?.content !== false ? (
              <Group label="Shows">
                <select
                  value={labels.content.kind}
                  onChange={(e) =>
                    setLabels((l) => (l.content = { kind: e.target.value as SimpleContent['kind'] }))
                  }
                  className={`${FIELD} w-24`}
                >
                  {LABEL_CONTENTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Group>
            ) : null}
            {/* Only `placeColumnBar` honours a placement — a slice's label sits
                on its slice and a point's beside its dot, whatever this says. */}
            {caps?.placement !== false ? (
              <Group label="Place">
                <select
                  value={labels.placement}
                  onChange={(e) =>
                    setLabels((l) => (l.placement = e.target.value as LabelPlacement))
                  }
                  className={`${FIELD} w-24`}
                >
                  {(caps?.placements ?? PLACEMENTS).map((o) => (
                    <option key={o} value={o}>
                      {PLACEMENT_LABELS[o]}
                    </option>
                  ))}
                </select>
              </Group>
            ) : null}
            {/* Per SERIES when one is selected — "make the actuals bigger than
                the forecast" is the common ask, and a chart-wide size can't
                say it. Blank falls back to the chart's, shown as the hint. */}
            <Group label={series ? 'Label size' : 'Type size'}>
              <AutoNumber
                value={series ? series.labels?.font?.sizePt : labels.font?.sizePt}
                width="w-14"
                placeholder={series ? String(labels.font?.sizePt ?? 'auto') : 'auto'}
                onChange={(v) =>
                  series
                    ? setSeriesLabels((l) => {
                        l.font = v === undefined ? undefined : { ...l.font, sizePt: v };
                      })
                    : setLabels((l) => {
                        l.font = v === undefined ? undefined : { ...l.font, sizePt: v };
                      })
                }
              />
            </Group>
            <Group label="Numbers">
              <select
                value={spec.numberFormat.style}
                onChange={(e) => setFormat((f) => (f.style = e.target.value as NumberFormat['style']))}
                className={`${FIELD} w-24`}
              >
                <option value="number">Number</option>
                <option value="currency">Currency</option>
                <option value="percent">Percent</option>
              </select>
              <select
                value={spec.numberFormat.scale ?? 'none'}
                onChange={(e) => setFormat((f) => (f.scale = e.target.value as NumberFormat['scale']))}
                aria-label="Number place"
                className={`${FIELD} w-20`}
              >
                <option value="none">—</option>
                <option value="auto">Auto</option>
                <option value="K">K</option>
                <option value="M">M</option>
                <option value="B">B</option>
                <option value="T">T</option>
              </select>
              {/* Blank is auto, which resolves across the whole set at once —
                  the thing that keeps a column of labels lined up. */}
              <select
                value={spec.numberFormat.decimals === undefined ? '' : String(spec.numberFormat.decimals)}
                onChange={(e) =>
                  setFormat((f) => {
                    f.decimals = e.target.value === '' ? undefined : Number(e.target.value);
                  })
                }
                aria-label="Decimal places"
                title="Decimal places. Auto gives the whole set the fewest that keep it exact."
                className={`${FIELD} w-16`}
              >
                <option value="">0.#</option>
                <option value="0">0</option>
                <option value="1">0.0</option>
                <option value="2">0.00</option>
                <option value="3">0.000</option>
              </select>
              {/* The pattern the three dropdowns can't spell. It writes the
                  same curated fields they do — see `parseNumberPattern`. */}
              <NumberPatternInput
                value={spec.numberFormat}
                onChange={(next) => patch((sp) => (sp.numberFormat = next))}
                className={`${FIELD} w-24`}
              />
            </Group>
          </>
        );
      }

      /* --- the total above a stack --- */
      case 'total':
        return (
          <>
            <Group label="Totals">
              <Toggle
                on={spec.decorations.totals?.show ?? false}
                onClick={() =>
                  patch((s) => {
                    s.decorations.totals = s.decorations.totals?.show
                      ? undefined
                      : { show: true, content: { kind: 'value' }, placement: 'above' };
                  })
                }
              >
                Show
              </Toggle>
            </Group>
            <Group label="Type size">
              <AutoNumber
                value={spec.decorations.totals?.font?.sizePt}
                width="w-14"
                onChange={(v) =>
                  patch((s) => {
                    if (!s.decorations.totals) return;
                    s.decorations.totals.font =
                      v === undefined ? undefined : { ...s.decorations.totals.font, sizePt: v };
                  })
                }
              />
            </Group>
          </>
        );

      /* --- legend --- */
      case 'legend.item':
      case 'legend.box': {
        // A legend key stands for its whole series (a slice, in a pie's legend),
        // so the swatch recolours all of it — `recolorLegendEntry` finds the node
        // that owns the colour and clears the per-point fills that would shadow
        // it. `null` where the key addresses nothing writable.
        const legendKey = part.part === 'legend.item' ? legendSeriesKey(part) : null;
        const legendColor = legendKey ? legendEntryColor(spec, legendKey) : null;
        return (
          <>
            {legendKey && legendColor ? (
              <Group label="Color">
                <Swatches
                  ds={ds}
                  current={legendColor.fill?.kind === 'solid' ? legendColor.fill.color : undefined}
                  onPick={(color) =>
                    patch((s) => recolorLegendEntry(s, legendKey, { kind: 'solid', color }))
                  }
                />
              </Group>
            ) : null}
            <Group label="Legend">
              <Toggle
                on={spec.legend.show}
                onClick={() => patch((s) => (s.legend.show = !s.legend.show))}
              >
                Show
              </Toggle>
            </Group>
            <Group label="Position">
              <select
                value={spec.legend.position}
                onChange={(e) =>
                  patch((s) => (s.legend.position = e.target.value as typeof s.legend.position))
                }
                className={`${FIELD} w-24`}
              >
                <option value="top">Top</option>
                <option value="right">Right</option>
                <option value="bottom">Bottom</option>
                <option value="left">Left</option>
                {/* Inside the plot, level with the top of the y axis: costs the
                    data no gutter, which is why it's worth its own entry. */}
                <option value="insideTopLeft">Inside top left</option>
                <option value="insideTopRight">Inside top right</option>
              </select>
            </Group>
            {series ? (
              <Group label="Name">
                <input
                  value={series.name}
                  onChange={(e) => setSeries((s) => (s.name = e.target.value))}
                  className={`${FIELD} w-32`}
                />
              </Group>
            ) : null}
          </>
        );
      }

      /* --- the chart's title --- */
      case 'title':
        return (
          <Group label="Title">
            <input
              value={spec.title ?? ''}
              placeholder="(none)"
              onChange={(e) => patch((s) => (s.title = e.target.value || undefined))}
              className={`${FIELD} w-64`}
            />
          </Group>
        );

      /* --- nothing selected, or the plot background: the whole chart --- */
      default:
        return (
          <>
            <Group label="Type">
              <select
                value={displayKind(spec.kind)}
                onChange={(e) => {
                  const next = e.target.value as ChartKind;
                  patch((s) => {
                    // Keep the orientation across a type change: someone who set
                    // up horizontal bars and switches to a waterfall means a
                    // horizontal waterfall, not a reset.
                    const was = chartOrientation(s);
                    const converted = convertData(s, next);
                    Object.assign(
                      s,
                      supportsOrientation(next) ? setChartOrientation(converted, was) : converted,
                    );
                  });
                }}
                className={`${FIELD} w-28`}
              >
                {KIND_OPTIONS.filter((k) => SUPPORTED_KINDS.includes(k.value)).map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Group>

            {'stack' in spec ? (
              <Group label="Stacking">
                <select
                  value={(spec as { stack: string }).stack}
                  onChange={(e) =>
                    patch((s) => {
                      if (!('stack' in s)) return;
                      const mode = e.target.value as 'clustered' | 'stacked' | 'stacked100';
                      s.stack = mode;
                      // Overlap is what actually makes bars sit on one another;
                      // leaving it clustered would stack them visually apart.
                      if ('overlapPct' in s) s.overlapPct = mode === 'clustered' ? -27 : 100;
                    })
                  }
                  className={`${FIELD} w-28`}
                >
                  <option value="clustered">Clustered</option>
                  <option value="stacked">Stacked</option>
                  <option value="stacked100">100% stacked</option>
                </select>
              </Group>
            ) : null}

            <Group label="Title">
              <input
                value={spec.title ?? ''}
                placeholder="(none)"
                onChange={(e) => patch((s) => (s.title = e.target.value || undefined))}
                className={`${FIELD} w-40`}
              />
            </Group>

            {'gapWidthPct' in spec ? (
              <Group label="Gap width">
                <AutoNumber
                  value={spec.gapWidthPct}
                  width="w-14"
                  onChange={(v) =>
                    patch((s) => {
                      if ('gapWidthPct' in s) s.gapWidthPct = v ?? 0;
                    })
                  }
                />
              </Group>
            ) : null}

            {canSwapAxes(spec.kind) ? (
              <Group label="Axes">
                <Toggle on={false} onClick={() => patch((s) => Object.assign(s, swapAxes(s)))}>
                  Swap X and Y
                </Toggle>
              </Group>
            ) : null}
          </>
        );
    }
  })();

  return (
    <div className="flex shrink-0 items-end gap-3 overflow-x-auto border-b border-zinc-200 bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex shrink-0 flex-col gap-0.5">
        <span className="text-[10px] text-transparent">.</span>
        <span className="flex h-6 items-center gap-1">
          <span className="whitespace-nowrap text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
            {part
              ? describePart(
                  part,
                  series?.name,
                  seriesKey ? (markRender(spec, part) ?? undefined) : undefined,
                )
              : 'Chart'}
          </span>
          {part ? (
            <button
              type="button"
              onClick={onClear}
              title="Back to the whole chart"
              aria-label="Back to the whole chart"
              className="rounded px-1 text-[11px] text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              ⤺
            </button>
          ) : null}
        </span>
      </div>

      <div className="h-9 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />

      {rows}

      {trailing ? <span className="ml-auto shrink-0 self-center">{trailing}</span> : null}

      {part || trailing ? null : (
        <span className="ml-auto shrink-0 self-center text-[11px] text-zinc-400">
          Click a part of the preview — an axis, a bar, the legend — to format it
        </span>
      )}
    </div>
  );
}
