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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FitSlideView } from '@/render/FitSlideView';
import type { ChartInstance } from '@/model';
import { useEditor } from '@/store/editorStore';
import { SheetGrid } from '@/sheet/SheetGrid';
import { OVERLAY_Z } from '../layers';
import { useChartDraft } from './useChartDraft';
import { ChartPropertiesPanel } from './ChartPropertiesPanel';
import { DevinChartMenu } from './DevinChartMenu';

const UI_KEY = 'devindesign.datasheet.ui.v2';

interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Sized off the viewport rather than fixed: the panel holds a grid, a preview
 * and a properties column side by side, and at a fixed 900px the preview ends
 * up too small to judge anything by.
 */
function defaultBox(): PanelBox {
  if (typeof window === 'undefined') return { x: 80, y: 180, w: 1180, h: 560 };
  const w = Math.min(1400, Math.max(MIN_W, window.innerWidth - 160));
  const h = Math.min(700, Math.max(MIN_H, Math.round(window.innerHeight * 0.55)));
  return { x: Math.round((window.innerWidth - w) / 2), y: Math.round(window.innerHeight - h - 60), w, h };
}

const MIN_W = 720;
const MIN_H = 320;

/** Panel position is view state, never deck state — it isn't undoable. */
function loadBox(): PanelBox {
  const fallback = defaultBox();
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(UI_KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<PanelBox>;
    // A box saved on a bigger screen, or from an older too-small default, must
    // not strand the panel off-screen or reintroduce a cramped preview.
    return {
      x: Math.max(0, Math.min(stored.x ?? fallback.x, window.innerWidth - MIN_W)),
      y: Math.max(0, Math.min(stored.y ?? fallback.y, window.innerHeight - 80)),
      w: Math.max(MIN_W, Math.min(stored.w ?? fallback.w, window.innerWidth)),
      h: Math.max(MIN_H, Math.min(stored.h ?? fallback.h, window.innerHeight)),
    };
  } catch {
    return fallback;
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
  const slideSize = useEditor((s) => s.deck.slideSize);
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
      window.localStorage.setItem(UI_KEY, JSON.stringify(box));
    } catch {
      // A full or blocked localStorage must not take the panel down with it.
    }
  }, [box]);

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

  if (!mounted) return null;

  const previewSlide = slide
    ? { ...slide, elements: slide.elements.filter((e) => e.chartRef?.chartId === chart.id) }
    : null;

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
        <span className="text-[10px] text-zinc-400">
          {sheet.rows.length} row{sheet.rows.length === 1 ? '' : 's'} · {sheet.series.length} series
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

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[1.35]">
          <SheetGrid
            sheet={sheet}
            ds={ds}
            diagnostics={diagnostics}
            onChange={(next) => commit(next)}
            onLiveEdit={live}
          />
        </div>

        {/* A preview of this chart alone, so an edit can be judged without
            dragging the panel off the chart it's editing. Sized as a share of
            the panel so widening the panel actually buys a bigger chart. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1 border-l border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Preview
          </div>
          {previewSlide ? (
            <div className="flex min-h-0 flex-1 items-center overflow-hidden rounded bg-white ring-1 ring-black/10 dark:bg-zinc-900">
              <FitSlideView
                slide={previewSlide}
                slideSize={slideSize}
                designSystem={ds}
              />
            </div>
          ) : null}
        </div>

        <ChartPropertiesPanel chart={chart} />
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
