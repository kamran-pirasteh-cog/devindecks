'use client';

/**
 * Artifacts — the shared asset library, browsed Drive-style: a grid of folders
 * bucketed by artifact type, drilled into one level.
 *
 * Uploading is folder-scoped rather than global: an asset's folder is the only
 * classification the library has, so there's no "unfiled" state to land in.
 * The shelf's Upload button therefore picks files and then asks which folder,
 * while inside a folder it uploads straight there. Both views also take a drop
 * — on the shelf, onto whichever folder card you drop over.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ACCEPT_ATTR,
  ARTIFACT_FOLDERS,
  ArtifactError,
  addArtifact,
  countByFolder,
  deleteArtifact,
  formatBytes,
  listArtifacts,
  MAX_BYTES,
  renameArtifact,
  type ArtifactFolderId,
  type StoredArtifact,
} from '@/artifacts/repository';

function FolderIcon({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={`${className} shrink-0 text-zinc-400 dark:text-zinc-500`}
    >
      <path
        fill="currentColor"
        d="M4 5h5.2l1.6 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
      />
    </svg>
  );
}

/** Upload button — the trigger only; each view owns its own file input. */
function UploadButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex shrink-0 items-center gap-1.5 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
    >
      <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5">
        <path
          d="M8 11V3.5M8 3.5 5 6.5M8 3.5l3 3M2.5 10.5v1A1.5 1.5 0 0 0 4 13h8a1.5 1.5 0 0 0 1.5-1.5v-1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {busy ? 'Uploading…' : 'Upload'}
    </button>
  );
}

