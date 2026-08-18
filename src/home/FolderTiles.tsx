'use client';

/**
 * Folders as tiles at the top of the Documents pane — the content-area half of
 * the rail, so browsing works the way a file explorer's does: folders first,
 * documents below, and you get into one by clicking it where you're already
 * looking rather than travelling to the rail.
 *
 * Deliberately NOT a second source of truth. The rail still owns folder
 * creation, renaming and deleting; these tiles only navigate and accept drops,
 * which is why they carry no "..." menu.
 *
 * Shown on "All documents" only: folders are flat (see `docs/folders.ts`), so
 * inside one there is nothing further down to show. They're also hidden while a
 * search or filter is active — a query runs across every folder, and offering
 * navigation tiles beside results that came from elsewhere reads as if the
 * tiles had been filtered too.
 */
import { useState } from 'react';
import type { DocFolder } from '@/docs/folders';

function FolderGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 shrink-0">
      <path
        d="M1.75 4.25c0-.55.45-1 1-1h3.1c.32 0 .62.15.81.4l.68.9h6.16c.55 0 1 .45 1 1v6.2c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-7.5Z"
        fill="currentColor"
        fillOpacity={0.15}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One tile. `depth` counts dragenter/dragleave rather than storing a boolean,
 * for the same reason the rail's rows do: those events fire for the tile's own
 * children too, so a boolean flickers off as the pointer crosses the label.
 */
function Tile({
  folder,
  count,
  onOpen,
  onDropDoc,
}: {
  folder: DocFolder;
  count: number;
  onOpen: () => void;
  onDropDoc: (docId: string) => void;
}) {
  const [depth, setDepth] = useState(0);

  return (
    <button
      onClick={onOpen}
      title={`Open “${folder.name}”`}
      onDragEnter={() => setDepth((d) => d + 1)}
      onDragLeave={() => setDepth((d) => Math.max(0, d - 1))}
      onDragOver={(e) => {
        // Without preventDefault the browser refuses the drop outright.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDepth(0);
        const docId = e.dataTransfer.getData('text/devindesign-doc');
        if (docId) onDropDoc(docId);
      }}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left ${
        depth > 0
          ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-300 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:ring-indigo-500/50'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60'
      }`}
    >
      <span className="text-zinc-400">
        <FolderGlyph />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
          {folder.name}
        </span>
        <span className="block text-[11px] text-zinc-400">
          {count} {count === 1 ? 'document' : 'documents'}
        </span>
      </span>
    </button>
  );
}

export function FolderTiles({
  folders,
  counts,
  onOpen,
  onFileDoc,
}: {
  folders: DocFolder[];
  /** Live-document counts by folder id — the rail's map, unchanged. */
  counts: Record<string, number>;
  onOpen: (folderId: string) => void;
  onFileDoc: (docId: string, folderId: string) => void;
}) {
  if (!folders.length) return null;

  return (
    <div className="mb-5">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        Folders
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
        {folders.map((folder) => (
          <Tile
            key={folder.id}
            folder={folder}
            count={counts[folder.id] ?? 0}
            onOpen={() => onOpen(folder.id)}
            onDropDoc={(docId) => onFileDoc(docId, folder.id)}
          />
        ))}
      </div>
    </div>
  );
}
