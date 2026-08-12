'use client';

/**
 * The split-screen shell: Devin chat (left) · slide navigator · canvas.
 * Loads a document by id from the repository, wires global keyboard shortcuts,
 * and autosaves. Everything below routes through the store command layer.
 */
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEditor, loadDeck, nextFontSize } from '@/store/editorStore';
import { SAMPLE_DECK } from '@/model/sample';
import { inchesToEmu, type Deck } from '@/model';
import { getDoc, saveDoc } from '@/docs/repository';
import { getStoredTemplate, saveTemplateFromDeck, templateAsDeck } from '@/templates/repository';
import { getStoredLayout, layoutAsDeck, saveLayoutFromSlide } from '@/templates/layoutRepository';
import { getActiveDesignSystem } from '@/design/repository';
import { ChatColumn } from './ChatColumn';
import { Filmstrip } from './Filmstrip';
import { Toolbar } from './Toolbar';
import { EditorCanvas } from './EditorCanvas';
import { fontSizeDirection } from './fontSizeShortcut';
import { TemplateDrawer } from './TemplateDrawer';
import { ExportMenu } from './ExportMenu';

export function Editor({
  deckId,
  templateId,
  layoutId,
}: {
  deckId?: string;
  templateId?: string;
  layoutId?: string;
}) {
  const router = useRouter();
  const title = useEditor((s) => s.deck.title);
  const ds = useEditor((s) => s.designSystem);
  const ready = useEditor((s) => s.currentSlideId !== '');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the requested document, template, layout, or the sample when opened bare.
  useEffect(() => {
    if (layoutId) {
      const l = getStoredLayout(layoutId);
      if (!l) {
        router.replace('/admin');
        return;
      }
      loadDeck(layoutAsDeck(l), getActiveDesignSystem());
      return;
    }
    if (templateId) {
      const tpl = getStoredTemplate(templateId);
      if (!tpl) {
        router.replace('/admin');
        return;
      }
      loadDeck(templateAsDeck(tpl), getActiveDesignSystem());
      return;
    }
    const doc: Deck | null = deckId ? getDoc(deckId) : SAMPLE_DECK;
    if (!doc) {
      router.replace('/');
      return;
    }
    loadDeck(doc, getActiveDesignSystem());
  }, [deckId, templateId, layoutId, router]);

  // Autosave: persist the deck (or template/layout) a beat after any change.
  useEffect(() => {
    if (!deckId && !templateId && !layoutId) return;
    const unsub = useEditor.subscribe((state, prev) => {
      if (state.deck === prev.deck) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const deck = useEditor.getState().deck;
        if (layoutId) saveLayoutFromSlide(layoutId, deck.slides[0], deck.title);
        else if (templateId) saveTemplateFromDeck(templateId, deck);
        else saveDoc(deck);
      }, 500);
    });
    return () => {
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [deckId, templateId, layoutId]);

  useEffect(() => {
    const NUDGE = inchesToEmu(0.083);
    const NUDGE_LARGE = NUDGE * 10;

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
      const key = e.key.toLowerCase();
      const sizeDir = fontSizeDirection(e);

      const slide = s.currentSlide();
      const primary = slide.elements.find(
        (el) => s.selectedIds.includes(el.id) && (el.type === 'text' || (el.type === 'shape' && el.body)),
      );
      const firstRun =
        primary && (primary.type === 'text' || (primary.type === 'shape' && primary.body))
          ? primary.body?.paragraphs[0]?.runs[0]
          : undefined;

      if (mod && key === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedIds.length) {
          e.preventDefault();
          s.deleteSelected();
        }
      } else if (e.key === 'Escape') {
        s.clearSelection();
      } else if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        s.selectedIds.length
      ) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE : NUDGE;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        s.moveBy(s.selectedIds, dx, dy);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Nothing selected, so the arrows page the deck instead of nudging.
        e.preventDefault();
        s.stepSlide(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        s.stepSlide(e.key === 'PageDown' ? 1 : -1);
      } else if (mod && key === 'b' && firstRun) {
        e.preventDefault();
        s.patchRuns(s.selectedIds, { bold: !firstRun.bold });
      } else if (mod && key === 'i' && firstRun) {
        e.preventDefault();
        s.patchRuns(s.selectedIds, { italic: !firstRun.italic });
      } else if (mod && key === 'u' && firstRun) {
        e.preventDefault();
        s.patchRuns(s.selectedIds, { underline: !firstRun.underline });
      } else if (mod && key === 'e' && firstRun) {
        e.preventDefault();
        s.patchParagraphs(s.selectedIds, { align: 'center' });
      } else if (mod && key === 'r' && firstRun) {
        e.preventDefault();
        s.patchParagraphs(s.selectedIds, { align: 'right' });
      } else if (mod && key === 'l' && firstRun) {
        e.preventDefault();
        s.patchParagraphs(s.selectedIds, { align: 'left' });
      } else if (sizeDir && firstRun) {
        e.preventDefault();
        s.patchRuns(s.selectedIds, {
          sizePt: nextFontSize(firstRun.sizePt ?? s.designSystem.type.body.sizePt, sizeDir),
        });
      } else if (mod && key === 'w' && s.selectedIds.length >= 2) {
        e.preventDefault();
        s.align('top');
      } else if (mod && key === 'a' && s.selectedIds.length >= 2) {
        e.preventDefault();
        s.align('left');
      } else if (mod && key === 'd' && s.selectedIds.length >= 2) {
        e.preventDefault();
        s.align('right');
      } else if (mod && key === 's' && s.selectedIds.length >= 2) {
        e.preventDefault();
        s.align('bottom');
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
            href={templateId || layoutId ? '/admin' : '/'}
            className="text-sm font-semibold tracking-tight hover:opacity-70"
            title={templateId || layoutId ? 'Back to Admin' : 'Back to documents'}
          >
            {templateId || layoutId ? 'Admin' : 'Deckmaker'}
          </Link>
          <span className="text-zinc-300">/</span>
          {layoutId ? (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
              Editing layout
            </span>
          ) : templateId ? (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
              Editing template
            </span>
          ) : null}
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
          <ExportMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ChatColumn />
        <Filmstrip singleSlide={!!layoutId} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Toolbar />
          <EditorCanvas />
        </div>
        <TemplateDrawer />
      </div>
    </div>
  );
}
