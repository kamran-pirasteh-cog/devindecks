'use client';

/**
 * The import picker: choose a .pptx or PDF, see every slide in it, tick the
 * ones you want.
 *
 * The thumbnails are NOT rasters from the source file — they're the imported
 * slides rendered through the same `<SlideView>` the canvas uses. So the
 * preview is the actual import result: whatever looks wrong here is what would
 * land in the deck, which is the only preview worth showing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideView } from '@/render/SlideView';
import { useEditor } from '@/store/editorStore';
import { IMPORT_ACCEPT, ImportError, parseImportFile, type ImportedDeck } from '@/import';
import { fitSlide, placementFor } from '@/import/fit';
import { MODAL_Z } from './layers';

type Phase =
  | { state: 'choosing' }
  | { state: 'reading'; name: string }
  | { state: 'ready'; name: string; deck: ImportedDeck }
  | { state: 'failed'; message: string };

const THUMB_WIDTH = 232;

export function ImportSlidesDialog({ onClose }: { onClose: () => void }) {
  const ds = useEditor((s) => s.designSystem);
  const insertSlides = useEditor((s) => s.insertSlides);
  const deckSlideSize = useEditor((s) => s.deck.slideSize);

  const [phase, setPhase] = useState<Phase>({ state: 'choosing' });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = useCallback(
    async (file: File) => {
      setPhase({ state: 'reading', name: file.name });
      try {
        const deck = await parseImportFile(file, ds);
        setPicked(new Set(deck.slides.map((_, i) => i)));
        setPhase({ state: 'ready', name: file.name, deck });
      } catch (err) {
        setPhase({
          state: 'failed',
          message:
            err instanceof ImportError
              ? err.message
              : `That file couldn’t be read (${(err as Error).message}).`,
        });
      }
    },
    [ds],
  );

  // The picker opens straight into the file chooser: the dialog exists to pick
  // SLIDES, and making the user click "choose a file" first is a step for
  // nothing.
  useEffect(() => {
    inputRef.current?.click();
  }, []);

  const doImport = () => {
    if (phase.state !== 'ready') return;
    // A deck has one slide size, so the fit happens now, not at export.
    const placement = placementFor(phase.deck.slideSize, deckSlideSize);
    const chosen = phase.deck.slides
      .filter((_, i) => picked.has(i))
      .map((s) => fitSlide(s.slide, placement));
    if (!chosen.length) return;
    insertSlides(chosen);
    onClose();
  };

  const size = phase.state === 'ready' ? phase.deck.slideSize : deckSlideSize;
  const differentSize =
    phase.state === 'ready' &&
    Math.abs(size.w / size.h - deckSlideSize.w / deckSlideSize.h) > 0.01;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import slides"
      onClick={onClose}
      style={{ zIndex: MODAL_Z }}
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void load(file);
        }}
        className={`flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 dark:bg-zinc-900 ${
          dragging ? 'ring-2 ring-indigo-500' : 'ring-black/10 dark:ring-white/10'
        }`}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Import slides
            </h2>
            {phase.state === 'ready' || phase.state === 'reading' ? (
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{phase.name}</p>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                PowerPoint (.pptx) or PDF
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            ✕
          </button>
        </header>

        <input
          ref={inputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void load(file);
          }}
        />

        {phase.state === 'ready' ? (
          <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-2 text-xs dark:border-zinc-800">
            <span className="text-zinc-500 dark:text-zinc-400">
              {picked.size} of {phase.deck.slides.length} selected
            </span>
            <button
              onClick={() => setPicked(new Set(phase.deck.slides.map((_, i) => i)))}
              className="rounded px-1.5 py-0.5 font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
            >
              Select all
            </button>
            <button
              onClick={() => setPicked(new Set())}
              className="rounded px-1.5 py-0.5 font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Clear
            </button>
            <div className="flex-1" />
            <button
              onClick={() => inputRef.current?.click()}
              className="rounded px-1.5 py-0.5 font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Choose a different file
            </button>
          </div>
        ) : null}

        <div className="min-h-[220px] flex-1 overflow-y-auto px-5 py-4">
          {phase.state === 'choosing' ? (
            <Empty onPick={() => inputRef.current?.click()} />
          ) : null}

          {phase.state === 'reading' ? (
            <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Reading {phase.name}…
            </p>
          ) : null}

          {phase.state === 'failed' ? (
            <div className="py-14 text-center">
              <p className="mx-auto max-w-md text-sm text-zinc-700 dark:text-zinc-200">
                {phase.message}
              </p>
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-4 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
              >
                Choose another file
              </button>
            </div>
          ) : null}

          {phase.state === 'ready' ? (
            <>
              <Notices deck={phase.deck} differentSize={differentSize} />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-4">
                {phase.deck.slides.map((s, i) => (
                  <button
                    key={s.slide.id}
                    onClick={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    aria-pressed={picked.has(i)}
                    className={`group relative overflow-hidden rounded-lg text-left ring-2 transition ${
                      picked.has(i)
                        ? 'ring-indigo-500'
                        : 'ring-zinc-200 hover:ring-zinc-400 dark:ring-zinc-700'
                    }`}
                  >
                    <SlideView
                      slide={s.slide}
                      slideSize={phase.deck.slideSize}
                      designSystem={ds}
                      width={THUMB_WIDTH}
                    />
                    <span
                      className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                        picked.has(i)
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white/90 text-zinc-500 ring-1 ring-zinc-300'
                      }`}
                    >
                      {picked.has(i) ? '✓' : ''}
                    </span>
                    <span className="absolute bottom-1 right-2 rounded bg-black/50 px-1 text-[10px] font-medium text-white">
                      {s.sourceIndex}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={doImport}
            disabled={phase.state !== 'ready' || picked.size === 0}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {phase.state === 'ready' && picked.size
              ? `Import ${picked.size} slide${picked.size === 1 ? '' : 's'}`
              : 'Import'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Empty({ onPick }: { onPick: () => void }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Drop a .pptx or PDF here, or
      </p>
      <button
        onClick={onPick}
        className="mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
      >
        Choose a file
      </button>
    </div>
  );
}

/**
 * Fidelity notes. Anything the engine could not carry over exactly is said out
 * loud here — a silent approximation is the thing that gets noticed in front of
 * a client.
 */
function Notices({ deck, differentSize }: { deck: ImportedDeck; differentSize: boolean }) {
  const notes = [...new Set([...deck.notes, ...deck.slides.flatMap((s) => s.notes)])];
  if (!notes.length && !differentSize) return null;
  return (
    <ul className="mb-4 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      {differentSize ? (
        <li>
          These slides are a different shape from this deck — they’ll be scaled
          to fit and centred, keeping their proportions.
        </li>
      ) : null}
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
