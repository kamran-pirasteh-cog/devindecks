'use client';

/**
 * Artifacts — the shared asset library, browsed Drive-style: a grid of folders
 * bucketed by artifact type, drilled into one level.
 *
 * The folder set is fixed and the contents are empty for now; uploads land in a
 * later pass, at which point ARTIFACT_FOLDERS grows an id the repository keys
 * assets by.
 */
import { useState } from 'react';

type ArtifactFolder = { id: string; name: string };

const ARTIFACT_FOLDERS: ArtifactFolder[] = [
  { id: 'cognition-logos', name: 'Cognition Logos' },
  { id: 'client-logos', name: 'Client Logos' },
  { id: 'cognition-brand-graphics', name: 'Cognition Brand Graphics' },
  { id: 'icons', name: 'Icons' },
];

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-9 w-9 shrink-0 text-zinc-400 dark:text-zinc-500"
    >
      <path
        fill="currentColor"
        d="M4 5h5.2l1.6 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
      />
    </svg>
  );
}

export function Artifacts() {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = ARTIFACT_FOLDERS.find((f) => f.id === openId) ?? null;

  if (open) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-1.5 text-sm">
          <button
            onClick={() => setOpenId(null)}
            className="rounded px-1.5 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Artifacts
          </button>
          <span className="text-zinc-300 dark:text-zinc-600">/</span>
          <span className="px-1.5 py-1 font-medium text-zinc-900 dark:text-white">
            {open.name}
          </span>
        </div>
        <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
          This folder is empty.
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-xs text-zinc-500">
        A shared library of images and icons, organized into folders by artifact type.
        Everyone picks from the same set in the deck editor.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {ARTIFACT_FOLDERS.map((folder) => (
          <button
            key={folder.id}
            onClick={() => setOpenId(folder.id)}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3.5 py-3 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <FolderIcon />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-white">
                {folder.name}
              </span>
              <span className="block text-xs text-zinc-400">0 items</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
