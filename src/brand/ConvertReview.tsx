'use client';

/**
 * Before and after, slide by slide — the trust surface.
 *
 * The engine can convert a sixty-slide deck in a second, and that speed is
 * exactly why this screen has to exist. Nobody puts a machine-restyled deck in
 * front of an executive on faith. What makes it usable is not a promise that
 * everything worked, it's a short honest list of the places it didn't.
 *
 * So three things, in order of importance:
 *
 *  1. FLAGGED SLIDES FIRST. The whole value of the linter is that it turns "check
 *     all sixty slides" into "look at these three". Sorting them to the front is
 *     what delivers that.
 *  2. SOURCE BESIDE RESULT, both rendered through the real `<SlideView>` — the
 *     same trick `ImportSlidesDialog` uses. A preview drawn by anything other
 *     than the actual renderer is a preview of something that doesn't exist.
 *  3. WHAT CHANGED, in words. "Arial → Geist, 14 sizes → 6, 9 colours → 5
 *     tokens, 12 source logos removed" is checkable; "converted successfully" is
 *     not.
 *
 * Per-slide, the reviewer can keep the ORIGINAL instead. That escape hatch
 * matters more than it looks: without it, one slide the engine mangles means
 * abandoning the conversion for the whole deck.
 */
import { useMemo, useState } from 'react';
import { SlideView } from '@/render/SlideView';
import { getActiveDesignSystem } from '@/design/repository';
import { SLIDE_16x9, type EMU, type Slide } from '@/model';
import type { Diagnostic } from '@/model/ingest';
import type { ConversionReport } from './convert';

const THUMB_WIDTH = 300;

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
  const [onlyFlagged, setOnlyFlagged] = useState(report.flagged.length > 0);

  const bySlide = useMemo(() => {
    const map = new Map<number, Diagnostic[]>();
    for (const d of diagnostics) {
      map.set(d.slide, [...(map.get(d.slide) ?? []), d]);
    }
    return map;
  }, [diagnostics]);

  /** Flagged first, then source order. */
  const order = useMemo(() => {
    const flagged = new Set(report.flagged);
    return slides
      .map((_, i) => i + 1)
      .sort((a, b) => {
        const fa = flagged.has(a) ? 0 : 1;
        const fb = flagged.has(b) ? 0 : 1;
        return fa - fb || a - b;
      });
  }, [slides, report.flagged]);

  const shown = onlyFlagged ? order.filter((n) => report.flagged.includes(n)) : order;

  const accept = () => {
    onAccept(
      slides.map((slide, i) => (keepOriginal.has(i + 1) ? (sourceSlides[i] ?? slide) : slide)),
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

      <Summary report={report} />

      <div className="mt-4 flex items-center gap-3 border-y border-zinc-200 py-2 text-xs dark:border-zinc-800">
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
        {keepOriginal.size ? (
          <span className="text-zinc-500">
            {keepOriginal.size} slide{keepOriginal.size === 1 ? '' : 's'} kept as imported
          </span>
        ) : null}
      </div>

      <div className="mt-4 max-h-[46vh] space-y-5 overflow-y-auto pr-1">
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
          className="rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
        >
          Use these {slides.length} slide{slides.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

/** What changed, deck-wide, in checkable numbers. */
function Summary({ report }: { report: ConversionReport }) {
  const chrome = Object.entries(report.removedChrome);
  const items: string[] = [];
  if (report.sourceFonts.length) {
    items.push(`${report.sourceFonts.join(', ')} → ${report.brandFonts.join(', ')}`);
  }
  // Only worth stating when there was something to state. "0 text sizes → 0"
  // reads as a report on work done rather than as the absence of any.
  if (report.sizesBefore > 0) {
    items.push(`${report.sizesBefore} text sizes → ${report.sizesAfter}`);
  }
  if (report.colorsBefore > 0) {
    items.push(`${report.colorsBefore} colours → ${report.tokensAfter} brand tokens`);
  }
  if (report.panelsSplit) {
    items.push(`${report.panelsSplit} filled shape${report.panelsSplit === 1 ? '' : 's'} split from their text`);
  }
  for (const [role, count] of chrome) {
    const label = role.replace('chrome.', '').replace('pageNumber', 'page number');
    items.push(`${count} source ${label}${count === 1 ? '' : 's'} removed`);
  }
  if (report.unconvertible.length < report.slideCount) {
    items.push('page numbers now brand-driven');
  }

  // Nothing to report at all: the caller shows its own banner for this, and an
  // empty "What changed" box under it would just be noise.
  if (!items.length) return null;

  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/50">
      <h3 className="text-xs font-semibold">What changed</h3>
      <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[11px] text-zinc-600 sm:grid-cols-2 dark:text-zinc-300">
        {items.map((item) => (
          <li key={item}>· {item}</li>
        ))}
      </ul>
      {report.coherenceAdjustments.length ? (
        <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-300">
          {report.coherenceAdjustments
            .map(
              (a) =>
                `Most ${a.role} text needed to be smaller, so all of it was set to ${a.toPt}pt (from ${a.fromPt}pt).`,
            )
            .join(' ')}
        </p>
      ) : null}
      {report.weakColors.length ? (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          Unsure about {report.weakColors.length} colour
          {report.weakColors.length === 1 ? '' : 's'}:{' '}
          {report.weakColors.map((w) => `${w.hex} → ${w.tokenId}`).join(', ')}
        </p>
      ) : null}
    </div>
  );
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
  keepOriginal: boolean;
  onToggleKeep: () => void;
}) {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const notes = diagnostics.filter((d) => d.severity === 'info');

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-semibold">Slide {number}</span>
        {info ? (
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">
            {info.archetype}
          </span>
        ) : null}
        {errors.length ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            {errors.length} to fix
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
          <input type="checkbox" checked={keepOriginal} onChange={onToggleKeep} />
          Keep this one as imported
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Pane label="Original" dim={!keepOriginal}>
          {source ? (
            <SlideView
              slide={source}
              slideSize={sourceSlideSize}
              designSystem={ds}
              width={THUMB_WIDTH}
            />
          ) : null}
        </Pane>
        <Pane label="Converted" dim={keepOriginal}>
          <SlideView
            slide={converted}
            slideSize={SLIDE_16x9}
            designSystem={ds}
            width={THUMB_WIDTH}
          />
        </Pane>
      </div>

      {errors.length || warnings.length || notes.length ? (
        <ul className="mt-1.5 space-y-0.5 text-[11px]">
          {errors.map((d, i) => (
            <li key={`e${i}`} className="text-red-700 dark:text-red-300">
              ✕ {d.message}
            </li>
          ))}
          {warnings.map((d, i) => (
            <li key={`w${i}`} className="text-amber-700 dark:text-amber-400">
              ! {d.message}
            </li>
          ))}
          {notes.map((d, i) => (
            <li key={`i${i}`} className="text-zinc-500 dark:text-zinc-400">
              · {d.message}
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
      <div className="overflow-hidden rounded border border-zinc-200 dark:border-zinc-700 [&>div]:!w-full">
        {children}
      </div>
    </div>
  );
}
