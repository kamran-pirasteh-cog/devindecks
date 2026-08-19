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
import { getDoc, saveDoc, seedIfFirstRun as seedDocs } from '@/docs/repository';
import { getFolder } from '@/docs/folders';
import { getLastSlide, rememberLastSlide } from '@/docs/lastSlide';
import {
  getStoredTemplate,
  saveTemplateFromDeck,
  seedIfFirstRun as seedTemplates,
  templateAsDeck,
} from '@/templates/repository';
import { getStoredLayout, layoutAsDeck, saveLayoutFromSlide } from '@/templates/layoutRepository';
import { getActiveDesignSystem } from '@/design/repository';
import { FLAGS } from '@/flags';
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
import { clipboardAction } from './clipboardShortcut';
import { nextAnchor, nextParaAlign, textAlignEdge } from './textAlignShortcut';
import { reorderDirection } from './reorderShortcut';
import { NAV_KEYS, nextInDirection } from './spatialNav';
import { stickyTextTarget } from './sticky';
import { TemplateDrawer } from './TemplateDrawer';
import { ExportMenu } from './ExportMenu';
import { ComingSoonLink } from '@/ui/ComingSoon';

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

/** Matches the folder glyph on the dashboard rail, so the same folder reads the
 *  same in both places. */
function FolderCrumbIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
      <path
        d="M1.75 4.25c0-.55.45-1 1-1h3.1c.32 0 .62.15.81.4l.68.9h6.16c.55 0 1 .45 1 1v6.2c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-7.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const folderId = useEditor((s) => s.deck.folderId);
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
    // Templates first: a pending seed migration rebuilds seeded decks from the
    // stored templates, so those must be current before it runs. Both calls are
    // no-ops once the version matches — and the editor has to make them,
    // because reloading an `/edit/<id>` URL never passes through the dashboard,
    // which used to be the only place a migration could happen.
    seedTemplates();
    seedDocs();

    const doc: Deck | null = deckId ? getDoc(deckId) : SAMPLE_DECK;
    if (!doc) {
      router.replace('/');
      return;
    }
    // Land back on the slide you were last on in this document, so a refresh
    // doesn't throw you to slide 1.
    loadDeck(doc, getActiveDesignSystem(), deckId ? getLastSlide(deckId) : null);
  }, [deckId, templateId, layoutId, router]);

  // ...and keep that memory current as you move through the deck. Templates,
  // layouts and the bare sample have no document id, so they don't take part.
  useEffect(() => {
    if (!deckId || templateId || layoutId) return;
    return useEditor.subscribe((state, prev) => {
      if (state.currentSlideId !== prev.currentSlideId) {
        rememberLastSlide(deckId, state.currentSlideId);
      }
    });
  }, [deckId, templateId, layoutId]);

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
      const restack = reorderDirection(e);
      const clip = clipboardAction(e);
      /** Focus sits on a filmstrip thumbnail — see the clipboard branch below. */
      const inSlideStrip =
        e.target instanceof HTMLElement && !!e.target.closest('[data-slide-strip]');

      const slide = s.currentSlide();
      /**
       * The sticky to write on when a bare printable key is pressed: clicking a
       * note and typing is the whole gesture, with no double-click and no
       * hunting for which of the note's three parts holds the words.
       */
      const stickySeed =
        !mod && !e.altKey && e.key.length === 1
          ? stickyTextTarget(slide.elements, s.selectedIds)
          : undefined;
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
      } else if (clip && inSlideStrip && (clip === 'paste' ? s.slideClipboard : true)) {
        // The filmstrip owns the chord whenever the keyboard is in it — a
        // thumbnail keeps focus after the click that selected the slide — so
        // ⌘C there copies whole slides rather than whatever is on the canvas.
        e.preventDefault();
        if (clip === 'cut') s.cutSlides();
        else if (clip === 'copy') s.copySlides();
        else s.pasteSlides();
      } else if (clip && (clip === 'paste' ? s.clipboard : s.selectedIds.length)) {
        // Left unhandled when there's nothing to act on, so ⌘V with an empty
        // clipboard still reaches the browser rather than being swallowed here.
        e.preventDefault();
        if (clip === 'cut') s.cutSelection();
        else if (clip === 'copy') s.copySelection();
        else s.pasteClipboard();
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
      } else if (FLAGS.comments && isCommentShortcut(e)) {
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
      } else if (restack && s.selectedIds.length) {
        // The same four moves on ⌘[ / ⌘] — see `reorderShortcut.ts`.
        e.preventDefault();
        s.reorder(restack);
      } else if (
        e.altKey &&
        !mod &&
        !e.shiftKey &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        s.selectedIds.length
      ) {
        // PowerPoint's ⌥ + ←/→: the selection turns one step about its own
        // centre, snapping to the 22.5° grid. Ahead of the ⌥ walk below, which
        // keeps ↑/↓ (and both horizontals with nothing selected, so ⌥→ on an
        // empty slide still picks the first object).
        e.preventDefault();
        s.rotateBy(s.selectedIds, e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.altKey && !mod && !e.shiftKey && NAV_KEYS[e.key]) {
        // ⌥ + arrow walks the selection between objects instead of moving one,
        // the way arrows alone do in PowerPoint. ←/→ only reach here with
        // nothing selected — with a selection they rotate, above. Matched ahead
        // of both the nudge and the page-the-deck branches, which take bare
        // arrows. ⇧ is excluded so ⌥⇧ + arrow can reach the free resize below.
        e.preventDefault();
        const next = nextInDirection(slide.elements, s.selectedIds, NAV_KEYS[e.key]!);
        if (next) s.select(next);
      } else if (e.shiftKey && !mod && ARROWS[e.key] && s.selectedIds.length) {
        // PowerPoint's ⇧ + arrow: the selection grows and shrinks instead of
        // moving, top-left pinned, so → widens and ← narrows from the right
        // edge (↓ / ↑ likewise for height). Reached without ⌘ — the restack and
        // align chords carry ⇧ too and match above.
        //
        // A picture scales both sides together here (see `resizeBy`), because a
        // one-axis resize stretches the image inside it rather than reframing
        // it. Adding ⌥ asks for that stretch anyway, which is the only way to
        // change a picture's proportions from the keyboard.
        e.preventDefault();
        const [ax, ay] = ARROWS[e.key]!;
        s.resizeBy(s.selectedIds, ax * RESIZE_STEP, ay * RESIZE_STEP, { stretch: e.altKey });
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
      } else if (mod && e.shiftKey && !e.altKey && (e.code === 'KeyE' || key === 'e')) {
        // Ahead of ⌘E (align centre), which doesn't rule ⇧ out. Needs no
        // selection: an eyebrow belongs to the slide's title, not to whatever
        // happens to be picked.
        e.preventDefault();
        s.insertEyebrow();
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
        // PowerPoint's new-slide chord. Alt is ruled out here rather than
        // upstream, so the chord stays exclusive whether or not ⌘⌥M (comment)
        // is matched further up.
        e.preventDefault();
        s.addSlide();
      } else if (stickySeed) {
        // LAST, so every chord above still wins. The keystroke opens the editor
        // AND is the first character typed into it — `beginEditWith` carries it
        // across the mount.
        e.preventDefault();
        s.beginEditWith(stickySeed, e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return null;

  // Where this document lives, for the header crumb. Document folders are flat
  // (see `docs/folders.ts`), so the path is one level: the folder's name, or
  // "Unfiled" for a document that was never filed. Templates and layouts don't
  // live in folders at all, so they get no crumb.
  const folder = folderId ? getFolder(folderId) : null;
  const inFolders = !templateId && !layoutId;

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
          {inFolders ? (
            <>
              {/* The crumb doubles as the way back to that folder: the
                  dashboard reads `?folder=` and opens scoped to it. */}
              <Link
                href={folder ? `/?folder=${encodeURIComponent(folder.id)}` : '/'}
                title={folder ? `Open folder “${folder.name}”` : 'Open unfiled documents'}
                className="flex max-w-40 items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <FolderCrumbIcon />
                <span className="truncate">{folder ? folder.name : 'Unfiled'}</span>
              </Link>
              <span className="text-zinc-300">/</span>
            </>
          ) : null}
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
          {/* Blue text, left of Export: what's being built, one click away. */}
          <ComingSoonLink />
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
        {FLAGS.comments ? <CommentsPanel /> : null}
        <TemplateDrawer />
      </div>
    </div>
  );
}
