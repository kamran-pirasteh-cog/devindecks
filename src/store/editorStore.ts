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
  type SlideElement,
  type TextRun,
} from '@/model';

export type AlignMode =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom';

interface EditorState {
  deck: Deck;
  designSystem: DesignSystem;
  currentSlideId: string;
  selectedIds: string[];
  editingId: string | null;

  past: Deck[];
  future: Deck[];

  // selection
  select: (ids: string[], additive?: boolean) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setEditing: (id: string | null) => void;
  setCurrentSlide: (id: string) => void;
  setTitle: (title: string) => void;

  // element mutations (all commit unless transient)
  addElement: (el: SlideElement) => void;
  updateElement: (id: string, patch: Partial<SlideElement>, transient?: boolean) => void;
  setRect: (id: string, rect: Rect, transient?: boolean) => void;
  moveBy: (ids: string[], dx: EMU, dy: EMU, transient?: boolean) => void;
  setFill: (ids: string[], fill: Fill) => void;
  setOutline: (ids: string[], outline: Outline | undefined) => void;
  patchRuns: (ids: string[], patch: Partial<TextRun>) => void;
  patchParagraphs: (ids: string[], patch: Partial<Omit<Paragraph, 'runs'>>) => void;
  deleteSelected: () => void;

  // arrangement
  align: (mode: AlignMode) => void;
  distribute: (axis: 'h' | 'v') => void;
  reorder: (dir: 'front' | 'back' | 'forward' | 'backward') => void;

  // slides
  addSlide: () => void;
  duplicateSlide: (id: string) => void;
  deleteSlide: (id: string) => void;

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
    past: [],
    future: [],

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
      if (get().deck.slides.length <= 1) return;
      get().commit();
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => sl.id === id);
        s.deck.slides = s.deck.slides.filter((sl) => sl.id !== id);
        if (s.currentSlideId === id) {
          s.currentSlideId = s.deck.slides[Math.max(0, idx - 1)].id;
        }
        s.selectedIds = [];
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
    past: [],
    future: [],
  }));
}

/** Factory for a new element id. */
export const newId = (prefix = 'el') => `${prefix}-${nanoid(8)}`;
