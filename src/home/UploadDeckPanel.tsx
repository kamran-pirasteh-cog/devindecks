'use client';

/**
 * Upload a presentation, and choose what to do with it.
 *
 * Two modes, and the choice is the whole point of this panel:
 *
 *  - IMPORT AS-IS keeps the file exactly as it came: its fonts, its colours, its
 *    logo. What you had, in our editor.
 *  - CONVERT TO BRAND keeps the content and the layout and replaces everything
 *    else with the design system's. What you had, in our brand.
 *
 * The choice is offered AFTER the file is read, not before, because until we've
 * parsed it we can't say anything useful about it — and because "convert" is the
 * option most people want, which is easier to recommend once there's a slide
 * count and a font list on screen to recommend it about.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { IMPORT_ACCEPT, ImportError, parseImportFile, type ImportedDeck } from '@/import';
import { fitSlide, placementFor } from '@/import/fit';
import { convertDeck, isConvertible, type ConversionReport } from '@/brand/convert';
import { getActiveDesignSystem } from '@/design/repository';
import { SLIDE_16x9, type Slide } from '@/model';
import type { Diagnostic } from '@/model/ingest';
import { ConvertReview } from '@/brand/ConvertReview';

export interface UploadOutcome {
  slides: Slide[];
  /** What to call the deck by default — the file's own name, cleaned up. */
  suggestedTitle: string;
  converted: boolean;
  report?: ConversionReport;
  diagnostics?: Diagnostic[];
}

type Phase =
  | { state: 'choosing' }
  | { state: 'reading'; name: string; done: number; total: number }
  | { state: 'mode'; name: string; deck: ImportedDeck }
  | { state: 'converting'; name: string }
  | {
      state: 'review';
      name: string;
      deck: ImportedDeck;
      slides: Slide[];
      report: ConversionReport;
      diagnostics: Diagnostic[];
    }
  | { state: 'failed'; message: string };

/**
 * How many of the parsed slides the brand engine could actually change.
 *
 * Asked BEFORE the mode choice, not after, because the honest place to tell
 * someone that converting will do nothing is the moment they are deciding
 * whether to convert. A PDF arrives as one full-bleed page image per slide (see
 * `import/pdf.ts`), so there is no text to re-set and no fill to re-token — and
 * a conversion that changes nothing looks exactly like a conversion that worked.
 */
const convertibleCount = (deck: ImportedDeck): number =>
  deck.slides.filter((s) => isConvertible(s.slide)).length;

/** `Q3 Business Review.pptx` → `Q3 Business Review`. */
function titleFromFile(name: string): string {
  return name.replace(/\.(pptx|pdf)$/i, '').replace(/[_-]+/g, ' ').trim();
}

