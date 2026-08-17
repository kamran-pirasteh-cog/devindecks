'use client';

/**
 * The custom-colour panel: an SV plane, a hue strip, an eyedropper, and
 * hex/R/G/B fields — the escape hatch from the brand palette.
 *
 * HSV is the state of record, NOT the hex. Drag the plane's thumb down to black
 * and the hue is gone from the resulting colour; keeping it here means dragging
 * back up returns the hue you were on rather than red. Same for a fully
 * desaturated colour. The hex only ever flows OUT (via `onChange`) and in once,
 * when the panel is seeded.
 *
 * Every gesture reports continuously, so the slide recolours under the cursor as
 * you drag. Callers should therefore treat `onChange` as cheap and coalescing —
 * the store actions here are idempotent patches, not appends.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampByte,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  isLight,
  normalizeHex,
  rgbToHex,
  rgbToHsv,
  type Hsv,
} from './colorSpace';

/**
 * Chrome's native picker, which reads a pixel from anywhere on screen —
 * including outside the browser. There is no polyfill worth shipping: reading
 * arbitrary screen pixels is a privilege only the browser has, and a
 * canvas-based fake would only see the parts of our own DOM that html2canvas
 * happens to render correctly. So it's the real API or nothing, and the button
 * hides itself where the API is missing.
 */
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperCtor {
  new (): { open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult> };
}

function eyeDropperCtor(): EyeDropperCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { EyeDropper?: EyeDropperCtor }).EyeDropper;
}

const AREA_H = 148;
const HUE_H = 14;

const FIELD =
  'w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-center text-[11px] tabular-nums text-zinc-700 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

const LABEL = 'mb-0.5 block text-[10px] font-semibold text-zinc-500 dark:text-zinc-400';

/** Where a pointer landed inside an element, as a 0-1 fraction on both axes. */
function fractionIn(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  return {
    x: r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0,
    y: r.height ? Math.min(1, Math.max(0, (clientY - r.top) / r.height)) : 0,
  };
}

/**
 * A press-and-drag surface: report where the press landed, then keep reporting
 * until the button comes up, wherever the pointer goes. Tracking has to survive
 * leaving the element — on a 148px-tall box you drag past the edge constantly —
 * so the move/up pair is bound to the WINDOW for the length of the gesture.
 *
 * Deliberately NOT `setPointerCapture`, which is the usual way to do this and
 * which broke badly here: Chrome then dispatches a second, fully trusted `click`
 * for the same press, retargeted to an unrelated element. In a palette row that
 * landed on the first brand swatch, so every colour picked in the panel was
 * immediately overwritten by that swatch's token — the picked colour appeared to
 * apply and then silently revert to black.
 */
function useDragSurface(onMove: (f: { x: number; y: number }) => void) {
  // The gesture's listeners close over one render's `onMove`, so the newest one
  // goes through a ref — otherwise a long drag keeps reporting through a stale
  // closure and fights whatever else has moved on since.
  const latest = useRef(onMove);
  useEffect(() => {
    latest.current = onMove;
  }, [onMove]);

  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      // Left button only, and never let the canvas below see this as a click on
      // the slide — the panel floats over a selected element.
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      const report = (clientX: number, clientY: number) =>
        latest.current(fractionIn(el, clientX, clientY));
      report(e.clientX, e.clientY);

      const move = (ev: PointerEvent) => report(ev.clientX, ev.clientY);
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    },
  };
}

