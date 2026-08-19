'use client';

/**
 * Homepage / dashboard: your documents, plus a "New" button that opens the
 * picker (browse templates · start from a prior doc · blank).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { type Deck } from '@/model';
import {
  countDocsByFolder,
  deleteDoc,
  listAllOwners,
  listAllTags,
  listDeletedDocs,
  listDocs,
  purgeAllDeleted,
  restoreDoc,
  seedIfFirstRun,
  setDocFolder,
} from '@/docs/repository';
import { getFolder, listFolders, type DocFolder } from '@/docs/folders';
import { useToast } from '@/ui/Toast';
import { FolderRail, type FolderScope } from './FolderRail';
import { DocCard } from './DocCard';
import { DocTable } from './DocTable';
import { NewDocModal } from './NewDocModal';
import { ComingSoonLink } from '@/ui/ComingSoon';
import { DeletedItems } from './DeletedItems';
import { PrimaryTabs } from '@/nav/PrimaryTabs';
import {
  DEFAULT_DOC_SORT,
  SORT_OPTIONS,
  SORT_DEFAULT_DIR,
  nextSort,
  sortDocs,
  type DocSort,
  type SortBy,
} from './sortDocs';

/** Sentinel for the "documents with no owner set" filter option. */
const NO_OWNER = '\u0000none';

/** Sentinel for the "documents with no client tag" filter option. */
const NO_CLIENT = '\u0000untagged';

/** Where the Thumbnails switch remembers itself. Unset means on. */
const THUMBS_KEY = 'devindesign.docthumbs.v1';

/**
 * The section header above the document grid: what you're looking at on the
 * left, the Thumbnails switch on the right. A real switch rather than a
 * checkbox — it flips a view, it doesn't submit anything — and it sits here
 * rather than in the toolbar because it belongs to the grid it changes, not to
 * the search and filters that decide what's in it.
 */
