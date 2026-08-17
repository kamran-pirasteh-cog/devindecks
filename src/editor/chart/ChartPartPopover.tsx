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
 * `seriesRender` is what answers "which of those is this?", since a combo
 * chart's series are not all drawn the same way.
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
  emuToPoints,
  FONTS,
  isGridSpec,
  legendSeriesKey,
  pointsToEmu,
  token,
  type ChartInstance,
  type ChartRef,
  type ChartSpec,
  type ColorRef,
  type DashStyle,
  type DesignSystem,
  type FontFamily,
  type GridSeries,
  type LabelContent,
  type LabelFont,
  type LabelPlacement,
  type LabelSpec,
  type MarkerShape,
  type Outline,
  type Slide,
} from '@/model';
import { useEditor } from '@/store/editorStore';
import { MOVEABLE_Z } from '../layers';
import { seriesRender } from './ChartPartOptions';

/** Where the panel hangs, in canvas px. */
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PANEL_W = 236;
const GAP = 10;

const FIELD =
  'h-6 w-full min-w-0 rounded border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

/** Type sizes offered anywhere in the panel. Blank means "the brand's". */
const SIZES = [7, 8, 9, 10, 11, 12, 14, 16, 18, 24];

const LABEL_CONTENTS: { value: LabelContent['kind']; label: string }[] = [
  { value: 'value', label: 'Value' },
  { value: 'percent', label: 'Percent' },
  { value: 'category', label: 'Category' },
  { value: 'seriesName', label: 'Series name' },
];

const PLACEMENTS: { value: LabelPlacement; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'insideEnd', label: 'Inside end' },
  { value: 'insideCenter', label: 'Center' },
  { value: 'insideBase', label: 'Inside base' },
  { value: 'outsideEnd', label: 'Outside end' },
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
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
 * The three allowed faces — see `fonts.ts`, where the tiny list is the point.
 * Pressing the active one clears the override rather than doing nothing, so a
 * face set by accident goes back to the brand's without a trip to the menu.
 */
const FACES: { value: FontFamily; glyph: string; css: string }[] = [
  { value: 'Geist', glyph: 'Aa', css: FONTS.Geist.cssStack },
  { value: 'Source Serif 4', glyph: 'Aa', css: FONTS['Source Serif 4'].cssStack },
  { value: 'Geist Mono', glyph: 'Aa', css: FONTS['Geist Mono'].cssStack },
];

