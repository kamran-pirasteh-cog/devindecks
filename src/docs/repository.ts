'use client';

/**
 * Documents repository. A "document" is just a Deck. This is the persistence
 * seam: today it's localStorage (fine for local dev and the single-user demo),
 * but every call site goes through THIS interface so Phase 5 can swap in the
 * Playground database + blob store without touching the UI.
 */
import { nanoid } from 'nanoid';
import { SLIDE_16x9, type Deck } from '@/model';
import { getTemplate, TEMPLATES } from '@/templates/registry';

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

export function listDocs(): Deck[] {
  return Object.values(read()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getDoc(id: string): Deck | null {
  return read()[id] ?? null;
}

export function saveDoc(deck: Deck): void {
  const map = read();
  map[deck.id] = { ...deck, updatedAt: now() };
  write(map);
}

export function deleteDoc(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}

export function renameDoc(id: string, title: string): void {
  const map = read();
  if (map[id]) {
    map[id] = { ...map[id], title, updatedAt: now() };
    write(map);
  }
}

function newDeck(title: string, slides: Deck['slides'], templateId?: string): Deck {
  const ts = now();
  return {
    id: `doc-${nanoid(10)}`,
    title,
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
  const tpl = getTemplate(templateId) ?? getTemplate('blank')!;
  const deck = newDeck(title ?? untitledName(tpl.name), tpl.buildSlides(), tpl.id);
  saveDoc(deck);
  return deck;
}

function untitledName(templateName: string): string {
  return templateName === 'Blank' ? 'Untitled presentation' : templateName;
}

/** Duplicate an existing document into a fresh one ("start from a prior doc"). */
export function duplicateDoc(id: string): Deck | null {
  const src = getDoc(id);
  if (!src) return null;
  const clone = structuredClone(src) as Deck;
  const deck: Deck = {
    ...clone,
    id: `doc-${nanoid(10)}`,
    title: `Copy of ${src.title}`,
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
