'use client';

/** Slide navigator — thumbnails via the same SlideView renderer, scaled down. */
import { SlideView } from '@/render/SlideView';
import { useEditor } from '@/store/editorStore';
import { useResizableWidth } from './useResizableWidth';
import { ResizeHandle } from './ResizeHandle';

const THUMB_W = 168;

export function Filmstrip() {
  const deck = useEditor((s) => s.deck);
  const ds = useEditor((s) => s.designSystem);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const setCurrentSlide = useEditor((s) => s.setCurrentSlide);
  const addSlide = useEditor((s) => s.addSlide);
  const duplicateSlide = useEditor((s) => s.duplicateSlide);
  const deleteSlide = useEditor((s) => s.deleteSlide);
  const { width, startDrag } = useResizableWidth(196, 180, 320, 'right');

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
          <button
            onClick={addSlide}
            title="Add slide"
            className="h-6 w-6 rounded bg-zinc-200 text-sm text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300"
          >
            +
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {deck.slides.map((slide, i) => (
            <div key={slide.id} className="group relative">
              <button
                onClick={() => setCurrentSlide(slide.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
                  if (deck.slides.length <= 1) return;
                  e.preventDefault();
                  deleteSlide(slide.id);
                }}
                className={`block w-full overflow-hidden rounded ring-1 ${
                  slide.id === currentSlideId
                    ? 'ring-2 ring-indigo-500'
                    : 'ring-black/10 hover:ring-zinc-400'
                }`}
              >
                <SlideView slide={slide} slideSize={deck.slideSize} designSystem={ds} width={THUMB_W} />
              </button>
              <span className="absolute left-1 top-1 rounded bg-black/50 px-1 text-[9px] text-white">
                {i + 1}
              </span>
              <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                <button
                  onClick={() => duplicateSlide(slide.id)}
                  title="Duplicate"
                  className="h-4 w-4 rounded bg-black/50 text-[9px] leading-none text-white"
                >
                  ⧉
                </button>
                {deck.slides.length > 1 ? (
                  <button
                    onClick={() => deleteSlide(slide.id)}
                    title="Delete slide"
                    className="h-4 w-4 rounded bg-black/50 text-[9px] leading-none text-white"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
      <ResizeHandle onPointerDown={startDrag} />
    </div>
  );
}
