'use client';

/**
 * Homepage / dashboard: your documents, plus a "New" button that opens the
 * picker (browse templates · start from a prior doc · blank).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { PrimaryTabs } from '@/nav/PrimaryTabs';

type Tab = 'documents' | 'reports';

type SortBy = 'updated' | 'created' | 'client' | 'owner';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Date created' },
  { value: 'client', label: 'Client' },
  { value: 'owner', label: 'Owner' },
];

/** Sentinel for the "documents with no owner set" filter option. */
const NO_OWNER = '\u0000none';

/** Sentinel for the "documents with no client tag" filter option. */
const NO_CLIENT = '\u0000untagged';

function firstClient(deck: Deck): string {
  return (deck.tags ?? [])[0]?.toLowerCase() ?? '';
}

/**
 * A toolbar dropdown. The native arrow is suppressed in favour of a
 * drawn chevron, so it can be thinner than the platform one and sit a couple
 * of px in from the right edge.
 */
function ToolbarSelect({
  label,
  value,
  onChange,
  active,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Narrows the set of documents right now, so it gets the "on" treatment. */
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full appearance-none rounded-md border py-1.5 pl-2.5 pr-8 text-sm outline-none ${
          active
            ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300'
            : 'border-zinc-200 bg-white text-zinc-600 focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
        }`}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 12 12"
        aria-hidden
        className={`pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 ${
          active ? 'text-indigo-500 dark:text-indigo-300' : 'text-zinc-400'
        }`}
      >
        <path
          d="M3 4.75 6 7.75 9 4.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * Header "New" button: one control, with the two things you can create behind
 * a dropdown. (It used to be two side-by-side buttons; a single verb reads
 * cleaner and leaves room for more document kinds later.)
 */
function NewMenu({ onNewDeck, onNewReport }: { onNewDeck: () => void; onNewReport: () => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stop here: the page-level Escape would otherwise clear the filters
      // behind an open menu.
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

  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        New
        <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3">
          <path
            d="M3 4.75 6 7.75 9 4.75"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          <button
            role="menuitem"
            onClick={() => choose(onNewDeck)}
            className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
          >
            New deck
          </button>
          <button
            role="menuitem"
            onClick={() => choose(onNewReport)}
            className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
          >
            New report
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Home() {
  const [docs, setDocs] = useState<Deck[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [allOwners, setAllOwners] = useState<string[]>([]);
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  // Documents/Reports are local state, but `?tab=reports` seeds it so the tab
  // is addressable from another route — that's how Admin's copy of the tab
  // strip links back to Reports.
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    searchParams.get('tab') === 'reports' ? 'reports' : 'documents',
  );
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

  // The search box counts as a filter here: it narrows the same grid, so
  // "Clear" and Escape should take it with them.
  const hasFilters = Boolean(query || ownerFilter || clientFilter);

  const clearFilters = () => {
    setQuery('');
    setOwnerFilter('');
    setClientFilter('');
  };

  // Escape clears the filters from anywhere on the page, including from inside
  // the search box. Skipped while the new-document modal or the bin is up, so
  // it doesn't fight whatever Escape means there.
  useEffect(() => {
    if (modal || showTrash || tab !== 'documents' || !hasFilters) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      clearFilters();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, showTrash, tab, hasFilters]);

  const hasUnowned = docs.some((d) => !d.owner);
  const hasUntagged = docs.some((d) => !(d.tags ?? []).length);

  const filteredDocs = docs
    .filter((deck) => {
      const q = query.trim().toLowerCase();
      if (q) {
        const titleMatch = deck.title.toLowerCase().includes(q);
        const tagMatch = (deck.tags ?? []).some((t) => t.toLowerCase().includes(q));
        const ownerMatch = (deck.owner ?? '').toLowerCase().includes(q);
        if (!titleMatch && !tagMatch && !ownerMatch) return false;
      }
      const tags = deck.tags ?? [];
      if (clientFilter === NO_CLIENT) {
        if (tags.length) return false;
      } else if (clientFilter && !tags.includes(clientFilter)) return false;
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
        {/* Fixed height, not py-3: keeps the brand row identical to Admin's,
            whose bordered buttons are 2px taller than this one's. */}
        <div className="flex h-13 items-center justify-between px-8">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/devin-logo.svg"
              alt=""
              className="h-6 w-6 shrink-0 dark:invert"
            />
            <span className="text-xl font-semibold tracking-tight">Decks</span>
          </div>
          <div className="flex items-center gap-2">
            <NewMenu
              onNewDeck={() => setModal(true)}
              onNewReport={() => {
                setShowTrash(false);
                setTab('reports');
                window.history.replaceState(null, '', '/?tab=reports');
              }}
            />
          </div>
        </div>
        <PrimaryTabs
          active={tab}
          onSelect={(t) => {
            setShowTrash(false);
            setTab(t);
            // Keep the URL matching the visible tab so a reload (or a link
            // copied out of the address bar) comes back to the same place.
            // replaceState rather than a router push: switching tabs isn't a
            // navigation, and it shouldn't stack up Back-button entries.
            window.history.replaceState(null, '', t === 'reports' ? '/?tab=reports' : '/');
          }}
        />
      </header>

      <main className="px-8 py-6">
        {tab === 'reports' ? <Reports docs={docs} /> : null}

        {/* Hidden rather than unmounted, so a search/filter survives a trip
            through Reports and back. */}
        <section className={tab === 'documents' ? '' : 'hidden'}>
          {/* One toolbar row: search + owner filter on the left, sort and the
              Deleted items button on the right, all sharing a baseline. The
              row's right edge lines up with the grid's, so that button sits
              flush with the rightmost card. The tab strip above already says
              "Documents", so there's no second heading. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {showTrash ? null : (
              <div className="flex items-center gap-2">
                <div className="relative w-72">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search documents…"
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 pr-7 text-sm outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
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
                {/* No visible captions: the "All owners"/"All clients" default
                    options already say what each filter is. */}
                <ToolbarSelect
                  label="Filter by owner"
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  active={Boolean(ownerFilter)}
                >
                  <option value="">All owners</option>
                  {allOwners.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  {hasUnowned ? <option value={NO_OWNER}>Unassigned</option> : null}
                </ToolbarSelect>
                <ToolbarSelect
                  label="Filter by client"
                  value={clientFilter}
                  onChange={setClientFilter}
                >
                  <option value="">All clients</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  {hasUntagged ? <option value={NO_CLIENT}>Untagged</option> : null}
                </ToolbarSelect>
                {hasFilters ? (
                  <button
                    onClick={clearFilters}
                    title="Clear filters (Esc)"
                    className="shrink-0 rounded px-1 text-xs font-medium text-red-500 hover:text-red-600 hover:underline dark:text-red-400 dark:hover:text-red-300"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            )}

            {/* ml-auto, not justify-end: in the bin the left group is gone and
                these still belong on the right. */}
            <div className="ml-auto flex items-center gap-3">
              {showTrash ? null : (
                <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                  Sort by
                  <ToolbarSelect
                    label="Sort by"
                    value={sortBy}
                    onChange={(v) => setSortBy(v as SortBy)}
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </ToolbarSelect>
                </label>
              )}

              <button
                onClick={() => setShowTrash((v) => !v)}
                className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
                  showTrash
                    ? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                {showTrash
                  ? '← Back to documents'
                  : `Deleted${deleted.length ? ` (${deleted.length})` : ''}`}
              </button>
            </div>
          </div>

          {showTrash ? (
            <DeletedItems docs={deleted} onChange={refreshDocs} />
          ) : (
            <>

          {filteredDocs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
              No documents match your search.
            </div>
          ) : (
            // Now the grid is full-bleed, the column COUNT is what should grow
            // with the window, not the card width: auto-fill keeps every card
            // near 280px and just fits more of them across, at any width, with
            // no breakpoints to keep in sync.
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
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
