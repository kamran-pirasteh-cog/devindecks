'use client';

/**
 * The "..." menu shared by both views of a document — the card grid and the
 * table. Everything reachable from it (tag, move to folder, duplicate, copy
 * link, delete) plus the delete confirmation lives here, so the two views can't
 * drift into offering different actions on the same deck.
 *
 * Renaming is the one action it doesn't own: each view edits the title in place
 * in its own layout, so the menu reports the request through `onStartRename` and
 * lets the caller put up its own field.
 */
import { useEffect, useRef, useState } from 'react';
import type { Deck } from '@/model';
import {
  addDocTag,
  deleteDoc,
  duplicateDoc,
  isTitleAvailable,
  removeDocTag,
  setDocFolder,
  suggestCopyTitle,
} from '@/docs/repository';
import type { DocFolder } from '@/docs/folders';
import { ConfirmDialog } from './ConfirmDialog';
import { clientColor } from './clientColor';

type MenuView = 'main' | 'tag' | 'duplicate' | 'folder';

export function DocMenu({
  deck,
  onChange,
  onStartRename,
  /** Folders offered by "Move to folder"; omitted where there's no rail. */
  folders = [],
  /**
   * How the button looks while the menu is CLOSED — the card reveals it on
   * hover, the table row keeps it in the layout. An open menu always shows.
   */
  buttonClassName = '',
  /**
   * Told when the menu opens or closes. The card lifts its own stacking context
   * on the back of this — see the note on its `z-20`.
   */
  onOpenChange,
  tagSignal = 0,
}: {
  deck: Deck;
  onChange: () => void;
  onStartRename: () => void;
  folders?: DocFolder[];
  buttonClassName?: string;
  onOpenChange?: (open: boolean) => void;
  /**
   * Bumped by the "Tag +" affordance both views put beside an untagged title:
   * it opens this menu straight on the tag panel. A counter rather than a
   * boolean, so a second press after closing the menu reaches it again — the
   * same reason the dashboard's "New report" signal is one.
   */
  tagSignal?: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [dupName, setDupName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const dupInputRef = useRef<HTMLInputElement>(null);

  const tags = deck.tags ?? [];

  // Skipped on the first render: the initial value isn't a request to open.
  useEffect(() => {
    if (tagSignal > 0) {
      setMenuOpen(true);
      setMenuView('tag');
    }
  }, [tagSignal]);

  useEffect(() => {
    onOpenChange?.(menuOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setMenuView('main');
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  useEffect(() => {
    if (menuView === 'tag') tagInputRef.current?.focus();
    if (menuView === 'duplicate') {
      setDupName(suggestCopyTitle(deck.title));
      requestAnimationFrame(() => {
        dupInputRef.current?.focus();
        dupInputRef.current?.select();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuView]);

  const copyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/edit/${deck.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard API unavailable — silently ignore
    }
    setMenuOpen(false);
  };

  const remove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    setConfirmDelete(true);
  };

  const confirmRemove = () => {
    deleteDoc(deck.id);
    setConfirmDelete(false);
    onChange();
  };

  // Enter closes the menu: the tag is in, and the next thing you want is the
  // shelf — usually to search or filter by the client you just typed.
  const commitTag = () => {
    if (!tagInput.trim()) return;
    addDocTag(deck.id, tagInput);
    setTagInput('');
    setMenuOpen(false);
    setMenuView('main');
    onChange();
  };

  const removeTag = (tag: string) => {
    removeDocTag(deck.id, tag);
    onChange();
  };

  const dupTrimmed = dupName.trim();
  const dupAvailable = dupTrimmed.length > 0 && isTitleAvailable(dupTrimmed);

  const commitDuplicate = () => {
    if (!dupAvailable) return;
    duplicateDoc(deck.id, dupTrimmed);
    setMenuOpen(false);
    setMenuView('main');
    onChange();
  };

  const moveTo = (folderId: string | undefined) => {
    setDocFolder(deck.id, folderId);
    setMenuOpen(false);
    setMenuView('main');
    onChange();
  };

  return (
    <>
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
          setMenuView('main');
        }}
        title="More"
        className={`flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
          menuOpen ? '' : buttonClassName
        }`}
      >
        •••
      </button>

      {menuOpen ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-7 z-10 w-72 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          {menuView === 'main' ? (
            <>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onStartRename();
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                Rename
              </button>
              <button
                onClick={() => setMenuView('tag')}
                className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                Tag{tags.length ? ` (${tags.length})` : ''}
              </button>
              <button
                onClick={() => setMenuView('folder')}
                className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                Move to folder
              </button>
              <button
                onClick={() => setMenuView('duplicate')}
                className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                Duplicate
              </button>
              <button
                onClick={copyLink}
                className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                {copied ? 'Link copied!' : 'Copy link'}
              </button>
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
              <button
                onClick={remove}
                className="block w-full px-3 py-1.5 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                Delete
              </button>
            </>
          ) : menuView === 'tag' ? (
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                <button
                  onClick={() => setMenuView('main')}
                  className="rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  title="Back"
                >
                  ←
                </button>
                Tag with client
              </div>
              {tags.length ? (
                <div className="mb-2 flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                        clientColor(t).pill
                      }`}
                    >
                      {t}
                      <button
                        onClick={() => removeTag(t)}
                        className={clientColor(t).remove}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <input
                ref={tagInputRef}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitTag();
                  }
                }}
                placeholder="Type a client name…"
                className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-300 dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
          ) : menuView === 'duplicate' ? (
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                <button
                  onClick={() => setMenuView('main')}
                  className="rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  title="Back"
                >
                  ←
                </button>
                Duplicate as
              </div>
              <input
                ref={dupInputRef}
                value={dupName}
                onChange={(e) => setDupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitDuplicate();
                  }
                }}
                placeholder="New document name…"
                className={`w-full rounded border bg-white px-2 py-1 text-xs outline-none dark:bg-zinc-900 ${
                  dupTrimmed && !dupAvailable
                    ? 'border-red-300 focus:border-red-400'
                    : 'border-zinc-200 focus:border-indigo-300 dark:border-zinc-600'
                }`}
              />
              {dupTrimmed && !dupAvailable ? (
                <div className="mt-1 text-[10px] text-red-500">
                  A document with this name already exists.
                </div>
              ) : null}
              <button
                onClick={commitDuplicate}
                disabled={!dupAvailable}
                className="mt-2 w-full rounded bg-black px-2 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                Create duplicate
              </button>
            </div>
          ) : (
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                <button
                  onClick={() => setMenuView('main')}
                  className="rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  title="Back"
                >
                  ←
                </button>
                Move to folder
              </div>
              <div className="-mx-1 max-h-52 overflow-y-auto">
                <button
                  onClick={() => moveTo(undefined)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                    deck.folderId ? '' : 'font-medium text-indigo-600 dark:text-indigo-300'
                  }`}
                >
                  No folder
                  {deck.folderId ? null : <span aria-hidden>✓</span>}
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => moveTo(f.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                      deck.folderId === f.id
                        ? 'font-medium text-indigo-600 dark:text-indigo-300'
                        : ''
                    }`}
                  >
                    <span className="truncate">{f.name}</span>
                    {deck.folderId === f.id ? <span aria-hidden>✓</span> : null}
                  </button>
                ))}
              </div>
              {folders.length ? null : (
                <div className="mt-1 text-[10px] text-zinc-400">
                  No folders yet — add one in the rail on the left.
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this document?"
          message={`“${deck.title}” will move to Deleted items. You can restore it from there, or delete it for good.`}
          confirmLabel="Delete"
          onConfirm={confirmRemove}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  );
}
