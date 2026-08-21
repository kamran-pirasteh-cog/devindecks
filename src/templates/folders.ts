'use client';

/**
 * Template folders — the left rail on Admin's Templates tab.
 *
 * The deliberate twin of `docs/folders.ts`, for the same reason the template
 * shelf is the documents shelf with a different noun in it: an admin who has
 * organized their documents already knows how this works. Same shape (flat, one
 * level, a template lives in at most one), same persistence seam (localStorage
 * today), and folders are stored apart from the templates themselves so an
 * empty folder is a real thing that survives its last template leaving.
 *
 * Unlike document folders, these are seeded: a fresh install gets the four
 * buckets the shelf is actually organized around, because the folders here are
 * shared vocabulary for everyone creating a deck — an empty rail would leave the
 * new-document picker with nothing to group by. They are ordinary folders once
 * seeded: rename them, delete them, add your own.
 */
import { nanoid } from 'nanoid';

export interface TemplateFolder {
  id: string;
  name: string;
  createdAt: string;
}

const KEY = 'devindesign.templatefolders.v1';

/**
 * Set once the defaults below have been laid down. Kept separate from the
 * folders themselves so deleting all four is a decision that sticks — seeding
 * off an empty map would put them back on the next load.
 */
const SEEDED_KEY = 'devindesign.templatefolders.seeded.v1';

/** The buckets a fresh install opens with, in the order they're created. */
export const DEFAULT_TEMPLATE_FOLDERS = [
  'Sales decks',
  'QBR',
  'Client analytics',
  'COE content',
] as const;

type FolderMap = Record<string, TemplateFolder>;

function read(): FolderMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as FolderMap;
  } catch {
    return {};
  }
}

function write(map: FolderMap) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

const now = () => new Date().toISOString();

/**
 * Lay down the default folders, once ever. Idempotent and safe to call on every
 * load — `seedIfFirstRun` in the template repository calls it before it files
 * the built-in templates, which is what makes those land somewhere visible.
 */
export function seedTemplateFoldersIfFirstRun(): void {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem(SEEDED_KEY) === '1') return;
  const map = read();
  const taken = new Set(Object.values(map).map((f) => f.name.trim().toLowerCase()));
  for (const name of DEFAULT_TEMPLATE_FOLDERS) {
    if (taken.has(name.toLowerCase())) continue;
    const folder: TemplateFolder = { id: `tfld-${nanoid(8)}`, name, createdAt: now() };
    map[folder.id] = folder;
  }
  write(map);
  window.localStorage.setItem(SEEDED_KEY, '1');
}

/** Every folder, in creation order — the rail's order. */
export function listTemplateFolders(): TemplateFolder[] {
  // Creation order, not A–Z: the seeded four read as a sequence (sell it, review
  // it, analyse it, teach it) that alphabetizing would scramble, and a folder an
  // admin adds belongs at the end where they just put it rather than wherever
  // its initial lands.
  return Object.values(read()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getTemplateFolder(id: string): TemplateFolder | null {
  return read()[id] ?? null;
}

/** Is `name` free (case-insensitive), ignoring `excludeId` itself? */
export function isTemplateFolderNameAvailable(name: string, excludeId?: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return !listTemplateFolders().some(
    (f) => f.id !== excludeId && f.name.trim().toLowerCase() === n,
  );
}

/** A default "New folder" / "New folder (2)" name that doesn't collide. */
export function suggestTemplateFolderName(base = 'New folder'): string {
  let candidate = base;
  let n = 2;
  while (!isTemplateFolderNameAvailable(candidate)) {
    candidate = `${base} (${n})`;
    n += 1;
  }
  return candidate;
}

export function createTemplateFolder(name?: string): TemplateFolder {
  const folder: TemplateFolder = {
    id: `tfld-${nanoid(8)}`,
    name: name?.trim() || suggestTemplateFolderName(),
    createdAt: now(),
  };
  const map = read();
  map[folder.id] = folder;
  write(map);
  return folder;
}

export function renameTemplateFolder(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const map = read();
  if (!map[id]) return;
  map[id] = { ...map[id], name: trimmed };
  write(map);
}

/**
 * Remove the folder itself. Its templates are NOT deleted — the caller clears
 * their `folderId` (see `unfileTemplateFolder` in the template repository), so
 * they fall back to Unfiled and stay on offer in the new-document picker.
 * Deleting a folder is an organizing action, never a destructive one: a template
 * that vanished with its folder would silently stop being something anyone could
 * start a deck from.
 */
export function deleteTemplateFolder(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}
