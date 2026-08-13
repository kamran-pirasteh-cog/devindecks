'use client';

/**
 * The editor store IS the command layer. Every mutation — whether triggered by
 * a toolbar button, a drag on the canvas, the inspector, or (later) Devin — goes
 * through one of these actions. That gives us free, coherent undo/redo and
 * guarantees the AI can never do anything the UI can't.
 *
 * History is snapshot-based: `commit()` clones the deck before a mutation so we
 * can step back. Transient drags call the mutating action with `transient=true`
 * to avoid flooding history, then commit once on drop.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';
import {
  DEFAULT_DESIGN_SYSTEM,
  EMU_PER_POINT,
  expandSelection,
  marginBox,
  marginGuides,
  outerGroupId,
  selectionUnits,
  unionRect,
  type BulletKind,
  type Deck,
  type DesignSystem,
  type EMU,
  type Fill,
  type Outline,
  type Paragraph,
  type Rect,
  type Slide,
  type SlideChartConfig,
  type SlideElement,
  type TextRun,
  type VerticalAnchor,
} from '@/model';
import { buildChartElements } from '@/templates/charts';
import { clampLevel } from '@/render/bullets';
import { applyFormat, extractFormat, type ElementFormat } from '@/editor/elementFormat';

export type AlignMode =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom';

/** PowerPoint's "increase/decrease font size" buttons step through this preset list. */
export const FONT_SIZE_STEPS = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96,
];

export function nextFontSize(current: number, dir: 'up' | 'down'): number {
  if (dir === 'up') {
    const next = FONT_SIZE_STEPS.find((n) => n > current);
    return next ?? current;
  }
  const prev = [...FONT_SIZE_STEPS].reverse().find((n) => n < current);
  return prev ?? current;
}

interface EditorState {
  deck: Deck;
  designSystem: DesignSystem;
  currentSlideId: string;
  selectedIds: string[];
  editingId: string | null;

  // slide (filmstrip) multi-selection
  selectedSlideIds: string[];
  slideSelectionAnchor: string | null;

  past: Deck[];
  future: Deck[];

  /**
   * Format painter buffer. Deliberately outside the deck: it's a scratch
   * register, not document state, so it survives undo and isn't autosaved.
   */
  formatClipboard: ElementFormat | null;

  /**
   * Whether the margin guides are painted on the canvas. View state, not deck
   * state: hiding the guides doesn't stop objects snapping to them, exactly as
   * PowerPoint's guides behave.
   */
  showGuides: boolean;

  /**
   * A just-inserted text box whose model rect is still the factory's default.
   * `autofit: 'resize'` means "the box is the text's size", but only the canvas
   * can measure type, so it does the fit as soon as the node exists and clears
   * this. Transient view state — never in the deck, never undone on its own.
   */
  pendingFitId: string | null;
  clearPendingFit: () => void;

  // selection
  /** Select these ids, grown so no group is ever half-selected. */
  select: (ids: string[], additive?: boolean) => void;
  /**
   * Select exactly these ids, group membership ignored — the "click again to
   * reach into a group" path. Everything else should use `select`.
   */
  selectExact: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setEditing: (id: string | null) => void;
  setCurrentSlide: (id: string) => void;
  stepSlide: (delta: number) => void;
  setTitle: (title: string) => void;
  toggleGuides: () => void;
  /** Turn deck-wide page numbers on or off. Deck state, so it's undoable. */
  togglePageNumbers: () => void;

  // element mutations (all commit unless transient)
  addElement: (el: SlideElement) => void;
  updateElement: (id: string, patch: Partial<SlideElement>, transient?: boolean) => void;
  setRect: (id: string, rect: Rect, transient?: boolean) => void;
  /** Commit several boxes at once (a group transform) as ONE history step. */
  setRects: (
    rects: { id: string; rect: Rect; rotation?: number }[],
    transient?: boolean,
  ) => void;
  moveBy: (ids: string[], dx: EMU, dy: EMU, transient?: boolean) => void;
  /**
   * Grow or shrink each box by the same amount, top-left pinned — the keyboard
   * counterpart to dragging the bottom-right handle.
   */
  resizeBy: (ids: string[], dw: EMU, dh: EMU, transient?: boolean) => void;
  duplicateBy: (ids: string[], dx: EMU, dy: EMU) => void;
  setFill: (ids: string[], fill: Fill) => void;
  /**
   * Fill opacity, 0..1. Separate from `setFill` so changing it doesn't have to
   * know each element's color: an unfilled box gains no fill from this.
   */
  setFillAlpha: (ids: string[], alpha: number) => void;
  setOutline: (ids: string[], outline: Outline | undefined) => void;
  patchRuns: (ids: string[], patch: Partial<TextRun>) => void;
  patchParagraphs: (ids: string[], patch: Partial<Omit<Paragraph, 'runs'>>) => void;
  /** Vertical anchor of the text inside its box (PowerPoint's bodyPr anchor). */
  setAnchor: (ids: string[], anchor: VerticalAnchor) => void;
  /** Turn a list style on for the selected boxes, or off if already on. */
  toggleBullet: (ids: string[], kind: BulletKind) => void;
  /** Nudge list indent level, clamped to the model's 0..4. */
  indentParagraphs: (ids: string[], delta: number) => void;
  deleteSelected: () => void;

