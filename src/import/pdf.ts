'use client';

/**
 * PDF -> slides.
 *
 * A PDF page has no shapes, only drawing operators, so there is nothing
 * honest to map onto the model's primitives — reconstructing "the rectangle
 * the designer drew" from fill/stroke ops is guesswork that looks right until
 * it doesn't. Each page therefore imports as ONE full-bleed picture, which is
 * exactly what the page looked like, plus its extracted text as a hidden
 * `notes` entry so the slide is still searchable.
 *
 * Deck geometry comes from the page's own size (points -> EMU), so a US-Letter
 * PDF doesn't get letterboxed into 16:9.
 */
import { nanoid } from 'nanoid';
import { EMU_PER_POINT, type Slide } from '@/model';
import type { ImportedDeck, ImportedSlide } from './pptx';

/** Raster density. 2× the slide's own size keeps text crisp when zoomed. */
const RENDER_SCALE = 2;

export async function parsePdf(buffer: ArrayBuffer): Promise<ImportedDeck> {
  const pdfjs = await import('pdfjs-dist');
  // The worker ships with the package; resolving it through import.meta.url
  // keeps it in the bundle rather than reaching for a CDN at runtime.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;
  const notes: string[] = [];
  const slides: ImportedSlide[] = [];
  let slideSize = { w: 0, h: 0 };

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const size = {
      w: Math.round(viewport.width * EMU_PER_POINT),
      h: Math.round(viewport.height * EMU_PER_POINT),
    };
    if (n === 1) slideSize = size;

    const canvas = document.createElement('canvas');
    const scaled = page.getViewport({ scale: RENDER_SCALE });
    canvas.width = Math.ceil(scaled.width);
    canvas.height = Math.ceil(scaled.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a canvas to render the PDF');

    await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;

    // JPEG at high quality: a 20-page deck of PNG pages is ~10× the bytes and
    // these are photographic-ish rasters, not flat-colour art.
    const src = canvas.toDataURL('image/jpeg', 0.92);

    const text = await pageText(page);

    const slide: Slide = {
      id: `sl_${nanoid(8)}`,
      elements: [
        {
          id: nanoid(10),
          type: 'picture',
          name: `Page ${n}`,
          src,
          rect: { x: 0, y: 0, w: size.w, h: size.h },
        },
      ],
      background: { kind: 'solid', color: { kind: 'hex', hex: '#FFFFFF' } },
      notes: text || undefined,
    };

    slides.push({
      slide,
      sourceIndex: n,
      notes:
        n === 1
          ? ['PDF pages import as images — the page is exact, but not editable.']
          : [],
    });

    page.cleanup();
  }

  if (slides.some((s) => s.slide.elements[0].rect.w !== slideSize.w)) {
    notes.push('This PDF mixes page sizes; every page was placed at the first page’s size.');
  }

  await task.destroy();
  return { slideSize, slides, notes };
}

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

async function pageText(page: {
  getTextContent: () => Promise<{ items: unknown[] }>;
}): Promise<string> {
  try {
    const content = await page.getTextContent();
    return (content.items as TextItemLike[])
      .map((i) => (i.str ?? '') + (i.hasEOL ? '\n' : ''))
      .join('')
      .trim();
  } catch {
    return '';
  }
}
