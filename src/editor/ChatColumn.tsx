'use client';

/**
 * The Devin chat column.
 *
 * Messages become tool calls against the SAME command layer the toolbar uses,
 * so Devin can only do what the UI can do — every edit it makes is undoable
 * with ⌘Z and autosaves like any other. The loop itself lives in
 * `src/chat/agent.ts`; this file is the panel around it.
 *
 * Collapsed by default so the canvas gets full width until you ask for help.
 */
import { useEffect, useRef, useState } from 'react';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgent, transcript, userTurn } from '@/chat/agent';
import { useResizableWidth } from './useResizableWidth';
import { ResizeHandle } from './ResizeHandle';

const RAIL_WIDTH = 40;

const SUGGESTIONS = [
  'Retitle this slide',
  'Line up the boxes on this slide',
  'Add a takeaway line at the bottom',
];

export function ChatColumn() {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<Anthropic.MessageParam[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { width, startDrag } = useResizableWidth(300, 240, 480, 'right');
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const items = transcript(messages);

  // Follow the conversation as it grows — including mid-turn, as tool calls land.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, busy]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // A turn in flight outlives a collapse (the edits still land), but not the
  // editor itself — leaving the page with a request open would apply tools to
  // a store nobody is looking at any more.
  useEffect(() => () => abort.current?.abort(), []);

  const send = async (text: string) => {
    const said = text.trim();
    if (!said || busy) return;
    setDraft('');
    setError(null);
    const next = [...messages, userTurn(said)];
    setMessages(next);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      setMessages(await runAgent(next, { onProgress: setMessages, signal: controller.signal }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      if (abort.current === controller) abort.current = null;
      setBusy(false);
    }
  };

  // The logo is the toggle in both states, so it stays one DOM node across the
  // open/close switch — that's what lets it rotate rather than swap.
  const onDragStart = (e: React.PointerEvent) => {
    setDragging(true);
    startDrag(e);
    const stop = () => {
      setDragging(false);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointerup', stop);
  };

  return (
    <div className="flex h-full shrink-0">
      <div
        style={{ width: open ? width : RAIL_WIDTH }}
        className={`flex h-full flex-col overflow-hidden border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${
          dragging ? '' : 'transition-[width] duration-300 ease-out'
        }`}
      >
        <div
          className={`flex items-center px-2 py-2.5 ${
            open
              ? 'justify-between border-b border-zinc-200 dark:border-zinc-800'
              : 'justify-center'
          }`}
        >
          {open && <span className="pl-1 text-sm font-medium">Devin</span>}
          <div className="flex items-center gap-1">
            {open && messages.length > 0 && !busy ? (
              <button
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
                title="Clear the conversation"
                className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              >
                Clear
              </button>
            ) : null}
            <button
              onClick={() => setOpen((v) => !v)}
              title={open ? 'Collapse' : 'Open Devin'}
              aria-expanded={open}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:opacity-80"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/devin-logo.svg"
                alt=""
                className={`h-6 w-6 transition-transform duration-300 ease-out dark:invert ${
                  open ? 'rotate-180' : 'rotate-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Fixed to the open width so the body doesn't reflow mid-animation. */}
        <div
          style={{ width }}
          className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
            {items.length === 0 ? (
              <>
                <div className="rounded-lg bg-zinc-100 p-3 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  I&apos;ll help you build and edit slides — add and restyle text, place shapes,
                  line things up, or reshuffle the deck. Everything I change is one ⌘Z away.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {items.map((item) =>
              item.kind === 'user' ? (
                <div
                  key={item.key}
                  className="ml-6 whitespace-pre-wrap rounded-lg bg-zinc-900 p-2.5 text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {item.text}
                </div>
              ) : item.kind === 'assistant' ? (
                <div
                  key={item.key}
                  className="whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  {item.text}
                </div>
              ) : (
                <div
                  key={item.key}
                  title={item.detail}
                  className={`flex items-center gap-1.5 pl-1 text-[11px] ${
                    item.failed ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'
                  }`}
                >
                  <span aria-hidden className="text-[9px]">
                    {item.failed ? '⚠' : '●'}
                  </span>
                  <span className="truncate">{item.label}</span>
                </div>
              ),
            )}

            {busy ? (
              <div className="flex items-center gap-1.5 pl-1 text-[11px] text-zinc-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
                Working…
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {error}
              </div>
            ) : null}
          </div>

          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
              <input
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Stopped here rather than bubbling: the editor's global
                  // shortcuts ignore typing, but Escape and the arrows belong
                  // to this field while it has focus.
                  e.stopPropagation();
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                disabled={busy}
                placeholder={busy ? 'Working…' : 'Ask Devin to make a change…'}
                className="flex-1 bg-transparent outline-none placeholder:text-zinc-400 disabled:text-zinc-400"
              />
              {busy ? (
                <button
                  onClick={() => abort.current?.abort()}
                  title="Stop"
                  className="text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Stop
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {open && <ResizeHandle onPointerDown={onDragStart} />}
    </div>
  );
}
