'use client';

/**
 * The import entry point: a file the user picked -> slides they can choose
 * from. Format detection is by MAGIC BYTES first (a .pptx renamed to .ppt is
 * still a zip, and browsers hand out empty MIME types often enough that
 * trusting `file.type` would reject good files).
 */
import type { DesignSystem } from '@/model';
import { parsePptx, type ImportedDeck } from './pptx';

export type { ImportedDeck, ImportedSlide } from './pptx';

export const IMPORT_ACCEPT = '.pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation';

export async function parseImportFile(
  file: File,
  ds: DesignSystem,
): Promise<ImportedDeck> {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 5));

  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK"
  const isPdf =
    head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // "%PDF"

  if (isPdf) {
    const { parsePdf } = await import('./pdf');
    return parsePdf(buffer);
  }

  if (isZip) {
    const deck = await parsePptx(buffer, ds);
    if (!deck.slides.length) {
      throw new ImportError(
        'That file is a zip but has no slides in it — .ppt and .key files need to be saved as .pptx or PDF first.',
      );
    }
    return deck;
  }

  throw new ImportError(
    `“${file.name}” isn’t a .pptx or a PDF. Older .ppt files and Keynote files have to be exported to one of those first.`,
  );
}

export class ImportError extends Error {}
