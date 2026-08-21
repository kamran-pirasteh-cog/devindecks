'use client';

/**
 * Before and after, slide by slide — the trust surface.
 *
 * The engine can convert a sixty-slide deck in a second, and that speed is
 * exactly why this screen has to exist. Nobody puts a machine-restyled deck in
 * front of an executive on faith. What makes it usable is not a promise that
 * everything worked, it's a short honest list of the places it didn't.
 *
 * So two things, in order of importance:
 *
 *  1. EVERY SLIDE, SOURCE BESIDE RESULT, both rendered through the real
 *     `<SlideView>` — the same trick `ImportSlidesDialog` uses. A preview drawn
 *     by anything other than the actual renderer is a preview of something that
 *     doesn't exist. Deck order, start to finish — a reviewer about to present
 *     this deck wants to page through the deck as it will be presented, not a
 *     re-sorted or filtered subset of it. The flag counts and the
 *     "only the flagged ones" filter are there when triage is what's wanted.
 *  2. THE PROBLEMS, per slide, in words. A prose summary of the conversion's
 *     bookkeeping — font counts, colour counts, size ladders — reads as
 *     reassurance and costs the reader the whole top of the screen; the
 *     previews are the evidence, and the only text worth keeping is the text
 *     that points at something wrong.
 *
 * Per-slide, the reviewer can keep the ORIGINAL instead, or drop the slide
 * from the deck entirely. Those escape hatches matter more than they look:
 * without them, one slide the engine mangles means abandoning the conversion
 * for the whole deck, and a deck that carries three slides nobody wants means
 * deleting them again in the editor.
 */
import { useMemo, useState } from 'react';
import { FitSlideView } from '@/render/FitSlideView';
import type { SlideView } from '@/render/SlideView';
import { getActiveDesignSystem } from '@/design/repository';
import { SLIDE_16x9, type EMU, type Slide } from '@/model';
import type { Diagnostic } from '@/model/ingest';
import type { ConversionReport } from './convert';

