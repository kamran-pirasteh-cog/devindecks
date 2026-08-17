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
  canSwapAxes,
  convertData,
  chartOrientation,
  emuToPoints,
  isGridSpec,
  isXYSpec,
  legendSeriesKey,
  pointsToEmu,
  setChartOrientation,
  supportsOrientation,
  swapAxes,
  token,
  type AxisId,
  type AxisSpec,
  type ChartKind,
  type ChartRef,
  type ChartSpec,
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
import { emphasisSeriesKey } from '@/chart/place/lineArea';
import { describePart } from './previewHitTest';

/** Mutate the spec in place. The owner turns that into whatever a write means. */
export type ChartPatch = (fn: (spec: ChartSpec) => void) => void;

const FIELD =
  'h-6 rounded border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

/**
 * Seven types, not twelve. Column and bar are one entry because orientation is
 * its own control; donut is a variant of pie and area of line.
 */
const KIND_OPTIONS: { value: ChartKind; label: string }[] = [
  { value: 'column', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'combo', label: 'Column + line' },
  { value: 'waterfall', label: 'Waterfall' },
  { value: 'pie', label: 'Pie' },
  { value: 'sankey', label: 'Sankey' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'bubble', label: 'Bubble' },
];

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

/**
 * How the selected series is DRAWN, which is what decides its options.
 *
 * A combo chart's series are not all the same shape — one is a column and the
 * next is a line over it — so the panel can't read this off `spec.kind`. A
 * line's options (weight, dash, dots) are meaningless on a bar, and offering
 * them is worse than not offering them: they write to the spec and nothing on
 * screen moves.
 */
export function seriesRender(
  spec: ChartSpec,
  key: string,
): 'column' | 'line' | 'area' | 'point' | 'slice' {
  switch (spec.kind) {
    case 'line':
      return 'line';
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

const PLACEMENTS: { value: LabelPlacement; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'outsideEnd', label: 'Outside' },
  { value: 'insideEnd', label: 'Inside end' },
  { value: 'insideCenter', label: 'Center' },
  { value: 'insideBase', label: 'Inside base' },
  { value: 'above', label: 'Above' },
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
  current?: string;
  onPick: (tokenId: string) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      {ds.colors.slice(0, 7).map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          title={c.name}
          aria-label={c.name}
          className={`h-4 w-4 rounded-full ring-1 ${
            current === c.id ? 'ring-2 ring-indigo-500' : 'ring-black/15'
          }`}
          style={{ background: c.hex }}
        />
      ))}
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

  const rows = (() => {
    switch (part?.part) {
      /* --- axis: the label, the ticks, the type size --- */
      case 'axis': {
        const axis = part.axis;
        const ax = spec.axes[axis];
        const value = axis === 'y';
        return (
          <>
            <Group label="Show">
              <Toggle on={ax?.show ?? true} onClick={() => setAxis(axis, (a) => (a.show = !a.show))}>
                Axis
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
        const render = seriesKey ? seriesRender(spec, seriesKey) : null;
        const colorPicker = series ? (
          <Group label="Color">
            <Swatches
              ds={ds}
              current={
                series.format?.fill?.kind === 'solid' && series.format.fill.color.kind === 'token'
                  ? series.format.fill.color.token
                  : undefined
              }
              onPick={(id) =>
                setSeriesFormat((f) => {
                  f.fill = { kind: 'solid', color: token(id) };
                  // A line takes its colour from the outline; leaving the old
                  // one set would repaint the dots and leave the line grey.
                  if (f.outline) f.outline = { ...f.outline, color: token(id) };
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

              <Group label="Label size">
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
            </>
          );
        }

        return (
          <>
            {colorPicker}

            <Group label="Labels">
              <Toggle on={labels.show} onClick={() => setLabels((l) => (l.show = !l.show))}>
                Show
              </Toggle>
            </Group>
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
            <Group label="Place">
              <select
                value={labels.placement}
                onChange={(e) =>
                  setLabels((l) => (l.placement = e.target.value as LabelPlacement))
                }
                className={`${FIELD} w-24`}
              >
                {PLACEMENTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Group>
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
                className={`${FIELD} w-20`}
              >
                <option value="none">—</option>
                <option value="auto">Auto</option>
                <option value="K">K</option>
                <option value="M">M</option>
                <option value="B">B</option>
              </select>
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
      case 'legend.box':
        return (
          <>
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
                  seriesKey ? seriesRender(spec, seriesKey) : undefined,
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
