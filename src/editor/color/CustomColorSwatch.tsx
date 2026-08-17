'use client';

/**
 * The swatch that sits at the end of every palette and opens the custom-colour
 * panel. One component, used by every colour surface in the editor, so "custom"
 * and the eyedropper look and behave the same in the format bar, the inspector,
 * the insert popovers and the chart panels.
 *
 * The panel stays INSIDE this component's own subtree rather than portalling.
 * That's deliberate: the popovers this lives in dismiss on an outside mousedown
 * (`ref.current.contains(target)`), and a portalled panel is by definition
 * outside — opening it would close the popover that hosts it. Staying in the
 * tree, plus swallowing pointer/mouse-down here, keeps both the host popover and
 * the canvas below from reacting to a colour drag.
 *
 * It is positioned FIXED, at coordinates measured off the trigger, for the same
 * in-tree reason: the palettes it hangs off sit inside scrollers and dialogs that
 * clip (`overflow-x-auto` on the chart part strip, `overflow-hidden` on the chart
 * dialog), and an absolutely-positioned panel is clipped away to nothing there —
 * present in the DOM, invisible on screen. Fixed also lets it flip up or shift
 * inward instead of running off a screen edge.
 *
 * Colours picked here are `{ kind: 'hex' }` refs, which is what makes them a real
 * escape hatch: unlike a token, a hex does NOT re-flow when the brand palette
 * changes. That's the trade the user is making by leaving the palette, and the
 * reason the brand swatches stay first in every row.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { COLOR_PANEL_Z } from '../layers';
import { CustomColorPanel } from './CustomColorPanel';
import { isLight } from './colorSpace';

/** The panel's own footprint, including its padding — what placement measures against. */
const PANEL_W = 272;
const PANEL_H = 290;
/** Clearance from the trigger, and from the window's edges. */
const GAP = 6;
const MARGIN = 8;

/** The rainbow the closed swatch shows when nothing custom is chosen yet. */
const WHEEL =
  'conic-gradient(from 90deg, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)';

export function CustomColorSwatch({
  value,
  active,
  onPick,
  onDone,
  size = 'h-6 w-6',
  shape = 'rounded',
  align = 'left',
}: {
  /** The colour in force, if it's a custom one — seeds the panel and shows in the swatch. */
  value?: string;
  /** True when the current selection came from here, so the swatch reads as chosen. */
  active?: boolean;
  onPick: (hex: string) => void;
  /** Host popovers that close on pick pass their close here. */
  onDone?: () => void;
  /** Tailwind sizing, to match whatever palette it's appended to. */
  size?: string;
  shape?: 'rounded' | 'rounded-full';
  /** Which edge the panel hangs from — right for bars pinned to the slide's edge. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  /** Where the panel goes, measured off the trigger against the window. */
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const wanted = align === 'right' ? r.right - PANEL_W : r.left;
    const left = Math.min(
      Math.max(MARGIN, wanted),
      Math.max(MARGIN, window.innerWidth - PANEL_W - MARGIN),
    );
    // Below by default; above when there's no room, which is the case for the
    // format bar's own palette when the window is short.
    const below = r.bottom + GAP;
    const top =
      below + PANEL_H <= window.innerHeight - MARGIN
        ? below
        : Math.max(MARGIN, r.top - PANEL_H - GAP);
    setPos({ left, top });
  }, [align]);

  // Measured on the click that opens it, not in an effect, so the panel's first
  // paint is already in the right place. Re-measured while it's open because the
  // surfaces it hangs off scroll and resize under it.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    // Capture: the scroller that moves it is an inner one, not the window.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture, and swallowed: Escape should close the panel and stop there,
    // rather than also closing the popover that hosts it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const ring = active
    ? 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-zinc-900'
    : 'ring-1 ring-black/15 dark:ring-zinc-600';

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      // See the module comment — the host popover and the canvas must not see
      // clicks aimed at the panel. Both event names, because the popovers listen
      // for `mousedown` while the drag surfaces speak `pointerdown`.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            setPos(null);
            return;
          }
          place();
          setOpen(true);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Custom color"
        aria-label="Custom color"
        className={`${size} ${shape} ${ring} grid place-items-center`}
        style={value ? { background: value } : { background: WHEEL }}
      >
        {/* A plus only while the swatch is still showing the wheel: once it
            holds a real colour, a glyph on top would misread as a pattern. */}
        {value ? (
          active ? (
            <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
              <path
                d="M1.5 5.2 3.9 7.6 8.5 2.6"
                fill="none"
                stroke={isLight(value) ? '#18181B' : '#FFFFFF'}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null
        ) : (
          <span className="text-[10px] font-bold leading-none text-white [text-shadow:0_0_2px_rgba(0,0,0,.6)]">
            +
          </span>
        )}
      </button>

      {open && pos ? (
        <div
          role="dialog"
          aria-label="Custom color"
          style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: COLOR_PANEL_Z }}
          className="rounded-lg border border-zinc-200 bg-white p-2.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          <CustomColorPanel
            value={value}
            onChange={onPick}
            onCommit={(hex) => {
              onPick(hex);
              setOpen(false);
              onDone?.();
            }}
          />
        </div>
      ) : null}
    </span>
  );
}
