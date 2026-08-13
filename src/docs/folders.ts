'use client';

/**
 * Document folders — the left rail on the Documents tab.
 *
 * Same persistence seam as `docs/repository.ts`: localStorage today, the
 * Playground database in Phase 5. Folders are stored separately from the
 * documents themselves (a document carries only a `folderId`), so an empty
 * folder is a real thing that survives its last document leaving, and deleting
 * a folder never has to touch document bytes.
 *
 * Unlike Admin's artifact folders, these are user-created and flat: one level,
 * no nesting, and a document lives in at most one of them.
 */
import { nanoid } from 'nanoid';

export interface DocFolder {
  id: string;
  name: string;
  createdAt: string;
}

const KEY = 'devindesign.docfolders.v1';

type FolderMap = Record<string, DocFolder>;

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

/** Every folder, A–Z — the rail's order, so it doesn't shuffle as you rename. */
export function listFolders(): DocFolder[] {
  return Object.values(read()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getFolder(id: string): DocFolder | null {
  return read()[id] ?? null;
}

/** Is `name` free (case-insensitive), ignoring `excludeId` itself? */
export function isFolderNameAvailable(name: string, excludeId?: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return !listFolders().some((f) => f.id !== excludeId && f.name.trim().toLowerCase() === n);
}

/** A default "New folder" / "New folder (2)" name that doesn't collide. */
export function suggestFolderName(base = 'New folder'): string {
  let candidate = base;
  let n = 2;
  while (!isFolderNameAvailable(candidate)) {
    candidate = `${base} (${n})`;
    n += 1;
  }
  return candidate;
}

export function createFolder(name?: string): DocFolder {
  const folder: DocFolder = {
    id: `fld-${nanoid(8)}`,
    name: name?.trim() || suggestFolderName(),
    createdAt: now(),
  };
  const map = read();
  map[folder.id] = folder;
  write(map);
  return folder;
}

export function renameFolder(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const map = read();
  if (!map[id]) return;
  map[id] = { ...map[id], name: trimmed };
  write(map);
}

/**
 * Remove the folder itself. Its documents are NOT deleted — the caller clears
 * their `folderId` (see `unfileFolder` in the docs repository), so they fall
 * back to Unfiled. Deleting a folder is an organizing action, never a
 * destructive one.
 */
export function deleteFolder(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}