  // format painter
  copyFormat: (id?: string) => void;
  pasteFormat: (ids?: string[]) => void;

  // arrangement
  align: (mode: AlignMode) => void;
  /**
   * Scale + shift the slide's content (or just the selection) as ONE block
   * until it sits inside the margin guides.
   */
  fitToMargins: () => void;
  distribute: (axis: 'h' | 'v') => void;
  matchSize: () => void;
  matchFormat: () => void;
  reorder: (dir: 'front' | 'back' | 'forward' | 'backward') => void;
  /** ⌘G — bind the selected objects into one group. */
  group: () => void;
  /** ⌘⇧G — release the outermost group of everything selected. */
  ungroup: () => void;

  // slides
  addSlide: () => void;
  insertSlides: (slides: Slide[]) => void;
  duplicateSlide: (id: string) => void;
  deleteSlide: (id: string) => void;
  updateSlideChart: (id: string, config: SlideChartConfig) => void;

  // slide multi-selection (filmstrip)
  selectSlideRange: (id: string) => void;
  deleteSlides: (ids: string[]) => void;
  moveSlides: (ids: string[], beforeId: string | null) => void;

  // history
  commit: () => void;
  undo: () => void;
  redo: () => void;

  // helpers
  currentSlide: () => Slide;
}

const HISTORY_LIMIT = 100;

/**
 * Floor for a keyboard resize, ~1/20". Shrinking stops here rather than
 * inverting the box, so holding the key down can't lose an object.
 */
const MIN_SIZE: EMU = EMU_PER_POINT * 3.6;

function slideById(deck: Deck, id: string): Slide | undefined {
  return deck.slides.find((s) => s.id === id);
}

/**
 * Roles that behave as the slide's title for layout purposes — the one line
 * that hangs off the top-left corner of the safe area. 'heading' counts: on a
 * content slide it IS the title, just a smaller type role.
 */
function isTitleRole(role: string | undefined): boolean {
  return role === 'title' || role === 'heading';
}

/** Selection split into groups-as-one-box + loose elements, with their bounds. */
function unitBoxes(state: EditorState, ids: string[]) {
  const els = slideById(state.deck, state.currentSlideId)?.elements ?? [];
  return selectionUnits(els, ids)
    .map((unit) => ({ ids: unit, r: unionRect(els, unit) }))
    .filter((b): b is { ids: string[]; r: NonNullable<typeof b.r> } => !!b.r);
}

/** Translate whole units — every member of a group moves by the same delta. */
const shiftUnits =
  (shifts: { ids: string[]; dx: number; dy: number }[]) => (s: EditorState) => {
    const slide = slideById(s.deck, s.currentSlideId);
    if (!slide) return;
    for (const { ids, dx, dy } of shifts) {
      if (!dx && !dy) continue;
      for (const el of slide.elements) {
        if (!ids.includes(el.id)) continue;
        el.rect.x += dx;
        el.rect.y += dy;
      }
    }
  };

