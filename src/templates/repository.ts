'use client';

/**
 * Deck template repository. Mirrors `docs/repository.ts`: templates are
 * persisted (localStorage today) so Admin can create, edit and delete them
 * like documents, instead of only shipping the built-ins baked into
 * `registry.ts`. Every load ensures storage has all built-ins (skipping ones
 * already present), so newly added built-ins show up without wiping edits.
 *
 * 'blank' stays special-cased in the registry (it's the "start empty" escape
 * hatch on the new-document picker, not something Admin authors) and never
 * gets stored here.
 */
import { nanoid } from 'nanoid';
import { SLIDE_16x9, type Deck, type PictureElement, type Slide } from '@/model';
import { getTemplate, TEMPLATES, type TemplateDef } from './registry';
import { defineCollection } from '@/platform/collection';
import { localStorageAdapter } from '@/platform/store';

/**
 * Seeding only fills in ids that are MISSING, so a browser that has already
 * stored a built-in keeps serving its copy forever — bumping this key is the
 * only way a changed built-in reaches an existing browser. v2: the built-in set
 * was replaced wholesale by the three standard reference decks. v3: those decks
 * re-imported at full canvas scale.
 */
const KEY = 'devindesign.templates.v3';

export interface StoredTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateDef['category'];
  /** Lower sorts first; carried over from the built-in def, if any. */
  order?: number;
  slides: Slide[];
  /**
   * Bumped when the SLIDES change, never for a rename or a recategorization —
   * the same rule as `StoredLayout.version`, for the same reason. Decks carry
   * the version they were built from in `Deck.deckTemplateVersion`.
   */
  version: number;
  createdAt: string;
  updatedAt: string;
}

type TemplateMap = Record<string, StoredTemplate>;

const collection = defineCollection<StoredTemplate>(KEY, localStorageAdapter, {
  migrate: (map) => {
    // Pre-versioning templates normalize to v1, matching the decks made from
    // them (which have no `deckTemplateVersion` either). Same backfill as
    // `layoutRepository`.
    for (const t of Object.values(map)) if (typeof t.version !== 'number') t.version = 1;
    return map;
  },
});

/** Hydrate from the adapter — only needed once that adapter is a remote one. */
export const hydrateTemplates = () => collection.hydrate();
export const subscribeTemplates = collection.subscribe;

const read = (): TemplateMap => collection.snapshot();
const write = (map: TemplateMap) => collection.replace(map);

const now = () => new Date().toISOString();

/** Ensure every built-in template exists in storage (idempotent, safe to call every load). */
export function seedIfFirstRun(): void {
  if (typeof window === 'undefined') return;
  const map = read();
  let changed = false;
  for (const t of TEMPLATES) {
    if (t.id === 'blank' || map[t.id]) continue;
    const ts = now();
    map[t.id] = {
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      order: t.order,
      slides: t.buildSlides(),
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    changed = true;
  }
  if (changed) write(map);
}

export function listTemplates(): StoredTemplate[] {
  return Object.values(read()).sort(
    (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name),
  );
}

export function getStoredTemplate(id: string): StoredTemplate | null {
  return read()[id] ?? null;
}

/**
 * Resolve a template's slides for use elsewhere (new doc, previews).
 *
 * `version` comes back too so the caller can stamp what it built from.
 * A built-in resolved straight from the registry — which happens for 'blank',
 * and before the store is seeded — reports v1: it hasn't been edited, so
 * there's nothing for a deck to have drifted from.
 */
export function getTemplateSlides(
  id: string,
): { name: string; slides: Slide[]; version: number } | null {
  const stored = getStoredTemplate(id);
  if (stored) return { name: stored.name, slides: stored.slides, version: stored.version };
  const builtin = getTemplate(id);
  return builtin ? { name: builtin.name, slides: builtin.buildSlides(), version: 1 } : null;
}

export function createTemplate(opts: {
  name: string;
  description?: string;
  category: TemplateDef['category'];
  slides?: Slide[];
}): StoredTemplate {
  const map = read();
  const ts = now();
  const t: StoredTemplate = {
    id: `tpl-${nanoid(8)}`,
    name: opts.name,
    description: opts.description ?? '',
    category: opts.category,
    slides: opts.slides ?? [{ id: `s-${nanoid(8)}`, elements: [] }],
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };
  map[t.id] = t;
  write(map);
  return t;
}

export function updateTemplateMeta(
  id: string,
  patch: Partial<Pick<StoredTemplate, 'name' | 'description' | 'category'>>,
): void {
  const map = read();
  if (!map[id]) return;
  map[id] = { ...map[id], ...patch, updatedAt: now() };
  write(map);
}

/**
 * Persist slide + title edits made in the editor back onto a template. Bumps
 * `version`: the slides are the content, and decks built from this template
 * are entitled to know it moved.
 */
export function saveTemplateFromDeck(id: string, deck: Deck): void {
  const map = read();
  if (!map[id]) return;
  const prev = map[id];
  map[id] = {
    ...prev,
    name: deck.title,
    slides: deck.slides,
    version: prev.version + 1,
    updatedAt: now(),
  };
  write(map);
}

export function duplicateTemplate(id: string, name?: string): StoredTemplate | null {
  const src = getStoredTemplate(id);
  if (!src) return null;
  const clone = structuredClone(src);
  const ts = now();
  const t: StoredTemplate = {
    ...clone,
    id: `tpl-${nanoid(8)}`,
    name: name?.trim() || `Copy of ${src.name}`,
    // A fresh master with its own history — see `duplicateLayout`.
    version: 1,
    slides: clone.slides.map((s) => ({
      ...s,
      id: `s-${nanoid(8)}`,
      elements: s.elements.map((e) => ({ ...e, id: `${e.type}-${nanoid(6)}` })),
    })),
    createdAt: ts,
    updatedAt: ts,
  };
  const map = read();
  map[t.id] = t;
  write(map);
  return t;
}

/** Seed a new template from an uploaded reference image (a full-bleed picture, editable after). */
export function createTemplateFromImage(dataUrl: string, name: string): StoredTemplate {
  const picture: PictureElement = {
    id: `picture-${nanoid(6)}`,
    type: 'picture',
    rect: { x: 0, y: 0, w: SLIDE_16x9.w, h: SLIDE_16x9.h },
    src: dataUrl,
  };
  return createTemplate({
    name,
    category: 'Blank',
    slides: [{ id: `s-${nanoid(8)}`, elements: [picture] }],
  });
}

export function deleteTemplate(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}

/** Wrap a stored template as a Deck so it can be loaded into the editor. */
export function templateAsDeck(t: StoredTemplate): Deck {
  return {
    id: `tpl-doc-${t.id}`,
    title: t.name,
    slideSize: { w: SLIDE_16x9.w, h: SLIDE_16x9.h },
    slides: t.slides,
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
