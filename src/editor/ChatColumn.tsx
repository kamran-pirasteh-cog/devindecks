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

export function ChatColumn() {
  const [open, setOpen] = useState(false);
  const { width, startDrag } = useResizableWidth(300, 240, 480, 'right');

  if (!open) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-zinc-200 bg-white py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
        <button
          onClick={() => setOpen(true)}
          title="Open Devin"
          className="flex h-6 w-6 items-center justify-center rounded-full hover:opacity-80"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/devin-logo.svg" alt="" className="h-6 w-6 dark:invert" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full shrink-0">
      <div
        style={{ width }}
        className="flex h-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <div className="flex h-6 w-6 items-center justify-center rounded-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/devin-logo.svg" alt="" className="h-6 w-6 dark:invert" />
          </div>
          <span className="text-sm font-medium">Devin</span>
          <div className="flex-1" />
          <button
            onClick={() => setOpen(false)}
            title="Collapse"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            «
          </button>
        </div>

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
      <ResizeHandle onPointerDown={startDrag} />
    </div>
  );
}
