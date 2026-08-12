'use client';

/**
 * The editing canvas. Renders the active slide's elements as positioned DOM
 * nodes (reusing <ElementVisual> so the canvas === preview === export) and
 * layers selection/transform interaction on top:
 *
 *  - Selecto: marquee multi-select with FULL-ENCLOSURE semantics (hitRate 100,
 *    selectFromInside=false) — PowerPoint behavior, not Google's intersection.
 *  - Moveable: drag / resize / rotate for the current selection, with snapping
 *    to sibling elements, slide edges and center.
 *
 * All geometry changes are converted from px back into EMU and written through
 * the store's command actions, so undo/redo and the model stay authoritative.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { ElementVisual } from '@/render/SlideView';
import { pxToEmu, resolveColor, type Rect } from '@/model';
import { useEditor } from '@/store/editorStore';
import { ShapeContextMenu } from './ShapeContextMenu';
import { TextEditor } from './TextEditor';
import { ChartEditorModal } from './ChartEditorModal';
import { measureTextFitPx } from './fitToText';

const CANVAS_PAD = 48;

/** Rotations are stored 0–359, so 1° and 361° are the same stored value. */
const normalizeDeg = (d: number) => ((Math.round(d) % 360) + 360) % 360;

export function EditorCanvas() {
  const deck = useEditor((s) => s.deck);
  const ds = useEditor((s) => s.designSystem);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const editingId = useEditor((s) => s.editingId);

  const slide = deck.slides.find((s) => s.id === currentSlideId) ?? deck.slides[0];

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const selectoRef = useRef<Selecto>(null);
  const nodeMap = useRef<Map<string, HTMLElement>>(new Map());

  const [width, setWidth] = useState(900);
  // Selecto reads dragContainer once, when it is constructed, so the marquee
  // root has to be a real node on the render that mounts it — not a ref.
  const [dragRoot, setDragRoot] = useState<HTMLElement | null>(null);
  const [liveResize, setLiveResize] = useState<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    ids: string[];
    primaryId: string;
    x: number;
    y: number;
  } | null>(null);
  // PowerPoint-style resize modifiers: Shift keeps aspect ratio (keepRatio prop,
  // must be a live value so react-moveable re-reads it every frame), Ctrl
  // resizes from the center (via onBeforeResize's per-frame setFixedDirection).
  const [keepRatioActive, setKeepRatioActive] = useState(false);
  const resizeFromCenterRef = useRef(false);
  const resizeModifierCleanupRef = useRef<(() => void) | null>(null);
  // PowerPoint-style drag modifiers: Shift constrains movement to the
  // horizontal/vertical axis; Ctrl+Shift does the same while dropping a copy
  // instead of moving the original.
  const dragAxisLockRef = useRef(false);
  const dragDuplicateRef = useRef(false);
  const dragModifierCleanupRef = useRef<(() => void) | null>(null);
  // A selection change that mousedown on an already-selected element implies,
  // held until mouseup so it can be dropped if the gesture turns into a drag.
  const pendingSelectRef = useRef<{ id: string; mode: 'toggle' | 'only' } | null>(null);
  const [editingChart, setEditingChart] = useState(false);
  // Live rotation angle during a rotate gesture — rendered instead of the
  // model's value so the object turns under the cursor, not on mouseup.
  const [liveRotate, setLiveRotate] = useState<{ id: string; deg: number } | null>(null);
  // Ctrl/⌘ + wheel zoom, as a multiple of the fit-to-window width.
  const [zoom, setZoom] = useState(1);
  const zoomAnchorRef = useRef<{ fx: number; fy: number; clientX: number; clientY: number } | null>(
    null,
  );
  // Turns a stream of wheel deltas into at most one slide step per gesture.
  // Deltas are normalized to pixels first: trackpads report pixels, but plenty
  // of mice report lines (deltaY ≈ 3 per notch) or pages, and an un-normalized
  // threshold makes those mice feel like the wheel barely does anything.
  // The threshold is then low enough that one notch — or the gentlest trackpad
  // nudge — steps immediately. After a step the wheel is blocked until the
  // event stream goes quiet, which swallows the long inertial tail of a
  // trackpad flick without also swallowing distinct mouse notches: inertia
  // events arrive continuously (gaps of a few ms), separate notches don't.
  // Accumulation only exists for sub-threshold deltas within one gesture, so
  // it resets once the wheel is quiet.
  const wheelStepRef = useRef(
    (() => {
      const QUIET = 80; // gap that ends a continuous stream, ms
      let acc = 0;
      let last = 0;
      let blocked = false;
      return (e: WheelEvent): -1 | 0 | 1 => {
        const px =
          e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
        const now = performance.now();
        const gap = now - last;
        last = now;
        if (blocked) {
          if (gap < QUIET) return 0;
          blocked = false;
        }
        if (gap > 150 || (acc !== 0 && Math.sign(px) !== Math.sign(acc))) acc = 0;
        acc += px;
        if (Math.abs(acc) < 8) return 0;
        const dir = acc > 0 ? 1 : -1;
        acc = 0;
        blocked = true;
        return dir;
      };
    })(),
  );

  useLayoutEffect(() => {
    setDragRoot(wrapRef.current);
  }, []);

  // Fit slide width to the available area.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const avail = el.clientWidth - CANVAS_PAD * 2;
      const byHeight = (el.clientHeight - CANVAS_PAD * 2) * (slide ? deck.slideSize.w / deck.slideSize.h : 16 / 9);
      setWidth(Math.max(320, Math.min(avail, byHeight)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [deck.slideSize.w, deck.slideSize.h, slide]);

  // Ctrl/⌘ + wheel zooms the slide; a plain wheel moves through the deck.
  // Registered natively because React's own wheel listener is passive —
  // preventDefault there is ignored and the browser would page-zoom instead.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // Zoomed in far enough that the slide overflows? Let the wheel pan it,
        // and only page the deck once that edge is reached.
        const max = el.scrollHeight - el.clientHeight;
        if (max > 1 && ((e.deltaY < 0 && el.scrollTop > 0) || (e.deltaY > 0 && el.scrollTop < max)))
          return;
        e.preventDefault();
        const dir = wheelStepRef.current(e);
        if (!dir) return;
        useEditor.getState().stepSlide(dir);
        return;
      }
      e.preventDefault();
      const canvas = canvasRef.current;
      if (canvas) {
        // Remember which point of the slide is under the cursor so the layout
        // effect below can keep it there after the resize.
        const r = canvas.getBoundingClientRect();
        zoomAnchorRef.current = {
          fx: (e.clientX - r.left) / r.width,
          fy: (e.clientY - r.top) / r.height,
          clientX: e.clientX,
          clientY: e.clientY,
        };
      }
      setZoom((z) => Math.min(8, Math.max(0.25, z * Math.exp(-e.deltaY / 400))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the pointer's slide position under the pointer across a zoom step.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    zoomAnchorRef.current = null;
    if (!anchor || !wrap || !canvas) return;
    const r = canvas.getBoundingClientRect();
    wrap.scrollLeft += r.left + anchor.fx * r.width - anchor.clientX;
    wrap.scrollTop += r.top + anchor.fy * r.height - anchor.clientY;
  }, [zoom]);

  const scale = (width * zoom) / deck.slideSize.w;
  const displayWidth = deck.slideSize.w * scale;
  const height = deck.slideSize.h * scale;

  // Keep the overlay glued to the element after ANY model change — inspector
  // edits, undo/redo, a drag commit — so handles never drift from the object.
  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [selectedIds, width, zoom, deck]);

  const selectedNodes = selectedIds
    .map((id) => nodeMap.current.get(id))
    .filter(Boolean) as HTMLElement[];

  const guidelineNodes = slide
    ? slide.elements
        .filter((e) => !selectedIds.includes(e.id))
        .map((e) => nodeMap.current.get(e.id))
        .filter(Boolean) as HTMLElement[]
    : [];

  const store = useEditor.getState;

  const findEl = (id: string) =>
    store()
      .deck.slides.find((s) => s.id === currentSlideId)
      ?.elements.find((x) => x.id === id);

  const deferSelect = (id: string, mode: 'toggle' | 'only') => {
    pendingSelectRef.current = { id, mode };
    const finalize = () => {
      const pending = pendingSelectRef.current;
      pendingSelectRef.current = null;
      window.removeEventListener('mouseup', finalize);
      if (pending?.id !== id) return;
      if (pending.mode === 'toggle') store().toggleSelect(id);
      else store().select([id]);
    };
    window.addEventListener('mouseup', finalize);
  };

  const attachDragModifiers = (inputEvent: any) => {
    dragModifierCleanupRef.current?.();
    const sync = (ke: KeyboardEvent) => {
      dragAxisLockRef.current = ke.shiftKey;
      dragDuplicateRef.current = ke.shiftKey && ke.ctrlKey;
    };
    dragAxisLockRef.current = !!inputEvent?.shiftKey;
    dragDuplicateRef.current = !!inputEvent?.shiftKey && !!inputEvent?.ctrlKey;
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    dragModifierCleanupRef.current = () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
    };
  };
  const detachDragModifiers = () => {
    dragModifierCleanupRef.current?.();
    dragModifierCleanupRef.current = null;
    dragAxisLockRef.current = false;
    dragDuplicateRef.current = false;
  };
  /**
   * Hand the dragged element to the compositor for the length of the gesture.
   *
   * A drag only mutates `transform`, but without a promotion hint Chrome keeps
   * the element on a shared layer and re-rasterizes it every frame — and text
   * is the most expensive thing on the slide to raster. The box tracked the
   * cursor while the glyphs inside it visibly trailed behind. `will-change`
   * makes the per-frame change compositor-only.
   *
   * Set imperatively, not through React state: a re-render mid-gesture would
   * rewrite the transform back to the model's committed position and the
   * element would snap to its origin for a frame.
   */
  const promoteForGesture = (targets: (HTMLElement | SVGElement)[]) => {
    targets.forEach((t) => {
      t.style.willChange = 'transform';
    });
  };
  const demoteAfterGesture = (targets: (HTMLElement | SVGElement)[]) => {
    targets.forEach((t) => {
      t.style.willChange = '';
    });
  };

  /**
   * Fit every selected text-bearing element's box to its own text, keeping the
   * top-left corner put (PowerPoint's "resize shape to fit text" anchor).
   * Non-text elements in the selection are left alone.
   */
  const fitSelectionToText = () => {
    selectedIds.forEach((id) => {
      const el = findEl(id);
      const node = nodeMap.current.get(id);
      if (!el || !node) return;
      if (!(el.type === 'text' || (el.type === 'shape' && el.body))) return;
      const fit = measureTextFitPx(node, el.rect.w * scale);
      if (!fit) return;
      const rect: Rect = {
        x: el.rect.x,
        y: el.rect.y,
        w: pxToEmu(fit.w, scale),
        h: pxToEmu(fit.h, scale),
      };
      if (rect.w === el.rect.w && rect.h === el.rect.h) return;
      store().setRect(id, rect);
    });
    moveableRef.current?.updateRect();
  };

  const lockAxis = (dx: number, dy: number): [number, number] =>
    Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];

  /**
   * Single source of truth for what a mousedown selects. It runs in the CAPTURE
   * phase on the whole canvas area because Moveable's overlay (the group drag
   * area in particular) swallows mousedown before it can reach the element or
   * the canvas underneath — so neither can be trusted to report the hit.
   * PowerPoint semantics: a plain click selects exactly what is under the
   * pointer and nothing else, empty space (on or off the slide) clears, Shift
   * adds/removes.
   */
  const resolveMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Handles/rotation knobs are transform gestures — leave them to Moveable.
    if (typeof target.className === 'string' && /moveable-(control|rotation|line)/.test(target.className)) {
      return;
    }

    // Walk UP from each hit node rather than looking for `.dd-el` in the list
    // itself: a line's wrapper box is zero-thickness on its cross axis, and a
    // zero-area box is never returned by elementsFromPoint even when its
    // overflowing stroke is what got hit. Only the inner <svg>/<line> shows up,
    // so matching the list directly picked whatever full-size element happened
    // to sit under the line instead.
    const hit = document
      .elementsFromPoint(e.clientX, e.clientY)
      .map((n) => (n as HTMLElement).closest?.('.dd-el') as HTMLElement | null)
      .find(Boolean) as HTMLElement | undefined;
    const id = hit?.dataset.id;

    // Right-click opens the context menu on whatever is under the pointer; it
    // must never shrink an existing multi-selection the menu is about to act on.
    if (e.button === 2) {
      if (id && !selectedIds.includes(id)) store().select([id]);
      return;
    }
    if (e.button !== 0) return;

    if (!id) {
      if (!e.shiftKey) store().clearSelection();
      return;
    }
    if (id === editingId) return;

    // Mousedown on something already selected is ambiguous with the start of a
    // drag (a plain drag moves the whole group, a shift-drag axis-locks), so
    // defer the selection change to mouseup and drop it if a drag begins.
    if (selectedIds.includes(id)) {
      if (e.shiftKey || selectedIds.length > 1) deferSelect(id, e.shiftKey ? 'toggle' : 'only');
    } else if (e.shiftKey) {
      store().toggleSelect(id);
    } else {
      store().select([id]);
    }
  };

  if (!slide) return null;

  // Zoomed past the window the slide has to be pannable, so the surround
  // scrolls; `m-auto` on the canvas keeps it centred while it still fits.
  return (
    <div
      ref={wrapRef}
      className="relative flex h-full w-full items-center justify-center overflow-auto bg-zinc-200/70 p-12 dark:bg-zinc-800"
      onMouseDownCapture={resolveMouseDown}
      onDoubleClickCapture={(e) => {
        const t = e.target as HTMLElement;
        if (typeof t.className !== 'string') return;
        // Double-tapping the rotation handle returns the object to upright.
        if (t.className.includes('moveable-rotation')) {
          e.preventDefault();
          e.stopPropagation();
          selectedIds.forEach((id) => store().updateElement(id, { rotation: 0 }));
          moveableRef.current?.updateRect();
          return;
        }
        // …and the bottom-right handle shrink-wraps the box to its text.
        if (t.className.includes('moveable-control') && t.dataset.direction === 'se') {
          e.preventDefault();
          e.stopPropagation();
          fitSelectionToText();
        }
      }}
    >
      <div
        ref={canvasRef}
        className="dd-canvas group relative m-auto shrink-0 select-none shadow-xl ring-1 ring-black/10"
        style={{
          width: displayWidth,
          height,
          background:
            slide.background?.kind === 'solid' ? resolveColor(slide.background.color, ds) : '#ffffff',
        }}
        onContextMenu={(e) => {
          if (e.target === canvasRef.current) e.preventDefault();
        }}
      >
        {slide.chart ? (
          <button
            onClick={() => setEditingChart(true)}
            title="Edit chart"
            className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 opacity-0 shadow-sm transition group-hover:opacity-100 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ✎ Edit chart
          </button>
        ) : null}
        {slide.elements.map((el) => {
          const isEditing = editingId === el.id;
          const live = liveResize && liveResize.id === el.id ? liveResize : null;
          const boxX = live ? live.x : el.rect.x * scale;
          const boxY = live ? live.y : el.rect.y * scale;
          const boxW = live ? live.w : el.rect.w * scale;
          const boxH = live ? live.h : el.rect.h * scale;
          // Mid-rotation the live angle wins, so the object turns with the
          // handle instead of snapping into place on mouseup.
          const spinDeg = liveRotate?.id === el.id ? liveRotate.deg : (el.rotation ?? 0);
          return (
            <div
              key={el.id}
              data-id={el.id}
              ref={(node) => {
                if (node) nodeMap.current.set(el.id, node);
                else nodeMap.current.delete(el.id);
              }}
              className="dd-el absolute left-0 top-0"
              style={{
                width: boxW,
                height: boxH,
                // Position via transform ONLY. React owns the transform string, so
                // it always overwrites anything Moveable applies mid-drag — no
                // leftover translate, no post-drag jump, overlay stays aligned.
                transform: `translate(${boxX}px, ${boxY}px)${
                  spinDeg ? ` rotate(${spinDeg}deg)` : ''
                }`,
                transformOrigin: 'center center',
                cursor: 'move',
              }}
              onDoubleClick={(e) => {
                if (el.type === 'text' || (el.type === 'shape' && el.body)) {
                  e.stopPropagation();
                  store().setEditing(el.id);
                }
              }}
              onContextMenu={(e) => {
                if (isEditing) return;
                e.preventDefault();
                e.stopPropagation();
                const ids = selectedIds.includes(el.id) ? selectedIds : [el.id];
                if (!selectedIds.includes(el.id)) store().select([el.id]);
                setContextMenu({ ids, primaryId: el.id, x: e.clientX, y: e.clientY });
              }}
            >
              <ElementVisual
                el={el}
                ds={ds}
                scale={scale}
                hideBody={isEditing}
                sizeOverridePx={live ? { w: live.w, h: live.h } : undefined}
              />
              {isEditing && (el.type === 'text' || el.type === 'shape') ? (
                <TextEditor el={el} scale={scale} />
              ) : null}
            </div>
          );
        })}

        {/* Live angle readout, pinned above the object being rotated. */}
        {(() => {
          if (!liveRotate) return null;
          const el = slide.elements.find((x) => x.id === liveRotate.id);
          if (!el) return null;
          return (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-md bg-zinc-900/90 px-2 py-1 text-xs font-medium tabular-nums text-white"
              style={{
                left: (el.rect.x + el.rect.w / 2) * scale,
                top: el.rect.y * scale - 32,
              }}
            >
              {normalizeDeg(liveRotate.deg)}°
            </div>
          );
        })()}

        {/* Transform controls for the current selection. */}
        {selectedNodes.length > 0 && !editingId ? (
          <Moveable
            ref={moveableRef}
            target={selectedNodes}
            draggable
            resizable
            rotatable
            keepRatio={keepRatioActive}
            origin={false}
            throttleDrag={0}
            throttleResize={0}
            throttleRotate={0}
            snappable
            snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            snapThreshold={6}
            elementGuidelines={guidelineNodes}
            verticalGuidelines={[0, displayWidth / 2, displayWidth]}
            horizontalGuidelines={[0, height / 2, height]}
            // During interaction we only paint the transform for smoothness; the
            // model is written once on end from the delta (dist), then React
            // re-renders the authoritative transform. No baking, no leftover.
            onDragStart={(e) => {
              attachDragModifiers(e.inputEvent);
              promoteForGesture([e.target as HTMLElement]);
            }}
            onDrag={(e) => {
              // Moveable raises dragStart on plain mousedown, so movement — not
              // the gesture starting — is what cancels a deferred reselect.
              pendingSelectRef.current = null;
              const id = (e.target as HTMLElement).dataset.id!;
              const el = findEl(id);
              if (!el) return;
              const [dx, dy] = dragAxisLockRef.current
                ? lockAxis(e.dist[0], e.dist[1])
                : (e.dist as [number, number]);
              e.target.style.transform = `translate(${el.rect.x * scale + dx}px, ${el.rect.y * scale + dy}px)${
                el.rotation ? ` rotate(${el.rotation}deg)` : ''
              }`;
            }}
            onDragEnd={(e) => {
              const wasDuplicate = dragDuplicateRef.current;
              const wasAxisLocked = dragAxisLockRef.current;
              detachDragModifiers();
              demoteAfterGesture([e.target as HTMLElement]);
              const last = e.lastEvent;
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              const [dx, dy] = wasAxisLocked
                ? lockAxis(last.dist[0], last.dist[1])
                : (last.dist as [number, number]);
              if (wasDuplicate) {
                if (!dx && !dy) return;
                store().duplicateBy([id], pxToEmu(dx, scale), pxToEmu(dy, scale));
              } else {
                store().moveBy([id], pxToEmu(dx, scale), pxToEmu(dy, scale));
              }
            }}
            onDragGroupStart={(e) => {
              attachDragModifiers(e.inputEvent);
              promoteForGesture(e.events.map((ev) => ev.target as HTMLElement));
            }}
            onDragGroup={(e) => {
              pendingSelectRef.current = null;
              const first = e.events[0];
              if (!first) return;
              const [dx, dy] = dragAxisLockRef.current
                ? lockAxis(first.dist[0], first.dist[1])
                : (first.dist as [number, number]);
              e.events.forEach((ev) => {
                const id = (ev.target as HTMLElement).dataset.id!;
                const el = findEl(id);
                if (!el) return;
                ev.target.style.transform = `translate(${el.rect.x * scale + dx}px, ${el.rect.y * scale + dy}px)${
                  el.rotation ? ` rotate(${el.rotation}deg)` : ''
                }`;
              });
            }}
            onDragGroupEnd={(e) => {
              const wasDuplicate = dragDuplicateRef.current;
              const wasAxisLocked = dragAxisLockRef.current;
              detachDragModifiers();
              demoteAfterGesture(e.events.map((ev) => ev.target as HTMLElement));
              const last = e.events[0]?.lastEvent;
              if (!last) return;
              const [dx, dy] = wasAxisLocked
                ? lockAxis(last.dist[0], last.dist[1])
                : (last.dist as [number, number]);
              if (wasDuplicate) {
                if (!dx && !dy) return;
                store().duplicateBy(selectedIds, pxToEmu(dx, scale), pxToEmu(dy, scale));
              } else {
                store().moveBy(selectedIds, pxToEmu(dx, scale), pxToEmu(dy, scale));
              }
            }}
            onResizeStart={(e) => {
              pendingSelectRef.current = null;
              resizeModifierCleanupRef.current?.();
              const syncModifiers = (ke: KeyboardEvent) => {
                setKeepRatioActive(ke.shiftKey);
                resizeFromCenterRef.current = ke.ctrlKey;
              };
              setKeepRatioActive(!!e.inputEvent?.shiftKey);
              resizeFromCenterRef.current = !!e.inputEvent?.ctrlKey;
              window.addEventListener('keydown', syncModifiers);
              window.addEventListener('keyup', syncModifiers);
              resizeModifierCleanupRef.current = () => {
                window.removeEventListener('keydown', syncModifiers);
                window.removeEventListener('keyup', syncModifiers);
              };
            }}
            onBeforeResize={(e) => {
              e.setFixedDirection(resizeFromCenterRef.current ? [0, 0] : e.startFixedDirection);
            }}
            onResize={(e) => {
              e.target.style.width = `${e.width}px`;
              e.target.style.height = `${e.height}px`;
              e.target.style.transform = e.drag.transform;
              const id = (e.target as HTMLElement).dataset.id!;
              const el = store()
                .deck.slides.find((s) => s.id === currentSlideId)
                ?.elements.find((x) => x.id === id);
              if (!el) return;
              const [dx, dy] = e.drag.dist as [number, number];
              setLiveResize({
                id,
                x: el.rect.x * scale + dx,
                y: el.rect.y * scale + dy,
                w: e.width,
                h: e.height,
              });
            }}
            onResizeEnd={(e) => {
              resizeModifierCleanupRef.current?.();
              resizeModifierCleanupRef.current = null;
              setKeepRatioActive(false);
              resizeFromCenterRef.current = false;
              const last = e.lastEvent;
              setLiveResize(null);
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              const el = store()
                .deck.slides.find((s) => s.id === currentSlideId)
                ?.elements.find((x) => x.id === id);
              if (!el) return;
              const [dx, dy] = last.drag.dist as [number, number];
              const rect: Rect = {
                x: el.rect.x + pxToEmu(dx, scale),
                y: el.rect.y + pxToEmu(dy, scale),
                w: pxToEmu(last.width, scale),
                h: pxToEmu(last.height, scale),
              };
              store().setRect(id, rect);
            }}
            onRotateStart={() => {
              pendingSelectRef.current = null;
            }}
            onRotate={(e) => {
              // Paint the angle every frame — the model is written once on end.
              setLiveRotate({ id: (e.target as HTMLElement).dataset.id!, deg: e.rotation });
            }}
            onRotateEnd={(e) => {
              setLiveRotate(null);
              const last = e.lastEvent;
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              store().updateElement(id, { rotation: normalizeDeg(last.rotation) });
            }}
          />
        ) : null}

        {/* Mounted only once the workspace node exists — see `dragRoot`. */}
        {dragRoot ? (
          <Selecto
            ref={selectoRef}
            // The whole workspace, not just the slide: PowerPoint lets a
            // marquee start out in the grey surround and sweep onto the slide.
            dragContainer={dragRoot}
            selectableTargets={['.dd-el']}
            hitRate={100}
            selectFromInside={false}
            selectByClick={false}
            toggleContinueSelect={['shift']}
            onDragStart={(e) => {
              const inp = e.inputEvent as MouseEvent;
              const target = inp.target as HTMLElement;
              if (
                moveableRef.current?.isMoveableElement(target) ||
                selectedNodes.some((n) => n === target || n.contains(target))
              ) {
                e.stop();
              }
            }}
            onSelectEnd={(e) => {
              // A click (not a marquee) also ends a Selecto gesture, and its
              // `selected` is just the pre-existing selection — applying it
              // would stomp the click's own selection change.
              if (e.isDragStartEnd) return;
              const ids = e.selected
                .map((n) => (n as HTMLElement).dataset.id)
                .filter(Boolean) as string[];
              store().select(ids);
            }}
          />
        ) : null}
      </div>

      {contextMenu
        ? (() => {
            const primary = slide.elements.find((e) => e.id === contextMenu.primaryId);
            if (!primary) return null;
            return (
              <ShapeContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                elementIds={contextMenu.ids}
                primary={primary}
                onClose={() => setContextMenu(null)}
              />
            );
          })()
        : null}

      {editingChart && slide.chart ? (
        <ChartEditorModal
          initial={slide.chart}
          ds={ds}
          saveLabel="Save changes"
          onCancel={() => setEditingChart(false)}
          onSave={(config) => {
            store().updateSlideChart(slide.id, config);
            setEditingChart(false);
          }}
        />
      ) : null}
    </div>
  );
}
