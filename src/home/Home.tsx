'use client';

/**
 * Homepage / dashboard: your documents, plus a "New" button that opens the
 * picker (browse templates · start from a prior doc · blank).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { type Deck } from '@/model';
import { listAllTags, listDocs, seedIfFirstRun } from '@/docs/repository';
import { DocCard } from './DocCard';
import { NewDocModal } from './NewDocModal';

export function Home() {
  const [docs, setDocs] = useState<Deck[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  useEffect(() => {
    seedIfFirstRun();
    setDocs(listDocs());
    setAllTags(listAllTags());
  }, []);

  const refreshDocs = () => {
    setDocs(listDocs());
    setAllTags(listAllTags());
  };

  const toggleTag = (tag: string) =>
    setActiveTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));

  const filteredDocs = docs.filter((deck) => {
    const q = query.trim().toLowerCase();
    if (q) {
      const titleMatch = deck.title.toLowerCase().includes(q);
      const tagMatch = (deck.tags ?? []).some((t) => t.toLowerCase().includes(q));
      if (!titleMatch && !tagMatch) return false;
    }
    if (activeTags.length && !activeTags.every((t) => (deck.tags ?? []).includes(t))) return false;
    return true;
  });

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

          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents…"
              className="w-full max-w-xs rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {allTags.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                  Filter by client
                </span>
                {allTags.map((tag) => {
                  const active = activeTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                        active
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
                {activeTags.length ? (
                  <button
                    onClick={() => setActiveTags([])}
                    className="text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {filteredDocs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
              No documents match your search.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {filteredDocs.map((deck) => (
                <DocCard key={deck.id} deck={deck} onChange={refreshDocs} />
              ))}
            </div>
          )}
        </section>
      </main>

      {modal ? <NewDocModal onClose={() => setModal(false)} /> : null}
    </div>
  );
}
