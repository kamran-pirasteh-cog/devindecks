'use client';

/**
 * Left rail on Admin's Templates tab: All templates · your folders · Unfiled.
 *
 * Modelled on the Documents tab's `FolderRail`, deliberately down to the
 * gestures: selecting a row scopes the shelf beside it, rows are drop targets
 * for a dragged template card, and the hover "•••" renames or deletes. An admin
 * who has filed a document already knows how to file a template.
 *
 * Two rows differ from the documents rail, both because a template can't be
 * thrown away by accident the way a document can:
 *
 *  - There's no Deleted row. Templates have no bin — deleting one is a
 *    confirmed, immediate action on the card itself.
 *  - There IS an Unfiled row, shown once something is actually unfiled. On the
 *    documents rail "All documents" doubles as the way out of a folder, but the
 *    template shelf needs Unfiled to be visitable: a template that's in no
 *    folder is invisible in the new-document picker's folder groups, and that's
 *    worth being able to look at directly.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createTemplateFolder,
  deleteTemplateFolder,
  isTemplateFolderNameAvailable,
  renameTemplateFolder,
  type TemplateFolder,
} from '@/templates/folders';
import { unfileTemplateFolder } from '@/templates/repository';
import { ConfirmDialog } from '@/home/ConfirmDialog';
import { useToast } from '@/ui/Toast';

/** The drag payload a template card writes, and this rail reads. */
export const TEMPLATE_DRAG_TYPE = 'text/devindesign-template';

/** Which slice of the template shelf the rail is asking for. */
export type TemplateScope =
  | { kind: 'all' }
  | { kind: 'folder'; id: string }
  | { kind: 'unfiled' };

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

/**
 * One rail row. `dropping` is counted rather than flagged for the reason
 * `FolderRail` spells out: dragenter/dragleave fire for the row's children too,
 * so a boolean flickers off as the pointer crosses the label.
 */
function Row({
  label,
  count,
  icon,
  selected,
  onSelect,
  onDropTemplate,
  trailing,
}: {
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  onDropTemplate?: (templateId: string) => void;
  trailing?: ReactNode;
}) {
  const [depth, setDepth] = useState(0);
  const dropping = depth > 0 && Boolean(onDropTemplate);

  return (
    <div
      onDragEnter={onDropTemplate ? () => setDepth((d) => d + 1) : undefined}
      onDragLeave={onDropTemplate ? () => setDepth((d) => Math.max(0, d - 1)) : undefined}
      onDragOver={
        onDropTemplate
          ? (e) => {
              // Without preventDefault the browser refuses the drop outright.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          : undefined
      }
      onDrop={
        onDropTemplate
          ? (e) => {
              e.preventDefault();
              setDepth(0);
              const id = e.dataTransfer.getData(TEMPLATE_DRAG_TYPE);
              if (id) onDropTemplate(id);
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
        // z-30 on the wrapper, not the popup: the -translate-y makes this span a
        // stacking context, so a later row would otherwise paint over the menu.
        <span className="absolute right-1 top-1/2 z-30 -translate-y-1/2">{trailing}</span>
      ) : null}
    </div>
  );
}

/** The hover-revealed "•••" menu on a folder row. */
function RowMenu({
  title,
  items,
}: {
  title: string;
  items: { label: string; danger?: boolean; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
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
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`block w-full px-3 py-1.5 text-left ${
                item.danger
                  ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-700'
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

export function TemplateFolderRail({
  folders,
  counts,
  scope,
  onSelect,
  onFileTemplate,
  onFoldersChange,
}: {
  folders: TemplateFolder[];
  /** Template counts by folder id, with the unfiled count under `''`. */
  counts: Record<string, number>;
  scope: TemplateScope;
  onSelect: (scope: TemplateScope) => void;
  onFileTemplate: (templateId: string, folderId: string | undefined) => void;
  onFoldersChange: () => void;
}) {
  const toast = useToast();
  // Two pieces of state rather than one object, for the focus reason
  // `FolderRail` documents: keying the focus effect on a `{id, name}` object
  // re-selects the field on every keystroke. `undefined` means nothing is being
  // edited; `null` is the not-yet-created folder the "+ New" button adds.
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<TemplateFolder | null>(null);
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

  const unfiled = counts[''] ?? 0;
  const total = folders.reduce((n, f) => n + (counts[f.id] ?? 0), 0) + unfiled;

  const commitEdit = () => {
    if (!editing) return;
    const name = editName.trim();
    if (name && isTemplateFolderNameAvailable(name, editingId ?? undefined)) {
      if (editingId) renameTemplateFolder(editingId, name);
      else {
        // Land in the folder you just made — creating one is almost always the
        // first half of "and put things in it".
        const folder = createTemplateFolder(name);
        onSelect({ kind: 'folder', id: folder.id });
        toast(`Folder “${folder.name}” created.`);
      }
      onFoldersChange();
    }
    setEditingId(undefined);
  };

  const removeFolder = (folder: TemplateFolder) => {
    // Templates first: if the folder went away with a template still pointing at
    // it, that template would be filed under nothing visible — and it would drop
    // out of the new-document picker's groups while still being offered.
    const held = counts[folder.id] ?? 0;
    unfileTemplateFolder(folder.id);
    deleteTemplateFolder(folder.id);
    if (scope.kind === 'folder' && scope.id === folder.id) onSelect({ kind: 'all' });
    setConfirmDelete(null);
    onFoldersChange();
    toast(
      held
        ? `Folder “${folder.name}” deleted — ${held} template${held === 1 ? '' : 's'} moved to Unfiled.`
        : `Folder “${folder.name}” deleted.`,
    );
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
    <nav
      aria-label="Template folders"
      className="w-56 shrink-0 border-r border-zinc-200 pr-4 dark:border-zinc-800"
    >
      <Row
        label="All templates"
        count={total}
        selected={scope.kind === 'all'}
        onSelect={() => onSelect({ kind: 'all' })}
        // Dropping here takes a template out of its folder — the way back out.
        onDropTemplate={(id) => onFileTemplate(id, undefined)}
      />

      {/* No right padding: a folder row's shaded box spans the rail's full
          content width, so this is what lines the button up with its edge. */}
      <div className="mt-4 mb-1 flex items-center justify-between pl-2">
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
              onDropTemplate={(id) => onFileTemplate(id, folder.id)}
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
            No folders yet. Add one, then drag templates onto it.
          </p>
        ) : null}
      </div>

      {/* Only worth a row once there's something in it — an Unfiled row reading
          0 is a permanent reminder of an empty place. */}
      {unfiled ? (
        <div className="mt-4 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <Row
            label="Unfiled"
            count={unfiled}
            selected={scope.kind === 'unfiled'}
            onSelect={() => onSelect({ kind: 'unfiled' })}
            onDropTemplate={(id) => onFileTemplate(id, undefined)}
          />
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this folder?"
          message={`“${confirmDelete.name}” will be removed. The ${
            counts[confirmDelete.id] ?? 0
          } template(s) in it aren't deleted — they move to Unfiled and are still offered when anyone creates a deck.`}
          confirmLabel="Delete folder"
          onConfirm={() => removeFolder(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </nav>
  );
}
