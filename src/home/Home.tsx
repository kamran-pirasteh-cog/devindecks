'use client';

/**
 * Homepage / dashboard: your documents, plus a "Start something new" button that
 * opens the picker (browse templates · start from a prior doc · blank).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type Deck } from '@/model';
import { deleteDoc, listDocs, seedIfFirstRun } from '@/docs/repository';
import { Thumb } from './Thumb';
import { NewDocModal } from './NewDocModal';

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function Home() {
  const router = useRouter();
  const [docs, setDocs] = useState<Deck[]>([]);
  const [modal, setModal] = useState(false);

  useEffect(() => {
    seedIfFirstRun();
    setDocs(listDocs());
  }, []);

  const remove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    deleteDoc(id);
    setDocs(listDocs());
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-black text-xs font-bold text-white dark:bg-white dark:text-black">
              D
            </div>
            <span className="text-sm font-semibold tracking-tight">Devin Design</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Admin
            </Link>
            <button
              onClick={() => setModal(true)}
              className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
            >
              + New
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              Your documents
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {docs.map((deck) => (
              <div
                key={deck.id}
                onClick={() => router.push(`/edit/${deck.id}`)}
                className="group relative cursor-pointer overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="overflow-hidden border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
                  <Thumb deck={deck} />
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                      {deck.title}
                    </div>
                    <div className="mt-0.5 text-[10px] text-zinc-400">
                      {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'} ·{' '}
                      {timeAgo(deck.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => remove(deck.id, e)}
                    title="Delete"
                    className="ml-2 hidden h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-red-500 group-hover:flex dark:hover:bg-zinc-800"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {modal ? <NewDocModal onClose={() => setModal(false)} /> : null}
    </div>
  );
}
