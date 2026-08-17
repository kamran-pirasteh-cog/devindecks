'use client';

/**
 * The floating datasheet — think-cell's model.
 *
 * Floating rather than modal or docked, for two reasons: the chart stays
 * visible and live-updating on the slide behind it, and both edges of the
 * editor are already spent (`ChatColumn` left, `TemplateDrawer` right) while a
 * datasheet needs to be WIDE, not tall.
 *
 * It sits at `OVERLAY_Z`, not `MODAL_Z`: it has to coexist with the toolbar and
 * the format bar rather than blanket them. It carries `dd-format-bar` so the
 * canvas's mousedown resolver and Selecto both leave it alone — without that,
 * clicking a cell would clear the chart's selection out from under it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { compileChart } from '@/chart/compile';
import { FitSlideView } from '@/render/FitSlideView';
import {
  chartOrientation,
  setChartOrientation,
  supportsOrientation,
  type ChartInstance,
  type ChartRef,
} from '@/model';
import { useEditor } from '@/store/editorStore';
import { SheetGrid } from '@/sheet/SheetGrid';
import { OVERLAY_Z } from '../layers';
import { useChartDraft } from './useChartDraft';
import { ChartPartOptions } from './ChartPartOptions';
import { hitTestChart, rectOfPart } from './previewHitTest';
import { DevinChartMenu } from './DevinChartMenu';

const UI_KEY = 'devindesign.datasheet.ui.v6';

interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_W = 720;
const MIN_H = 420;

/**
 * Sized off the viewport rather than fixed. It stacks a properties band, a
 * datasheet and a preview, and all three are judged by how much you can see at
 * once — so it opens wide. But not edge-to-edge: filling the window read as a
 * modal takeover of the slide it's meant to sit beside, so it leaves a visible
 * margin and caps its width on a large display. Dragging the corner still gets
 * you the old size, and that size is remembered.
 */
const MAX_DEFAULT_W = 1100;

function defaultSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1040, h: 640 };
  return {
    w: Math.max(MIN_W, Math.min(MAX_DEFAULT_W, window.innerWidth - 200)),
    h: Math.max(MIN_H, Math.round(window.innerHeight * 0.72)),
  };
}

/** Dead centre of the window, for a size. */
const centered = (size: { w: number; h: number }): PanelBox => ({
  ...size,
  x: typeof window === 'undefined' ? 32 : Math.round((window.innerWidth - size.w) / 2),
  y: typeof window === 'undefined' ? 80 : Math.round((window.innerHeight - size.h) / 2),
});

/**
 * SIZE is remembered; POSITION is not.
 *
 * A panel this large has one right place to open — the middle of the screen —
 * and restoring wherever it was last dragged means it opens off-centre for the
 * rest of time, including on a different-sized window where the stored spot
 * isn't even on screen. Dragging still works; it just doesn't outlive the panel.
 */
function loadBox(): PanelBox {
  const fallback = defaultSize();
  if (typeof window === 'undefined') return centered(fallback);
  try {
    const raw = window.localStorage.getItem(UI_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<PanelBox>) : {};
    return centered({
      w: Math.max(MIN_W, Math.min(stored.w ?? fallback.w, window.innerWidth)),
      h: Math.max(MIN_H, Math.min(stored.h ?? fallback.h, window.innerHeight)),
    });
  } catch {
    return centered(fallback);
  }
}

