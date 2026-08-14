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
  isGridSpec,
  legendSeriesKey,
  token,
  type ChartInstance,
  type ChartRef,
  type ChartSpec,
  type DesignSystem,
  type GridSeries,
  type LabelContent,
  type LabelPlacement,
  type LabelSpec,
  type Slide,
} from '@/model';
import { useEditor } from '@/store/editorStore';
import { MOVEABLE_Z } from '../layers';

/** Where the panel hangs, in canvas px. */
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PANEL_W = 232;
const GAP = 10;

const FIELD =
  'h-6 w-full rounded border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

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
      className={`h-6 rounded px-1.5 text-[11px] ${
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
 * click deeper than the panel itself would waste the whole gesture.
 */
function Swatches({
  ds,
  onPick,
}: {
  ds: DesignSystem;
  onPick: (tokenId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {ds.colors.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          title={c.name}
          aria-label={c.name}
          className="h-5 w-5 rounded border border-black/10 dark:border-zinc-600"
          style={{ background: c.hex }}
        />
      ))}
    </div>
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

  const nudged =
    pointKeys.length > 0 &&
    pointKeys.some((k) => series?.pointOverrides?.[k]?.labelOffset !== undefined);

  const label = effectiveLabel();
  const axisRef = refs.find((r): r is Extract<ChartRef, { part: 'axis' }> => r.part === 'axis');
  const legendRef = refs.find(
    (r): r is Extract<ChartRef, { part: 'legend.item' }> => r.part === 'legend.item',
  );
  const totalRef = refs.find((r): r is Extract<ChartRef, { part: 'total' }> => r.part === 'total');

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
  // bar behind it.
  const style: React.CSSProperties = { width: PANEL_W, zIndex: MOVEABLE_Z + 1 };
  if (anchor.x + anchor.w + GAP + PANEL_W <= canvas.w) style.left = anchor.x + anchor.w + GAP;
  else if (anchor.x - GAP - PANEL_W >= 0) style.right = canvas.w - anchor.x + GAP;
  else style.left = Math.min(Math.max(GAP, anchor.x), Math.max(GAP, canvas.w - PANEL_W - GAP));
  if (anchor.y + anchor.h / 2 < canvas.h / 2) style.top = Math.max(GAP, anchor.y);
  else style.bottom = Math.max(GAP, canvas.h - anchor.y - anchor.h);

  return (
    <div
      className="dd-format-bar absolute flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
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

      {markRefs.length ? (
        <>
          <Row label="Color">
            <Swatches
              ds={ds}
              onPick={(id) =>
                store().setFill(selectedIds, { kind: 'solid', color: token(id) })
              }
            />
          </Row>
          {seriesKey && !wholeSeries ? (
            <Row label="Scope">
              <MiniButton onClick={() => store().selectExact(seriesMarkIds(seriesKey))}>
                Select whole series
              </MiniButton>
            </Row>
          ) : null}
        </>
      ) : null}

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
              onChange={(e) =>
                patchLabel({ content: { kind: e.target.value } as LabelContent })
              }
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
          <Row label="Size">
            <select
              value={label.font?.sizePt ?? spec.decorations.labels.font?.sizePt ?? 9}
              disabled={!label.show}
              onChange={(e) =>
                patchLabel({
                  font: { ...label.font, sizePt: parseFloat(e.target.value) },
                })
              }
              aria-label="Label size"
              className={`${FIELD} disabled:opacity-40`}
            >
              {[7, 8, 9, 10, 11, 12, 14, 16, 18].map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
            <MiniButton
              active={label.font?.bold ?? false}
              onClick={() => patchLabel({ font: { ...label.font, sizePt: label.font?.sizePt ?? 9, bold: !label.font?.bold } })}
              title="Bold label"
            >
              B
            </MiniButton>
          </Row>
        </>
      ) : null}

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
          </Row>
          <Row label="Grid">
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
              Gridlines
            </MiniButton>
          </Row>
        </>
      ) : null}

      {totalRef ? (
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
      ) : null}

      {legendRef && !markRefs.length ? (
        <Row label="Legend">
          <MiniButton
            onClick={() => store().selectExact(seriesMarkIds(legendSeriesKey(legendRef)))}
          >
            Select series
          </MiniButton>
        </Row>
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
