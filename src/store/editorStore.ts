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
} from '@/model';
import { buildChartElements } from '@/templates/charts';
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

  // selection
  select: (ids: string[], additive?: boolean) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setEditing: (id: string | null) => void;
  setCurrentSlide: (id: string) => void;
  stepSlide: (delta: number) => void;
  setTitle: (title: string) => void;

  // element mutations (all commit unless transient)
  addElement: (el: SlideElement) => void;
  updateElement: (id: string, patch: Partial<SlideElement>, transient?: boolean) => void;
  setRect: (id: string, rect: Rect, transient?: boolean) => void;
  moveBy: (ids: string[], dx: EMU, dy: EMU, transient?: boolean) => void;
  duplicateBy: (ids: string[], dx: EMU, dy: EMU) => void;
  setFill: (ids: string[], fill: Fill) => void;
  setOutline: (ids: string[], outline: Outline | undefined) => void;
  patchRuns: (ids: string[], patch: Partial<TextRun>) => void;
  patchParagraphs: (ids: string[], patch: Partial<Omit<Paragraph, 'runs'>>) => void;
  deleteSelected: () => void;

  // format painter
  copyFormat: (id?: string) => void;
  pasteFormat: (ids?: string[]) => void;

  // arrangement
  align: (mode: AlignMode) => void;
  distribute: (axis: 'h' | 'v') => void;
  reorder: (dir: 'front' | 'back' | 'forward' | 'backward') => void;

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

function slideById(deck: Deck, id: string): Slide | undefined {
  return deck.slides.find((s) => s.id === id);
}

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

    currentSlide() {
      const { deck, currentSlideId } = get();
      return slideById(deck, currentSlideId) ?? deck.slides[0];
    },

    select(ids, additive = false) {
      set((s) => {
        s.selectedIds = additive
          ? Array.from(new Set([...s.selectedIds, ...ids]))
          : ids;
        if (!additive) s.editingId = null;
      });
    },

    toggleSelect(id) {
      set((s) => {
        s.selectedIds = s.selectedIds.includes(id)
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id];
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
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (slide) slide.elements.push(el);
        s.selectedIds = [el.id];
        s.deck.updatedAt = new Date(0).toISOString();
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

    duplicateBy(ids, dx, dy) {
      const slide = slideById(get().deck, get().currentSlideId);
      if (!slide?.elements.some((e) => ids.includes(e.id))) return;
      get().commit();
      const newIds: string[] = [];
      set((s) => {
        const sl = slideById(s.deck, s.currentSlideId);
        if (!sl) return;
        for (const el of sl.elements.filter((e) => ids.includes(e.id))) {
          const copy: SlideElement = JSON.parse(JSON.stringify(el));
          copy.id = `${el.id}-${nanoid(4)}`;
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

    align(mode) {
      const { selectedIds } = get();
      if (selectedIds.length < 2) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        const els = slide.elements.filter((e) => selectedIds.includes(e.id));
        const minX = Math.min(...els.map((e) => e.rect.x));
        const maxX = Math.max(...els.map((e) => e.rect.x + e.rect.w));
        const minY = Math.min(...els.map((e) => e.rect.y));
        const maxY = Math.max(...els.map((e) => e.rect.y + e.rect.h));
        for (const e of els) {
          switch (mode) {
            case 'left': e.rect.x = minX; break;
            case 'right': e.rect.x = maxX - e.rect.w; break;
            case 'hcenter': e.rect.x = (minX + maxX) / 2 - e.rect.w / 2; break;
            case 'top': e.rect.y = minY; break;
            case 'bottom': e.rect.y = maxY - e.rect.h; break;
            case 'vcenter': e.rect.y = (minY + maxY) / 2 - e.rect.h / 2; break;
          }
        }
      });
    },

    distribute(axis) {
      const { selectedIds } = get();
      if (selectedIds.length < 3) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        const els = slide.elements
          .filter((e) => selectedIds.includes(e.id))
          .sort((a, b) => (axis === 'h' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
        if (els.length < 3) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (axis === 'h') {
          const span = last.rect.x - first.rect.x;
          const step = span / (els.length - 1);
          els.forEach((e, i) => { e.rect.x = Math.round(first.rect.x + step * i); });
        } else {
          const span = last.rect.y - first.rect.y;
          const step = span / (els.length - 1);
          els.forEach((e, i) => { e.rect.y = Math.round(first.rect.y + step * i); });
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
