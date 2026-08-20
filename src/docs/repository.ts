'use client';

/**
 * Documents repository. A "document" is just a Deck. This is the persistence
 * seam: today it's localStorage (fine for local dev and the single-user demo),
 * but every call site goes through THIS interface so Phase 5 can swap in the
 * Playground database + blob store without touching the UI.
 */
import { nanoid } from 'nanoid';
import {
  reidentifyCharts,
  SLIDE_16x9,
  type Deck,
  type DeckBrief,
  type Slide,
} from '@/model';
import { getTemplate, RETIRED_TEMPLATE_IDS, TEMPLATES } from '@/templates/registry';
import { getTemplateSlides } from '@/templates/repository';
import { copyThreads, purgeThreads } from '@/comments/repository';

/** Stand-in for the signed-in user until Phase 5 brings real auth. */
export const DEFAULT_OWNER = 'Me';

const KEY = 'devindesign.docs.v1';
/** What the last seed put on the dashboard, so the next one can clear it. */
const SEED_KEY = 'devindesign.seeded.v1';

/**
 * Bumping this reseeds. v1 was a synthetic "Sample QBR"; v2 replaced it with
 * the three standard reference decks; v3 re-imported those at full canvas
 * scale; v4 rebuilds seeded decks in place, from any page, so a browser holding
 * a v2-era copy gets the fitted one without visiting the dashboard.
 */
const SEED_VERSION = 4;

/** The decks every fresh dashboard starts with, in the order they appear. */
const DEFAULT_DOC_TEMPLATE_IDS = ['wayfair-reskin', 'bva-pitch', 'fiserv-exec-readout'];

/**
 * The seed's own record of what it created and how the store looked right
 * afterwards. `updatedAt` is the untouched-check: it can't be inferred from the
 * deck (creating one goes through `saveDoc`, which stamps `updatedAt`, so a
 * brand-new deck's timestamps already differ), so the seed writes down what it
 * left and a later reseed only removes decks still carrying that exact value.
 */
interface SeedRecord {
  version: number;
  docs: { id: string; updatedAt: string }[];
}

function readSeed(): SeedRecord | null {
  const raw = window.localStorage.getItem(SEED_KEY);
  if (!raw) return null;
  // v1 wrote the string '1' before this record existed. Its one seeded doc is
  // recognizable by its template instead — see `seedIfFirstRun`.
  if (raw === '1') return { version: 1, docs: [] };
  try {
    return JSON.parse(raw) as SeedRecord;
  } catch {
    return null;
  }
}

type DocMap = Record<string, Deck>;

function read(): DocMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as DocMap;
  } catch {
    return {};
  }
}

/**
 * Thrown when the browser refuses the write. localStorage is a few megabytes
 * per origin, and one imported deck of photographs can be all of it — so this
 * is a normal outcome, not a bug, and it has to reach the user: a swallowed
 * quota error means every later save fails too and the work is gone at the next
 * reload with nothing ever having said so.
 */
export class StorageFullError extends Error {
  constructor() {
    super(
      'There isn’t room to save this deck in the browser’s local storage. Delete some documents, or import fewer slides at a time.',
    );
    this.name = 'StorageFullError';
  }
}