function ErrorList({ errors, onDismiss }: { errors: string[]; onDismiss: () => void }) {
  if (!errors.length) return null;
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
      <ul className="min-w-0 space-y-0.5">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 px-1 text-red-400 hover:text-red-700 dark:hover:text-red-200"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Destination picker for a shelf-level upload: the files are already chosen and
 * parked, so this only names the folder they land in.
 */
function FolderPrompt({
  count,
  onChoose,
  onCancel,
}: {
  count: number;
  onChoose: (folderId: ArtifactFolderId) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="Choose a folder"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h3 className="text-sm font-semibold">
          Upload {count} {count === 1 ? 'file' : 'files'} to…
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Artifacts are organized by type, so they need a destination folder.
        </p>
        <div className="mt-3 space-y-1.5">
          {ARTIFACT_FOLDERS.map((f) => (
            <button
              key={f.id}
              onClick={() => onChoose(f.id)}
              className="flex w-full items-center gap-2.5 rounded-md border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <FolderIcon className="h-6 w-6" />
              {f.name}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** One asset tile: checkerboard-backed preview, name, size, rename + delete. */
function ArtifactTile({
  artifact,
  onChanged,
}: {
  artifact: StoredArtifact;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(artifact.name);

  const commit = () => {
    renameArtifact(artifact.id, draft);
    setRenaming(false);
    onChanged();
  };

  return (
    <div className="group rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Checkerboard: most of these are transparent PNGs and SVGs, which are
          invisible against a plain white or plain dark tile. */}
      <div
        className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded"
        style={{
          backgroundImage:
            'linear-gradient(45deg, rgba(120,120,128,.14) 25%, transparent 25% 75%, rgba(120,120,128,.14) 75%), linear-gradient(45deg, rgba(120,120,128,.14) 25%, transparent 25% 75%, rgba(120,120,128,.14) 75%)',
          backgroundSize: '12px 12px',
          backgroundPosition: '0 0, 6px 6px',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={artifact.src}
          alt={artifact.name}
          className="max-h-full max-w-full object-contain p-2"
        />
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-1">
        <div className="min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  setDraft(artifact.name);
                  setRenaming(false);
                }
              }}
              className="w-full rounded border border-indigo-300 px-1 py-0.5 text-xs outline-none dark:bg-zinc-800"
            />
          ) : (
            <button
              onClick={() => setRenaming(true)}
              title="Rename"
              className="block max-w-full truncate text-left text-xs font-medium hover:underline"
            >
              {artifact.name}
            </button>
          )}
          <span className="block text-[11px] text-zinc-400">
            {artifact.width && artifact.height ? `${artifact.width}×${artifact.height} · ` : ''}
            {formatBytes(artifact.bytes)}
          </span>
        </div>
        <button
          onClick={() => {
            deleteArtifact(artifact.id);
            onChanged();
          }}
          aria-label={`Delete ${artifact.name}`}
          title="Delete"
          className="shrink-0 rounded px-1 text-zinc-300 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-100 hover:text-red-600 focus:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800"
        >
          ×
        </button>
      </div>
    </div>
  );
}

const HINT = (
  <>PNG, JPEG, SVG, GIF or WebP, up to {formatBytes(MAX_BYTES)} each.</>
);

export function Artifacts() {
  const [openId, setOpenId] = useState<ArtifactFolderId | null>(null);
  const [items, setItems] = useState<StoredArtifact[]>([]);
  const [counts, setCounts] = useState<Record<ArtifactFolderId, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Files chosen from the shelf, parked while we ask for a destination folder.
  const [pending, setPending] = useState<File[] | null>(null);
  // Which folder card (or the folder view) is under a drag right now.
  const [dropTarget, setDropTarget] = useState<ArtifactFolderId | null>(null);
  // Bumped after every write; the load effect keys off it. A counter rather
  // than a refresh callback because an upload's completion handler would
  // otherwise close over a stale `openId` and blank the grid it just filled.
  const [version, setVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reads localStorage, so it has to wait for the client.
  useEffect(() => {
    setCounts(countByFolder());
    setItems(openId ? listArtifacts(openId) : []);
  }, [openId, version]);

  const refresh = () => setVersion((v) => v + 1);

  const upload = async (files: FileList | File[], folderId: ArtifactFolderId) => {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setErrors([]);
    const failed: string[] = [];
    // Sequential, not Promise.all: each write reads the store back first, so
    // parallel uploads would clobber each other. Failures are collected rather
    // than thrown, so one bad file doesn't abandon the rest of the selection.
    for (const file of list) {
      try {
        await addArtifact(file, folderId);
      } catch (err) {
        failed.push(err instanceof ArtifactError ? err.message : `Couldn't upload ${file.name}.`);
      }
    }
    setBusy(false);
    setErrors(failed);
    refresh();
  };

  const open = ARTIFACT_FOLDERS.find((f) => f.id === openId) ?? null;

  const dropHandlers = (folderId: ArtifactFolderId) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(folderId);
    },
    onDragLeave: () => setDropTarget((cur) => (cur === folderId ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      if (e.dataTransfer.files?.length) upload(e.dataTransfer.files, folderId);
    },
  });

  const fileInput = (onFiles: (files: File[]) => void) => (
    <input
      ref={fileInputRef}
      type="file"
      accept={ACCEPT_ATTR}
      multiple
      className="hidden"
      onChange={(e) => {
        // Copy out of the live FileList BEFORE clearing the input: `value = ''`
        // empties that same list, and the reset is what lets the same file be
        // re-picked (an unchanged value fires no second change event).
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (files.length) onFiles(files);
      }}
    />
  );

  if (open && openId) {
    const dropping = dropTarget === openId;
    return (
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <button
              onClick={() => setOpenId(null)}
              className="rounded px-1.5 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Artifacts
            </button>
            <span className="text-zinc-300 dark:text-zinc-600">/</span>
            <span className="truncate px-1.5 py-1 font-medium text-zinc-900 dark:text-white">
              {open.name}
            </span>
          </div>
          <UploadButton busy={busy} onClick={() => fileInputRef.current?.click()} />
          {fileInput((files) => upload(files, openId))}
        </div>

        <ErrorList errors={errors} onDismiss={() => setErrors([])} />

        {items.length ? (
          <div
            {...dropHandlers(openId)}
            className={`grid grid-cols-2 gap-3 rounded-lg sm:grid-cols-3 lg:grid-cols-5 ${
              dropping ? 'ring-2 ring-indigo-400' : ''
            }`}
          >
            {items.map((a) => (
              <ArtifactTile key={a.id} artifact={a} onChanged={refresh} />
            ))}
          </div>
        ) : (
          <div
            {...dropHandlers(openId)}
            className={`rounded-lg border border-dashed py-16 text-center text-sm ${
              dropping
                ? 'border-indigo-400 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10'
                : 'border-zinc-300 text-zinc-400 dark:border-zinc-700'
            }`}
          >
            <p>This folder is empty.</p>
            <p className="mt-1 text-xs">Drop images here, or use Upload. {HINT}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-end gap-3">
        <UploadButton busy={busy} onClick={() => fileInputRef.current?.click()} />
        {fileInput(setPending)}
      </div>

      <ErrorList errors={errors} onDismiss={() => setErrors([])} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {ARTIFACT_FOLDERS.map((folder) => (
          <button
            key={folder.id}
            onClick={() => setOpenId(folder.id)}
            {...dropHandlers(folder.id)}
            className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left ${
              dropTarget === folder.id
                ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10'
                : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
            }`}
          >
            <FolderIcon />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-white">
                {folder.name}
              </span>
              <span className="block text-xs text-zinc-400">
                {counts ? `${counts[folder.id]} ${counts[folder.id] === 1 ? 'item' : 'items'}` : '—'}
              </span>
            </span>
          </button>
        ))}
      </div>

      {pending ? (
        <FolderPrompt
          count={pending.length}
          onChoose={(folderId) => {
            const files = pending;
            setPending(null);
            setOpenId(folderId);
            upload(files, folderId);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
