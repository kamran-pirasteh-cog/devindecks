'use client';

/**
 * Callout inserter — corners, box colour, and which text slots the card carries.
 * The preview is the card itself at card proportions, so the choice is made by
 * looking at it rather than by reading three lists of options.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveColor } from '@/model';
import { useEditor } from '@/store/editorStore';
import {
  CALLOUT_PARTS,
  CALLOUT_PART_LABEL,
  DEFAULT_CALLOUT_OPTIONS,
  isLightFill,
  makeCallout,
  type CalloutOptions,
  type CalloutPart,
} from './callout';
import { OVERLAY_Z } from './layers';

export function CalloutPopover({
  onClose,
  anchorRef,
}: {
  onClose: () => void;
  /** The trigger's wrapper — clicks inside it must not count as "outside", or
   *  the close-then-toggle race would leave the popover stuck open. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const addElements = useEditor((s) => s.addElements);
  const ds = useEditor((s) => s.designSystem);
  const [opts, setOpts] = useState<CalloutOptions>(DEFAULT_CALLOUT_OPTIONS);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  const fillHex = useMemo(
    () => resolveColor({ kind: 'token', token: opts.fillToken }, ds),
    [opts.fillToken, ds],
  );
  const onLight = isLightFill(fillHex);
  const strong = onLight ? '#0A0A0A' : '#FFFFFF';
  const muted = onLight ? resolveColor({ kind: 'token', token: 'ink.muted' }, ds) : '#FFFFFF';

  const togglePart = (p: CalloutPart) =>
    setOpts((o) => ({
      ...o,
      parts: o.parts.includes(p) ? o.parts.filter((x) => x !== p) : [...o.parts, p],
    }));

  const shown = CALLOUT_PARTS.filter((p) => opts.parts.includes(p));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Insert callout"
      style={{ zIndex: OVERLAY_Z }}
      className="absolute top-full left-0 mt-1.5 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-3">
        <div
          aria-hidden
          className="flex h-24 flex-col justify-center overflow-hidden px-3"
          style={{
            background: fillHex,
            borderRadius: opts.corners === 'round' ? 10 : 0,
          }}
        >
          {shown.length === 0 ? (
            <span className="text-[10px]" style={{ color: muted }}>
              Empty card
            </span>
          ) : null}
          {shown.map((p) => (
            <span
              key={p}
              className={
                p === 'number'
                  ? 'text-2xl leading-tight font-semibold'
                  : p === 'title'
                    ? 'text-sm leading-snug font-semibold'
                    : p === 'eyebrow'
                      ? 'text-[9px] leading-tight tracking-wider'
                      : 'text-[10px] leading-snug'
              }
              style={{ color: p === 'number' || p === 'title' ? strong : muted }}
            >
              {p === 'number'
                ? '10×'
                : p === 'title'
                  ? 'Title'
                  : p === 'eyebrow'
                    ? 'EYEBROW'
                    : 'Supporting line.'}
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Corners
          </span>
          <div className="flex items-center gap-1">
            {(['round', 'square'] as const).map((c) => {
              const active = opts.corners === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setOpts((o) => ({ ...o, corners: c }))}
                  aria-pressed={active}
                  className={`flex h-7 flex-1 items-center justify-center rounded-md border px-2 text-xs capitalize ${
                    active
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Color
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {ds.colors.map((c) => {
              const active = opts.fillToken === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpts((o) => ({ ...o, fillToken: c.id }))}
                  aria-pressed={active}
                  title={c.name}
                  aria-label={c.name}
                  className={`h-6 w-6 rounded-full border ${
                    active
                      ? 'ring-2 ring-zinc-900 ring-offset-1 dark:ring-zinc-100 dark:ring-offset-zinc-900'
                      : ''
                  } border-zinc-300 dark:border-zinc-600`}
                  style={{ background: c.hex }}
                />
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Text
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {CALLOUT_PARTS.map((p) => {
              const active = opts.parts.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePart(p)}
                  aria-pressed={active}
                  className={`flex h-7 items-center rounded-md border px-2 text-xs ${
                    active
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  {CALLOUT_PART_LABEL[p]}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            addElements(makeCallout(ds, opts));
            onClose();
          }}
          className="flex h-8 items-center justify-center rounded-md bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Insert callout
        </button>
      </div>
    </div>
  );
}
