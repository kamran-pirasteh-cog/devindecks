/**
 * Artifacts the library ships with — the Cognition and Devin brand marks, which
 * every deck reaches for and nobody should have to upload.
 *
 * These are the one kind of artifact whose bytes aren't inline: `src` is a path
 * under `public/`, not a data URL. Uploads have to be data URLs because the
 * bytes arrive from a file picker with nowhere to live, but a seeded asset is
 * already served by the app, and half a megabyte of base64 would be a large
 * bite out of the ~5MB the whole library shares (see `repository.ts`). Both
 * forms drop into a `PictureElement.src` unchanged, and the PPTX exporter
 * already branches on the `data:` prefix to pick `data` vs `path` — the same
 * split the imported-template assets under `public/templates/` rely on.
 *
 * `createdAt` is fixed rather than generated: the grid sorts newest-first, so
 * hardcoded stamps are what keep this list in a deliberate order instead of
 * whatever order the seed happened to run in.
 */
import type { ArtifactFolderId, StoredArtifact } from './repository';

const FOLDER: ArtifactFolderId = 'cognition-logos';

function seed(
  slug: string,
  name: string,
  bytes: number,
  width: number,
  height: number,
  createdAt: string,
): StoredArtifact {
  return {
    // A stable, derived id — not a nanoid. Re-seeding has to be able to see
    // that an entry is already there rather than adding a second copy.
    id: `seed-${slug}`,
    folderId: FOLDER,
    name,
    src: `/artifacts/cognition-logos/${slug}.png`,
    mime: 'image/png',
    bytes,
    width,
    height,
    createdAt,
  };
}

export const SEED_ARTIFACTS: StoredArtifact[] = [
  seed('cognition-wordmark-black', 'Cognition wordmark (black)', 41_157, 3020, 584, '2026-01-01T00:00:06.000Z'),
  seed('cognition-wordmark-white', 'Cognition wordmark (white)', 44_100, 3020, 584, '2026-01-01T00:00:05.000Z'),
  seed('cognition-mark-black', 'Cognition mark (black)', 118_765, 2800, 3200, '2026-01-01T00:00:04.000Z'),
  seed('devin-wordmark-black', 'Devin wordmark (black)', 24_044, 1988, 529, '2026-01-01T00:00:03.000Z'),
  seed('devin-wordmark-white', 'Devin wordmark (white)', 25_825, 1988, 529, '2026-01-01T00:00:02.000Z'),
  seed('devin-mark-black', 'Devin mark (black)', 93_939, 2800, 3200, '2026-01-01T00:00:01.000Z'),
];
