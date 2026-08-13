'use client';

/**
 * Devin chat column (placeholder). The split-screen shape is real now; the
 * wiring lands in Phase 4, where messages become tool-calls against the SAME
 * command layer the toolbar uses — so Devin can only do what the UI can do.
 *
 * Collapsed by default so the canvas gets full width until you ask for help.
 */
import { useState } from 'react';
import { useResizableWidth } from './useResizableWidth';
import { ResizeHandle } from './ResizeHandle';

const RAIL_WIDTH = 40;

export function ChatColumn() {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { width, startDrag } = useResizableWidth(300, 240, 480, 'right');

  // The logo is the toggle in both states, so it stays one DOM node across the
  // open/close switch — that's what lets it rotate rather than swap.
  const onDragStart = (e: React.PointerEvent) => {
    setDragging(true);
    startDrag(e);
    const stop = () => {
      setDragging(false);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointerup', stop);
  };

  return (
    <div className="flex h-full shrink-0">
      <div
        style={{ width: open ? width : RAIL_WIDTH }}
        className={`flex h-full flex-col overflow-hidden border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${
          dragging ? '' : 'transition-[width] duration-300 ease-out'
        }`}
      >
        <div
          className={`flex items-center px-2 py-2.5 ${
            open
              ? 'justify-between border-b border-zinc-200 dark:border-zinc-800'
              : 'justify-center'
          }`}
        >
          {open && <span className="pl-1 text-sm font-medium">Devin</span>}
          <button
            onClick={() => setOpen((v) => !v)}
            title={open ? 'Collapse' : 'Open Devin'}
            aria-expanded={open}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:opacity-80"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/devin-logo.svg"
              alt=""
              className={`h-6 w-6 transition-transform duration-300 ease-out dark:invert ${
                open ? 'rotate-180' : 'rotate-0'
              }`}
            />
          </button>
        </div>

        {/* Fixed to the open width so the body doesn't reflow mid-animation. */}
        <div
          style={{ width }}
          className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
            <div className="rounded-lg bg-zinc-100 p-3 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
              I&apos;ll help you build and edit slides — pull in a template, reformat
              to brand, or tweak anything on the canvas by asking.
              <div className="mt-2 text-[11px] text-zinc-400">(Chat comes online in Phase 4.)</div>
            </div>
          </div>

          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-400 dark:border-zinc-700">
              <input
                disabled
                placeholder="Ask Devin to make a change…"
                className="flex-1 bg-transparent outline-none placeholder:text-zinc-400"
              />
            </div>
          </div>
        </div>
      </div>
      {open && <ResizeHandle onPointerDown={onDragStart} />}
    </div>
  );
}