const SIDES: { value: 'top' | 'right' | 'bottom' | 'left'; glyph: string }[] = [
  { value: 'top', glyph: '↑' },
  { value: 'right', glyph: '→' },
  { value: 'bottom', glyph: '↓' },
  { value: 'left', glyph: '←' },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

function MiniButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`h-6 shrink-0 rounded px-1.5 text-[11px] leading-none ${
        active
          ? 'bg-indigo-600 text-white'
          : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
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
  size = 'h-5 w-5',
}: {
  ds: DesignSystem;
  current?: string;
  onPick: (tokenId: string) => void;
  onClear?: () => void;
  size?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ds.colors.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          title={c.name}
          aria-label={c.name}
          aria-pressed={current === c.id}
          className={`${size} rounded ${
            current === c.id
              ? 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-zinc-900'
              : 'ring-1 ring-black/10 dark:ring-zinc-600'
          }`}
          style={{ background: c.hex }}
        />
      ))}
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
  label = 'Text',
}: {
  ds: DesignSystem;
  font: LabelFont | undefined;
  onPatch: (patch: Partial<LabelFont>) => void;
  label?: string;
}) {
  return (
    <>
      <Row label={label}>
        <select
          value={font?.sizePt ?? ''}
          onChange={(e) =>
            onPatch({ sizePt: e.target.value === '' ? undefined : parseFloat(e.target.value) })
          }
          aria-label="Type size"
          className={FIELD}
        >
          <option value="">Auto</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s} pt
            </option>
          ))}
        </select>
        <MiniButton
          active={font?.bold ?? false}
          onClick={() => onPatch({ bold: !font?.bold })}
          title="Bold"
        >
          <span className="font-bold">B</span>
        </MiniButton>
      </Row>
      <Row label="Face">
        {FACES.map((f) => (
          <MiniButton
            key={f.value}
            active={font?.font === f.value}
            title={f.value}
            onClick={() => onPatch({ font: font?.font === f.value ? undefined : f.value })}
          >
            <span style={{ fontFamily: f.css }}>{f.glyph}</span>
          </MiniButton>
        ))}
      </Row>
      <Row label="Ink">
        <Swatches
          ds={ds}
          size="h-4 w-4"
          current={tokenOf(font?.color)}
          onPick={(id) => onPatch({ color: token(id) })}
          onClear={() => onPatch({ color: undefined })}
        />
      </Row>
    </>
  );
}

/** Human name for what the drill-in landed on, for the panel's header. */
function describe(spec: ChartSpec, refs: ChartRef[]): string {
  if (!refs.length) return 'Chart';
  const ref = refs[0]!;
  const many = refs.length > 1;

  const categoryLabel = (key: string): string => {
    if (isGridSpec(spec)) return spec.data.categories.find((c) => c.key === key)?.label ?? key;
    if (spec.kind === 'waterfall') return spec.data.items.find((i) => i.key === key)?.label ?? key;
    return key;
  };
  const seriesName = (key: string): string =>
    (isGridSpec(spec) ? spec.data.series.find((s) => s.key === key)?.name : undefined) ?? key;

  switch (ref.part) {
    case 'mark':
      if (many) return `${seriesName(ref.series)} · ${refs.length} points`;
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
    case 'decoration':
      return 'Annotation';
    case 'plot':
      return 'Plot area';
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
  const render = seriesKey ? seriesRender(spec, seriesKey) : null;
  const isStroked = render === 'line' || render === 'area';

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
   * The label spec actually in force for the selected point(s).
   *
   * Resolved over the WHOLE selection, not just its first member: select three
   * bars, turn labels on, and the override lands on all three — reading only
   * one point (or skipping straight to the series) would leave the toggle
   * showing "off" for labels that are visibly on. A selection whose points
   * disagree has no single answer, so it falls back to the series' setting.
   */
  const effectiveLabel = (): LabelSpec => {
    const base = series?.labels ?? spec.decorations.labels;
    const perPoint = pointKeys.map((k) => series?.pointOverrides?.[k]?.label);
    const first = perPoint[0];
    if (!first || !perPoint.every((l) => l?.show === first.show)) return base;
    return first;
  };

  /**
   * Write a label change to the narrowest node that owns it: the series when the
   * whole series is selected, otherwise a per-point override. Same rule as
   * `applyChartFormat`, so color and labels never disagree about scope.
   */
  const patchLabel = (patch: Partial<LabelSpec>) => {
    if (!seriesKey) return;
    store().patchChart(chart.id, (draft) => {
      if (!isGridSpec(draft)) return;
      const ser = draft.data.series.find((s) => s.key === seriesKey);
      if (!ser) return;
      if (wholeSeries) {
        ser.labels = { ...(ser.labels ?? draft.decorations.labels), ...patch };
        // Per-point labels would now shadow the series setting just made.
        for (const key of Object.keys(ser.pointOverrides ?? {})) {
          delete ser.pointOverrides![key]!.label;
        }
        return;
      }
      ser.pointOverrides ??= {};
      for (const key of pointKeys) {
        const prior = ser.pointOverrides[key] ?? {};
        ser.pointOverrides[key] = {
          ...prior,
          label: { ...(prior.label ?? ser.labels ?? draft.decorations.labels), ...patch },
        };
      }
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
  const totalRef = refs.find((r): r is Extract<ChartRef, { part: 'total' }> => r.part === 'total');
  const titleRef = refs.find((r): r is Extract<ChartRef, { part: 'title' }> => r.part === 'title');

  /** Merge a font patch onto whatever the node already had. */
  const withFont = (cur: LabelFont | undefined, patch: Partial<LabelFont>): LabelFont => ({
    ...cur,
    ...patch,
  });

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
  if (anchor.y + anchor.h / 2 < canvas.h / 2) style.top = Math.max(GAP, anchor.y);
  else style.bottom = Math.max(GAP, canvas.h - anchor.y - anchor.h);

  return (
    <div
      className="dd-format-bar absolute flex max-h-[85%] flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={style}
      role="dialog"
      aria-label="Format chart part"
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
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
          <Row label="Color">
            <Swatches
              ds={ds}
              current={tokenOf(
                series?.format?.outline?.color ??
                  (series?.format?.fill?.kind === 'solid' ? series.format.fill.color : undefined),
              )}
              onPick={(id) =>
                patchSeriesFormat((f) => {
                  f.fill = { kind: 'solid', color: token(id) };
                  // A line takes its colour from the outline; leaving the old
                  // one set would repaint the dots and leave the line grey.
                  f.outline = { ...f.outline, color: token(id) } as Outline;
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
        </>
      ) : null}

      {/* --- a segment, a slice, a bar: fill and border --- */}
      {markRefs.length && !isStroked ? (
        <>
          <Row label="Fill">
            <Swatches
              ds={ds}
              onPick={(id) => store().setFill(selectedIds, { kind: 'solid', color: token(id) })}
            />
          </Row>
          <Row label="Border">
            <Swatches
              ds={ds}
              size="h-4 w-4"
              current={tokenOf(currentOutline?.color)}
              onPick={(id) => setOutline({ color: token(id) })}
              onClear={() => setOutline(null)}
            />
          </Row>
          {currentOutline ? (
            <Row label="Edge">
              <select
                value={Number(emuToPoints(currentOutline.widthEmu).toFixed(2))}
                onChange={(e) => setOutline({ widthEmu: pointsToEmu(parseFloat(e.target.value)) })}
                aria-label="Border weight"
                className={FIELD}
              >
                {WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {w} pt
                  </option>
                ))}
              </select>
              {DASHES.map((d) => (
                <MiniButton
                  key={d.value}
                  active={currentOutline.dash === d.value}
                  title={d.label}
                  onClick={() => setOutline({ dash: d.value })}
                >
                  {d.glyph}
                </MiniButton>
              ))}
            </Row>
          ) : null}
        </>
      ) : null}

      {markRefs.length && seriesKey && !wholeSeries ? (
        <Row label="Scope">
          <MiniButton onClick={() => store().selectExact(seriesMarkIds(seriesKey))}>
            Select whole series
          </MiniButton>
        </Row>
      ) : null}

      {/* --- the number on the mark --- */}
      {series && (markRefs.length || labelRefs.length) ? (
        <>
          <Row label="Label">
            <MiniButton
              active={label.show}
              onClick={() => patchLabel({ show: !label.show })}
              title="Show the data label"
            >
              123
            </MiniButton>
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
          </Row>
          <Row label="Place">
            <select
              value={label.placement}
              disabled={!label.show}
              onChange={(e) => patchLabel({ placement: e.target.value as LabelPlacement })}
              aria-label="Label placement"
              className={`${FIELD} disabled:opacity-40`}
            >
              {PLACEMENTS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          <TextRows
            ds={ds}
            label="Number"
            font={label.font}
            onPatch={(p) => patchLabel({ font: withFont(label.font, p) })}
          />
        </>
      ) : null}

      {/* --- an axis: its rule, its grid, its numbers --- */}
      {axisRef ? (
        <>
          <Row label="Axis">
            <MiniButton
              active={spec.axes[axisRef.axis]?.show ?? true}
              onClick={() =>
                store().patchChart(chart.id, (d) => {
                  const ax = d.axes[axisRef.axis];
                  if (ax) ax.show = !ax.show;
                })
              }
            >
              Visible
            </MiniButton>
            <MiniButton
              active={spec.decorations.gridlines.major?.show ?? false}
              onClick={() =>
                store().patchChart(chart.id, (d) => {
                  d.decorations.gridlines.major = {
                    ...d.decorations.gridlines.major,
                    show: !d.decorations.gridlines.major?.show,
                  };
                })
              }
            >
              Grid
            </MiniButton>
          </Row>
          <TextRows
            ds={ds}
            font={spec.axes[axisRef.axis]?.font}
            onPatch={(p) =>
              store().patchChart(chart.id, (d) => {
                const ax = d.axes[axisRef.axis];
                if (ax) ax.font = withFont(ax.font, p);
              })
            }
          />
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
              font={spec.decorations.totals.font}
              onPatch={(p) =>
                store().patchChart(chart.id, (d) => {
                  if (d.decorations.totals) d.decorations.totals.font = withFont(
                    d.decorations.totals.font,
                    p,
                  );
                })
              }
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
            font={spec.titleFont}
            onPatch={(p) =>
              store().patchChart(chart.id, (d) => (d.titleFont = withFont(d.titleFont, p)))
            }
          />
        </>
      ) : null}

      {/* --- the legend. Position is also a drag on the canvas; the buttons are
              here because a legend already parked in a corner is a small target
              and "put it on the right" shouldn't need aim. --- */}
      {legendRef && !markRefs.length ? (
        <>
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
                title={`Legend on the ${s.value}`}
                onClick={() => store().patchChart(chart.id, (d) => (d.legend.position = s.value))}
              >
                {s.glyph}
              </MiniButton>
            ))}
          </Row>
          <TextRows
            ds={ds}
            font={spec.legend.font}
            onPatch={(p) =>
              store().patchChart(chart.id, (d) => (d.legend.font = withFont(d.legend.font, p)))
            }
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

      {series && !wholeSeries && (markRefs.length || labelRefs.length) ? (
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