export function ConvertReview({
  slides,
  sourceSlides,
  sourceSlideSize,
  report,
  diagnostics,
  onAccept,
  onBack,
}: {
  slides: Slide[];
  sourceSlides: Slide[];
  sourceSlideSize: { w: EMU; h: EMU };
  report: ConversionReport;
  diagnostics: Diagnostic[];
  onAccept: (slides: Slide[]) => void;
  onBack: () => void;
}) {
  const ds = getActiveDesignSystem();
  /** Slide numbers (1-based) the reviewer chose to keep unconverted. */
  const [keepOriginal, setKeepOriginal] = useState<Set<number>>(new Set());
  // Excluded, not included: everything the upload contained comes along unless
  // the reviewer says otherwise, so an untouched screen means "the whole deck".
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  // Off by default: the reviewer asked for a preview of the deck, and a screen
  // that opens showing three of forty slides is not one.
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const bySlide = useMemo(() => {
    const map = new Map<number, Diagnostic[]>();
    for (const d of diagnostics) {
      map.set(d.slide, [...(map.get(d.slide) ?? []), d]);
    }
    return map;
  }, [diagnostics]);

  /** Deck order, every slide. */
  const order = useMemo(() => slides.map((_, i) => i + 1), [slides]);

  const shown = onlyFlagged ? order.filter((n) => report.flagged.includes(n)) : order;

  const kept = order.filter((n) => !excluded.has(n));

  const accept = () => {
    onAccept(
      kept.map((n) => (keepOriginal.has(n) ? (sourceSlides[n - 1] ?? slides[n - 1]) : slides[n - 1])),
    );
  };

  const untouched = new Set(report.unconvertible);
  const cleanCount = slides.length - report.flagged.length - untouched.size;

  return (
    <div className="py-2">
      {report.unconvertible.length === slides.length ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            Nothing was changed.
          </p>
          <p className="mt-1 text-[11px] text-amber-900/90 dark:text-amber-200/90">
            Every slide here is a page image, so there was no text, colour or
            branding to replace — what you see on the right is the same deck.
            Upload the original <strong>.pptx</strong> to re-brand it.
          </p>
        </div>
      ) : null}

      <div className="flex items-center gap-3 border-y border-zinc-200 py-2 text-xs dark:border-zinc-800">
        <span className={report.clean ? 'text-emerald-700 dark:text-emerald-400' : ''}>
          <strong>{cleanCount}</strong> converted
          {report.flagged.length ? (
            <>
              {' · '}
              <strong className="text-amber-700 dark:text-amber-400">
                {report.flagged.length}
              </strong>{' '}
              <span className="text-amber-700 dark:text-amber-400">need a look</span>
            </>
          ) : null}
          {untouched.size ? (
            <>
              {' · '}
              <strong className="text-zinc-500">{untouched.size}</strong>{' '}
              <span className="text-zinc-500">unchanged</span>
            </>
          ) : null}
        </span>
        {report.flagged.length ? (
          <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.currentTarget.checked)}
            />
            Show only the flagged ones
          </label>
        ) : null}
        <div className="flex-1" />
        {excluded.size ? (
          <span className="text-zinc-500">
            {excluded.size} slide{excluded.size === 1 ? '' : 's'} left out
          </span>
        ) : null}
        {keepOriginal.size ? (
          <span className="text-zinc-500">
            {keepOriginal.size} slide{keepOriginal.size === 1 ? '' : 's'} kept as imported
          </span>
        ) : null}
      </div>

      <div className="mt-4 max-h-[56vh] space-y-5 overflow-y-auto pr-1">
        {shown.map((n) => (
          <SlideRow
            key={n}
            number={n}
            source={sourceSlides[n - 1]}
            sourceSlideSize={sourceSlideSize}
            converted={slides[n - 1]}
            ds={ds}
            info={report.slides[n - 1]}
            diagnostics={bySlide.get(n) ?? []}
            untouched={untouched.has(n)}
            included={!excluded.has(n)}
            onToggleInclude={() =>
              setExcluded((prev) => {
                const next = new Set(prev);
                if (next.has(n)) next.delete(n);
                else next.add(n);
                return next;
              })
            }
            keepOriginal={keepOriginal.has(n)}
            onToggleKeep={() =>
              setKeepOriginal((prev) => {
                const next = new Set(prev);
                if (next.has(n)) next.delete(n);
                else next.add(n);
                return next;
              })
            }
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="rounded-md px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ← Back
        </button>
        <button
          onClick={accept}
          disabled={kept.length === 0}
          className="rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {kept.length === 0
            ? 'No slides selected'
            : `Use these ${kept.length} slide${kept.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

/**
 * The same message, said once with a count.
 *
 * A slide with four text boxes that each dropped off the size ladder produces
 * four identical lines, and four identical lines read as four problems. One
 * line and a ×4 is the same information at a quarter of the height.
 */
function tally(ds: Diagnostic[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const d of ds) counts.set(d.message, (counts.get(d.message) ?? 0) + 1);
  return [...counts];
}

function SlideRow({
  number,
  source,
  sourceSlideSize,
  converted,
  ds,
  info,
  diagnostics,
  untouched,
  included,
  onToggleInclude,
  keepOriginal,
  onToggleKeep,
}: {
  number: number;
  source: Slide | undefined;
  sourceSlideSize: { w: EMU; h: EMU };
  converted: Slide;
  ds: Parameters<typeof SlideView>[0]['designSystem'];
  info: ConversionReport['slides'][number] | undefined;
  diagnostics: Diagnostic[];
  /** Conversion had nothing to change here — a page image, not a slide. */
  untouched: boolean;
  /** Unchecked slides never reach the deck. */
  included: boolean;
  onToggleInclude: () => void;
  keepOriginal: boolean;
  onToggleKeep: () => void;
}) {
  const errors = tally(diagnostics.filter((d) => d.severity === 'error'));
  const warnings = tally(diagnostics.filter((d) => d.severity === 'warning'));
  const notes = tally(diagnostics.filter((d) => d.severity === 'info'));
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;

  return (
    <div className={included ? '' : 'opacity-45'}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <input
          type="checkbox"
          checked={included}
          onChange={onToggleInclude}
          aria-label={`Include slide ${number}`}
          title={included ? 'Leave this slide out of the deck' : 'Add this slide to the deck'}
          className="self-center"
        />
        <span className="text-xs font-semibold">Slide {number}</span>
        {info ? (
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">
            {info.archetype}
          </span>
        ) : null}
        {errorCount ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorCount} to fix
          </span>
        ) : untouched ? (
          // Not "clean" — nothing was examined, because there was nothing to
          // examine. Calling a no-op clean is how it reads as a success.
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            unchanged
          </span>
        ) : (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            converted
          </span>
        )}
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={keepOriginal}
            onChange={onToggleKeep}
            disabled={!included}
          />
          Keep this one as imported
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Pane label="Original" dim={!keepOriginal}>
          {source ? (
            <FitSlideView slide={source} slideSize={sourceSlideSize} designSystem={ds} />
          ) : null}
        </Pane>
        <Pane label="Converted" dim={keepOriginal}>
          <FitSlideView slide={converted} slideSize={SLIDE_16x9} designSystem={ds} />
        </Pane>
      </div>

      {errors.length || warnings.length || notes.length ? (
        <ul className="mt-1.5 space-y-0.5 text-[11px]">
          {errors.map(([message, n]) => (
            <li key={`e${message}`} className="text-red-700 dark:text-red-300">
              ✕ {message}
              {n > 1 ? ` (×${n})` : ''}
            </li>
          ))}
          {warnings.map(([message, n]) => (
            <li key={`w${message}`} className="text-amber-700 dark:text-amber-400">
              ! {message}
              {n > 1 ? ` (×${n})` : ''}
            </li>
          ))}
          {notes.map(([message, n]) => (
            <li key={`i${message}`} className="text-zinc-500 dark:text-zinc-400">
              · {message}
              {n > 1 ? ` (×${n})` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One preview pane. The unchosen side is dimmed rather than hidden, so the
 * comparison stays available while the choice stays legible.
 */
function Pane({
  label,
  dim,
  children,
}: {
  label: string;
  dim: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={dim ? 'opacity-40 transition-opacity' : 'transition-opacity'}>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="overflow-hidden rounded border border-zinc-200 dark:border-zinc-700">
        {children}
      </div>
    </div>
  );
}
