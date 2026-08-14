'use client';

/**
 * Comments panel — the right-hand discussion rail, Google Slides' model:
 * threads pinned to an object (or to the slide), replies inside a thread, and
 * resolve to file it away without losing it.
 *
 * Like every other panel here it's a thin trigger surface over a store — all
 * the mutation lives in `commentStore`, so the pins on the canvas, the filmstrip
 * badges and this list can never disagree about what exists.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useComments, COMMENT_AUTHOR } from '@/store/commentStore';
import { useEditor } from '@/store/editorStore';
import type { CommentThread } from '@/comments/types';
import type { SlideElement } from '@/model';
import { elementLabel } from './commentAnchor';
import { useResizableWidth } from './useResizableWidth';
import { ResizeHandle } from './ResizeHandle';

/** "just now" / "4m" / "3h" / "2d" / a date once it stops being recent. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Up to two initials, so the avatar reads as a person rather than a blob. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-semibold text-white">
      {initials(name)}
    </span>
  );
}

/** Multi-line box that posts on ⌘/Ctrl+Enter or the button, cancels on Esc. */
function Composer({
  placeholder,
  autoFocus,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  autoFocus?: boolean;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value);
    setValue('');
  };

  return (
    <div className="space-y-1.5">
      <textarea
        ref={ref}
        value={value}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Stop here: the editor's window-level handler treats bare keys as
          // canvas shortcuts, and Esc would clear the selection behind us.
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel?.();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />
      <div className="flex items-center justify-end gap-1.5">
        {onCancel ? (
          <button
            onClick={onCancel}
            className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        ) : null}
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  slideIndex,
  anchorLabel,
  detached,
  active,
  onActivate,
}: {
  thread: CommentThread;
  slideIndex: number;
  anchorLabel: string;
  detached: boolean;
  active: boolean;
  onActivate: () => void;
}) {
  const store = useComments.getState;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);

  // Opening a thread from its pin on the canvas has to bring the card into
  // view, or the click looks like it did nothing.
  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  // Collapsed, a card shows the opening comment and a reply count; opening it
  // expands the whole thread. Keeps a busy slide's list scannable.
  const [opening, ...replies] = thread.comments;
  const shown = active ? replies : [];

  return (
    <div
      ref={cardRef}
      onClick={onActivate}
      className={`cursor-pointer rounded-lg border bg-white p-2.5 shadow-sm transition dark:bg-zinc-900 ${
        active
          ? 'border-indigo-400 ring-1 ring-indigo-400/40'
          : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
      } ${thread.resolved ? 'opacity-60' : ''}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-zinc-400">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-zinc-800">
          Slide {slideIndex + 1}
        </span>
        <span className="truncate" title={anchorLabel}>
          {anchorLabel}
        </span>
        {detached ? (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            object deleted
          </span>
        ) : null}
        {thread.resolved ? (
          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            resolved
          </span>
        ) : null}
      </div>

      {[opening, ...shown].filter(Boolean).map((c, i) => (
        <div key={c.id} className={i === 0 ? '' : 'mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800'}>
          <div className="flex gap-2">
            <Avatar name={c.author} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                  {c.author}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-400">
                  {relativeTime(c.createdAt)}
                  {c.editedAt ? ' · edited' : ''}
                </span>
              </div>
              {editingId === c.id ? (
                <div className="mt-1 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    value={editValue}
                    rows={2}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') setEditingId(null);
                      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        store().editComment(thread.id, c.id, editValue);
                        setEditingId(null);
                      }
                    }}
                    className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        store().editComment(thread.id, c.id, editValue);
                        setEditingId(null);
                      }}
                      className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-300">
                  {c.body}
                </p>
              )}
              {active && editingId !== c.id && c.author === COMMENT_AUTHOR ? (
                <div className="mt-1 flex gap-2 text-[10px] text-zinc-400">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(c.id);
                      setEditValue(c.body);
                    }}
                    className="hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      store().deleteComment(thread.id, c.id);
                    }}
                    className="hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}

      {active ? (
        <div className="mt-2.5 space-y-2" onClick={(e) => e.stopPropagation()}>
          <Composer
            placeholder="Reply…"
            submitLabel="Reply"
            onSubmit={(body) => store().reply(thread.id, body)}
          />
          <div className="flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <button
              onClick={() => store().setResolved(thread.id, !thread.resolved)}
              className="rounded px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              {thread.resolved ? '↺ Reopen' : '✓ Resolve'}
            </button>
            <button
              onClick={() => store().deleteThread(thread.id)}
              className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
            >
              Delete thread
            </button>
          </div>
        </div>
      ) : replies.length ? (
        <div className="mt-1.5 pl-8 text-[11px] text-zinc-400">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </div>
      ) : null}
    </div>
  );
}

export function CommentsPanel() {
  const open = useComments((s) => s.panelOpen);
  const threads = useComments((s) => s.threads);
  const scope = useComments((s) => s.scope);
  const showResolved = useComments((s) => s.showResolved);
  const activeThreadId = useComments((s) => s.activeThreadId);
  const draft = useComments((s) => s.draft);
  const slides = useEditor((s) => s.deck.slides);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const store = useComments.getState;

  const slideIndex = useMemo(
    () => Object.fromEntries(slides.map((s, i) => [s.id, i])),
    [slides],
  );
  const elementById = useMemo(() => {
    const map = new Map<string, SlideElement>();
    for (const s of slides) for (const el of s.elements) map.set(el.id, el);
    return map;
  }, [slides]);
  /** An element's own slide, so a grouped anchor can borrow its group's text. */
  const siblingsOf = useMemo(() => {
    const map = new Map<string, SlideElement[]>();
    for (const s of slides) for (const el of s.elements) map.set(el.id, s.elements);
    return map;
  }, [slides]);

  const visible = threads
    .filter((t) => (scope === 'slide' ? t.slideId === currentSlideId : true))
    .filter((t) => (showResolved ? true : !t.resolved))
    .sort(
      (a, b) =>
        (slideIndex[a.slideId] ?? 0) - (slideIndex[b.slideId] ?? 0) ||
        a.createdAt.localeCompare(b.createdAt),
    );

  const { width, startDrag } = useResizableWidth(300, 260, 460, 'left');

  if (!open) return null;

  const draftElement = draft?.elementId ? elementById.get(draft.elementId) : undefined;

  return (
    <div className="flex h-full shrink-0">
      <ResizeHandle onPointerDown={startDrag} />
      <div
        style={{ width }}
        className="flex h-full flex-col border-l border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="text-sm font-medium">Comments</span>
          <button
            onClick={() => store().closePanel()}
            title="Close comments"
            aria-label="Close comments"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="flex rounded-md bg-zinc-200/70 p-0.5 text-[11px] dark:bg-zinc-800">
            {(['slide', 'deck'] as const).map((s) => (
              <button
                key={s}
                onClick={() => store().setScope(s)}
                className={`rounded px-2 py-0.5 ${
                  scope === s
                    ? 'bg-white font-medium text-zinc-800 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-zinc-500'
                }`}
              >
                {s === 'slide' ? 'This slide' : 'All slides'}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => store().setShowResolved(e.target.checked)}
              className="h-3 w-3 accent-indigo-600"
            />
            Resolved
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {draft ? (
            <div className="rounded-lg border border-indigo-400 bg-white p-2.5 shadow-sm dark:bg-zinc-900">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-zinc-400">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-zinc-800">
                  Slide {(slideIndex[draft.slideId] ?? 0) + 1}
                </span>
                <span className="truncate">
                  {draftElement
                    ? elementLabel(draftElement, siblingsOf.get(draftElement.id))
                    : 'whole slide'}
                </span>
              </div>
              <div className="flex gap-2">
                <Avatar name={COMMENT_AUTHOR} />
                <div className="min-w-0 flex-1">
                  <Composer
                    autoFocus
                    placeholder="Add a comment…"
                    submitLabel="Comment"
                    onSubmit={(body) => store().submitDraft(body)}
                    onCancel={() => store().cancelDraft()}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {visible.map((t) => {
            const el = t.elementId ? elementById.get(t.elementId) : undefined;
            return (
              <ThreadCard
                key={t.id}
                thread={t}
                slideIndex={slideIndex[t.slideId] ?? 0}
                anchorLabel={
                  t.elementId
                    ? el
                      ? elementLabel(el, siblingsOf.get(el.id))
                      : 'deleted object'
                    : 'whole slide'
                }
                detached={!!t.elementId && !el}
                active={activeThreadId === t.id}
                onActivate={() => {
                  const editor = useEditor.getState();
                  if (t.slideId !== editor.currentSlideId) editor.setCurrentSlide(t.slideId);
                  if (t.elementId && elementById.has(t.elementId)) editor.select([t.elementId]);
                  store().setActiveThread(t.id);
                }}
              />
            );
          })}

          {!draft && visible.length === 0 ? (
            <p className="px-1 pt-6 text-center text-xs text-zinc-400">
              No {showResolved ? '' : 'open '}comments {scope === 'slide' ? 'on this slide' : 'in this document'}.
              <br />
              Select an object and press ⌘⌥M to start one.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