function SectionHeader({
  label,
  showThumbs,
  onToggleThumbs,
}: {
  label: string;
  showThumbs: boolean;
  onToggleThumbs: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</span>
      <button
        role="switch"
        aria-checked={showThumbs}
        onClick={onToggleThumbs}
        title={showThumbs ? 'Hide slide previews' : 'Show slide previews'}
        className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Thumbnails
        <span
          aria-hidden
          className={`relative h-3.5 w-6 rounded-full transition-colors ${
            showThumbs ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
        >
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-[left] ${
              showThumbs ? 'left-3' : 'left-0.5'
            }`}
          />
        </span>
      </button>
    </div>
  );
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
 * Header "New" button. It used to open a menu (deck · report); with reporting
 * not yet built there is one thing to create, so the button just does it —
 * a one-item dropdown is a click that asks a question with a single answer.
 */
function NewButton({ onNewDeck }: { onNewDeck: () => void }) {
  return (
    <button
      onClick={onNewDeck}
      className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
    >
      New
    </button>
  );
}

export function Home() {
  const toast = useToast();
  const [docs, setDocs] = useState<Deck[]>([]);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  // The folder (`?folder=`, how the editor's header crumb links back here) is
  // seeded from the query string, so it's addressable from another route.
  const searchParams = useSearchParams();
  const [scope, setScope] = useState<FolderScope>({ kind: 'all' });
  const [allTags, setAllTags] = useState<string[]>([]);
  const [allOwners, setAllOwners] = useState<string[]>([]);
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  // Key AND direction together: the column headers reverse the order in place,
  // which a bare key can't express.
  const [sort, setSort] = useState<DocSort>(DEFAULT_DOC_SORT);
  // Thumbnails on/off. Persisted, and read in an effect rather than in the
  // initializer: localStorage doesn't exist during the server render, and
  // seeding state from it directly would hydrate a different grid than the
  // markup says.
  const [showThumbs, setShowThumbs] = useState(true);
  const [deleted, setDeleted] = useState<Deck[]>([]);
  // The rail's "Deleted" row swaps the grid for the recycle bin — it's one of
  // the places documents can be, so it lives with the folders rather than as a
  // button off in the toolbar.
  const showTrash = scope.kind === 'deleted';

  const refreshDocs = () => {
    setDocs(listDocs());
    setAllTags(listAllTags());
    setAllOwners(listAllOwners());
    setDeleted(listDeletedDocs());
    setFolders(listFolders());
    setFolderCounts(countDocsByFolder());
  };

  useEffect(() => {
    seedIfFirstRun();
    refreshDocs();
    if (window.localStorage.getItem(THUMBS_KEY) === '0') setShowThumbs(false);
    // Opening a folder from elsewhere (the editor's header crumb). Applied
    // after the seed so a first-run folder is already on disk, and only for an
    // id that still exists — a stale link lands on All documents rather than
    // scoping the grid to nothing.
    const id = searchParams.get('folder');
    if (id && getFolder(id)) setScope({ kind: 'folder', id });
    // Mount only: the rail owns the scope from here on, and re-running this
    // would yank you back to the folder in the URL after every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleThumbs = () => {
    const next = !showThumbs;
    setShowThumbs(next);
    window.localStorage.setItem(THUMBS_KEY, next ? '1' : '0');
  };

  /** Drop-onto-a-folder from the rail. (The card menu files documents itself,
      and raises its own toast, because it knows which folders it offered.) */
  const fileDoc = (docId: string, folderId: string | undefined) => {
    const doc = docs.find((d) => d.id === docId);
    const from = doc?.folderId;
    setDocFolder(docId, folderId);
    refreshDocs();
    if (!doc || from === folderId) return;
    const name = folders.find((f) => f.id === folderId)?.name;
    toast(name ? `Moved “${doc.title}” to ${name}.` : `Removed “${doc.title}” from its folder.`, {
      action: {
        label: 'Undo',
        run: () => {
          setDocFolder(docId, from);
          refreshDocs();
        },
      },
    });
  };

  /** Dropped onto the rail's Deleted row: recoverable, same as the card menu. */
  const trashDoc = (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    deleteDoc(docId);
    refreshDocs();
    toast(doc ? `“${doc.title}” moved to Deleted.` : 'Document moved to Deleted.', {
      action: {
        label: 'Undo',
        run: () => {
          restoreDoc(docId);
          refreshDocs();
        },
      },
    });
  };

  /** The rail's Deleted menu — the bin view's own two controls, reachable
      without going into the bin first. */
  const restoreAllDeleted = () => {
    const n = deleted.length;
    deleted.forEach((deck) => restoreDoc(deck.id));
    refreshDocs();
    toast(`Restored ${n} document${n === 1 ? '' : 's'}.`);
  };

  const emptyDeleted = () => {
    const n = deleted.length;
    purgeAllDeleted();
    refreshDocs();
    // No undo here, and the tone says as much: this is the one path that
    // destroys documents.
    toast(`${n} document${n === 1 ? '' : 's'} deleted for good.`, { tone: 'danger' });
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
    if (modal || showTrash || !hasFilters) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      clearFilters();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, showTrash, hasFilters]);

  const hasUnowned = docs.some((d) => !d.owner);
  const hasUntagged = docs.some((d) => !(d.tags ?? []).length);

  const filteredDocs = sortDocs(
    docs.filter((deck) => {
      // Folder scope first: it's a location, not a filter — "Clear" and Escape
      // leave it alone, and the empty state below reads differently inside a
      // folder than it does under a search that matched nothing.
      if (scope.kind === 'folder' && deck.folderId !== scope.id) return false;
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
    }),
    sort,
  );

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
          <div className="flex items-center gap-3">
            {/* Blue text, left of New: what's being built, one click away. */}
            <ComingSoonLink />
            <NewButton onNewDeck={() => setModal(true)} />
          </div>
        </div>
        <PrimaryTabs
          active="documents"
          // Already here — so Documents is a way back out of the bin rather
          // than a navigation.
          onSelect={() => {
            if (showTrash) setScope({ kind: 'all' });
          }}
        />
      </header>

      <main className="px-8 py-6">
        {/* Two panes, the way a file explorer is laid out: folders on the left,
            the documents in the selected one on the right, with a rule between
            them so they read as separate halves rather than a sidebar floating
            beside the content. `items-stretch` + a min height keep the divider
            running the full pane rather than stopping at whichever column
            happens to be shorter. */}
        <section className="flex min-h-[70vh] items-stretch">
          {/* The rail is a place, not a filter, so it stays put as you search —
              and it stays visible inside Deleted, which is one of its rows. */}
          <FolderRail
            folders={folders}
            counts={folderCounts}
            deletedCount={deleted.length}
            scope={scope}
            onSelect={setScope}
            onFileDoc={fileDoc}
            onTrashDoc={trashDoc}
            onRestoreAllDeleted={restoreAllDeleted}
            onEmptyDeleted={emptyDeleted}
            onFoldersChange={refreshDocs}
          />

          <div className="min-w-0 flex-1 pl-6">
          {/* Says where you are, as a path rather than a bare heading: inside a
              folder the first crumb is the way back out, which is the one
              control an explorer is expected to have and the rail alone doesn't
              advertise. Skipped on "All documents", where the tab strip above
              already reads "Documents". */}
          {scope.kind !== 'all' ? (
            <div className="mb-3 flex items-center gap-1.5 text-sm">
              <button
                onClick={() => setScope({ kind: 'all' })}
                className="text-zinc-500 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                All documents
              </button>
              <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
                /
              </span>
              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                {scope.kind === 'deleted'
                  ? 'Deleted'
                  : (folders.find((f) => f.id === scope.id)?.name ?? 'Folder')}
              </span>
              {scope.kind === 'folder' ? (
                <span className="text-[11px] tabular-nums text-zinc-400">
                  {folderCounts[scope.id] ?? 0}
                </span>
              ) : null}
            </div>
          ) : null}
          {/* One toolbar row: search + filters on the left, sort on the right,
              all sharing a baseline. The whole row is gone inside Deleted,
              which has its own controls. */}
          {showTrash ? null : (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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

            {/* ml-auto, not justify-end: sort belongs at the grid's right edge
                whatever the left group's width comes out to. */}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
              Sort by
              <ToolbarSelect
                label="Sort by"
                value={sort.by}
                // Picking a key from here takes that key's own direction — the
                // headers are where you reverse one.
                onChange={(v) =>
                  setSort({ by: v as SortBy, dir: SORT_DEFAULT_DIR[v as SortBy] })
                }
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </ToolbarSelect>
            </label>
          </div>
          )}

          {showTrash ? (
            <DeletedItems docs={deleted} onChange={refreshDocs} />
          ) : (
            <>

            {/* "All documents" keeps meaning ALL of them, folders included — the
                tiles above are a way in, not a filter, and a root that hid
                filed documents would contradict the rail row they're both named
                after. */}
            <SectionHeader
              label={
                scope.kind === 'folder'
                  ? (folders.find((f) => f.id === scope.id)?.name ?? 'Folder')
                  : hasFilters
                    ? 'Results'
                    : 'All documents'
              }
              showThumbs={showThumbs}
              onToggleThumbs={toggleThumbs}
            />

          {filteredDocs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
              {hasFilters
                ? 'No documents match your search.'
                : scope.kind === 'all'
                  ? 'No documents yet.'
                  : 'This folder is empty. Drag a document onto it, or use “Move to folder”.'}
            </div>
          ) : showThumbs ? (
            // Now the grid is full-bleed, the column COUNT is what should grow
            // with the window, not the card width: auto-fill keeps every card
            // near 280px and just fits more of them across, at any width, with
            // no breakpoints to keep in sync.
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {filteredDocs.map((deck) => (
                <DocCard key={deck.id} deck={deck} onChange={refreshDocs} folders={folders} />
              ))}
            </div>
          ) : (
            // Previews off means the file-explorer list: same documents, same
            // sort, one row each.
            <DocTable
              docs={filteredDocs}
              folders={folders}
              onChange={refreshDocs}
              sort={sort}
              onSort={(by) => setSort((s) => nextSort(s, by))}
            />
          )}
            </>
          )}
          </div>
        </section>
      </main>

      {modal ? (
        <NewDocModal
          onClose={() => setModal(false)}
          folderId={scope.kind === 'folder' ? scope.id : undefined}
        />
      ) : null}

    </div>
  );
}
