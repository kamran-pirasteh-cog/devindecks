'use client';

/** Document card with a "..." menu: rename, copy link, delete. */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Deck } from '@/model';
import { deleteDoc, renameDoc } from '@/docs/repository';
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

export function DocCard({ deck, onChange }: { deck: Deck; onChange: () => void }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(deck.title);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
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

  return (
    <div
      onClick={() => !renaming && router.push(`/edit/${deck.id}`)}
      className="group relative cursor-pointer rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="overflow-hidden rounded-t-lg border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
        <Thumb deck={deck} />
      </div>
      <div className="flex items-center justify-between px-3 py-2">
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
            <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
              {deck.title}
            </div>
          )}
          <div className="mt-0.5 text-[10px] text-zinc-400">
            {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'} · {timeAgo(deck.updatedAt)}
          </div>
        </div>

        <div className="relative ml-2 shrink-0" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="More"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 opacity-0 hover:bg-zinc-100 group-hover:opacity-100 dark:hover:bg-zinc-800"
          >
            •••
          </button>

          {menuOpen ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-7 z-10 w-36 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
            >
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
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