function write(map: DocMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch (err) {
    const quota =
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    if (quota) throw new StorageFullError();
    throw err;
  }
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

/**
 * Delete for good, from Deleted items. This is the only unrecoverable path —
 * and the document's discussion goes with it, since comments are stored beside
 * the deck rather than inside it.
 */
export function purgeDoc(id: string): void {
  const map = read();
  delete map[id];
  write(map);
  purgeThreads(id);
}

/** Empty Deleted items entirely. */
export function purgeAllDeleted(): void {
  const map = read();
  for (const doc of Object.values(map)) {
    if (doc.deletedAt) {
      delete map[doc.id];
      purgeThreads(doc.id);
    }
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

/**
 * Tagging isn't editing, so `updatedAt` is left alone — the same reasoning as
 * `setDocFolder`. It also keeps the card still: under the default "recently
 * updated" sort, stamping the time here jumped the deck to the front of the
 * grid the moment you tagged it.
 */
export function setDocTags(id: string, tags: string[]): void {
  const map = read();
  if (map[id]) {
    map[id] = { ...map[id], tags };
    write(map);
  }
}

/**
 * Record (or clear) the meeting brief. Like tagging, this isn't editing the
 * deck, so `updatedAt` is left alone — a deck shouldn't jump to the front of
 * the "recently updated" sort because someone filled in the client name.
 *
 * Empty strings and empty attendee lists are dropped rather than stored, so a
 * skipped field reads as absent everywhere downstream instead of as `''`.
 */
export function setDocBrief(id: string, brief: DeckBrief): void {
  const map = read();
  if (!map[id]) return;
  const client = brief.client?.trim();
  const meetingDate = brief.meetingDate?.trim();
  const attendees = brief.attendees?.map((a) => a.trim()).filter(Boolean);
  const cleaned: DeckBrief = {
    ...(client ? { client } : {}),
    ...(meetingDate ? { meetingDate } : {}),
    ...(attendees?.length ? { attendees } : {}),
  };
  const { brief: _brief, ...rest } = map[id];
  map[id] = Object.keys(cleaned).length ? { ...rest, brief: cleaned } : rest;
  write(map);
}

export function setDocOwner(id: string, owner: string): void {
  const map = read();
  if (map[id]) {
    const trimmed = owner.trim();
    map[id] = { ...map[id], owner: trimmed || undefined, updatedAt: now() };
    write(map);
  }
}

/**
 * File a document into a folder, or pass `undefined` to send it back to
 * Unfiled. Filing isn't editing, so `updatedAt` is left alone — the same
 * reasoning as `deleteDoc`.
 */
export function setDocFolder(id: string, folderId: string | undefined): void {
  const map = read();
  if (!map[id]) return;
  const { folderId: _folderId, ...rest } = map[id];
  map[id] = folderId ? { ...rest, folderId } : rest;
  write(map);
}

/**
 * Live-document counts per folder id, plus the unfiled count under `''`, for
 * the rail's badges. One pass over the store rather than a filter per folder.
 */
export function countDocsByFolder(): Record<string, number> {
  const counts: Record<string, number> = { '': 0 };
  for (const doc of listDocs()) {
    const key = doc.folderId ?? '';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Clear a folder off every document in it, before the folder itself goes. */
export function unfileFolder(folderId: string): void {
  const map = read();
  for (const doc of Object.values(map)) {
    if (doc.folderId !== folderId) continue;
    const { folderId: _folderId, ...rest } = doc;
    map[doc.id] = rest;
  }
  write(map);
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

function newDeck(
  title: string,
  slides: Deck['slides'],
  templateId?: string,
  templateVersion?: number,
): Deck {
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
    deckTemplateVersion: templateVersion,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Fresh ids for a copied slide.
 *
 * Chart-owned elements are left for `reidentifyCharts`: their ids encode which
 * chart and which part they are, so a random id would silently sever them from
 * their chart — the copy looks fine until someone edits it, and then the chart
 * regenerates on top of orphans.
 */
function rekeySlide(s: Slide, elementIds?: Record<string, string>): Slide {
  const copy: Slide = {
    ...s,
    id: `s-${nanoid(8)}`,
    elements: s.elements.map((e) => {
      if (e.chartRef) return e;
      const id = `${e.type}-${nanoid(6)}`;
      if (elementIds) elementIds[e.id] = id;
      return { ...e, id };
    }),
  };
  return reidentifyCharts(copy);
}

/** Create a document from a template (or 'blank') and persist it. */
export function createDoc(templateId = 'blank', title?: string): Deck {
  const tpl = getTemplateSlides(templateId) ?? getTemplateSlides('blank')!;
  const slides = structuredClone(tpl.slides).map((s) => rekeySlide(s));
  // The template's version at creation time, so `templateDrift` can later tell
  // this deck that the master it came from has moved on.
  const deck = newDeck(title ?? untitledName(tpl.name), slides, templateId, tpl.version);
  saveDoc(deck);
  return deck;
}

/**
 * Create a document from slides that came from OUTSIDE the app — an uploaded
 * .pptx or PDF, imported as-is or converted to the brand.
 *
 * Deliberately does NOT go through `createDoc`: there is no template behind
 * these slides, so `deckTemplateId` stays unset and `templateDrift` will never
 * claim this deck has drifted from a master it was never made from.
 *
 * Slides arrive already carrying their own ids (the conversion engine's
 * diagnostics reference them, so they must survive), but they are re-keyed here
 * anyway — the same upload may be imported twice, and two decks sharing element
 * ids would have the comments store pinning one deck's threads to the other's
 * objects.
 */
export function createDocFromSlides(
  slides: Slide[],
  title: string,
  opts: { pageNumbers?: boolean; designSystemId?: string; designSystemVersion?: number } = {},
): Deck {
  const deck = newDeck(title.trim() || 'Untitled presentation', slides.map((s) => rekeySlide(s)));
  const next: Deck = {
    ...deck,
    ...(opts.pageNumbers !== undefined ? { pageNumbers: opts.pageNumbers } : {}),
    ...(opts.designSystemId ? { designSystemId: opts.designSystemId } : {}),
    ...(opts.designSystemVersion !== undefined
      ? { designSystemVersion: opts.designSystemVersion }
      : {}),
  };
  saveDoc(next);
  return next;
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
  // Every slide and element is re-keyed, so the id maps are built as we go and
  // handed to the comments store — a copy keeps its discussion, still pinned to
  // the right objects.
  const slideIds: Record<string, string> = {};
  const elementIds: Record<string, string> = {};
  const deck: Deck = {
    ...clone,
    id: `doc-${nanoid(10)}`,
    title: title?.trim() || suggestCopyTitle(src.title),
    owner: DEFAULT_OWNER,
    // Client tags do NOT carry over. A copy is almost always the start of work
    // for someone else — reusing last quarter's deck for the next client — and
    // an inherited tag files it under the wrong client until someone notices,
    // which is worse than an untagged deck the user has to tag.
    tags: undefined,
    createdAt: now(),
    updatedAt: now(),
    slides: clone.slides.map((s) => {
      const copy = rekeySlide(s, elementIds);
      slideIds[s.id] = copy.id;
      return copy;
    }),
  };
  saveDoc(deck);
  copyThreads(id, deck.id, { slides: slideIds, elements: elementIds });
  return deck;
}

/**
 * Was this deck put here by a seed that kept no record of itself (v1, v2)?
 *
 * Those seeds wrote a bare flag, so their decks have to be recognized by what
 * they are: built from a template the seed used, and still carrying the name
 * that seed gave them — which is the template's own name, since `createDoc`
 * titles an untitled deck after its template. Renaming one is enough to keep
 * it, and so is starting from a template and naming the result, which is what
 * anyone does with a deck they mean to keep.
 */
function isUnclaimedLegacySeed(doc: Deck): boolean {
  if (!doc.deckTemplateId) return false;
  // A retired template can only have come from a seed — nothing else could have
  // created one, and the template itself no longer exists to start from.
  if ((RETIRED_TEMPLATE_IDS as readonly string[]).includes(doc.deckTemplateId)) return true;
  if (!DEFAULT_DOC_TEMPLATE_IDS.includes(doc.deckTemplateId)) return false;
  return doc.title === getTemplate(doc.deckTemplateId)?.name;
}

/**
 * Bring the three standard reference decks up to date, once per seed version.
 *
 * A bump REBUILDS a seeded deck in place rather than deleting and recreating
 * it: same id, same title, new slides from the current template. That matters
 * because the dashboard isn't the only way in — someone sitting on an open
 * `/edit/<id>` tab has to get the fixed deck when they reload, and a deck that
 * vanished out from under that URL would be worse than a stale one. Decks from
 * templates that no longer exist have nothing to rebuild from, so those go.
 *
 * Nothing the user has claimed is touched. For decks this seed recorded, that
 * means an exact `updatedAt` match: one edit, rename or comment and the deck is
 * theirs. For the older seeds, which recorded nothing, it means the deck still
 * has its seeded title — see `isUnclaimedLegacySeed`.
 */
export function seedIfFirstRun(): void {
  if (typeof window === 'undefined') return;
  const prev = readSeed();
  if (prev?.version === SEED_VERSION) return;

  const map = read();
  const recorded = new Map(prev?.docs.map((d) => [d.id, d.updatedAt]));
  const refreshed: string[] = [];
  for (const doc of Object.values(map)) {
    const isSeed = recorded.has(doc.id)
      ? recorded.get(doc.id) === doc.updatedAt
      : isUnclaimedLegacySeed(doc);
    if (!isSeed) continue;

    const tpl = doc.deckTemplateId ? getTemplateSlides(doc.deckTemplateId) : null;
    if (!tpl) {
      delete map[doc.id];
      purgeThreads(doc.id);
      continue;
    }
    map[doc.id] = {
      ...doc,
      slides: structuredClone(tpl.slides).map((s) => rekeySlide(s)),
      updatedAt: now(),
    };
    refreshed.push(doc.id);
    // The deck's discussion was pinned to slides and elements that no longer
    // exist, and there's no honest mapping onto a rebuilt deck.
    purgeThreads(doc.id);
  }
  write(map);

  const created = listDocs().length === 0 ? DEFAULT_DOC_TEMPLATE_IDS.map((id) => createDoc(id)) : [];
  const record: SeedRecord = {
    version: SEED_VERSION,
    docs: [...refreshed, ...created.map((d) => d.id)].flatMap((id) => {
      const doc = getDoc(id);
      return doc ? [{ id, updatedAt: doc.updatedAt }] : [];
    }),
  };
  window.localStorage.setItem(SEED_KEY, JSON.stringify(record));
}

export { TEMPLATES };
