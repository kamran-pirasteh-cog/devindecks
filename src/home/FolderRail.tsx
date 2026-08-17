'use client';

/**
 * Left rail on the Documents tab: All documents · your folders · Deleted.
 *
 * Selecting a row scopes the view beside it — including Deleted, which is a
 * place in the rail rather than a button in the toolbar. Rows are also drop
 * targets: drag a document card onto a folder to file it, or onto All documents
 * to take it out of whatever folder it's in. That's why the drag payload is a
 * plain document id (see `DocCard`'s `dragstart`).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createFolder,
  deleteFolder,
  isFolderNameAvailable,
  renameFolder,
  type DocFolder,
} from '@/docs/folders';
import { unfileFolder } from '@/docs/repository';
import { ConfirmDialog } from './ConfirmDialog';

/** Which slice of the dashboard the rail is asking for. */
export type FolderScope =
  | { kind: 'all' }
  | { kind: 'folder'; id: string }
  | { kind: 'deleted' };

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
      <path
        d="M1.75 4.25c0-.55.45-1 1-1h3.1c.32 0 .62.15.81.4l.68.9h6.16c.55 0 1 .45 1 1v6.2c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-7.5Z"
        fill={open ? 'currentColor' : 'none'}
        fillOpacity={open ? 0.15 : undefined}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 shrink-0">
      <path
        d="M8 3.5v9M3.5 8h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
      <path
        d="M3.25 4.75h9.5m-8 0 .6 8.05h5.3l.6-8.05M6.25 4.75V3.4c0-.36.29-.65.65-.65h2.2c.36 0 .65.29.65.65v1.35"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One rail row. `dropping` is tracked with a counter rather than a boolean:
 * dragenter/dragleave also fire for the row's own children, so a plain boolean
 * flickers off as the pointer crosses the label.
 */
