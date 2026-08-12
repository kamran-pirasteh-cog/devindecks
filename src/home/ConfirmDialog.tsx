'use client';

/**
 * Modal confirmation for destructive actions. Deleting a document is
 * unrecoverable — there is no trash and no undo on the dashboard — so it has to
 * be deliberate.
 *
 * Escape cancels, Enter confirms, and the click target is stopped from
 * bubbling: these dialogs open from inside cards whose own click handler
 * navigates into the editor.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Portalled to <body>, and only after mount (there is no document to portal
  // into during SSR). `position: fixed` is NOT enough on its own: the cards
  // these dialogs open from lift on hover, and a transformed ancestor becomes
  // the containing block for fixed descendants — the dialog rendered inside
  // the card, clipped to it, with its backdrop covering only that card.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
      if (e.key === 'Enter') {
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
