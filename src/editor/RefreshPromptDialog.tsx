'use client';

/**
 * The fallback for the toolbar's Refresh button.
 *
 * `navigator.clipboard` simply doesn't exist on a non-secure origin, and a
 * permission can be refused — so when the copy fails the brief is shown instead
 * of silently dead-ending. The text is pre-selected, which makes the manual path
 * one ⌘C.
 */
import { useMemo, useState } from 'react';
import { useEditor } from '@/store/editorStore';
import { buildDeckRefreshPrompt } from '@/devin/refresh';
import { MODAL_Z } from './layers';

export function RefreshPromptDialog({ onClose }: { onClose: () => void }) {
  const deck = useEditor((s) => s.deck);
  const prompt = useMemo(() => buildDeckRefreshPrompt(deck), [deck]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Already showing the text — nothing left to fall back to.
    }
  };

  return (
    <div
      style={{ zIndex: MODAL_Z }}
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">
            Refresh prompt — {prompt.numberCount} number
            {prompt.numberCount === 1 ? '' : 's'} across {prompt.pages.length} page
            {prompt.pages.length === 1 ? '' : 's'}
          </h2>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <textarea
            readOnly
            value={prompt.text}
            ref={(el) => el?.select()}
            className="h-[60vh] w-full resize-none bg-transparent p-4 font-mono text-[11px] leading-relaxed outline-none"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
          <button
            onClick={copy}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
