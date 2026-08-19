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
  SLIDE_LAYOUT_CATEGORIES,
} from './registry';
import { stampLayoutProvenance } from './provenance';
import { defineCollection } from '@/platform/collection';
import { localStorageAdapter } from '@/platform/store';

const KEY = 'devindesign.layouts.v1';
const SEED_KEY = 'devindesign.layouts.seeded.v1';
const FOLDERS_KEY = 'devindesign.layoutFolders.v1';

/**
 * Bumping this re-seeds the built-in layouts. v2 replaced the four original
 * buckets (Title / Section / KPI / Blank) with the SmartArt-style families;
 * v3 replaced their hand-authored contents with exact slides lifted from the
 * three reference decks.
 */
const LAYOUT_SEED_VERSION = 3;

/**
 * A folder is one of the built-in families or a name Admin typed, so this is
 * just a string — `SlideLayoutCategory` stays the type for the built-in set.
 */
export type LayoutFolder = string;

export interface StoredLayout {
  id: string;
  name: string;
  category: LayoutFolder;
  slide: Slide;
  /**
   * Bumped whenever the SLIDE changes, and never for a rename or a move
   * between folders. Slides made from this layout compare against it to spot
   * that their master has moved (`templates/provenance.ts`), and being
   * told a deck is out of date because someone fixed a typo in a layout's
   * name would train everyone to ignore the signal.
   */
  version: number;
  createdAt: string;
  updatedAt: string;
}

type LayoutMap = Record<string, StoredLayout>;

const collection = defineCollection<StoredLayout>(KEY, localStorageAdapter, {
  migrate: (map) => {
    // Layouts stored before versioning have no `version`. Treat them as v1
    // rather than NaN-comparing forever: a slide made from one also has no
    // `layoutVersion`, so both sides normalize to the same answer and nothing
    // reads as spuriously stale.
    for (const l of Object.values(map)) if (typeof l.version !== 'number') l.version = 1;
    return map;
  },
});

/** Hydrate from the adapter — only needed once that adapter is a remote one. */
export const hydrateLayouts = () => collection.hydrate();
export const subscribeLayouts = collection.subscribe;

const read = (): LayoutMap => collection.snapshot();
const write = (map: LayoutMap) => collection.replace(map);

const now = () => new Date().toISOString();

function readFolders(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(FOLDERS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Folders Admin created, alphabetically. Any folder a layout was filed under is
 * included even if the folder record is gone, so no layout can end up homeless.
 */
export function listCustomFolders(): string[] {
  const known = new Set(SLIDE_LAYOUT_CATEGORIES as string[]);
  const out = new Set<string>();
  for (const f of readFolders()) if (!known.has(f)) out.add(f);
  for (const l of Object.values(read())) if (!known.has(l.category)) out.add(l.category);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Built-in families in authored order, then Admin's own folders. */
export function listFolders(): string[] {
  return [...SLIDE_LAYOUT_CATEGORIES, ...listCustomFolders()];
}

/**
 * Create a folder, or return the existing one it collides with (matched
 * case-insensitively, so "Case study" and "case study" stay one folder).
 */
export function addCustomFolder(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = listFolders().find((f) => f.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FOLDERS_KEY, JSON.stringify([...readFolders(), trimmed]));
  }
  return trimmed;
}

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
      // A reseed rewrites the slide, so it IS a content change and has to
      // bump — otherwise decks holding the old copy would never learn the
      // built-in they came from was restyled underneath them.
      version: (map[l.id]?.version ?? 0) + 1,
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

/**
 * Resolve a layout's slide for insertion, with fresh element ids each time and
 * provenance stamped on so the copy can be traced back to this master later.
 */
export function getLayoutSlide(id: string): Slide | null {
  const l = getStoredLayout(id);
  return l ? stampLayoutProvenance(freshIds(l.slide), l, l.slide) : null;
}

export function createLayout(opts: { name: string; category: LayoutFolder; slide?: Slide }): StoredLayout {
  const map = read();
  const ts = now();
  const l: StoredLayout = {
    id: `lay-${nanoid(8)}`,
    name: opts.name,
    category: opts.category,
    slide: opts.slide ?? { id: `s-${nanoid(8)}`, elements: [] },
    version: 1,
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

/**
 * Persist slide edits made in the editor back onto a layout.
 *
 * The one write that bumps `version`: this is the master's content changing,
 * which is exactly what every slide made from it needs to hear about.
 */
export function saveLayoutFromSlide(id: string, slide: Slide, name?: string): void {
  const map = read();
  if (!map[id]) return;
  const prev = map[id];
  map[id] = {
    ...prev,
    slide,
    name: name ?? prev.name,
    version: prev.version + 1,
    updatedAt: now(),
  };
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
    // A copy is a new master with its own history, not a continuation of the
    // original's — slides made from the source must not read as made from it.
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };
  const map = read();
  map[l.id] = l;
  write(map);
  return l;
}

/** Seed a new layout from an uploaded reference image (a full-bleed picture, editable after). */
export function createLayoutFromImage(
  dataUrl: string,
  name: string,
  category: LayoutFolder = 'Blank',
): StoredLayout {
  const picture: PictureElement = {
    id: `picture-${nanoid(6)}`,
    type: 'picture',
    rect: { x: 0, y: 0, w: SLIDE_16x9.w, h: SLIDE_16x9.h },
    src: dataUrl,
  };
  return createLayout({
    name,
    category,
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