export const useEditor = create<EditorState>()(
  immer((set, get) => ({
    deck: emptyDeck(),
    designSystem: DEFAULT_DESIGN_SYSTEM,
    currentSlideId: '',
    selectedIds: [],
    editingId: null,
    selectedSlideIds: [],
    slideSelectionAnchor: null,
    past: [],
    future: [],
    formatClipboard: null,
    showGuides: true,
    pendingFitId: null,

    clearPendingFit() {
      set((s) => {
        s.pendingFitId = null;
      });
    },

    toggleGuides() {
      set((s) => {
        s.showGuides = !s.showGuides;
      });
    },

    currentSlide() {
      const { deck, currentSlideId } = get();
      return slideById(deck, currentSlideId) ?? deck.slides[0];
    },

    /**
     * Grouping lives here rather than at the call sites: a group is only a
     * group if EVERY path into the selection — click, shift-click, marquee,
     * Devin — treats it as one object.
     */
    select(ids, additive = false) {
      set((s) => {
        const els = slideById(s.deck, s.currentSlideId)?.elements ?? [];
        const grown = expandSelection(els, ids);
        s.selectedIds = additive
          ? Array.from(new Set([...s.selectedIds, ...grown]))
          : grown;
        if (!additive) s.editingId = null;
      });
    },

    selectExact(ids) {
      set((s) => {
        s.selectedIds = ids;
        s.editingId = null;
      });
    },

    /** Shift-click: the whole group joins or leaves, never one member of it. */
    toggleSelect(id) {
      set((s) => {
        const els = slideById(s.deck, s.currentSlideId)?.elements ?? [];
        const unit = expandSelection(els, [id]);
        const on = unit.every((x) => s.selectedIds.includes(x));
        s.selectedIds = on
          ? s.selectedIds.filter((x) => !unit.includes(x))
          : [...s.selectedIds, ...unit.filter((x) => !s.selectedIds.includes(x))];
      });
    },

    clearSelection() {
      set((s) => {
        s.selectedIds = [];
        s.editingId = null;
      });
    },

    setEditing(id) {
      set((s) => {
        s.editingId = id;
        if (id && !s.selectedIds.includes(id)) s.selectedIds = [id];
      });
    },

    setCurrentSlide(id) {
      set((s) => {
        s.currentSlideId = id;
        s.selectedIds = [];
        s.editingId = null;
        s.selectedSlideIds = [id];
        s.slideSelectionAnchor = id;
      });
    },

    /** Move `delta` slides from the current one, clamped at both ends. */
    stepSlide(delta) {
      const { deck, currentSlideId, setCurrentSlide } = get();
      const i = deck.slides.findIndex((sl) => sl.id === currentSlideId);
      const next = deck.slides[i + delta];
      if (next) setCurrentSlide(next.id);
    },

    selectSlideRange(id) {
      set((s) => {
        const ids = s.deck.slides.map((sl) => sl.id);
        const anchor = s.slideSelectionAnchor ?? s.currentSlideId;
        const anchorIdx = ids.indexOf(anchor);
        const clickedIdx = ids.indexOf(id);
        if (anchorIdx < 0 || clickedIdx < 0) {
          s.selectedSlideIds = [id];
          s.slideSelectionAnchor = id;
          return;
        }
        const [lo, hi] = anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
        s.selectedSlideIds = ids.slice(lo, hi + 1);
        s.currentSlideId = id;
        s.selectedIds = [];
        s.editingId = null;
      });
    },

    /**
     * One flag for the whole deck — there is nothing to stamp onto individual
     * slides, because the numbers are derived at render time from each slide's
     * index (see `model/pageNumbers.ts`). That's what keeps them correct
     * through every insert, delete and reorder without a renumbering pass.
     */
    togglePageNumbers() {
      get().commit();
      set((s) => {
        s.deck.pageNumbers = !s.deck.pageNumbers;
      });
    },

    setTitle(title) {
      set((s) => {
        s.deck.title = title;
      });
    },

    addSlide() {
      get().commit();
      const id = `s-${nanoid(8)}`;
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => sl.id === s.currentSlideId);
        const slide: Slide = { id, elements: [] };
        s.deck.slides.splice(idx + 1, 0, slide);
        s.currentSlideId = id;
        s.selectedIds = [];
      });
    },

    insertSlides(slides) {
      get().commit();
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => sl.id === s.currentSlideId);
        s.deck.slides.splice(idx + 1, 0, ...slides);
        s.currentSlideId = slides[0]?.id ?? s.currentSlideId;
        s.selectedIds = [];
      });
    },

    updateSlideChart(id, config) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, id);
        if (!slide) return;
        slide.chart = config;
        slide.elements = buildChartElements(config);
        s.selectedIds = [];
      });
    },

    duplicateSlide(id) {
      get().commit();
      const newSlideId = `s-${nanoid(8)}`;
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => sl.id === id);
        if (idx < 0) return;
        const copy: Slide = JSON.parse(JSON.stringify(s.deck.slides[idx]));
        copy.id = newSlideId;
        copy.elements = copy.elements.map((e) => ({ ...e, id: `${e.id}-${nanoid(4)}` }));
        s.deck.slides.splice(idx + 1, 0, copy);
        s.currentSlideId = newSlideId;
        s.selectedIds = [];
      });
    },

    deleteSlide(id) {
      get().deleteSlides([id]);
    },

    deleteSlides(ids) {
      const idSet = new Set(ids);
      const { deck } = get();
      const remaining = deck.slides.filter((sl) => !idSet.has(sl.id));
      if (remaining.length === 0) return;
      get().commit();
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => idSet.has(sl.id));
        const wasCurrentDeleted = idSet.has(s.currentSlideId);
        s.deck.slides = s.deck.slides.filter((sl) => !idSet.has(sl.id));
        if (wasCurrentDeleted) {
          s.currentSlideId = s.deck.slides[Math.max(0, Math.min(idx, s.deck.slides.length - 1))].id;
        }
        s.selectedIds = [];
        s.selectedSlideIds = [];
        s.slideSelectionAnchor = null;
      });
    },

    moveSlides(ids, beforeId) {
      if (ids.length === 0) return;
      get().commit();
      set((s) => {
        const idSet = new Set(ids);
        const moved = s.deck.slides.filter((sl) => idSet.has(sl.id));
        if (moved.length === 0) return;
        const rest = s.deck.slides.filter((sl) => !idSet.has(sl.id));
        const insertAt = beforeId ? rest.findIndex((sl) => sl.id === beforeId) : -1;
        rest.splice(insertAt < 0 ? rest.length : insertAt, 0, ...moved);
        s.deck.slides = rest;
      });
    },

    commit() {
      set((s) => {
        s.past.push(JSON.parse(JSON.stringify(s.deck)));
        if (s.past.length > HISTORY_LIMIT) s.past.shift();
        s.future = [];
      });
    },

    addElement(el) {
      get().commit();
      const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (slide) slide.elements.push(el);
        s.selectedIds = [el.id];
        s.deck.updatedAt = new Date(0).toISOString();
        // A text box arrives at a nominal size; the canvas measures the type and
        // shrinks it onto the text, so the selection you land on hugs it.
        s.pendingFitId = body?.autofit === 'resize' ? el.id : null;
      });
    },

    updateElement(id, patch, transient = false) {
      if (!transient) get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const el = slide?.elements.find((e) => e.id === id);
        if (el) Object.assign(el, patch);
      });
    },

    setRect(id, rect, transient = false) {
      if (!transient) get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const el = slide?.elements.find((e) => e.id === id);
        if (el) el.rect = rect;
      });
    },

    /**
     * Many boxes in one commit, so a group resize or rotate is a single undo
     * step. `rotation` is optional because a resize leaves angles alone.
     */
    setRects(rects, transient = false) {
      if (!rects.length) return;
      if (!transient) get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const { id, rect, rotation } of rects) {
          const el = slide.elements.find((e) => e.id === id);
          if (!el) continue;
          el.rect = rect;
          if (rotation !== undefined) el.rotation = rotation;
        }
      });
    },

    moveBy(ids, dx, dy, transient = false) {
      if (!transient) get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (ids.includes(el.id)) {
            el.rect.x += dx;
            el.rect.y += dy;
          }
        }
      });
    },

    resizeBy(ids, dw, dh, transient = false) {
      if (!transient) get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          el.rect.w = Math.max(MIN_SIZE, el.rect.w + dw);
          el.rect.h = Math.max(MIN_SIZE, el.rect.h + dh);
        }
      });
    },

    duplicateBy(ids, dx, dy) {
      const slide = slideById(get().deck, get().currentSlideId);
      if (!slide?.elements.some((e) => ids.includes(e.id))) return;
      get().commit();
      const newIds: string[] = [];
      // Copies of a group form their OWN group: same shape, new ids, so
      // ungrouping or dragging the copy can't reach back into the original.
      const gidMap = new Map<string, string>();
      const remapGid = (g: string) => {
        const next = gidMap.get(g) ?? `g-${nanoid(8)}`;
        gidMap.set(g, next);
        return next;
      };
      set((s) => {
        const sl = slideById(s.deck, s.currentSlideId);
        if (!sl) return;
        for (const el of sl.elements.filter((e) => ids.includes(e.id))) {
          const copy: SlideElement = JSON.parse(JSON.stringify(el));
          copy.id = `${el.id}-${nanoid(4)}`;
          if (copy.groupIds) copy.groupIds = copy.groupIds.map(remapGid);
          copy.rect = { ...copy.rect, x: copy.rect.x + dx, y: copy.rect.y + dy };
          sl.elements.push(copy);
          newIds.push(copy.id);
        }
        s.selectedIds = newIds;
      });
    },

    setFill(ids, fill) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (ids.includes(el.id) && (el.type === 'text' || el.type === 'shape')) {
            el.fill = fill;
          }
        }
      });
    },

    setFillAlpha(ids, alpha) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          if (el.type !== 'text' && el.type !== 'shape') continue;
          if (el.fill?.kind !== 'solid') continue;
          el.fill = { ...el.fill, alpha };
        }
      });
    },

    setOutline(ids, outline) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          if (el.type === 'line') {
            if (outline) el.outline = outline;
          } else if (el.type === 'text' || el.type === 'shape' || el.type === 'picture') {
            el.outline = outline;
          }
        }
      });
    },

    patchRuns(ids, patch) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          const body = el.type === 'text' ? el.body : el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          for (const p of body.paragraphs) {
            for (const r of p.runs) Object.assign(r, patch);
          }
        }
      });
    },

    patchParagraphs(ids, patch) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          const body = el.type === 'text' ? el.body : el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          for (const p of body.paragraphs) Object.assign(p, patch);
        }
      });
    },

    setAnchor(ids, anchor) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          body.anchor = anchor;
        }
      });
    },

    /**
     * PowerPoint's bullet/numbering buttons: pressing the one a box already
     * uses clears it, pressing the other switches list style. "Already uses"
     * means every paragraph in every targeted box, so a box with a mixed or
     * plain body turns fully into a list on the first press.
     */
    toggleBullet(ids, kind) {
      const slide = slideById(get().deck, get().currentSlideId);
      const bodies =
        slide?.elements
          .filter((el) => ids.includes(el.id))
          .map((el) => (el.type === 'text' || el.type === 'shape' ? el.body : undefined))
          .filter((b): b is NonNullable<typeof b> => !!b) ?? [];
      const paras = bodies.flatMap((b) => b.paragraphs);
      if (!paras.length) return;
      const allOn = paras.every((p) => p.bullet === kind);
      get().patchParagraphs(ids, { bullet: allOn ? 'none' : kind });
    },

    indentParagraphs(ids, delta) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          for (const p of body.paragraphs) p.level = clampLevel((p.level ?? 0) + delta);
        }
      });
    },

    /**
     * Pick up the formatting of one element. Defaults to the first selected
     * element (PowerPoint samples a single source, never a mixed selection).
     */
    copyFormat(id) {
      const s = get();
      const sourceId = id ?? s.selectedIds[0];
      if (!sourceId) return;
      const el = slideById(s.deck, s.currentSlideId)?.elements.find((e) => e.id === sourceId);
      if (!el) return;
      set((d) => {
        d.formatClipboard = extractFormat(el);
      });
    },

    /** Stamp the buffered formatting onto every selected element. */
    pasteFormat(ids) {
      const s = get();
      const fmt = s.formatClipboard;
      const targets = ids ?? s.selectedIds;
      if (!fmt || targets.length === 0) return;
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide?.elements.some((e) => targets.includes(e.id))) return;
      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        for (const el of sl.elements) {
          if (targets.includes(el.id)) applyFormat(el, fmt);
        }
      });
    },

    deleteSelected() {
      const { selectedIds } = get();
      if (selectedIds.length === 0) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (slide) slide.elements = slide.elements.filter((e) => !selectedIds.includes(e.id));
        s.selectedIds = [];
        s.editingId = null;
      });
    },

    /**
     * Aligns SELECTION UNITS, not elements: a group is one box that slides
     * bodily to the edge, exactly as PowerPoint treats it. For a selection with
     * no groups in it this is the old element-wise behaviour unchanged.
     *
     * The edge modes ESCALATE: the mode names a DIRECTION OF TRAVEL, and each
     * press slides the selection to the next line it meets going that way.
     *
     *   1. objects not yet flush → line them up on their own outermost edge
     *   2. flush (a single object always is) → travel to the next stop: a margin
     *      guide, the content-top guide, or the slide edge, whichever comes first
     *   3. …repeat, one line per press, until there is nothing further that way,
     *      where it stops dead rather than cycling
     *
     * A stop counts when EITHER edge of the selection can land on it — an object
     * overhanging the left guide moves right onto that guide (its left edge),
     * and keeps going to the right guide (its right edge) and then the paper's
     * right edge. A single object also stops centred on the slide, passing
     * through the middle on its way across. Moves that would carry the selection
     * off the slide are not offered, which is what makes the walk terminate.
     *
     * Every step past the first moves the whole selection by ONE shift (they
     * share the edge by then), so the layout inside it survives the trip.
     *
     * The centre modes have nowhere to escalate to: they centre on the selection
     * with several units and on the margin frame with one.
     */
    align(mode) {
      const s = get();
      const { selectedIds } = s;
      const boxes = unitBoxes(s, selectedIds);
      if (boxes.length === 0) return;
      const frame = marginBox(s.deck.slideSize);

      if (mode === 'hcenter' || mode === 'vcenter') {
        const single = boxes.length === 1;
        const lo = mode === 'hcenter'
          ? (single ? frame.x : Math.min(...boxes.map((b) => b.r.x)))
          : (single ? frame.y : Math.min(...boxes.map((b) => b.r.y)));
        const hi = mode === 'hcenter'
          ? (single ? frame.x + frame.w : Math.max(...boxes.map((b) => b.r.x + b.r.w)))
          : (single ? frame.y + frame.h : Math.max(...boxes.map((b) => b.r.y + b.r.h)));
        const centre = (lo + hi) / 2;
        get().commit();
        set(shiftUnits(boxes.map((b) => {
          const d = mode === 'hcenter'
            ? centre - b.r.w / 2 - b.r.x
            : centre - b.r.h / 2 - b.r.y;
          return mode === 'hcenter' ? { ids: b.ids, dx: d, dy: 0 } : { ids: b.ids, dx: 0, dy: d };
        })));
        return;
      }

      /** Half a point — under this two edges are the same edge to any eye. */
      const EPS = EMU_PER_POINT / 2;
      const horizontal = mode === 'left' || mode === 'right';
      /** −1 travels toward the top-left corner, +1 toward the bottom-right. */
      const dir = mode === 'left' || mode === 'top' ? -1 : 1;
      const edgeOf = (r: Rect) =>
        mode === 'left' ? r.x : mode === 'right' ? r.x + r.w : mode === 'top' ? r.y : r.y + r.h;
      const shift = (d: number) =>
        boxes.map((b) => (horizontal ? { ids: b.ids, dx: d, dy: 0 } : { ids: b.ids, dx: 0, dy: d }));

      // Step 1: pull the selection flush before it starts travelling.
      const edges = boxes.map((b) => edgeOf(b.r));
      if (Math.max(...edges) - Math.min(...edges) > EPS) {
        const target = dir < 0 ? Math.min(...edges) : Math.max(...edges);
        get().commit();
        set(shiftUnits(boxes.map((b) => {
          const d = target - edgeOf(b.r);
          return horizontal ? { ids: b.ids, dx: d, dy: 0 } : { ids: b.ids, dx: 0, dy: d };
        })));
        return;
      }

      // Steps 2+: the lines the selection can come to rest on, in this axis.
      //
      // Every line has a SIDE — the side its content belongs on — and takes the
      // selection edge that lands it there: the left guide and the paper's left
      // edge take the left edge, the right guide and right paper edge take the
      // right, and going down the page the top and content-top guides take the
      // top edge while the bottom guide takes the bottom. Without that, both
      // edges would want each line and the selection would stop on every guide
      // twice, once hanging off each side of it.
      //
      // The slide's centre line is a stop too, met by the object's own centre —
      // but only for a single object, where "centred" is unambiguous. With
      // several units selected the chord is about their shared edge, and a
      // centre stop would slide the block off that reading.
      const guides = marginGuides(s.deck.slideSize);
      const size = horizontal ? s.deck.slideSize.w : s.deck.slideSize.h;
      const lines = horizontal ? guides.vertical : guides.horizontal;
      type Stop = { at: number; on: 'lo' | 'hi' | 'centre' };
      const stops: Stop[] = [
        { at: 0, on: 'lo' },
        // The last guide on each axis (right / bottom) closes the frame; the
        // ones before it (left, and top + content-top) open it.
        ...lines.map((at, i): Stop => ({ at, on: i < lines.length - 1 ? 'lo' : 'hi' })),
        { at: size, on: 'hi' },
        ...(boxes.length === 1 ? [{ at: size / 2, on: 'centre' } as Stop] : []),
      ];

      const lo = Math.min(...boxes.map((b) => (horizontal ? b.r.x : b.r.y)));
      const hi = Math.max(...boxes.map((b) => (horizontal ? b.r.x + b.r.w : b.r.y + b.r.h)));
      // Anything bigger than the slide can never sit inside it, so it is exempt
      // from the containment rule — otherwise it could never move at all.
      const oversized = hi - lo > size;

      let best: number | null = null;
      for (const stop of stops) {
        const from = stop.on === 'lo' ? lo : stop.on === 'hi' ? hi : (lo + hi) / 2;
        const d = stop.at - from;
        if (d * dir <= EPS) continue; // not a move, or not the way we're going
        if (!oversized && (lo + d < -EPS || hi + d > size + EPS)) continue;
        if (best === null || Math.abs(d) < Math.abs(best)) best = d;
      }
      if (best === null) return; // nothing further that way — stay put

      get().commit();
      set(shiftUnits(shift(best)));
    },

    /**
     * PowerPoint has no equivalent: one press pulls everything that overhangs
     * back inside the safe area. Deliberately ONE uniform transform over the
     * whole content bounding box rather than per-object clamping — relative
     * positions, gaps and alignments survive, so a laid-out slide stays laid
     * out and only its overall size/position changes.
     *
     * Two rules, because a title and the body it heads want different things:
     *
     * - Titles park in the top-left corner of the safe area — top edge on the
     *   top guide, left edge on the left guide. A title is the one object on
     *   the slide whose position is a brand rule, not a layout choice.
     * - Everything else is scaled as ONE block until it spans the left AND
     *   right guides exactly — the body column always measures the full text
     *   width — and shrunk vertically only if it overhangs top or bottom.
     *
     * Scaling the body as one block rather than clamping objects one by one
     * keeps relative positions, gaps and alignments intact, so a laid-out
     * slide stays laid out and only its overall size changes. Horizontally
     * this stretches as well as shrinks (the block must REACH both guides);
     * vertically it only ever shrinks, so a short slide isn't smeared down
     * the page.
     *
     * Geometry only: font sizes are left alone, exactly like dragging a
     * group's handle.
     */
    fitToMargins() {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide?.elements.length) return;
      // A selection means "fit these"; otherwise the whole slide.
      const ids = s.selectedIds.length
        ? expandSelection(slide.elements, s.selectedIds)
        : slide.elements.map((e) => e.id);
      const inScope = new Set(ids);

      const frame = marginBox(s.deck.slideSize);
      if (frame.w <= 0 || frame.h <= 0) return;
      const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

      // A grouped title moves with its group, not on its own — pulling one
      // member into the corner would tear the group apart.
      const titleIds = new Set(
        slide.elements
          .filter((e) => inScope.has(e.id) && isTitleRole(e.role) && !e.groupIds?.length)
          .map((e) => e.id),
      );
      const bodyIds = ids.filter((id) => !titleIds.has(id));
      const box = unionRect(slide.elements, bodyIds);

      // Body: span the guides horizontally, shrink to fit vertically.
      let sx = 1;
      let sy = 1;
      let x = box?.x ?? 0;
      let y = box?.y ?? 0;
      if (box && box.w > 0 && box.h > 0) {
        sx = frame.w / box.w;
        sy = Math.min(1, frame.h / box.h);
        x = frame.x;
        y = clamp(box.y + box.h / 2 - (box.h * sy) / 2, frame.y, frame.y + frame.h - box.h * sy);
      }

      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        for (const el of sl.elements) {
          if (titleIds.has(el.id)) {
            // Never let a title hang past the right guide either.
            el.rect = {
              x: frame.x,
              y: frame.y,
              w: Math.min(el.rect.w, frame.w),
              h: el.rect.h,
            };
          } else if (box && inScope.has(el.id)) {
            el.rect = {
              x: Math.round(x + (el.rect.x - box.x) * sx),
              y: Math.round(y + (el.rect.y - box.y) * sy),
              w: Math.round(el.rect.w * sx),
              h: Math.round(el.rect.h * sy),
            };
          }
        }
      });
    },

    distribute(axis) {
      const { selectedIds } = get();
      const boxes = unitBoxes(get(), selectedIds).sort((a, b) =>
        axis === 'h' ? a.r.x - b.r.x : a.r.y - b.r.y,
      );
      if (boxes.length < 3) return;
      const at = (b: (typeof boxes)[number]) => (axis === 'h' ? b.r.x : b.r.y);
      const start = at(boxes[0]);
      const step = (at(boxes[boxes.length - 1]) - start) / (boxes.length - 1);
      const shifts = boxes.map((b, i) => {
        const delta = Math.round(start + step * i) - at(b);
        return { ids: b.ids, dx: axis === 'h' ? delta : 0, dy: axis === 'h' ? 0 : delta };
      });
      get().commit();
      set(shiftUnits(shifts));
    },

    group() {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide) return;
      const ids = expandSelection(slide.elements, s.selectedIds);
      if (selectionUnits(slide.elements, ids).length < 2) return;
      const gid = `g-${nanoid(8)}`;
      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        const sel = new Set(ids);
        for (const el of sl.elements) {
          if (sel.has(el.id)) el.groupIds = [gid, ...(el.groupIds ?? [])];
        }
        // PowerPoint also makes the members contiguous in z-order, stacked at
        // the depth of the topmost one — otherwise "bring to front" on the
        // group would be the only way to stop other objects sitting inside it.
        const top = sl.elements.reduce((acc, el, i) => (sel.has(el.id) ? i : acc), -1);
        const moved = sl.elements.filter((el) => sel.has(el.id));
        const rest = sl.elements.filter((el) => !sel.has(el.id));
        rest.splice(Math.max(0, top - moved.length + 1), 0, ...moved);
        sl.elements = rest;
        d.selectedIds = moved.map((el) => el.id);
        d.editingId = null;
      });
    },

    /**
     * Releases one level only — the outermost group of whatever is selected —
     * so ungrouping a group of groups leaves the inner ones intact, and the
     * freed objects stay selected ready to be regrouped or moved.
     */
    ungroup() {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide) return;
      const gids = new Set<string>();
      for (const el of slide.elements) {
        if (!s.selectedIds.includes(el.id)) continue;
        const gid = outerGroupId(el);
        if (gid) gids.add(gid);
      }
      if (!gids.size) return;
      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        const freed: string[] = [];
        for (const el of sl.elements) {
          const gid = outerGroupId(el);
          if (!gid || !gids.has(gid)) continue;
          const rest = el.groupIds!.slice(1);
          if (rest.length) el.groupIds = rest;
          else delete el.groupIds;
          freed.push(el.id);
        }
        d.selectedIds = Array.from(new Set([...d.selectedIds, ...freed]));
      });
    },

    /**
     * PowerPoint's Arrange > Size: every other selected object takes the
     * reference object's width AND height. The reference is the first object in
     * the selection — the same rule the format painter follows.
     */
    matchSize() {
      const { selectedIds } = get();
      if (selectedIds.length < 2) return;
      const ref = slideById(get().deck, get().currentSlideId)?.elements.find(
        (e) => e.id === selectedIds[0],
      );
      if (!ref) return;
      const { w, h } = ref.rect;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (el.id === ref.id || !selectedIds.includes(el.id)) continue;
          el.rect.w = w;
          el.rect.h = h;
        }
      });
    },

    /**
     * Stamp the first selected object's formatting onto the rest — the format
     * painter without the two-step, for when the source is already in the
     * selection. Deliberately does NOT touch `formatClipboard`: the painter's
     * buffer is the user's, and picking up a format here would silently
     * overwrite whatever they had loaded.
     */
    matchFormat() {
      const { selectedIds } = get();
      if (selectedIds.length < 2) return;
      const ref = slideById(get().deck, get().currentSlideId)?.elements.find(
        (e) => e.id === selectedIds[0],
      );
      if (!ref) return;
      const fmt = extractFormat(ref);
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (el.id === ref.id || !selectedIds.includes(el.id)) continue;
          applyFormat(el, fmt);
        }
      });
    },

    reorder(dir) {
      const { selectedIds } = get();
      if (selectedIds.length === 0) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        const arr = slide.elements;
        const sel = new Set(selectedIds);
        if (dir === 'front') {
          const moved = arr.filter((e) => sel.has(e.id));
          slide.elements = [...arr.filter((e) => !sel.has(e.id)), ...moved];
        } else if (dir === 'back') {
          const moved = arr.filter((e) => sel.has(e.id));
          slide.elements = [...moved, ...arr.filter((e) => !sel.has(e.id))];
        } else if (dir === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) {
              [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
            }
          }
        } else if (dir === 'backward') {
          for (let i = 1; i < arr.length; i++) {
            if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) {
              [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
            }
          }
        }
      });
    },

    undo() {
      set((s) => {
        const prev = s.past.pop();
        if (!prev) return;
        s.future.push(JSON.parse(JSON.stringify(s.deck)));
        s.deck = prev;
        s.selectedIds = [];
        s.editingId = null;
        s.selectedSlideIds = [];
        s.slideSelectionAnchor = null;
      });
    },

    redo() {
      set((s) => {
        const next = s.future.pop();
        if (!next) return;
        s.past.push(JSON.parse(JSON.stringify(s.deck)));
        s.deck = next;
        s.selectedIds = [];
        s.editingId = null;
        s.selectedSlideIds = [];
        s.slideSelectionAnchor = null;
      });
    },
  })),
);

function emptyDeck(): Deck {
  return {
    id: 'deck-empty',
    title: 'Untitled',
    slideSize: { w: 12_192_000, h: 6_858_000 },
    slides: [{ id: 's1', elements: [] }],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** Seed the store with a deck (e.g. the sample or an imported one). */
export function loadDeck(deck: Deck, ds?: DesignSystem) {
  useEditor.setState((s) => ({
    ...s,
    deck,
    designSystem: ds ?? s.designSystem,
    currentSlideId: deck.slides[0]?.id ?? '',
    selectedIds: [],
    editingId: null,
    selectedSlideIds: [],
    slideSelectionAnchor: null,
    past: [],
    future: [],
  }));
}

/** Factory for a new element id. */
export const newId = (prefix = 'el') => `${prefix}-${nanoid(8)}`;
