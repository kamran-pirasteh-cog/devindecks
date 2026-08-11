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
import { useEffect, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { ElementVisual } from '@/render/SlideView';
import { pxToEmu, type Rect } from '@/model';
import { useEditor } from '@/store/editorStore';
import { ShapeContextMenu } from './ShapeContextMenu';
import { TextEditor } from './TextEditor';
import { ChartEditorModal } from './ChartEditorModal';

const CANVAS_PAD = 48;

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
  const shiftToggleCandidateRef = useRef<string | null>(null);
  const [editingChart, setEditingChart] = useState(false);

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

  const scale = width / deck.slideSize.w;
  const height = deck.slideSize.h * scale;

  // Keep the overlay glued to the element after ANY model change — inspector
  // edits, undo/redo, a drag commit — so handles never drift from the object.
  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [selectedIds, width, deck]);

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

  const attachDragModifiers = (inputEvent: any) => {
    // A real drag is starting — this was not a shift-click toggle.
    shiftToggleCandidateRef.current = null;
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
  const lockAxis = (dx: number, dy: number): [number, number] =>
    Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];

  if (!slide) return null;

  return (
    <div
      ref={wrapRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-zinc-200/70 dark:bg-zinc-800"
    >
      <div
        ref={canvasRef}
        className="dd-canvas group relative shadow-xl ring-1 ring-black/10"
        style={{ width, height, background: '#ffffff' }}
        onMouseDown={(e) => {
          // Clicking empty canvas clears selection (marquee handled by Selecto).
          if (e.target === canvasRef.current) store().clearSelection();
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
                  el.rotation ? ` rotate(${el.rotation}deg)` : ''
                }`,
                transformOrigin: 'center center',
                cursor: 'move',
              }}
              onMouseDown={(e) => {
                if (isEditing) return;
                // Shift-click toggles; plain click selects just this one. But
                // shift-mousedown on an already-selected element is ambiguous
                // with a shift-drag (axis-locked move) — defer the toggle to
                // mouseup, and only apply it if no drag actually started.
                if (e.shiftKey) {
                  if (selectedIds.includes(el.id)) {
                    shiftToggleCandidateRef.current = el.id;
                    const finalize = () => {
                      if (shiftToggleCandidateRef.current === el.id) {
                        store().toggleSelect(el.id);
                      }
                      shiftToggleCandidateRef.current = null;
                      window.removeEventListener('mouseup', finalize);
                    };
                    window.addEventListener('mouseup', finalize);
                  } else {
                    e.stopPropagation();
                    store().toggleSelect(el.id);
                  }
                } else if (!selectedIds.includes(el.id)) {
                  store().select([el.id]);
                }
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
            verticalGuidelines={[0, width / 2, width]}
            horizontalGuidelines={[0, height / 2, height]}
            // During interaction we only paint the transform for smoothness; the
            // model is written once on end from the delta (dist), then React
            // re-renders the authoritative transform. No baking, no leftover.
            onDragStart={(e) => attachDragModifiers(e.inputEvent)}
            onDrag={(e) => {
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
            onDragGroupStart={(e) => attachDragModifiers(e.inputEvent)}
            onDragGroup={(e) => {
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
            onRotateEnd={(e) => {
              const last = e.lastEvent;
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              store().updateElement(id, { rotation: Math.round(last.rotation) });
            }}
          />
        ) : null}

        <Selecto
          ref={selectoRef}
          dragContainer={canvasRef.current ?? undefined}
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
            const ids = e.selected
              .map((n) => (n as HTMLElement).dataset.id)
              .filter(Boolean) as string[];
            store().select(ids);
          }}
        />
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
