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
 *
 * It is also the CONTEXT menu for a document: both views right-click into this
 * same panel through `openAt`, so the file-explorer gesture offers exactly the
 * actions the ••• button does and can't fall behind them.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Deck } from '@/model';
import {
  addDocTag,
  deleteDoc,
  duplicateDoc,
  isTitleAvailable,
  removeDocTag,
  restoreDoc,
  setDocFolder,
  suggestCopyTitle,
} from '@/docs/repository';
import type { DocFolder } from '@/docs/folders';
import { ConfirmDialog } from './ConfirmDialog';
import { clientColor } from './clientColor';
import { useToast } from '@/ui/Toast';

type MenuView = 'main' | 'tag' | 'duplicate' | 'folder';

/**
 * The panel's own size, for keeping a right-click-opened menu on screen: `w-72`
 * exactly, and the tallest the main view gets (six items and a rule).
 */
const MENU_W = 288;
const MENU_H = 230;

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
  openAt,
  tagSignal = 0,
}: {
  deck: Deck;
  onChange: () => void;
  onStartRename: () => void;
  folders?: DocFolder[];
  buttonClassName?: string;
  onOpenChange?: (open: boolean) => void;
  /**
   * A request to open the menu AT A POINT — the right-click both views hand
   * down, in client coordinates. `n` is bumped per press for the same reason
   * `tagSignal` is a counter: right-clicking a second row (or the same one
   * again) has to reach the effect even when the point hasn't changed.
   */
  openAt?: { x: number; y: number; n: number };
  /**
   * Bumped by the "Tag +" affordance both views put beside an untagged title:
   * it opens this menu straight on the tag panel. A counter rather than a
   * boolean, so a second press after closing the menu reaches it again — the
   * same reason the dashboard's "New report" signal is one.
   */
  tagSignal?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [dupName, setDupName] = useState('');
  /**
   * Where the panel sits when a right-click opened it, as an offset from the
   * ••• button's box — the anchor it is positioned against. Null means the
   * ordinary "hanging under the button" placement.
   *
   * An offset rather than `position: fixed` at the client point, because a card
   * lifts itself on hover (`hover:-translate-y-0.5`) and a transformed ancestor
   * is what `fixed` would then be measured from. Absolute inside the anchor is
   * measured in the same space the cursor was read in, so the two agree.
   */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const dupInputRef = useRef<HTMLInputElement>(null);

  const tags = deck.tags ?? [];

  // Skipped on the first render: the initial value isn't a request to open.
  useEffect(() => {
    if (tagSignal > 0) {
      setMenuOpen(true);
      setMenuView('tag');
      // Under the button, wherever the last right-click was: `at` is only read
      // while the menu is open, so it's cleared on the way IN rather than out.
      setAt(null);
    }
  }, [tagSignal]);

  // Right-click: same panel, opened at the pointer. Clamped to the viewport so
  // a note-sized menu asked for near the bottom right of the shelf doesn't open
  // off the edge of it.
  useEffect(() => {
    if (!openAt || openAt.n <= 0) return;
    const box = menuRef.current?.getBoundingClientRect();
    const x = Math.max(8, Math.min(openAt.x, window.innerWidth - MENU_W - 8));
    const y = Math.max(8, Math.min(openAt.y, window.innerHeight - MENU_H - 8));
    setAt(box ? { left: x - box.left, top: y - box.top } : null);
    setMenuView('main');
    setMenuOpen(true);
    // Only the counter: the same point pressed twice still has to reopen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt?.n]);

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
    // Escape closes it, which a menu opened by right-click needs more than one
    // opened by a button: the pointer is already somewhere in the middle of the
    // shelf, with no obvious empty space to click.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      setMenuView('main');
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
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
    // Recoverable, so the toast says so with a button rather than a sentence
    // about where to find Deleted items.
    toast(`“${deck.title}” moved to Deleted.`, {
      action: {
        label: 'Undo',
        run: () => {
          restoreDoc(deck.id);
          onChange();
        },
      },
    });
  };

  // Enter closes the menu: the tag is in, and the next thing you want is the
  // shelf — usually to search or filter by the client you just typed.
  const commitTag = () => {
    if (!tagInput.trim()) return;
    const tag = tagInput.trim();
    addDocTag(deck.id, tagInput);
    // Worth saying because the menu closes on Enter: the pill it added is on a
    // card or row that may well have scrolled, sorted or filtered out from
    // under the cursor by the time the menu is gone.
    toast(`Tagged “${deck.title}” as ${tag}.`);
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
    const copy = duplicateDoc(deck.id, dupTrimmed);
    setMenuOpen(false);
    setMenuView('main');
    onChange();
    // Duplicating from the menu deliberately stays on the dashboard, so the
    // copy is somewhere in the shelf behind the toast — "Open" saves hunting
    // for it under whatever sort is in effect.
    if (copy) {
      toast(`Duplicated as “${copy.title}”.`, {
        action: { label: 'Open', run: () => router.push(`/edit/${copy.id}`) },
      });
    }
  };

  const moveTo = (folderId: string | undefined) => {
    const from = deck.folderId;
    if (from === folderId) {
      setMenuOpen(false);
      setMenuView('main');
      return;
    }
    setDocFolder(deck.id, folderId);
    setMenuOpen(false);
    setMenuView('main');
    onChange();
    const name = folders.find((f) => f.id === folderId)?.name;
    // Filing is the action most in need of a confirmation: inside a folder view
    // the document leaves the screen entirely, and nothing else says where it
    // went.
    toast(
      name ? `Moved “${deck.title}” to ${name}.` : `Removed “${deck.title}” from its folder.`,
      {
        action: {
          label: 'Undo',
          run: () => {
            setDocFolder(deck.id, from);
            onChange();
          },
        },
      },
    );
  };

  return (
    <>
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
          setMenuView('main');
          setAt(null);
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
          // A right-click opens the panel where the pointer is; the button opens
          // it hanging under the button.
          style={at ? { left: at.left, top: at.top } : undefined}
          className={`absolute z-10 w-72 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800 ${
            at ? '' : 'right-0 top-7'
          }`}
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
