'use client';

/**
 * The split-screen shell: Devin chat (left) · slide navigator · canvas.
 * Loads a document by id from the repository, wires global keyboard shortcuts,
 * and autosaves. Everything below routes through the store command layer.
 */
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEditor, loadDeck } from '@/store/editorStore';
import { SAMPLE_DECK } from '@/model/sample';
import type { Deck } from '@/model';
import { downloadDeckPptx } from '@/export/pptx';
import { getDoc, saveDoc } from '@/docs/repository';
import { getActiveDesignSystem } from '@/design/repository';
import { ChatColumn } from './ChatColumn';
import { Filmstrip } from './Filmstrip';
import { Toolbar } from './Toolbar';
import { EditorCanvas } from './EditorCanvas';

export function Editor({ deckId }: { deckId?: string }) {
  const router = useRouter();
  const title = useEditor((s) => s.deck.title);
  const ds = useEditor((s) => s.designSystem);
  const ready = useEditor((s) => s.currentSlideId !== '');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the requested document (or the sample when opened without an id).
  useEffect(() => {
    const doc: Deck | null = deckId ? getDoc(deckId) : SAMPLE_DECK;
    if (!doc) {
      router.replace('/');
      return;
    }
    loadDeck(doc, getActiveDesignSystem());
  }, [deckId, router]);

  // Autosave: persist the deck a beat after any change (only for real docs).
  useEffect(() => {
    if (!deckId) return;
    const unsub = useEditor.subscribe((state, prev) => {
      if (state.deck === prev.deck) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveDoc(useEditor.getState().deck), 500);
    });
    return () => {
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [deckId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const typing =
        s.editingId ||
        (e.target instanceof HTMLElement &&
          (e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.isContentEditable));
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedIds.length) {
          e.preventDefault();
          s.deleteSelected();
        }
      } else if (e.key === 'Escape') {
        s.clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight hover:opacity-70"
            title="Back to documents"
          >
            Devin Design
          </Link>
          <span className="text-zinc-300">/</span>
          <input
            value={title}
            onChange={(e) => useEditor.getState().setTitle(e.target.value)}
            className="w-64 rounded bg-transparent px-1 py-0.5 text-sm text-zinc-600 outline-none hover:bg-zinc-100 focus:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-400">
            {ds.name} · v{ds.version}
          </span>
          <button
            onClick={() => {
              const s = useEditor.getState();
              downloadDeckPptx(s.deck, s.designSystem);
            }}
            className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
            title="Export to .pptx"
          >
            Export .pptx
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="w-[300px] shrink-0">
          <ChatColumn />
        </div>
        <div className="w-[196px] shrink-0">
          <Filmstrip />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Toolbar />
          <EditorCanvas />
        </div>
      </div>
    </div>
  );
}
