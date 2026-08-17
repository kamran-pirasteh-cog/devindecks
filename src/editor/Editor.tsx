'use client';

/**
 * The split-screen shell: Devin chat (left) · slide navigator · canvas.
 * Loads a document by id from the repository, wires global keyboard shortcuts,
 * and autosaves. Everything below routes through the store command layer.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEditor, loadDeck, type AlignMode } from '@/store/editorStore';
import { SAMPLE_DECK } from '@/model/sample';
import { expandSelection, inchesToEmu, unionRect, type Deck } from '@/model';
import { getDoc, saveDoc } from '@/docs/repository';
import { getStoredTemplate, saveTemplateFromDeck, templateAsDeck } from '@/templates/repository';
import { getStoredLayout, layoutAsDeck, saveLayoutFromSlide } from '@/templates/layoutRepository';
import { getActiveDesignSystem } from '@/design/repository';
import { useComments } from '@/store/commentStore';
import { ChatColumn } from './ChatColumn';
import { CommentsPanel } from './CommentsPanel';
import { commentAnchorId } from './commentAnchor';
import { Filmstrip } from './Filmstrip';
import { Toolbar } from './Toolbar';
import { EditorCanvas } from './EditorCanvas';
import { fontSizeDirection } from './fontSizeShortcut';
import { formatPainterAction } from './formatShortcut';
import { isCommentShortcut } from './commentShortcut';
import { nextAnchor, nextParaAlign, textAlignEdge } from './textAlignShortcut';
import { NAV_KEYS, nextInDirection } from './spatialNav';
import { TemplateDrawer } from './TemplateDrawer';
import { ExportMenu } from './ExportMenu';

/**
 * Alignment rides the arrow keys: the direction you press is the edge things
 * move to. The plain arrows still nudge, so only a modified press aligns —
 * ⌘ (align to each other) or Ctrl (snap to the margin guides).
 *
 * Which of the two actually happens is decided by the SELECTION, not the
 * modifier: `align` measures against the margin frame when a single object is
 * selected and against the selection's own bounds when several are. So each
 * modifier does the documented thing in the case it's documented for, and the
 * sensible thing in the other.
 */
const ALIGN_KEYS: Record<string, AlignMode | undefined> = {
  ArrowUp: 'top',
  ArrowLeft: 'left',
  ArrowDown: 'bottom',
  ArrowRight: 'right',
};

/**
 * Unit vector per arrow, shared by the nudge and the ⇧ resize: the same
 * direction that moves a box one step also grows it by one step.
 */
