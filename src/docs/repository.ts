'use client';

/**
 * Documents repository. A "document" is just a Deck. This is the persistence
 * seam: today it's localStorage (fine for local dev and the single-user demo),
 * but every call site goes through THIS interface so Phase 5 can swap in the
 * Playground database + blob store without touching the UI.
 */
import { nanoid } from 'nanoid';
import { SLIDE_16x9, type Deck } from '@/model';
import { TEMPLATES } from '@/templates/registry';
import { getTemplateSlides } from '@/templates/repository';

/** Stand-in for the signed-in user until Phase 5 brings real auth. */
export const DEFAULT_OWNER = 'Me';

const KEY = 'devindesign.docs.v1';
const SEED_KEY = 'devindesign.seeded.v1';

type DocMap = Record<string, Deck>;

function read(): DocMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as DocMap;
  } catch {
    return {};
  }
}

function write(map: DocMap) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

const now = () => new Date().toISOString();

/** Live documents — everything except what's sitting in Deleted items. */
export function listDocs(): Deck[] {
  return Object.values(read())
    .filter((d) => !d.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Deleted items, most recently deleted first. */
export function listDeletedDocs(): Deck[] {
  return Object.values(read())
    .filter((d) => d.deletedAt)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

export function getDoc(id: string): Deck | null {
  return read()[id] ?? null;
}

export function saveDoc(deck: Deck): void {
  const map = read();
  map[deck.id] = { ...deck, updatedAt: now() };
  write(map);
}

/**
 * Move a document to Deleted items. It stays on disk — `deletedAt` is what
 * hides it — so it can be restored. `updatedAt` is deliberately untouched:
 * deleting isn't editing, and a restored document should keep its real
 * last-edited time.
 */
export function deleteDoc(id: string): void {
  const map = read();
  if (!map[id]) return;
  map[id] = { ...map[id], deletedAt: now() };
  write(map);
}

/** Put it back on the dashboard. */
export function restoreDoc(id: string): void {
  const map = read();
  if (!map[id]) return;
  const { deletedAt: _deletedAt, ...rest } = map[id];
  map[id] = rest;
  write(map);
}

/** Delete for good, from Deleted items. This is the only unrecoverable path. */
export function purgeDoc(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}

/** Empty Deleted items entirely. */
export function purgeAllDeleted(): void {
  const map = read();
  for (const doc of Object.values(map)) {
    if (doc.deletedAt) delete map[doc.id];
  }
  write(map);
}

export function renameDoc(id: string, title: string): void {
  const map = read();
  if (map[id]) {
    map[id] = { ...map[id], title, updatedAt: now() };
    write(map);
  }
}

export function setDocTags(id: string, tags: string[]): void {
  const map = read();
  if (map[id]) {
    map[id] = { ...map[id], tags, updatedAt: now() };
    write(map);
  }
}

export function setDocOwner(id: string, owner: string): void {
  const map = read();
  if (map[id]) {
    const trimmed = owner.trim();
    map[id] = { ...map[id], owner: trimmed || undefined, updatedAt: now() };
    write(map);
  }
}

/** All distinct owners across every document, for building the owner filter. */
export function listAllOwners(): string[] {
  const set = new Set<string>();
  for (const doc of listDocs()) {
    if (doc.owner) set.add(doc.owner);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function addDocTag(id: string, tag: string): void {
  const trimmed = tag.trim();
  if (!trimmed) return;
  const doc = getDoc(id);
  if (!doc) return;
  const existing = doc.tags ?? [];
  if (existing.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
  setDocTags(id, [...existing, trimmed]);
}

export function removeDocTag(id: string, tag: string): void {
  const doc = getDoc(id);
  if (!doc) return;
  setDocTags(id, (doc.tags ?? []).filter((t) => t !== tag));
}

/** All distinct tags across every document, for building filter chips. */
export function listAllTags(): string[] {
  const set = new Set<string>();
  for (const doc of listDocs()) {
    for (const t of doc.tags ?? []) set.add(t);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function newDeck(title: string, slides: Deck['slides'], templateId?: string): Deck {
  const ts = now();
  return {
    id: `doc-${nanoid(10)}`,
    title,
    owner: DEFAULT_OWNER,
    slideSize: { w: SLIDE_16x9.w, h: SLIDE_16x9.h },
    slides,
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    deckTemplateId: templateId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Create a document from a template (or 'blank') and persist it. */
export function createDoc(templateId = 'blank', title?: string): Deck {
  const tpl = getTemplateSlides(templateId) ?? getTemplateSlides('blank')!;
  const slides = structuredClone(tpl.slides).map((s) => ({
    ...s,
    id: `s-${nanoid(8)}`,
    elements: s.elements.map((e) => ({ ...e, id: `${e.type}-${nanoid(6)}` })),
  }));
  const deck = newDeck(title ?? untitledName(tpl.name), slides, templateId);
  saveDoc(deck);
  return deck;
}

function untitledName(templateName: string): string {
  return templateName === 'Blank' ? 'Untitled presentation' : templateName;
}

/** Is `title` free to use (case-insensitive), ignoring `excludeId` itself? */
export function isTitleAvailable(title: string, excludeId?: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return false;
  // Deleted items don't reserve their titles — an invisible document must not
  // block a name the user can't see or free up.
  return !listDocs().some((d) => d.id !== excludeId && d.title.trim().toLowerCase() === t);
}

/** A default "Copy of X" / "Copy of X (2)" name that doesn't collide. */
export function suggestCopyTitle(baseTitle: string): string {
  let candidate = `Copy of ${baseTitle}`;
  let n = 2;
  while (!isTitleAvailable(candidate)) {
    candidate = `Copy of ${baseTitle} (${n})`;
    n += 1;
  }
  return candidate;
}

/** Duplicate an existing document into a fresh one ("start from a prior doc"). */
export function duplicateDoc(id: string, title?: string): Deck | null {
  const src = getDoc(id);
  if (!src) return null;
  const clone = structuredClone(src) as Deck;
  const deck: Deck = {
    ...clone,
    id: `doc-${nanoid(10)}`,
    title: title?.trim() || suggestCopyTitle(src.title),
    owner: DEFAULT_OWNER,
    createdAt: now(),
    updatedAt: now(),
    slides: clone.slides.map((s) => ({
      ...s,
      id: `s-${nanoid(8)}`,
      elements: s.elements.map((e) => ({ ...e, id: `${e.type}-${nanoid(6)}` })),
    })),
  };
  saveDoc(deck);
  return deck;
}

/** Seed one sample doc on first run so the dashboard isn't empty. */
export function seedIfFirstRun(): void {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem(SEED_KEY)) return;
  window.localStorage.setItem(SEED_KEY, '1');
  if (Object.keys(read()).length === 0) {
    createDoc('qbr', 'Sample QBR');
  }
}

export { TEMPLATES };