export function ChartDatasheetPanel({
  chart,
  onClose,
}: {
  chart: ChartInstance;
  onClose: () => void;
}) {
  const ds = useEditor((s) => s.designSystem);
  const slide = useEditor((s) => s.deck.slides.find((sl) => sl.id === s.currentSlideId));
  const { sheet, diagnostics, commit, live } = useChartDraft(chart);

  const [box, setBox] = useState<PanelBox>(loadBox);
  // The panel portals into document.body, which doesn't exist while Next
  // renders this on the server. `useSyncExternalStore` reports false there and
  // true on the client with no effect and no cascading render — the standard
  // way to ask "am I hydrated yet?".
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const gesture = useRef<{ kind: 'move' | 'resize'; x: number; y: number; box: PanelBox } | null>(
    null,
  );

  useEffect(() => {
    try {
      // Size only — see `loadBox`.
      window.localStorage.setItem(UI_KEY, JSON.stringify({ w: box.w, h: box.h }));
    } catch {
      // A full or blocked localStorage must not take the panel down with it.
    }
  }, [box.w, box.h]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes, but not while a cell editor has focus — there it means
      // "cancel this cell", which the grid handles.
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest('input, select')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPointerDown = useCallback(
    (kind: 'move' | 'resize') => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      gesture.current = { kind, x: e.clientX, y: e.clientY, box };
    },
    [box],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    setBox(
      g.kind === 'move'
        ? // Clamp so the header can never be dragged off-screen and stranded.
          {
            ...g.box,
            x: Math.max(8 - g.box.w + 120, Math.min(window.innerWidth - 120, g.box.x + dx)),
            y: Math.max(8, Math.min(window.innerHeight - 60, g.box.y + dy)),
          }
        : {
            ...g.box,
            w: Math.max(MIN_W, g.box.w + dx),
            h: Math.max(MIN_H, g.box.h + dy),
          },
    );
  }, []);

  const endGesture = useCallback(() => {
    gesture.current = null;
  }, []);

  /**
   * The preview canvas is the chart's OWN frame, magnified.
   *
   * Two wrong answers were tried first. Cropping the chart out of the rendered
   * slide keeps the geometry but wastes most of the panel on the rest of the
   * slide. Recompiling into the measured box fills the panel but re-solves the
   * layout: a taller frame means taller bars, different gutters and type that
   * is a different fraction of the frame — so the preview stops looking like
   * the thing on the page, which is the one job it has.
   *
   * Compiling at the chart's real width and height and scaling the result is
   * the only version where "bigger" means bigger and nothing else. Every gap,
   * gutter and point size keeps its ratio to the frame; `FitSlideView` scales
   * the lot uniformly to the panel.
   */
  const previewSize = useMemo(
    () => ({ w: chart.frame.w, h: chart.frame.h }),
    [chart.frame.h, chart.frame.w],
  );

  const previewSlide = useMemo(() => {
    // Compiled at the origin rather than at the chart's place on the slide —
    // placers lay out relative to the frame, so the geometry is identical and
    // the preview has no slide margins to crop.
    const { elements } = compileChart(
      { ...chart, frame: { x: 0, y: 0, w: previewSize.w, h: previewSize.h } },
      ds,
    );
    return { id: 'chart-preview', elements, background: slide?.background };
  }, [chart, ds, previewSize, slide?.background]);

  /**
   * The part being formatted. Clicking the preview picks one; clicking an empty
   * corner of it drops back to the chart as a whole.
   */
  const [part, setPart] = useState<ChartRef | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const onPreviewClick = useCallback(
    (e: React.MouseEvent) => {
      const el = previewRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.width < 1) return;
      // Screen px back to the EMU the elements are laid out in — the preview is
      // one uniform scale, so this is a single divide.
      const perPx = previewSize.w / box.width;
      const x = (e.clientX - box.left) * perPx;
      const y = (e.clientY - box.top) * perPx;
      // A few px of slop, in EMU: a tick label is a hairline tall and a click
      // that has to be exact reads as a broken control.
      setPart(hitTestChart(previewSlide.elements, x, y, 4 * perPx));
    },
    [previewSize.w, previewSlide.elements],
  );

  /** The ring drawn over whatever is selected, in fractions of the preview. */
  const partBox = useMemo(() => {
    if (!part) return null;
    const rect = rectOfPart(previewSlide.elements, part);
    if (!rect) return null;
    return {
      left: `${(rect.x / previewSize.w) * 100}%`,
      top: `${(rect.y / previewSize.h) * 100}%`,
      width: `${(rect.w / previewSize.w) * 100}%`,
      height: `${(rect.h / previewSize.h) * 100}%`,
    };
  }, [part, previewSize.h, previewSize.w, previewSlide.elements]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="dd-format-bar fixed flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      style={{ zIndex: OVERLAY_Z, left: box.x, top: box.y, width: box.w, height: box.h }}
      onContextMenu={(e) => e.stopPropagation()}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <div
        onPointerDown={onPointerDown('move')}
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <span className="text-[11px] font-semibold">
          {chart.spec.title || 'Chart data'}
        </span>
        {/* Counted in the chart's own terms, not the grid's: under the
            transposed layout a "row" is a series and a column is a period. */}
        <span className="text-[10px] text-zinc-400">
          {sheet.schema.layout === 'seriesDown'
            ? `${sheet.series.length} column${sheet.series.length === 1 ? '' : 's'} · ${sheet.rows.length} series`
            : `${sheet.rows.length} row${sheet.rows.length === 1 ? '' : 's'} · ${sheet.series.length} series`}
        </span>

        <div className="ml-auto flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <DevinChartMenu chart={chart} onApplied={onClose} />
          <button
            onClick={onClose}
            title="Close"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            ×
          </button>
        </div>
      </div>

      {/* One row of options for whatever is selected in the preview — see
          `ChartPartOptions`. This used to be every chart setting at once. */}
      <ChartPartOptions chart={chart} ds={ds} part={part} onClear={() => setPart(null)} />

      <div className="flex min-h-0 flex-1">
        {/* The sheet takes the whole left side — a datasheet is judged by how
            many rows and columns you can see at once. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <SheetGrid
            sheet={sheet}
            ds={ds}
            diagnostics={diagnostics}
            onChange={(next) => commit(next)}
            onLiveEdit={live}
          />
        </div>

        {/* A preview of this chart alone, so an edit can be judged without
            dragging the panel off the chart it's editing. An even split with the
            sheet: you're reading the chart as much as you're typing into the
            grid, and half a wide panel is still a dozen columns. */}
        <div className="flex w-1/2 min-w-[20rem] shrink-0 flex-col gap-1 border-l border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Preview
          </div>
          {/* Takes the chart's own shape, as wide as the column allows. Making
              the card fill the column instead would only add white around a
              chart that has to keep its proportions to be worth looking at. */}
          <div
            ref={previewRef}
            onClick={onPreviewClick}
            className="relative shrink-0 cursor-pointer overflow-hidden rounded bg-white ring-1 ring-black/10 dark:bg-zinc-900"
          >
            <FitSlideView slide={previewSlide} slideSize={previewSize} designSystem={ds} />
            {partBox ? (
              <span
                // Purely an indicator: it must never eat the next click, which
                // is usually on a neighbouring part.
                className="pointer-events-none absolute rounded-sm ring-2 ring-indigo-500/70"
                style={partBox}
              />
            ) : null}
            <OrientationArrows chart={chart} />
          </div>
        </div>
      </div>

      <div
        onPointerDown={onPointerDown('resize')}
        title="Resize"
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        style={{
          background:
            'linear-gradient(135deg, transparent 50%, rgba(120,120,130,0.45) 50%, rgba(120,120,130,0.45) 60%, transparent 60%, transparent 72%, rgba(120,120,130,0.45) 72%, rgba(120,120,130,0.45) 82%, transparent 82%)',
        }}
      />
    </div>,
    document.body,
  );
}

