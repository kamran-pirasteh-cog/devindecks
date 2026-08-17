'use client';

/**
 * Single-slide layout repository. Mirrors `repository.ts` (the deck-template
 * store) at slide granularity: individual layouts persisted (localStorage
 * today) so Admin can create, upload and edit them, bucketed by category, the
 * same way the RHS drawer buckets `SLIDE_LAYOUTS`. On first run we seed
 * storage from that built-in registry so the existing layouts show up
 * pre-populated and editable.
 */
import { nanoid } from 'nanoid';
import { SLIDE_16x9, type Deck, type PictureElement, type Slide } from '@/model';
import {
  BUILTIN_LAYOUT_IDS,
  LAYOUT_CATEGORY_MOVES,
  RETIRED_LAYOUT_IDS,
  SLIDE_LAYOUTS,
  type SlideLayoutCategory,
} from './registry';

const KEY = 'devindesign.layouts.v1';
const SEED_KEY = 'devindesign.layouts.seeded.v1';

/**
 * Bumping this re-seeds the built-in layouts. v2 replaced the four original
 * buckets (Title / Section / KPI / Blank) with the SmartArt-style families;
 * v3 replaced their hand-authored contents with exact slides lifted from the
 * three reference decks.
 */
const LAYOUT_SEED_VERSION = 3;

export interface StoredLayout {
  id: string;
  name: string;
  category: SlideLayoutCategory;
  slide: Slide;
  createdAt: string;
  updatedAt: string;
}

type LayoutMap = Record<string, StoredLayout>;

function read(): LayoutMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as LayoutMap;
  } catch {
    return {};
  }
}

function write(map: LayoutMap) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

const now = () => new Date().toISOString();

/** Give a slide's elements fresh ids so inserting/duplicating never collides. */
function freshIds(slide: Slide): Slide {
  return {
    ...slide,
    id: `s-${nanoid(8)}`,
    elements: slide.elements.map((e) => ({ ...e, id: `${e.type}-${nanoid(6)}` })),
  };
}

/**
 * Seed the store from the built-in registry, once per seed version.
 *
 * A bump rebuilds the BUILT-IN layouts and leaves everything else alone. That
 * split is the whole point: built-ins are ours to restyle, and a layout Admin
 * authored or uploaded is not, so it survives untouched — with only its
 * category re-bucketed if the family it sat in was renamed.
 */
export function seedLayoutsIfFirstRun(): void {
  if (typeof window === 'undefined') return;
  const stamp = window.localStorage.getItem(SEED_KEY);
  // v1 wrote the bare string '1' before this was versioned.
  if (Number(stamp) === LAYOUT_SEED_VERSION) return;
  window.localStorage.setItem(SEED_KEY, String(LAYOUT_SEED_VERSION));

  const map = read();
  for (const id of RETIRED_LAYOUT_IDS) delete map[id];
  const builtin = new Set(BUILTIN_LAYOUT_IDS);
  for (const l of Object.values(map)) {
    if (builtin.has(l.id)) continue;
    const moved = LAYOUT_CATEGORY_MOVES[l.category];
    if (moved) map[l.id] = { ...l, category: moved, updatedAt: now() };
  }
  for (const l of SLIDE_LAYOUTS) {
    const ts = now();
    map[l.id] = {
      id: l.id,
      name: l.name,
      category: l.layout,
      slide: l.buildSlide(),
      createdAt: map[l.id]?.createdAt ?? ts,
      updatedAt: ts,
    };
  }
  write(map);
}

/**
 * Built-ins in registry order, then anything Admin added, alphabetically.
 * Registry order is authored — within a family the plainest layout comes
 * first — and alphabetizing it would shuffle that into nonsense.
 */
export function listLayouts(): StoredLayout[] {
  const rank = new Map(BUILTIN_LAYOUT_IDS.map((id, i) => [id, i]));
  return Object.values(read()).sort(
    (a, b) =>
      (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.name.localeCompare(b.name),
  );
}

export function getStoredLayout(id: string): StoredLayout | null {
  return read()[id] ?? null;
}

/** Resolve a layout's slide for insertion, with fresh element ids each time. */
export function getLayoutSlide(id: string): Slide | null {
  const l = getStoredLayout(id);
  return l ? freshIds(l.slide) : null;
}

export function createLayout(opts: { name: string; category: SlideLayoutCategory; slide?: Slide }): StoredLayout {
  const map = read();
  const ts = now();
  const l: StoredLayout = {
    id: `lay-${nanoid(8)}`,
    name: opts.name,
    category: opts.category,
    slide: opts.slide ?? { id: `s-${nanoid(8)}`, elements: [] },
    createdAt: ts,
    updatedAt: ts,
  };
  map[l.id] = l;
  write(map);
  return l;
}

export function updateLayoutMeta(
  id: string,
  patch: Partial<Pick<StoredLayout, 'name' | 'category'>>,
): void {
  const map = read();
  if (!map[id]) return;
  map[id] = { ...map[id], ...patch, updatedAt: now() };
  write(map);
}

/** Persist slide edits made in the editor back onto a layout. */
export function saveLayoutFromSlide(id: string, slide: Slide, name?: string): void {
  const map = read();
  if (!map[id]) return;
  map[id] = { ...map[id], slide, name: name ?? map[id].name, updatedAt: now() };
  write(map);
}

export function duplicateLayout(id: string, name?: string): StoredLayout | null {
  const src = getStoredLayout(id);
  if (!src) return null;
  const ts = now();
  const l: StoredLayout = {
    ...structuredClone(src),
    id: `lay-${nanoid(8)}`,
    name: name?.trim() || `Copy of ${src.name}`,
    slide: freshIds(src.slide),
    createdAt: ts,
    updatedAt: ts,
  };
  const map = read();
  map[l.id] = l;
  write(map);
  return l;
}

/** Seed a new layout from an uploaded reference image (a full-bleed picture, editable after). */
export function createLayoutFromImage(dataUrl: string, name: string): StoredLayout {
  const picture: PictureElement = {
    id: `picture-${nanoid(6)}`,
    type: 'picture',
    rect: { x: 0, y: 0, w: SLIDE_16x9.w, h: SLIDE_16x9.h },
    src: dataUrl,
  };
  return createLayout({
    name,
    category: 'Blank',
    slide: { id: `s-${nanoid(8)}`, elements: [picture] },
  });
}

export function deleteLayout(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}

/** Wrap a stored layout's single slide as a 1-slide Deck so it can be edited. */
export function layoutAsDeck(l: StoredLayout): Deck {
  return {
    id: `lay-doc-${l.id}`,
    title: l.name,
    slideSize: { w: SLIDE_16x9.w, h: SLIDE_16x9.h },
    slides: [l.slide],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}
