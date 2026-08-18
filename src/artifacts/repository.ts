'use client';

/**
 * Artifact repository — the shared asset library behind Admin › Artifacts.
 * Same persistence seam as `docs/repository.ts` and `templates/layoutRepository.ts`:
 * localStorage today, the Playground blob store in Phase 5.
 *
 * Bytes live inline as data URLs, which is what makes them usable straight from
 * a `PictureElement.src` with no fetch. It's also why uploads are capped: the
 * whole library shares one ~5MB localStorage origin quota, so a single 4MB
 * screenshot would evict the rest of the app's state. `MAX_BYTES` keeps one
 * file well inside that, and `addArtifact` surfaces a quota failure as a thrown
 * `ArtifactError` rather than silently dropping the asset. Both limits go away
 * with the real blob store.
 */
import { nanoid } from 'nanoid';
import { SEED_ARTIFACTS } from './seed';

export type ArtifactFolderId =
  | 'cognition-logos'
  | 'client-logos'
  | 'cognition-brand-graphics'
  | 'icons'
  | 'team-photos';

export interface ArtifactFolder {
  id: ArtifactFolderId;
  name: string;
}

export const ARTIFACT_FOLDERS: ArtifactFolder[] = [
  { id: 'cognition-logos', name: 'Cognition Logos' },
  { id: 'client-logos', name: 'Client Logos' },
  { id: 'cognition-brand-graphics', name: 'Cognition Brand Graphics' },
  { id: 'icons', name: 'Icons' },
  { id: 'team-photos', name: 'Team Photos' },
];

export interface StoredArtifact {
  id: string;
  folderId: ArtifactFolderId;
  /** Display name, defaulting to the filename without its extension. */
  name: string;
  /** Data URL — goes straight into a picture element's `src`. */
  src: string;
  mime: string;
  bytes: number;
  /** Intrinsic pixel size, so an insert can pick a sane aspect ratio. */
  width: number;
  height: number;
  createdAt: string;
}

/** Per-file ceiling. See the note at the top of the file. */
export const MAX_BYTES = 1_500_000;

const ACCEPTED = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/gif', 'image/webp'];

/** The `accept` attribute for the upload input, kept in step with ACCEPTED. */
export const ACCEPT_ATTR = ACCEPTED.join(',');

const KEY = 'devindesign.artifacts.v1';

/**
 * Set once the built-in brand marks have been folded into the store. It's what
 * makes deleting a seeded logo stick — without it, every read would put back
 * whatever the user just removed.
 */
const SEEDED_KEY = 'devindesign.artifacts.seeded.v1';

/** A rejection with a message that's already fit to show the user. */
export class ArtifactError extends Error {}

type ArtifactMap = Record<string, StoredArtifact>;

function read(): ArtifactMap {
  if (typeof window === 'undefined') return {};
  let map: ArtifactMap;
  try {
    map = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as ArtifactMap;
  } catch {
    map = {};
  }
  return seedOnce(map);
}

/**
 * Fold the built-in brand marks into the store the first time it's read on a
 * given browser, then leave them alone forever: once they're ordinary rows,
 * rename and delete work on them with no special-casing anywhere downstream.
 *
 * A failed write is deliberately swallowed rather than thrown. Seeding is a
 * convenience, and the caller here is a plain read — a full store shouldn't
 * turn browsing the library into an error. The marker stays unset, so the next
 * read tries again once there's room.
 */
function seedOnce(map: ArtifactMap): ArtifactMap {
  if (window.localStorage.getItem(SEEDED_KEY)) return map;
  for (const artifact of SEED_ARTIFACTS) {
    if (!map[artifact.id]) map[artifact.id] = artifact;
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
    window.localStorage.setItem(SEEDED_KEY, '1');
  } catch {
    // Retried on the next read.
  }
  return map;
}

function write(map: ArtifactMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Quota is the only realistic failure here, and it matters: the caller
    // must not report a successful upload that didn't persist.
    throw new ArtifactError(
      'The library is full. Delete some artifacts and try again.',
    );
  }
}

const now = () => new Date().toISOString();

/** Everything in one folder, newest first. */
export function listArtifacts(folderId: ArtifactFolderId): StoredArtifact[] {
  return Object.values(read())
    .filter((a) => a.folderId === folderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Item counts for every folder, for the folder-grid subtitles. */
export function countByFolder(): Record<ArtifactFolderId, number> {
  // Derived from the folder list so a new folder can't be missed here.
  const counts = Object.fromEntries(
    ARTIFACT_FOLDERS.map((f) => [f.id, 0]),
  ) as Record<ArtifactFolderId, number>;
  for (const a of Object.values(read())) {
    if (a.folderId in counts) counts[a.folderId] += 1;
  }
  return counts;
}

export function getArtifact(id: string): StoredArtifact | null {
  return read()[id] ?? null;
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^./]+$/, '');
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new ArtifactError(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/**
 * Intrinsic size of a data URL. Resolves 0×0 rather than rejecting: an SVG
 * without width/height attributes has no intrinsic size, and that's not a
 * reason to refuse the upload.
 */
function measure(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

/**
 * Validate, read and persist one uploaded file. Throws `ArtifactError` with a
 * user-facing message on a rejected type, an oversized file, or a full store.
 */
export async function addArtifact(file: File, folderId: ArtifactFolderId): Promise<StoredArtifact> {
  if (!ACCEPTED.includes(file.type)) {
    throw new ArtifactError(`${file.name} isn't a supported image (PNG, JPEG, SVG, GIF or WebP).`);
  }
  if (file.size > MAX_BYTES) {
    throw new ArtifactError(
      `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_BYTES)}.`,
    );
  }
  const src = await readAsDataUrl(file);
  const { width, height } = await measure(src);
  const artifact: StoredArtifact = {
    id: `art-${nanoid(8)}`,
    folderId,
    name: stripExt(file.name),
    src,
    mime: file.type,
    bytes: file.size,
    width,
    height,
    createdAt: now(),
  };
  // Re-read rather than reusing an earlier snapshot: uploads are awaited one
  // at a time, and each needs to land on top of the previous one's write.
  const map = read();
  map[artifact.id] = artifact;
  write(map);
  return artifact;
}

export function renameArtifact(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const map = read();
  if (!map[id]) return;
  map[id] = { ...map[id], name: trimmed };
  write(map);
}

export function deleteArtifact(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
