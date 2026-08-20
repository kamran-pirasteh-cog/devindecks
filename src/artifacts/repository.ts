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
import { defineCollection } from '@/platform/collection';
import { localStorageAdapter } from '@/platform/store';

export type ArtifactFolderId =
  | 'images'
  | 'cognition-logos'
  | 'client-logos'
  | 'cognition-brand-graphics'
  | 'icons'
  | 'team-photos'
  | 'case-studies'
  | 'product-content'
  | 'industry-credentials';

export interface ArtifactFolder {
  id: ArtifactFolderId;
  name: string;
  /**
   * Set on a subfolder. A folder with children is a grouping only — artifacts
   * live in the leaves, which is what keeps `folderId` a single unambiguous
   * classification and leaves no "in the parent, not a child" state to sort out.
   */
  parentId?: ArtifactFolderId;
}

export const ARTIFACT_FOLDERS: ArtifactFolder[] = [
  { id: 'images', name: 'Images' },
  { id: 'client-logos', name: 'Client Logos', parentId: 'images' },
  { id: 'cognition-logos', name: 'Cognition Logos', parentId: 'images' },
  { id: 'cognition-brand-graphics', name: 'Cognition Graphics', parentId: 'images' },
  { id: 'team-photos', name: 'Team Photos', parentId: 'images' },
  { id: 'icons', name: 'Icons' },
  { id: 'case-studies', name: 'Case Studies' },
  { id: 'product-content', name: 'Product Content' },
  { id: 'industry-credentials', name: 'Industry Credentials' },
];

/** The folders shown at the top of the library. */
export const ROOT_ARTIFACT_FOLDERS = ARTIFACT_FOLDERS.filter((f) => !f.parentId);

/** Subfolders of `id`, in declaration order. Empty for a leaf folder. */
export function childFolders(id: ArtifactFolderId): ArtifactFolder[] {
  return ARTIFACT_FOLDERS.filter((f) => f.parentId === id);
}

/** Only leaves take uploads — see the note on `ArtifactFolder.parentId`. */
export function isLeafFolder(id: ArtifactFolderId): boolean {
  return childFolders(id).length === 0;
}

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

/**
 * The last flush failure, waiting to be reported to whoever caused it.
 *
 * `Collection.flushed()` deliberately never rejects — one failed background
 * write must not become an unhandled rejection that takes the app down — so a
 * failure is recorded here and claimed by `confirmWrite` instead.
 */
let flushError: unknown = null;

const collection = defineCollection<StoredArtifact>(KEY, localStorageAdapter, {
  onFlushError: (err) => {
    flushError = err;
  },
});

/** Hydrate from the adapter — only needed once that adapter is a remote one. */
export const hydrateArtifacts = () => collection.hydrate();
export const subscribeArtifacts = collection.subscribe;

function read(): ArtifactMap {
  // The window guard used to live on the localStorage read this replaced.
  // `seedOnce` still needs it: there is no storage on the server, and the
  // seed marker it consults is not part of this collection.
  if (typeof window === 'undefined') return {};
  return seedOnce(collection.snapshot());
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
  const seeded = { ...map };
  for (const artifact of SEED_ARTIFACTS) {
    if (!seeded[artifact.id]) seeded[artifact.id] = artifact;
  }
  // Through the collection, not straight to storage: writing behind its back
  // would leave the in-memory snapshot disagreeing with what's on disk until
  // the next reload.
  collection.replace(seeded);
  try {
    window.localStorage.setItem(SEEDED_KEY, '1');
  } catch {
    // Retried on the next read.
  }
  return seeded;
}

function write(map: ArtifactMap) {
  collection.replace(map);
}

/**
 * Wait for the write to actually land, and turn a failure into the
 * user-facing error.
 *
 * Quota is the only realistic failure, and it matters more here than anywhere
 * else in the app: the library shares one ~5MB origin with everything else, so
 * reporting a successful upload that didn't persist shows the user an asset
 * that vanishes on reload. Writes are asynchronous now, so the error arrives
 * through the flush rather than out of `write` — this is the only call site
 * that has to care, and it's `async` already.
 */
async function confirmWrite(): Promise<void> {
  flushError = null;
  await collection.flushed();
  if (flushError) {
    flushError = null;
    throw new ArtifactError('The library is full. Delete some artifacts and try again.');
  }
}

const now = () => new Date().toISOString();

/** Everything in one folder, newest first. */
export function listArtifacts(folderId: ArtifactFolderId): StoredArtifact[] {
  return Object.values(read())
    .filter((a) => a.folderId === folderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Item counts for every folder, for the folder-grid subtitles. A parent's count
 * rolls up its children, so "Images" reads as the size of everything under it
 * rather than the zero it holds directly.
 */
export function countByFolder(): Record<ArtifactFolderId, number> {
  // Derived from the folder list so a new folder can't be missed here.
  const counts = Object.fromEntries(
    ARTIFACT_FOLDERS.map((f) => [f.id, 0]),
  ) as Record<ArtifactFolderId, number>;
  for (const a of Object.values(read())) {
    if (a.folderId in counts) counts[a.folderId] += 1;
  }
  for (const folder of ARTIFACT_FOLDERS) {
    if (folder.parentId) counts[folder.parentId] += counts[folder.id];
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
  await confirmWrite();
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