const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

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
  /** Set when a save is refused (storage full) — the one failure the user must see. */
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Comments belong to a document, so templates, layouts and the bare sample
  // get an in-memory thread list that is never persisted.
  useEffect(() => {
    useComments.getState().load(deckId && !templateId && !layoutId ? deckId : null);
  }, [deckId, templateId, layoutId]);

  // Autosave: persist the deck (or template/layout) a beat after any change.
  useEffect(() => {
    if (!deckId && !templateId && !layoutId) return;
    const unsub = useEditor.subscribe((state, prev) => {
      if (state.deck === prev.deck) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const deck = useEditor.getState().deck;
        try {
          if (layoutId) saveLayoutFromSlide(layoutId, deck.slides[0], deck.title);
          else if (templateId) saveTemplateFromDeck(templateId, deck);
          else saveDoc(deck);
          setSaveError(null);
        } catch (err) {
          // Autosave runs on a timer, so a throw here has nowhere to go — it
          // would be an unhandled rejection and a deck that silently stops
          // saving. Say it in the header instead, and keep it said.
          setSaveError((err as Error).message);
        }
      }, 500);
    });
    return () => {
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [deckId, templateId, layoutId]);

  useEffect(() => {
    const NUDGE = inchesToEmu(0.083);
    /** One press of ⇧ + arrow, matched to the nudge so the two feel the same. */
    const RESIZE_STEP = NUDGE;
    /** Breathing room between an object and the copy that lands under it. */
    const DUP_GAP = inchesToEmu(0.1);

    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const typing =
        s.editingId ||
        // Crop mode owns the keyboard the way text editing does: Enter and
        // Escape belong to the overlay, and nudging or deleting the picture
        // out from under the handles is never what's meant.
        s.croppingId ||
        (e.target instanceof HTMLElement &&
          (e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.isContentEditable));
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // Matched ahead of the nudge branch, which otherwise swallows every arrow.
      const alignMode = mod && !e.altKey && !e.shiftKey ? ALIGN_KEYS[e.key] : undefined;
      const sizeDir = fontSizeDirection(e);
      const painter = formatPainterAction(e);
      const textEdge = textAlignEdge(e);

      const slide = s.currentSlide();
      // Every selected box the character shortcuts can act on. A group arrives
      // here as its members (`select` expands it), so a click on an imported
      // table selects a dozen of these at once.
      const textTargets = slide.elements.filter(
        (el) =>
          s.selectedIds.includes(el.id) && (el.type === 'text' || (el.type === 'shape' && el.body)),
      );
      /**
       * The run whose current values the shortcuts read: the first one in the
       * box, skipping paragraphs that carry no text. A blank opening line is
       * common in imported decks, and an empty cell often leads a table's
       * elements — reading `paragraphs[0].runs[0]` there finds nothing, which
       * used to leave the whole cluster of shortcuts inert.
       */
      const firstRunOf = (el: (typeof textTargets)[number]) =>
        (el.type === 'text' || el.type === 'shape' ? el.body : undefined)?.paragraphs.find(
          (p) => p.runs.length,
        )?.runs[0];
      const primary = textTargets.find(firstRunOf) ?? textTargets[0];
      const primaryBody =
        primary && (primary.type === 'text' || primary.type === 'shape') ? primary.body : undefined;
      // Undefined for a box with no text in it yet, so the branches below gate
      // on `primaryBody` — what the box could take — and fall back to the
      // theme's own size rather than doing nothing.
      const firstRun = primary && firstRunOf(primary);

      // Format painter first: its chords carry Alt/Shift, so they must not be
      // read as a plain mod+C/V by anything below.
      if (painter && s.selectedIds.length) {
        e.preventDefault();
        if (painter === 'copy') s.copyFormat();
        else s.pasteFormat();
      } else if (alignMode && s.selectedIds.length) {
        e.preventDefault();
        s.align(alignMode);
      } else if (textEdge && primaryBody) {
        // Ahead of the restack and nudge branches, both of which take arrows
        // with fewer modifiers and would otherwise swallow this chord.
        e.preventDefault();
        if (textEdge === 'left' || textEdge === 'right') {
          s.patchParagraphs(s.selectedIds, {
            align: nextParaAlign(textEdge, primaryBody.paragraphs[0]?.align),
          });
        } else {
          s.setAnchor(s.selectedIds, nextAnchor(textEdge, primaryBody.anchor));
        }
      } else if (isCommentShortcut(e)) {
        // Google Slides' insert-comment chord. With something selected the
        // thread pins to it — to whichever selected object carries the text the
        // commenter was reading; otherwise it's a comment on the slide itself.
        e.preventDefault();
        useComments
          .getState()
          .startDraft(
            s.currentSlideId,
            commentAnchorId(s.selectedIds, s.currentSlide().elements),
          );
      } else if (mod && !e.shiftKey && key === 'z') {
        e.preventDefault();
        s.undo();
      } else if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) {
        // Both redo chords: ⌘⇧Z is what every other editor on this machine
        // uses, and leaving it unbound made redo look broken half the time.
        e.preventDefault();
        s.redo();
      } else if (mod && e.altKey && (e.code === 'KeyG' || key === 'g' || key === '©')) {
        // ⌥ rewrites the character on macOS (⌥G arrives as "©"), so `code` is
        // the half of the match to trust.
        e.preventDefault();
        s.ungroup();
      } else if (mod && e.shiftKey && (e.code === 'KeyG' || key === 'g')) {
        e.preventDefault();
        s.toggleGuides();
      } else if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyG' || key === 'g')) {
        e.preventDefault();
        s.group();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedIds.length) {
          e.preventDefault();
          s.deleteSelected();
        }
      } else if (e.key === 'Escape') {
        // Escape climbs back out of a group before it clears: with one member
        // of a group selected it re-selects the whole group, as PowerPoint does.
        const grown = expandSelection(s.currentSlide().elements, s.selectedIds);
        if (s.selectedIds.length && grown.length > s.selectedIds.length) s.select(s.selectedIds);
        else s.clearSelection();
      } else if (
        mod &&
        e.altKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        s.selectedIds.length
      ) {
        // Restack rather than nudge: ⌘⌥↑/↓ walks the selection one step through
        // z-order, and ⇧ takes it all the way to the front or back.
        e.preventDefault();
        const up = e.key === 'ArrowUp';
        s.reorder(e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward');
      } else if (e.altKey && !mod && NAV_KEYS[e.key]) {
        // ⌥ + arrow walks the selection between objects instead of moving one,
        // the way arrows alone do in PowerPoint. Matched ahead of both the
        // nudge and the page-the-deck branches, which take bare arrows.
        e.preventDefault();
        const next = nextInDirection(slide.elements, s.selectedIds, NAV_KEYS[e.key]!);
        if (next) s.select(next);
      } else if (e.shiftKey && !mod && !e.altKey && ARROWS[e.key] && s.selectedIds.length) {
        // PowerPoint's ⇧ + arrow: the selection grows and shrinks instead of
        // moving, top-left pinned, so → widens and ← narrows from the right
        // edge (↓ / ↑ likewise for height). Reached only with no other
        // modifier — the restack and align chords carry ⇧ too and match above.
        e.preventDefault();
        const [ax, ay] = ARROWS[e.key]!;
        s.resizeBy(s.selectedIds, ax * RESIZE_STEP, ay * RESIZE_STEP);
      } else if (ARROWS[e.key] && s.selectedIds.length) {
        e.preventDefault();
        const [ax, ay] = ARROWS[e.key]!;
        s.moveBy(s.selectedIds, ax * NUDGE, ay * NUDGE);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Nothing selected, so the arrows page the deck instead of nudging.
        e.preventDefault();
        s.stepSlide(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        s.stepSlide(e.key === 'PageDown' ? 1 : -1);
      } else if (mod && key === 'b' && primaryBody) {
        e.preventDefault();
        s.patchRuns(s.selectedIds, { bold: !firstRun?.bold });
      } else if (mod && key === 'i' && primaryBody) {
        e.preventDefault();
        s.patchRuns(s.selectedIds, { italic: !firstRun?.italic });
      } else if (mod && key === 'u' && primaryBody) {
        e.preventDefault();
        s.patchRuns(s.selectedIds, { underline: !firstRun?.underline });
      } else if (mod && key === 'e' && primaryBody) {
        e.preventDefault();
        s.patchParagraphs(s.selectedIds, { align: 'center' });
      } else if (mod && key === 'r' && primaryBody) {
        e.preventDefault();
        s.patchParagraphs(s.selectedIds, { align: 'right' });
      } else if (mod && key === 'l' && primaryBody) {
        e.preventDefault();
        s.patchParagraphs(s.selectedIds, { align: 'left' });
      } else if (sizeDir && textTargets.length) {
        // Every selected box steps, each run from its own size — gated on the
        // targets rather than on `primaryBody` so a mixed selection (say a
        // chart and three labels, or an imported table's cells) still steps the
        // text it does hold.
        e.preventDefault();
        s.stepFontSize(
          textTargets.map((el) => el.id),
          sizeDir,
        );
      } else if (mod && !e.shiftKey && key === 'a') {
        e.preventDefault();
        s.select(slide.elements.map((el) => el.id));
      } else if (mod && !e.shiftKey && key === 'd' && s.selectedIds.length) {
        e.preventDefault();
        // The copy lands directly under the original, left edges lined up, so a
        // ⌘D-⌘D-⌘D run builds an evenly spaced stack instead of a staircase.
        const box = unionRect(slide.elements, expandSelection(slide.elements, s.selectedIds));
        if (box) s.duplicateBy(s.selectedIds, 0, box.h + DUP_GAP);
      } else if (mod && key === 's') {
        // Nothing to save — the deck persists as it changes. Swallowed so the
        // browser's save-page dialog never lands on top of the editor.
        e.preventDefault();
      } else if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyM' || key === 'm')) {
        // PowerPoint's new-slide chord. ⌘⌥M (comment) is matched further up, so
        // by here Alt is already ruled out.
        e.preventDefault();
        s.addSlide();
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
            {templateId || layoutId ? 'Admin' : 'Devin Decks'}
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
          {saveError ? (
            <span
              title={saveError}
              className="max-w-md truncate rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              Not saved — {saveError}
            </span>
          ) : null}
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
        <CommentsPanel />
        <TemplateDrawer />
      </div>
    </div>
  );
}