export function CustomColorPanel({
  value,
  onChange,
  onCommit,
}: {
  /** Seed colour — read once per mount, then the panel owns the state. */
  value: string | undefined;
  onChange: (hex: string) => void;
  /** Called when a gesture or field edit finishes; closes the panel, usually. */
  onCommit?: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value ?? '#000000'));
  // The hex field needs its own draft: normalising on every keystroke would
  // rewrite "#26" to nothing and make the field impossible to type in.
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  const hex = hsvToHex(hsv);
  const rgb = hsvToRgb(hsv);
  const EyeDropper = eyeDropperCtor();

  const emit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      setHexDraft(null);
      onChange(hsvToHex(next));
    },
    [onChange],
  );

  /** Adopt a colour that arrived as hex — the field, or the eyedropper. */
  const adopt = useCallback(
    (incoming: string, commit = false) => {
      const normalized = normalizeHex(incoming);
      if (!normalized) return;
      const parsed = rgbToHsv(hexToRgb(normalized));
      // A grey reports hue 0; keep the hue the user was on so the strip's thumb
      // doesn't snap to red every time they type a grey.
      const next: Hsv = { ...parsed, h: parsed.s === 0 ? hsv.h : parsed.h };
      setHsv(next);
      setHexDraft(null);
      onChange(normalized);
      if (commit) onCommit?.(normalized);
    },
    [hsv.h, onChange, onCommit],
  );

  const setChannel = (key: 'r' | 'g' | 'b', raw: string) => {
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    adopt(rgbToHex({ ...rgb, [key]: clampByte(n) }));
  };

  const area = useDragSurface(({ x, y }) => emit({ ...hsv, s: x, v: 1 - y }));
  const strip = useDragSurface(({ x }) => emit({ ...hsv, h: x * 360 }));

  /**
   * Arrow keys on either surface, so the picker isn't a mouse-only control.
   * Shift takes the coarse step — 10× on the plane, 10° on the strip.
   */
  const areaKeys = (e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      emit({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + step)) });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      emit({ ...hsv, v: Math.min(1, Math.max(0, hsv.v + step)) });
    }
  };

  const stripKeys = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
    emit({ ...hsv, h: (((hsv.h + step) % 360) + 360) % 360 });
  };

  const pickWithDropper = async () => {
    if (!EyeDropper) return;
    try {
      const { sRGBHex } = await new EyeDropper().open();
      adopt(sRGBHex, true);
    } catch {
      // Escape during a pick rejects, and that's the common case — a cancel, not
      // a failure. Nothing to report either way: the colour simply didn't change.
    }
  };

  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const thumbRing = isLight(hex) ? 'border-black/40' : 'border-white';

  return (
    <div
      className="flex w-[248px] flex-col gap-2.5"
      // The panel lives inside popovers that dismiss on outside mousedown and
      // over a canvas that starts marquees; neither should see these events.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* --- the SV plane. White→hue left to right, transparent→black top to
              bottom, so every colour of this hue is somewhere in the box. --- */}
      <div
        {...area}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        // Two axes, one slider role: saturation carries the numeric value (left
        // and right, the axis a screen reader announces steps on) and the text
        // says both, so the vertical arrows aren't silent.
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
        onKeyDown={areaKeys}
        className="relative w-full cursor-crosshair touch-none rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 dark:focus:ring-offset-zinc-900"
        style={{
          height: AREA_H,
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hueHex})`,
        }}
      >
        <span
          className={`pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow ${thumbRing}`}
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
        />
      </div>

      {/* --- preview, eyedropper, hue --- */}
      <div className="flex items-center gap-2">
        <span
          className="size-9 shrink-0 rounded-full border border-black/10 dark:border-white/15"
          style={{ background: hex }}
          title={hex}
          aria-hidden
        />
        {EyeDropper ? (
          <button
            type="button"
            onClick={pickWithDropper}
            title="Pick a colour from anywhere on screen"
            aria-label="Pick a colour from the screen"
            className="grid size-9 shrink-0 place-items-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <DropperIcon />
          </button>
        ) : null}
        <div
          {...strip}
          role="slider"
          tabIndex={0}
          aria-label="Hue"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          onKeyDown={stripKeys}
          className="relative min-w-0 flex-1 cursor-pointer touch-none rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 dark:focus:ring-offset-zinc-900"
          style={{
            height: HUE_H,
            background:
              'linear-gradient(to right, #F00 0%, #FF0 17%, #0F0 33%, #0FF 50%, #00F 67%, #F0F 83%, #F00 100%)',
          }}
        >
          <span
            className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${(hsv.h / 360) * 100}%`, background: hueHex }}
          />
        </div>
      </div>

      {/* --- hex and channels. Hex commits on blur or Enter; the channels are
              live, since a number field can't hold an invalid value long. --- */}
      <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-1.5">
        <label>
          <span className={LABEL}>Hex</span>
          <input
            value={hexDraft ?? hex}
            onChange={(e) => {
              setHexDraft(e.target.value);
              // Commit as soon as it parses, so a pasted hex lands without
              // needing Enter — but keep the draft on screen either way.
              const normalized = normalizeHex(e.target.value);
              if (normalized) {
                const parsed = rgbToHsv(hexToRgb(normalized));
                setHsv({ ...parsed, h: parsed.s === 0 ? hsv.h : parsed.h });
                onChange(normalized);
              }
            }}
            onBlur={() => setHexDraft(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                adopt(hexDraft ?? hex, true);
              }
            }}
            spellCheck={false}
            aria-label="Hex"
            className={`${FIELD} font-mono uppercase`}
          />
        </label>
        {(['r', 'g', 'b'] as const).map((k) => (
          <label key={k}>
            <span className={LABEL}>{k.toUpperCase()}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[k]}
              onChange={(e) => setChannel(k, e.target.value)}
              aria-label={k.toUpperCase()}
              className={FIELD}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** The dropper glyph from the mock: a slanted pen with a filled nib. */
function DropperIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10.6 1.9a1.8 1.8 0 0 1 2.5 2.5l-1 1 .9.9-1.3 1.3-.9-.9-4.6 4.6-2.6.9.9-2.6 4.6-4.6-.9-.9L9.7 3l.9.9 1-1Z"
        fill="currentColor"
      />
    </svg>
  );
}
