'use client';

/**
 * Deleted items — the dashboard's recycle bin. Deleting a document only sets
 * `deletedAt`, so everything here is intact and restorable; this view is the
 * only place a document can be destroyed for good.
 */
import { useState } from 'react';
import type { Deck } from '@/model';
import { purgeAllDeleted, purgeDoc, restoreDoc } from '@/docs/repository';
import { Thumb } from './Thumb';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from '@/ui/Toast';

function deletedAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function DeletedItems({ docs, onChange }: { docs: Deck[]; onChange: () => void }) {
  const toast = useToast();
  // Which permanent deletion is awaiting confirmation: one document, or all.
  const [purging, setPurging] = useState<Deck | null>(null);
  const [purgingAll, setPurgingAll] = useState(false);

  if (!docs.length) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
        Nothing deleted. Documents you delete land here, and can be restored.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-zinc-400">
          {docs.length} deleted document{docs.length === 1 ? '' : 's'} · restore any of them, or
          delete for good.
        </p>
        <button
          onClick={() => setPurgingAll(true)}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Empty Deleted items
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {docs.map((deck) => (
          <div
            key={deck.id}
            className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            {/* Deliberately not clickable: a deleted document is restored
                first, not opened from the bin. */}
            <div className="overflow-hidden rounded-t-lg border-b border-zinc-100 opacity-60 dark:border-zinc-800 [&>div]:!w-full">
              <Thumb deck={deck} />
            </div>
            <div className="px-3 py-2">
              <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                {deck.title}
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-400">
                {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'} · Deleted{' '}
                {deletedAgo(deck.deletedAt!)}
              </div>
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => {
                    restoreDoc(deck.id);
                    onChange();
                    // The restored document leaves the bin for the shelf behind
                    // it, so the bin alone can't confirm where it went.
                    toast(`“${deck.title}” restored to All documents.`);
                  }}
                  className="rounded border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Restore
                </button>
                <button
                  onClick={() => setPurging(deck)}
                  className="rounded px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Delete forever
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {purging ? (
        <ConfirmDialog
          title="Delete forever?"
          message={`“${purging.title}” will be destroyed permanently. This can't be undone.`}
          confirmLabel="Delete forever"
          onConfirm={() => {
            purgeDoc(purging.id);
            setPurging(null);
            onChange();
            toast(`“${purging.title}” deleted for good.`, { tone: 'danger' });
          }}
          onCancel={() => setPurging(null)}
        />
      ) : null}

      {purgingAll ? (
        <ConfirmDialog
          title={`Empty Deleted items?`}
          message={`All ${docs.length} deleted document${
            docs.length === 1 ? '' : 's'
          } will be destroyed permanently. This can't be undone.`}
          confirmLabel="Empty"
          onConfirm={() => {
            const n = docs.length;
            purgeAllDeleted();
            setPurgingAll(false);
            onChange();
            toast(`${n} document${n === 1 ? '' : 's'} deleted for good.`, { tone: 'danger' });
          }}
          onCancel={() => setPurgingAll(false)}
        />
      ) : null}
    </div>
  );
}
