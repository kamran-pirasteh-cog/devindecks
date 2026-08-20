'use client';

/**
 * Side-band inserter — edge, fraction of the page, and what sits in the panel.
 *
 * The preview is the slide itself at 16:9 with the band drawn in, so the choice
 * is made by looking at the arrangement rather than by reading three lists.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { hex as hexRef, resolveColor, token } from '@/model';
import { useEditor } from '@/store/editorStore';
import {
  BAND_CONTENTS,
  BAND_CONTENT_LABEL,
  BAND_FRACTIONS,
  DEFAULT_BAND_OPTIONS,
  fractionValue,
  makeBand,
  type BandOptions,
  type BandSide,
} from './band';
import { isLightFill } from './callout';
import { CustomColorSwatch, customHexOf } from './color';
import { OVERLAY_Z } from './layers';

/** The segmented row every control in this popover is built from. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onPick: (id: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              aria-pressed={active}
              className={`flex h-7 flex-1 items-center justify-center rounded-md border px-2 text-xs ${
                active
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BandPopover({
  onClose,
  anchorRef,
}: {
  onClose: () => void;
  /** The trigger's wrapper — a click inside it must not count as "outside", or
   *  the close-then-toggle race leaves the popover stuck open. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const addElements = useEditor((s) => s.addElements);
  const ds = useEditor((s) => s.designSystem);
  const slideSize = useEditor((s) => s.deck.slideSize);
  const [opts, setOpts] = useState<BandOptions>(DEFAULT_BAND_OPTIONS);
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

  const fillHex = useMemo(() => resolveColor(opts.fill, ds), [opts.fill, ds]);
  const onLight = isLightFill(fillHex);
  const strong = onLight ? '#0A0A0A' : '#FFFFFF';
  const pct = `${fractionValue(opts.fraction) * 100}%`;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Insert side band"
      style={{ zIndex: OVERLAY_Z }}
      className="absolute top-full left-0 mt-1.5 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-3">
        {/* The slide, at slide proportions — band on its edge, content inside. */}
        <div
          aria-hidden
          className="relative aspect-[16/9] w-full overflow-hidden rounded-[3px] border border-zinc-200 bg-white dark:border-zinc-700"
        >
          <div
            className="absolute top-0 bottom-0 flex flex-col gap-[3px] p-1.5"
            style={{
              background: fillHex,
              width: pct,
              left: opts.side === 'left' ? 0 : undefined,
              right: opts.side === 'right' ? 0 : undefined,
            }}
          >
            {opts.content === 'title-subtitle' ? (
              <>
                <span className="text-[9px] leading-tight font-bold" style={{ color: strong }}>
                  Title
                </span>
                <span
                  className="font-serif text-[7px] leading-tight italic"
                  style={{ color: strong, opacity: 0.75 }}
                >
                  Subtitle line
                </span>
              </>
            ) : null}
            {opts.content === 'cards' ? (
              <>
                <span
                  className="text-[6px] leading-none tracking-widest"
                  style={{ color: strong, opacity: 0.7 }}
                >
                  LABEL
                </span>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-[2px]"
                    style={{ background: strong, opacity: 0.15 }}
                  />
                ))}
              </>
            ) : null}
          </div>
        </div>

        <Segmented<BandSide>
          label="Side"
          value={opts.side}
          options={[
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ]}
          onPick={(side) => setOpts((o) => ({ ...o, side }))}
        />

        <Segmented
          label="Width"
          value={opts.fraction}
          options={BAND_FRACTIONS.map((f) => ({ id: f.id, label: f.label }))}
          onPick={(fraction) => setOpts((o) => ({ ...o, fraction }))}
        />

        <Segmented
          label="Contents"
          value={opts.content}
          options={BAND_CONTENTS.map((c) => ({ id: c, label: BAND_CONTENT_LABEL[c] }))}
          onPick={(content) => setOpts((o) => ({ ...o, content }))}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Color
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {ds.colors.map((c) => {
              const active = opts.fill.kind === 'token' && opts.fill.token === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpts((o) => ({ ...o, fill: token(c.id) }))}
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
            <CustomColorSwatch
              value={customHexOf(opts.fill)}
              active={opts.fill.kind === 'hex'}
              onPick={(h) => setOpts((o) => ({ ...o, fill: hexRef(h) }))}
              shape="rounded-full"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            addElements(makeBand(ds, slideSize, opts));
            onClose();
          }}
          className="flex h-8 items-center justify-center rounded-md bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Insert band
        </button>
      </div>
    </div>
  );
}