function Row({
  label,
  count,
  icon,
  selected,
  onSelect,
  onDropDoc,
  trailing,
}: {
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  /** Omitted for rows that can't accept a document (Deleted). */
  onDropDoc?: (docId: string) => void;
  trailing?: ReactNode;
}) {
  const [depth, setDepth] = useState(0);
  const dropping = depth > 0 && Boolean(onDropDoc);

  return (
    <div
      onDragEnter={onDropDoc ? () => setDepth((d) => d + 1) : undefined}
      onDragLeave={onDropDoc ? () => setDepth((d) => Math.max(0, d - 1)) : undefined}
      onDragOver={
        onDropDoc
          ? (e) => {
              // Without preventDefault the browser refuses the drop outright.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          : undefined
      }
      onDrop={
        onDropDoc
          ? (e) => {
              e.preventDefault();
              setDepth(0);
              const docId = e.dataTransfer.getData('text/devindesign-doc');
              if (docId) onDropDoc(docId);
            }
          : undefined
      }
      className={`group/row relative flex items-center gap-1.5 rounded-md py-1.5 pl-2 pr-2 text-sm ${
        dropping
          ? 'bg-indigo-50 ring-1 ring-indigo-300 dark:bg-indigo-500/10 dark:ring-indigo-500/50'
          : selected
            ? 'bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
            : 'text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
      }`}
    >
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {typeof count === 'number' ? (
        // The count sits flush at the row's right edge and slides out of the
        // way of the "..." rather than reserving a permanent gap for it. The
        // has-[] half keeps it clear while the menu is open but the pointer has
        // moved off the row onto the popup.
        <span
          className={`ml-auto shrink-0 text-[11px] tabular-nums text-zinc-400 transition-transform duration-150 ${
            trailing
              ? 'group-hover/row:-translate-x-6 group-has-[[aria-expanded=true]]/row:-translate-x-6'
              : ''
          }`}
        >
          {count}
        </span>
      ) : null}
      {trailing ? (
        <span className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</span>
      ) : null}
    </div>
  );
}

/**
 * The hover-revealed "..." menu on a rail row. Shared by the folders (rename,
 * delete) and Deleted (restore all, empty), so both behave the same way.
 */
function RowMenu({
  title,
  items,
}: {
  title: string;
  items: { label: string; danger?: boolean; disabled?: boolean; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Capture, and stop the event: the page-level Escape clears the filters,
    // which isn't what closing this menu should do.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
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

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-5 w-5 items-center justify-center rounded text-[11px] text-zinc-400 hover:bg-zinc-300/60 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 ${
          open ? '' : 'opacity-0 group-hover/row:opacity-100'
        }`}
      >
        •••
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-6 z-30 w-36 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`block w-full px-3 py-1.5 text-left disabled:cursor-default disabled:opacity-40 ${
                item.danger
                  ? 'text-red-500 hover:bg-red-50 disabled:hover:bg-transparent dark:hover:bg-red-950/40'
                  : 'hover:bg-zinc-100 disabled:hover:bg-transparent dark:hover:bg-zinc-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FolderRail({
  folders,
  counts,
  deletedCount,
  scope,
  onSelect,
  onFileDoc,
  onTrashDoc,
  onRestoreAllDeleted,
  onEmptyDeleted,
  onFoldersChange,
}: {
  folders: DocFolder[];
  /** Live-document counts by folder id, with the unfiled count under `''`. */
  counts: Record<string, number>;
  deletedCount: number;
  scope: FolderScope;
  onSelect: (scope: FolderScope) => void;
  onFileDoc: (docId: string, folderId: string | undefined) => void;
  /** Dropped onto Deleted — a recoverable delete, same as the card menu's. */
  onTrashDoc: (docId: string) => void;
  /** The Deleted row's menu: the same two actions the bin view offers. */
  onRestoreAllDeleted: () => void;
  onEmptyDeleted: () => void;
  onFoldersChange: () => void;
}) {
  // Two pieces of state, not one object: the focus effect below has to fire when
  // edit mode OPENS and not on every keystroke. Keying it on the row (a string,
  // or null for the new-folder row) does that; keying it on a `{id, name}`
  // object re-selected the field after each character, so only the last letter
  // typed survived.
  //
  // `undefined` means nothing is being edited; `null` is the not-yet-created
  // folder that the "+" button adds.
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<DocFolder | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const editing = editingId !== undefined;

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing, editingId]);

  const beginEdit = (id: string | null, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const total = folders.reduce((n, f) => n + (counts[f.id] ?? 0), 0) + (counts[''] ?? 0);

  const commitEdit = () => {
    if (!editing) return;
    const name = editName.trim();
    if (name && isFolderNameAvailable(name, editingId ?? undefined)) {
      if (editingId) renameFolder(editingId, name);
      else {
        // Land in the folder you just made — creating one is almost always the
        // first half of "and put things in it".
        const folder = createFolder(name);
        onSelect({ kind: 'folder', id: folder.id });
      }
      onFoldersChange();
    }
    setEditingId(undefined);
  };

  const removeFolder = (folder: DocFolder) => {
    // Documents come first: if the folder went away with a document still
    // pointing at it, that document would be filed under nothing visible.
    unfileFolder(folder.id);
    deleteFolder(folder.id);
    if (scope.kind === 'folder' && scope.id === folder.id) onSelect({ kind: 'all' });
    setConfirmDelete(null);
    onFoldersChange();
  };

  const nameField = (
    <input
      ref={inputRef}
      value={editName}
      onChange={(e) => setEditName(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitEdit();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setEditingId(undefined);
        }
      }}
      placeholder="Folder name…"
      className="w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm outline-none dark:bg-zinc-800"
    />
  );

  return (
    <nav aria-label="Folders" className="w-56 shrink-0">
      <Row
        label="All documents"
        count={total}
        selected={scope.kind === 'all'}
        onSelect={() => onSelect({ kind: 'all' })}
        // Dropping here takes a document out of its folder — the way back out,
        // now that there's no separate "Unfiled" row.
        onDropDoc={(docId) => onFileDoc(docId, undefined)}
      />

      {/* pr-1, matching the rows' menu slot, so the button's right edge lines up
          with the row menus rather than a couple of pixels off them. */}
      <div className="mt-4 mb-1 flex items-center justify-between pl-2 pr-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          Folders
        </span>
        <button
          onClick={() => beginEdit(null, '')}
          title="New folder"
          className="flex h-[18px] items-center gap-0.5 rounded-md border border-zinc-200 bg-white pl-1 pr-1.5 text-[11px] leading-none font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
        >
          <PlusIcon />
          New
        </button>
      </div>

      <div className="space-y-0.5">
        {folders.map((folder) =>
          editingId === folder.id ? (
            <div key={folder.id} className="px-2 py-0.5">
              {nameField}
            </div>
          ) : (
            <Row
              key={folder.id}
              label={folder.name}
              count={counts[folder.id] ?? 0}
              selected={scope.kind === 'folder' && scope.id === folder.id}
              onSelect={() => onSelect({ kind: 'folder', id: folder.id })}
              onDropDoc={(docId) => onFileDoc(docId, folder.id)}
              icon={<FolderIcon open={scope.kind === 'folder' && scope.id === folder.id} />}
              trailing={
                <RowMenu
                  title="Folder options"
                  items={[
                    { label: 'Rename', onSelect: () => beginEdit(folder.id, folder.name) },
                    {
                      label: 'Delete folder',
                      danger: true,
                      onSelect: () => setConfirmDelete(folder),
                    },
                  ]}
                />
              }
            />
          ),
        )}

        {editingId === null ? <div className="px-2 py-0.5">{nameField}</div> : null}

        {!folders.length && !editing ? (
          <p className="px-2 py-1 text-[11px] leading-relaxed text-zinc-400">
            No folders yet. Add one, then drag documents onto it.
          </p>
        ) : null}
      </div>

      {/* Deleted items belongs in the rail, not in the toolbar: it's another
          place documents can be, and it's where a drag-out would send them. */}
      <div className="mt-4 border-t border-zinc-200 pt-2 dark:border-zinc-800">
        <Row
          label="Deleted"
          count={deletedCount}
          selected={scope.kind === 'deleted'}
          onSelect={() => onSelect({ kind: 'deleted' })}
          onDropDoc={onTrashDoc}
          icon={<TrashIcon />}
          trailing={
            <RowMenu
              title="Deleted items options"
              items={[
                {
                  label: 'Restore all',
                  disabled: !deletedCount,
                  onSelect: onRestoreAllDeleted,
                },
                {
                  label: 'Empty Deleted items',
                  danger: true,
                  disabled: !deletedCount,
                  onSelect: () => setConfirmEmpty(true),
                },
              ]}
            />
          }
        />
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this folder?"
          message={`“${confirmDelete.name}” will be removed. The ${
            counts[confirmDelete.id] ?? 0
          } document(s) in it aren't deleted — they move out of the folder.`}
          confirmLabel="Delete folder"
          onConfirm={() => removeFolder(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}

      {confirmEmpty ? (
        <ConfirmDialog
          title="Empty Deleted items?"
          message={`${deletedCount} document(s) will be permanently deleted. This can't be undone.`}
          confirmLabel="Empty"
          onConfirm={() => {
            setConfirmEmpty(false);
            onEmptyDeleted();
          }}
          onCancel={() => setConfirmEmpty(false)}
        />
      ) : null}
    </nav>
  );
}