export function UploadDeckPanel({ onReady }: { onReady: (outcome: UploadOutcome) => void }) {
  const [phase, setPhase] = useState<Phase>({ state: 'choosing' });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (file: File) => {
    setPhase({ state: 'reading', name: file.name, done: 0, total: 0 });
    const ds = getActiveDesignSystem();
    try {
      const deck = await parseImportFile(file, ds, (done, total) =>
        setPhase({ state: 'reading', name: file.name, done, total }),
      );
      setPhase({ state: 'mode', name: file.name, deck });
    } catch (err) {
      setPhase({
        state: 'failed',
        message:
          err instanceof ImportError
            ? err.message
            : `That file couldn’t be read (${(err as Error).message}).`,
      });
    }
  }, []);

  /** As-is: the existing import path, unchanged. */
  const importAsIs = (deck: ImportedDeck, name: string) => {
    const placement = placementFor(deck.slideSize, SLIDE_16x9);
    onReady({
      slides: deck.slides.map((s) => fitSlide(s.slide, placement)),
      suggestedTitle: titleFromFile(name),
      converted: false,
    });
  };

  const convert = (deck: ImportedDeck, name: string) => {
    setPhase({ state: 'converting', name });
    /*
     * Wait for the webfonts before measuring anything.
     *
     * Conversion decides every point size on the deck by measuring text against
     * the real faces, and those decisions are WRITTEN INTO the document. Measure
     * before Geist has loaded and the canvas answers with system-ui's advance
     * widths, so the same upload converts differently on a cold load than on a
     * warm one — sizes that fit one way and shrank the other, with nothing on
     * screen to explain it. `convert.ts` promises "the same upload converts to
     * the same deck every time"; this is what makes that true in a browser.
     *
     * `fonts.ready` also yields the frame this used to get from `setTimeout`, so
     * the "Converting…" state still paints before the synchronous work starts.
     */
    const ready = document.fonts?.ready ?? Promise.resolve();
    void ready.then(() => {
      try {
        const ds = getActiveDesignSystem();
        const placement = placementFor(deck.slideSize, SLIDE_16x9);
        const fitted = deck.slides.map((s) => fitSlide(s.slide, placement));
        const { slides, diagnostics, report } = convertDeck(fitted, {
          ds,
          slideSize: SLIDE_16x9,
        });
        setPhase({ state: 'review', name, deck, slides, report, diagnostics });
      } catch (err) {
        setPhase({
          state: 'failed',
          message: `That deck couldn’t be converted (${(err as Error).message}). You can still import it as-is.`,
        });
      }
    });
  };

  // Straight into the file chooser: this panel exists to pick a file.
  useEffect(() => {
    inputRef.current?.click();
  }, []);

  return (
    <div
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
      className={`rounded-lg ${dragging ? 'ring-2 ring-indigo-500' : ''}`}
    >
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

      {phase.state === 'choosing' ? (
        <div className="py-14 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Drop a .pptx or PDF here, or
          </p>
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Choose a file
          </button>
        </div>
      ) : null}

      {phase.state === 'reading' ? (
        <div className="py-16 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {phase.total ? `Reading slide ${phase.done} of ${phase.total}…` : `Reading ${phase.name}…`}
          </p>
          {phase.total ? (
            <div className="mx-auto mt-3 h-1 w-56 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-indigo-600 transition-[width]"
                style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {phase.state === 'converting' ? (
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Converting {phase.name} to the brand…
        </p>
      ) : null}

      {phase.state === 'mode' ? (
        <ModeChoice
          deck={phase.deck}
          name={phase.name}
          onAsIs={() => importAsIs(phase.deck, phase.name)}
          onConvert={() => convert(phase.deck, phase.name)}
          onChangeFile={() => inputRef.current?.click()}
        />
      ) : null}

      {phase.state === 'review' ? (
        <ConvertReview
          slides={phase.slides}
          sourceSlides={phase.deck.slides.map((s) => s.slide)}
          sourceSlideSize={phase.deck.slideSize}
          report={phase.report}
          diagnostics={phase.diagnostics}
          onBack={() => setPhase({ state: 'mode', name: phase.name, deck: phase.deck })}
          onAccept={(slides) =>
            onReady({
              slides,
              suggestedTitle: titleFromFile(phase.name),
              converted: true,
              report: phase.report,
              diagnostics: phase.diagnostics,
            })
          }
        />
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
    </div>
  );
}

/**
 * The two modes, side by side.
 *
 * Convert is presented first and marked as the recommendation, because it's what
 * the feature is for — but as-is is a full-width equal option rather than a link,
 * because "I just need this deck in the editor" is a real and common need.
 */
function ModeChoice({
  deck,
  name,
  onAsIs,
  onConvert,
  onChangeFile,
}: {
  deck: ImportedDeck;
  name: string;
  onAsIs: () => void;
  onConvert: () => void;
  onChangeFile: () => void;
}) {
  const notes = [...new Set([...deck.notes, ...deck.slides.flatMap((s) => s.notes)])];
  const convertible = convertibleCount(deck);
  // Nothing to work with: every slide is a page image. Converting is offered
  // but demoted, and says plainly what it would and wouldn't do.
  const nothingToConvert = convertible === 0;
  return (
    <div className="py-4">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-200">{name}</span> —{' '}
          {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={onChangeFile}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Choose a different file
        </button>
      </div>

      {nothingToConvert ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            There’s nothing here to re-brand.
          </p>
          <p className="mt-1 text-[11px] text-amber-900/90 dark:text-amber-200/90">
            {deck.slides.length === 1 ? 'This slide is' : 'These slides are'} page
            images — a picture each, with no editable text or shapes. Converting
            would change nothing at all, so it isn’t offered.{' '}
            <strong>Upload the original .pptx</strong> to re-brand this deck, or
            import the images as-is.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={onConvert}
          disabled={nothingToConvert}
          className={`group rounded-lg border-2 p-4 text-left transition ${
            nothingToConvert
              ? 'cursor-not-allowed border-zinc-200 opacity-45 dark:border-zinc-700'
              : 'border-indigo-500 bg-indigo-50/50 hover:bg-indigo-50 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Convert to our brand</span>
            {nothingToConvert ? null : (
              <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                Recommended
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            Keeps the content and the layout. Replaces the type, colours, logo and
            page numbers with ours, then checks every slide for text that no
            longer fits.
          </p>
        </button>

        <button
          onClick={onAsIs}
          className={`rounded-lg border p-4 text-left transition ${
            nothingToConvert
              ? 'border-2 border-indigo-500 bg-indigo-50/50 hover:bg-indigo-50 dark:bg-indigo-950/20'
              : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50'
          }`}
        >
          <span className="text-sm font-semibold">Import as-is</span>
          <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            Brings the slides in exactly as they are, keeping the original fonts,
            colours and branding.
          </p>
        </button>
      </div>

      {notes.length ? (
        <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
