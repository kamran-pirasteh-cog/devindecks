'use client';

/**
 * Documents as a table — the file-explorer list, and what the Thumbnails switch
 * turns the grid into when previews are off. Same shelf, same actions, sorted by
 * the same toolbar; only the row is different.
 *
 * A real `<table>` rather than a grid of divs, because that's what this is: the
 * header names the columns for anyone reading it with a screen reader, and the
 * columns line their text up down the page without every row having to agree on
 * a pixel width.
 *
 * Rows are draggable onto the rail's folders, carrying the same
 * `text/devindesign-doc` payload the cards do, so filing works identically in
 * either view.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Deck } from '@/model';
import { renameDoc } from '@/docs/repository';
import type { DocFolder } from '@/docs/folders';
import { DocMenu } from './DocMenu';
import { clientColor } from './clientColor';
import { timeAgo } from './timeAgo';

function SlidesIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
      <rect
        x="2.25"
        y="3.25"
        width="11.5"
        height="8"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d="M6 13.25h4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function Row({
  deck,
  folders,
  onChange,
}: {
  deck: Deck;
  folders: DocFolder[];
  onChange: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(deck.title);
  const [tagSignal, setTagSignal] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tags = deck.tags ?? [];

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

  return (
    <tr
      onClick={() => !renaming && router.push(`/edit/${deck.id}`)}
      // Suspended while renaming, where a drag would fight text selection in
      // the input — the same rule the card follows.
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/devindesign-doc', deck.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`group cursor-pointer border-b border-zinc-100 last:border-0 dark:border-zinc-800/70 ${
        menuOpen ? 'bg-zinc-50 dark:bg-zinc-800/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
      }`}
    >
      <td className="w-full max-w-0 py-2 pl-3 pr-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-zinc-300 dark:text-zinc-600">
            <SlidesIcon />
          </span>
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
              className="w-full min-w-0 rounded border border-indigo-300 bg-white px-1 py-0.5 text-sm outline-none dark:bg-zinc-800"
            />
          ) : (
            <span className="truncate text-sm text-zinc-800 dark:text-zinc-100">{deck.title}</span>
          )}
        </div>
      </td>

      <td className="py-2 pr-3">
        {tags.length ? (
          <span className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className={`rounded-full px-2 py-0.5 text-[11px] ${clientColor(t).pill}`}
              >
                {t}
              </span>
            ))}
          </span>
        ) : (
          // The same affordance the card offers, for the same reason: tagging is
          // the common next thing to do, and it shouldn't need the ••• menu.
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTagSignal((n) => n + 1);
            }}
            title="Tag with client"
            className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-600 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
          >
            Tag +
          </button>
        )}
      </td>

      <td className="py-2 pr-3 text-xs whitespace-nowrap">
        <span className={deck.owner ? 'text-zinc-500 dark:text-zinc-300' : 'italic text-zinc-400'}>
          {deck.owner ?? 'Unassigned'}
        </span>
      </td>

      <td className="py-2 pr-3 text-right text-xs tabular-nums whitespace-nowrap text-zinc-400">
        {deck.slides.length}
      </td>

      <td className="py-2 pr-3 text-xs whitespace-nowrap text-zinc-400">
        {timeAgo(deck.updatedAt)}
      </td>

      {/* The menu's dropdown is absolutely positioned inside a row that has no
          stacking context of its own, so the cell provides one — otherwise later
          rows paint over the open menu. */}
      <td className="relative w-8 py-2 pr-2 align-middle">
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DocMenu
            deck={deck}
            onChange={onChange}
            onStartRename={() => setRenaming(true)}
            folders={folders}
            buttonClassName="opacity-0 group-hover:opacity-100"
            onOpenChange={setMenuOpen}
            tagSignal={tagSignal}
          />
        </div>
      </td>
    </tr>
  );
}

export function DocTable({
  docs,
  folders,
  onChange,
}: {
  docs: Deck[];
  folders: DocFolder[];
  onChange: () => void;
}) {
  // The wrapper is NOT a scroll container: `overflow` of any kind clips the row
  // menus, which hang below their row and outside the table box. The table
  // shrinks instead — every column but Name is a short nowrap value, and Name
  // truncates — so there was nothing here that needed scrolling. The header's
  // own corners are rounded to sit inside the border, which is the one thing
  // `overflow-hidden` had been doing for us.
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 [&>th:first-child]:rounded-tl-lg [&>th:last-child]:rounded-tr-lg text-[11px] font-medium whitespace-nowrap uppercase tracking-wide text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/60">
            <th className="w-full py-1.5 pl-3 pr-3 font-medium">Name</th>
            <th className="py-1.5 pr-3 font-medium">Client</th>
            <th className="py-1.5 pr-3 font-medium">Owner</th>
            <th className="py-1.5 pr-3 text-right font-medium">Slides</th>
            <th className="py-1.5 pr-3 font-medium">Last updated</th>
            <th className="w-8 pr-2" />
          </tr>
        </thead>
        <tbody>
          {docs.map((deck) => (
            <Row key={deck.id} deck={deck} folders={folders} onChange={onChange} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