/**
 * Orientation, on the preview instead of in a dropdown.
 *
 * Turning bars on their side is a change you judge by looking at the chart, so
 * the control belongs on the chart: two arrows pointing the way the bars will
 * run. Absent entirely for the kinds that have no orientation to speak of — a
 * pie doesn't lie down.
 */
function OrientationArrows({ chart }: { chart: ChartInstance }) {
  const patchChart = useEditor((s) => s.patchChart);
  if (!supportsOrientation(chart.spec.kind)) return null;

  const current = chartOrientation(chart.spec);
  const options: { value: 'vertical' | 'horizontal'; glyph: string; title: string }[] = [
    { value: 'vertical', glyph: '↑', title: 'Bars run up' },
    { value: 'horizontal', glyph: '→', title: 'Bars run across' },
  ];

  return (
    <div className="absolute right-1.5 top-1.5 flex overflow-hidden rounded border border-black/10 bg-white/85 shadow-sm backdrop-blur dark:border-white/15 dark:bg-zinc-900/85">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() =>
            patchChart(chart.id, (s) => Object.assign(s, setChartOrientation(s, o.value)))
          }
          title={o.title}
          aria-pressed={current === o.value}
          className={`flex h-6 w-6 items-center justify-center text-[13px] leading-none ${
            current === o.value
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
              : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          {o.glyph}
        </button>
      ))}
    </div>
  );
}
