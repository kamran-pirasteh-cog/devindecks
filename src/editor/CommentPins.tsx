'use client';

/**
 * Comment pins on the canvas — the little markers Google Slides parks on the
 * corner of a commented object.
 *
 * Pins are chrome, not content: they live in an overlay above the elements,
 * they're never part of the model, and they never appear in the renderer that
 * backs the filmstrip, preview and export (`SlideView`). The `dd-comment-pin`
 * class is load-bearing — the canvas's mousedown resolver and Selecto both
 * check for it, so clicking a pin neither clears the selection nor starts a
 * marquee.
 */
import { useComments } from '@/store/commentStore';
import { useEditor } from '@/store/editorStore';
import type { CommentThread } from '@/comments/types';
import type { Slide } from '@/model';

/** Class the canvas hit-testing treats as "editor UI, not the slide". */
export const PIN_CLASS = 'dd-comment-pin';

export function CommentPins({ slide, scale }: { slide: Slide; scale: number }) {
  const threads = useComments((s) => s.threads);
  const showResolved = useComments((s) => s.showResolved);
  const activeThreadId = useComments((s) => s.activeThreadId);
  const draft = useComments((s) => s.draft);
  const store = useComments.getState;

  const mine = threads.filter(
    (t) => t.slideId === slide.id && (showResolved || !t.resolved),
  );
  if (!mine.length && !draft) return null;

  const elementRect = (id: string) => slide.elements.find((e) => e.id === id)?.rect;

  /**
   * Where a pin sits: hooked over the object's top-right corner, or — for a
   * thread about the slide itself, or one whose object has been deleted —
   * stacked down the slide's right edge so it stays reachable.
   */
  const position = (thread: CommentThread, stackIndex: number) => {
    const rect = thread.elementId ? elementRect(thread.elementId) : undefined;
    if (rect) {
      return { left: (rect.x + rect.w) * scale - 8, top: rect.y * scale - 10 };
    }
    return { right: -10, top: 8 + stackIndex * 30 };
  };

  let stack = 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {mine.map((t) => {
        const anchored = !!t.elementId && !!elementRect(t.elementId);
        const pos = position(t, anchored ? 0 : stack++);
        const active = activeThreadId === t.id;
        const count = t.comments.length;
        return (
          <button
            key={t.id}
            style={pos}
            className={`${PIN_CLASS} pointer-events-auto absolute flex h-6 min-w-6 items-center gap-1 rounded-full rounded-bl-sm px-1.5 text-[10px] font-semibold shadow-md ring-1 transition ${
              t.resolved
                ? 'bg-white text-emerald-600 ring-emerald-300 dark:bg-zinc-900'
                : active
                  ? 'bg-indigo-600 text-white ring-indigo-700'
                  : 'bg-amber-300 text-amber-900 ring-amber-500/60 hover:bg-amber-200'
            }`}
            title={`${count} ${count === 1 ? 'comment' : 'comments'} — click to open`}
            onClick={(e) => {
              e.stopPropagation();
              const editor = useEditor.getState();
              if (t.elementId && anchored) editor.select([t.elementId]);
              store().openPanel();
              store().setActiveThread(t.id);
            }}
          >
            <span aria-hidden>💬</span>
            {count > 1 ? <span>{count}</span> : null}
          </button>
        );
      })}

      {/* The pin for a thread being written, so it's obvious what it will
          attach to before the first word is typed. */}
      {draft && draft.slideId === slide.id
        ? (() => {
            const rect = draft.elementId ? elementRect(draft.elementId) : undefined;
            const pos = rect
              ? { left: (rect.x + rect.w) * scale - 8, top: rect.y * scale - 10 }
              : { right: -10, top: 8 + stack * 30 };
            return (
              <span
                style={pos}
                className={`${PIN_CLASS} pointer-events-none absolute flex h-6 min-w-6 animate-pulse items-center justify-center rounded-full rounded-bl-sm bg-indigo-600 px-1.5 text-[10px] text-white shadow-md ring-1 ring-indigo-700`}
              >
                💬
              </span>
            );
          })()
        : null}
    </div>
  );
}
