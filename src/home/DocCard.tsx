'use client';

/** Document card with a "..." menu: rename, tag, move to folder, copy link, delete. */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Deck } from '@/model';
import { renameDoc } from '@/docs/repository';
import type { DocFolder } from '@/docs/folders';
import { Thumb } from './Thumb';
import { DocMenu } from './DocMenu';
import { clientColor } from './clientColor';
import { timeAgo } from './timeAgo';

export function DocCard({
  deck,
  onChange,
  /** Folders offered by "Move to folder"; omitted where there's no rail. */
  folders = [],
}: {
  deck: Deck;
  onChange: () => void;
  folders?: DocFolder[];
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagSignal, setTagSignal] = useState(0);
  /** Where the last right-click landed, and how many there have been. */
  const [ctx, setCtx] = useState({ x: 0, y: 0, n: 0 });
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(deck.title);
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
    <div
      onClick={() => !renaming && router.push(`/edit/${deck.id}`)}
      // Dragged onto a folder row in the rail to file it. Suspended while the
      // title is being renamed, where a drag would fight text selection in the
      // input; the payload is just the document id (see `FolderRail`).
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/devindesign-doc', deck.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      // Right-clicking the card offers the same ••• menu at the pointer, so the
      // gesture works the same in either view. Left alone while renaming, where
      // the browser's own menu belongs to the input.
      onContextMenu={(e) => {
        if (renaming) return;
        e.preventDefault();
        setCtx((c) => ({ x: e.clientX, y: e.clientY, n: c.n + 1 }));
      }}
      // `z-20` while the menu is open, on the CARD and not just the menu: the
      // hover lift is a transform, which makes the hovered card a stacking
      // context — and an open menu means the pointer is on this card. That
      // traps the menu's own z-index inside the card, so the next row of cards
      // (later siblings, z-index auto) painted straight over the dropdown.
      // Lifting the whole card is what actually gets its subtree out in front.
      className={`group relative cursor-pointer rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 ${
        menuOpen ? 'z-20' : ''
      }`}
    >
      <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
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
                className="w-full rounded border border-indigo-300 bg-white px-1 py-0.5 text-sm font-medium outline-none dark:bg-zinc-800"
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {deck.title}
                </span>
                {tags.length ? (
                  <span className="flex shrink-0 gap-1">
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
                  // Untagged decks get the pill's slot as an affordance rather
                  // than nothing: tagging is the common next thing to do with a
                  // new deck, and it shouldn't need a trip through the ••• menu.
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setTagSignal((n) => n + 1);
                    }}
                    title="Tag with client"
                    className="shrink-0 rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-600 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
                  >
                    Tag +
                  </button>
                )}
              </div>
            )}
            <div className="mt-0.5 text-xs text-zinc-400">
              {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'} · Owner:{' '}
              <span className={deck.owner ? 'text-zinc-500 dark:text-zinc-300' : 'italic'}>
                {deck.owner ?? 'Unassigned'}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-400">
              Created {timeAgo(deck.createdAt)} · Last updated {timeAgo(deck.updatedAt)}
            </div>
          </div>

          <DocMenu
            deck={deck}
            onChange={onChange}
            onStartRename={() => setRenaming(true)}
            folders={folders}
            buttonClassName="opacity-0 group-hover:opacity-100"
            onOpenChange={setMenuOpen}
            openAt={ctx}
            tagSignal={tagSignal}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-b-lg [&>div]:!w-full">
        <Thumb deck={deck} />
      </div>

    </div>
  );
}
