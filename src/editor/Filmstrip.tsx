'use client';

/** Slide navigator — thumbnails via the same SlideView renderer, scaled down. */
import { useEffect, useRef, useState } from 'react';
import { SlideView } from '@/render/SlideView';
import { showsPageNumbers } from '@/model';
import { useEditor } from '@/store/editorStore';
import { useComments } from '@/store/commentStore';
import { unresolvedCounts } from '@/comments/types';
import { FLAGS } from '@/flags';
import { useResizableWidth } from './useResizableWidth';
import { useContentWidth } from './useContentWidth';
import { ResizeHandle } from './ResizeHandle';
import { makeSlideDragImage } from './slideDragImage';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { slideMenuItems } from './slideMenuItems';

/** First non-dragged slide after `afterIndex`, or null to mean "end of list". */
function nextDropTargetId(afterIndex: number, draggingIds: string[], slides: { id: string }[]) {
  for (let i = afterIndex + 1; i < slides.length; i++) {
    if (!draggingIds.includes(slides[i].id)) return slides[i].id;
  }
  return null;
}

export function Filmstrip({ singleSlide = false }: { singleSlide?: boolean } = {}) {
  const deck = useEditor((s) => s.deck);
  const ds = useEditor((s) => s.designSystem);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const selectedSlideIds = useEditor((s) => s.selectedSlideIds);
  const setCurrentSlide = useEditor((s) => s.setCurrentSlide);
  const selectSlideRange = useEditor((s) => s.selectSlideRange);
  const toggleSlideSelection = useEditor((s) => s.toggleSlideSelection);
  const addSlide = useEditor((s) => s.addSlide);
  const duplicateSlide = useEditor((s) => s.duplicateSlide);
  const deleteSlides = useEditor((s) => s.deleteSlides);
  const moveSlides = useEditor((s) => s.moveSlides);
  const threads = useComments((s) => s.threads);
  const commentCounts = unresolvedCounts(threads);
  const { width, startDrag } = useResizableWidth(196, 180, 320, 'right');
  // Measured, not derived: the thumbnail column's usable width is the panel
  // width minus padding (and any scrollbar gutter). See useContentWidth.
  const listRef = useRef<HTMLDivElement>(null);
  const thumbWidth = useContentWidth(listRef);

  // Keep the active thumbnail in view when the slide changes from outside the
  // strip (arrow keys, canvas scroll) — 'nearest' makes a click on an already
  // visible thumbnail a no-op.
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentSlideId]);

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [draggingIds, setDraggingIds] = useState<string[] | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<'before' | 'after'>('before');

  const endDrag = () => {
    setDraggingIds(null);
    setDragOverId(null);
  };

  return (
    <div className="flex h-full shrink-0">
      <div
        style={{ width }}
        className="flex h-full flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Slides
          </span>
          {singleSlide ? null : (
            <button
              onClick={addSlide}
              title="Add slide"
              className="h-6 w-6 rounded bg-zinc-200 text-sm text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300"
            >
              +
            </button>
          )}
        </div>
        {/* pt-1: the active thumbnail's ring and the drop indicator are drawn
            outside the box, so the scroll container needs slack or they clip.

            data-slide-strip marks the keyboard's home for the clipboard chords:
            ⌘X/⌘C/⌘V with focus in here act on slides, not on canvas objects. */}
        <div
          ref={listRef}
          data-slide-strip={singleSlide ? undefined : ''}
          className="flex-1 space-y-2 overflow-y-auto px-3 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onKeyDown={(e) => {
            if (singleSlide) return;
            if (e.key !== 'Backspace' && e.key !== 'Delete') return;
            // A thumbnail keeps DOM focus after the click that selected the
            // slide — Moveable swallows the canvas mousedown, so focus never
            // leaves the strip. Without this guard, deleting a selected object
            // on the canvas would bubble up here and take the slide with it.
            if (useEditor.getState().selectedIds.length) return;
            e.preventDefault();
            deleteSlides(selectedSlideIds.length > 0 ? selectedSlideIds : [currentSlideId]);
          }}
          onDragOver={(e) => {
            if (draggingIds) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (draggingIds && dragOverId === null) moveSlides(draggingIds, null);
            endDrag();
          }}
        >
          {deck.slides.map((slide, i) => {
            const isActive = slide.id === currentSlideId;
            const isMultiSelected = selectedSlideIds.length > 1 && selectedSlideIds.includes(slide.id);
            const isDragging = draggingIds?.includes(slide.id) ?? false;
            return (
              <div
                key={slide.id}
                ref={isActive ? activeRef : undefined}
                className={`group relative rounded ${isMultiSelected ? 'bg-indigo-500/10' : ''} ${
                  isDragging ? 'opacity-40' : ''
                }`}
                draggable={!singleSlide}
                onDragStart={(e) => {
                  const group = isMultiSelected ? selectedSlideIds : [slide.id];
                  if (!isMultiSelected) setCurrentSlide(slide.id);
                  setDraggingIds(group);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', slide.id);
                  // More than one slide in hand: drag a counted stack rather
                  // than the browser's ghost of the single thumbnail grabbed.
                  if (group.length > 1) {
                    const ghost = makeSlideDragImage(e.currentTarget, group.length);
                    e.dataTransfer.setDragImage(ghost, 24, 20);
                    // The snapshot is taken synchronously, so the node only has
                    // to survive this tick.
                    setTimeout(() => ghost.remove(), 0);
                  }
                }}
                onDragEnd={endDrag}
                // The same rule the drag follows: a right-click inside a
                // multi-selection acts on all of it, one outside it takes the
                // slide under the pointer and drops the rest.
                onContextMenu={(e) => {
                  if (singleSlide) return;
                  e.preventDefault();
                  const group = isMultiSelected ? selectedSlideIds : [slide.id];
                  if (!isMultiSelected) setCurrentSlide(slide.id);
                  setMenu({ x: e.clientX, y: e.clientY, items: slideMenuItems(group) });
                }}
                onDragOver={(e) => {
                  if (!draggingIds || draggingIds.includes(slide.id)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const isAfter = e.clientY - rect.top > rect.height / 2;
                  setDragOverId(slide.id);
                  setDragPosition(isAfter ? 'after' : 'before');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggingIds && !draggingIds.includes(slide.id)) {
                    const beforeId =
                      dragPosition === 'before' ? slide.id : nextDropTargetId(i, draggingIds, deck.slides);
                    moveSlides(draggingIds, beforeId);
                  }
                  endDrag();
                }}
              >
                {dragOverId === slide.id ? (
                  <div
                    className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-indigo-500 ${
                      dragPosition === 'before' ? '-top-1' : '-bottom-1'
                    }`}
                  />
                ) : null}
                <button
                  onClick={(e) => {
                    if (e.shiftKey) selectSlideRange(slide.id);
                    else if (e.metaKey || e.ctrlKey) toggleSlideSelection(slide.id);
                    else setCurrentSlide(slide.id);
                  }}
                  style={{ aspectRatio: `${deck.slideSize.w} / ${deck.slideSize.h}` }}
                  className={`block w-full overflow-hidden rounded ring-1 ${
                    isActive
                      ? 'ring-2 ring-indigo-500'
                      : isMultiSelected
                        ? 'ring-2 ring-indigo-400'
                        : 'ring-black/10 hover:ring-zinc-400'
                  }`}
                >
                  {thumbWidth === null ? null : (
                    <SlideView
                      slide={slide}
                      slideSize={deck.slideSize}
                      designSystem={ds}
                      width={thumbWidth}
                      page={
                        showsPageNumbers(deck) ? { index: i, count: deck.slides.length } : undefined
                      }
                    />
                  )}
                </button>
                {/* Bottom-right: out of the way of the hover actions up top, and
                    clear of the title area most slides put in the top-left. */}
                <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/50 px-1 text-[9px] text-white">
                  {i + 1}
                </span>
                {/* Open threads on this slide — the same signal Google Slides
                    puts on a thumbnail, so a comment on slide 14 is findable
                    without paging through the deck. */}
                {FLAGS.comments && commentCounts[slide.id] ? (
                  <span
                    title={`${commentCounts[slide.id]} open ${
                      commentCounts[slide.id] === 1 ? 'comment' : 'comments'
                    }`}
                    className="pointer-events-none absolute bottom-1 left-1 flex h-5 items-center gap-0.5 rounded bg-amber-300 px-1 text-[9px] font-semibold leading-none text-amber-900"
                  >
                    💬 {commentCounts[slide.id]}
                  </span>
                ) : null}
                {singleSlide ? null : (
                  <>
                    <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                      <button
                        onClick={() => duplicateSlide(slide.id)}
                        title="Duplicate"
                        className="flex h-6 w-6 items-center justify-center rounded bg-black/50 text-sm leading-none text-white hover:bg-black/70"
                      >
                        ⧉
                      </button>
                      {deck.slides.length > 1 ? (
                        <button
                          onClick={() => deleteSlides([slide.id])}
                          title="Delete slide"
                          className="flex h-6 w-6 items-center justify-center rounded bg-black/50 text-sm leading-none text-white hover:bg-black/70"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ResizeHandle onPointerDown={startDrag} />
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}
