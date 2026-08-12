'use client';

/**
 * Homepage / dashboard: your documents, plus a "New" button that opens the
 * picker (browse templates · start from a prior doc · blank).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { type Deck } from '@/model';
import {
  listAllOwners,
  listAllTags,
  listDeletedDocs,
  listDocs,
  seedIfFirstRun,
} from '@/docs/repository';
import { DocCard } from './DocCard';
import { NewDocModal } from './NewDocModal';
import { Reports } from './Reports';
import { DeletedItems } from './DeletedItems';

type Tab = 'documents' | 'reports';

const TABS: { value: Tab; label: string }[] = [
  { value: 'documents', label: 'Documents' },
  { value: 'reports', label: 'Reports' },
];

type SortBy = 'updated' | 'created' | 'client' | 'owner';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Date created' },
  { value: 'client', label: 'Client' },
  { value: 'owner', label: 'Owner' },
];

/** Sentinel for the "documents with no owner set" filter option. */
const NO_OWNER = '\u0000none';

function firstClient(deck: Deck): string {
  return (deck.tags ?? [])[0]?.toLowerCase() ?? '';
}

export function Home() {
  const [docs, setDocs] = useState<Deck[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [allOwners, setAllOwners] = useState<string[]>([]);
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [tab, setTab] = useState<Tab>('documents');
  // "Deleted items" swaps the grid for the recycle bin.
  const [showTrash, setShowTrash] = useState(false);
  const [deleted, setDeleted] = useState<Deck[]>([]);

  useEffect(() => {
    seedIfFirstRun();
    setDocs(listDocs());
    setAllTags(listAllTags());
    setAllOwners(listAllOwners());
    setDeleted(listDeletedDocs());
  }, []);

  const refreshDocs = () => {
    setDocs(listDocs());
    setAllTags(listAllTags());
    setAllOwners(listAllOwners());
    setDeleted(listDeletedDocs());
  };

  const hasUnowned = docs.some((d) => !d.owner);

  const toggleTag = (tag: string) =>
    setActiveTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));

  const filteredDocs = docs
    .filter((deck) => {
      const q = query.trim().toLowerCase();
      if (q) {
        const titleMatch = deck.title.toLowerCase().includes(q);
        const tagMatch = (deck.tags ?? []).some((t) => t.toLowerCase().includes(q));
        const ownerMatch = (deck.owner ?? '').toLowerCase().includes(q);
        if (!titleMatch && !tagMatch && !ownerMatch) return false;
      }
      if (activeTags.length && !activeTags.every((t) => (deck.tags ?? []).includes(t))) return false;
      if (ownerFilter === NO_OWNER) {
        if (deck.owner) return false;
      } else if (ownerFilter && deck.owner !== ownerFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'created') return b.createdAt.localeCompare(a.createdAt);
      if (sortBy === 'owner') {
        const oa = (a.owner ?? '').toLowerCase();
        const ob = (b.owner ?? '').toLowerCase();
        if (!oa && ob) return 1;
        if (oa && !ob) return -1;
        return oa.localeCompare(ob) || a.title.localeCompare(b.title);
      }
      if (sortBy === 'client') {
        const ca = firstClient(a);
        const cb = firstClient(b);
        if (!ca && cb) return 1;
        if (ca && !cb) return -1;
        return ca.localeCompare(cb) || a.title.localeCompare(b.title);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/devin-logo.svg"
              alt=""
              className="h-6 w-6 dark:invert"
            />
            <span className="text-sm font-semibold tracking-tight">Deckmaker</span>
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
        <div className="mb-4 flex items-end justify-between border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium ${
                  tab === t.value
                    ? 'border-indigo-500 text-zinc-900 dark:text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'reports' ? <Reports docs={docs} /> : null}

        {/* Hidden rather than unmounted, so a search/filter survives a trip
            through Reports and back. */}
        <section className={tab === 'documents' ? '' : 'hidden'}>
          {/* The tab strip above already says "Documents" — no second heading.
              The row's right edge lines up with the grid's, so the bulk-delete
              controls sit flush with the rightmost card. */}
          <div className="mb-3 flex items-center justify-end gap-3">
            {showTrash ? null : (
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              Sort by
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            )}

            <button
              onClick={() => setShowTrash((v) => !v)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                showTrash
                  ? 'border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {showTrash
                ? '← Back to documents'
                : `Deleted items${deleted.length ? ` (${deleted.length})` : ''}`}
            </button>
          </div>

          {showTrash ? (
            <DeletedItems docs={deleted} onChange={refreshDocs} />
          ) : (
            <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full max-w-lg items-center gap-2">
            <div className="relative w-full max-w-xs">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents…"
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 pr-7 text-xs outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
              />
              {query ? (
                <button
                  onClick={() => setQuery('')}
                  title="Clear search"
                  className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  ×
                </button>
              ) : null}
            </div>
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
                Owner
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  <option value="">All owners</option>
                  {allOwners.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  {hasUnowned ? <option value={NO_OWNER}>Unassigned</option> : null}
                </select>
              </label>
            </div>
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
            </>
          )}
        </section>
      </main>

      {modal ? <NewDocModal onClose={() => setModal(false)} /> : null}

    </div>
  );
}
