'use client';

/**
 * The split-screen shell: Devin chat (left) · slide navigator · canvas · inspector.
 * Seeds the store with a deck and wires global keyboard shortcuts. Everything
 * below routes through the store command layer.
 */
import { useEffect } from 'react';
import { useEditor, loadDeck } from '@/store/editorStore';
import { SAMPLE_DECK } from '@/model/sample';
import type { Deck, DesignSystem } from '@/model';
import { downloadDeckPptx } from '@/export/pptx';
import { ChatColumn } from './ChatColumn';
import { Filmstrip } from './Filmstrip';
import { Toolbar } from './Toolbar';
import { EditorCanvas } from './EditorCanvas';

export function Editor({ deck = SAMPLE_DECK, designSystem }: { deck?: Deck; designSystem?: DesignSystem }) {
  const title = useEditor((s) => s.deck.title);
  const ds = useEditor((s) => s.designSystem);
  const ready = useEditor((s) => s.currentSlideId !== '');

  useEffect(() => {
    loadDeck(deck, designSystem);
  }, [deck, designSystem]);

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
          <span className="text-sm font-semibold tracking-tight">Devin Design</span>
          <span className="text-zinc-300">/</span>
          <span className="text-sm text-zinc-500">{title}</span>
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
