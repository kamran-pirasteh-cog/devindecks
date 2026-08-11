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
import { TextEditor } from './TextEditor';

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

  // Keep moveable in sync when selection changes elsewhere (inspector, undo…).
  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [selectedIds, width]);

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

  if (!slide) return null;

  return (
    <div
      ref={wrapRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-zinc-200/70 dark:bg-zinc-800"
    >
      <div
        ref={canvasRef}
        className="dd-canvas relative shadow-xl ring-1 ring-black/10"
        style={{ width, height, background: '#ffffff' }}
        onMouseDown={(e) => {
          // Clicking empty canvas clears selection (marquee handled by Selecto).
          if (e.target === canvasRef.current) store().clearSelection();
        }}
      >
        {slide.elements.map((el) => {
          const isEditing = editingId === el.id;
          return (
            <div
              key={el.id}
              data-id={el.id}
              ref={(node) => {
                if (node) nodeMap.current.set(el.id, node);
                else nodeMap.current.delete(el.id);
              }}
              className="dd-el absolute"
              style={{
                left: el.rect.x * scale,
                top: el.rect.y * scale,
                width: el.rect.w * scale,
                height: el.rect.h * scale,
                transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                transformOrigin: 'center center',
                cursor: 'move',
                outline: selectedIds.includes(el.id) ? undefined : 'none',
              }}
              onMouseDown={(e) => {
                if (isEditing) return;
                // Shift-click toggles; plain click selects just this one.
                if (e.shiftKey) {
                  e.stopPropagation();
                  store().toggleSelect(el.id);
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
            >
              <ElementVisual el={el} ds={ds} scale={scale} />
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
            keepRatio={false}
            origin={false}
            snappable
            snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            snapThreshold={6}
            elementGuidelines={guidelineNodes}
            verticalGuidelines={[0, width / 2, width]}
            horizontalGuidelines={[0, height / 2, height]}
            onDrag={(e) => {
              e.target.style.transform = e.transform;
            }}
            onDragEnd={(e) => {
              const t = e.lastEvent?.translate;
              if (!t) return;
              const id = (e.target as HTMLElement).dataset.id!;
              store().moveBy([id], pxToEmu(t[0], scale), pxToEmu(t[1], scale));
            }}
            onDragGroup={(e) => {
              e.events.forEach((ev) => {
                ev.target.style.transform = ev.transform;
              });
            }}
            onDragGroupEnd={(e) => {
              const t = e.lastEvent?.translate ?? e.events[0]?.lastEvent?.translate;
              if (!t) return;
              store().moveBy(selectedIds, pxToEmu(t[0], scale), pxToEmu(t[1], scale));
            }}
            onResize={(e) => {
              e.target.style.width = `${e.width}px`;
              e.target.style.height = `${e.height}px`;
              e.target.style.transform = e.drag.transform;
            }}
            onResizeEnd={(e) => {
              const last = e.lastEvent;
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              const el = store().deck.slides.find((s) => s.id === currentSlideId)?.elements.find((x) => x.id === id);
              if (!el) return;
              const [tx, ty] = last.drag.translate as [number, number];
              const rect: Rect = {
                x: el.rect.x + pxToEmu(tx, scale),
                y: el.rect.y + pxToEmu(ty, scale),
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
    </div>
  );
}
