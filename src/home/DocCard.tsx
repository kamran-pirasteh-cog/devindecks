'use client';

/** Document card with a "..." menu: rename, tag, copy link, delete. */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Deck } from '@/model';
import {
  addDocTag,
  deleteDoc,
  duplicateDoc,
  isTitleAvailable,
  removeDocTag,
  renameDoc,
  suggestCopyTitle,
} from '@/docs/repository';
import { Thumb } from './Thumb';

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

type MenuView = 'main' | 'tag' | 'duplicate';

export function DocCard({ deck, onChange }: { deck: Deck; onChange: () => void }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>('main');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(deck.title);
  const [copied, setCopied] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [dupName, setDupName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const dupInputRef = useRef<HTMLInputElement>(null);

  const tags = deck.tags ?? [];

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
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

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

  const commitRename = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== deck.title) renameDoc(deck.id, trimmed);
    else setTitle(deck.title);
    setRenaming(false);
    onChange();
  };

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
    deleteDoc(deck.id);
    setMenuOpen(false);
    onChange();
  };

  const commitTag = () => {
    if (tagInput.trim()) {
      addDocTag(deck.id, tagInput);
      setTagInput('');
      onChange();
    }
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

  return (
    <div
      onClick={() => !renaming && router.push(`/edit/${deck.id}`)}
      className="group relative cursor-pointer rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="overflow-hidden rounded-t-lg border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
        <Thumb deck={deck} />
      </div>
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            {renaming ? (
              <input
                ref={inputRef}
                value={title}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') {
                    setTitle(deck.title);
                    setRenaming(false);
                  }
                }}
                className="w-full rounded border border-indigo-300 bg-white px-1 py-0.5 text-xs font-medium outline-none dark:bg-zinc-800"
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                  {deck.title}
                </span>
                {tags.length ? (
                  <span className="flex shrink-0 gap-1">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            )}
            <div className="mt-0.5 text-[10px] text-zinc-400">
              {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-400">
              Created {timeAgo(deck.createdAt)} · Last updated {timeAgo(deck.updatedAt)}
            </div>
          </div>

          <div className="relative ml-2 shrink-0" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
                setMenuView('main');
              }}
              title="More"
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 opacity-0 hover:bg-zinc-100 group-hover:opacity-100 dark:hover:bg-zinc-800"
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
                        setRenaming(true);
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
                            className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                          >
                            {t}
                            <button
                              onClick={() => removeTag(t)}
                              className="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-100"
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
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
