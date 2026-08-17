/**
 * Turns a reference .pptx into a bundled template: RawSlide JSON in
 * `src/templates/data/<slug>.json` plus its images under
 * `public/templates/<slug>/assets/`.
 *
 * Run with `npm run import:deck -- <file.pptx> <slug>`.
 *
 * This is the generator behind the decks registered in `templates/registry.ts`.
 * It runs the SAME `parsePptx` the in-app importer uses, so a bundled deck and
 * an uploaded one differ only in where the pictures live: the parser hands back
 * `data:` URLs (right for a one-off upload, ruinous for a file that gets parsed
 * on every template build), so each one is written out once, content-addressed,
 * and the element points at the public path instead.
 *
 * Element ids are placeholders — `ingestSlides` reassigns them at build time —
 * but they're kept stable and sequential so a re-import produces a readable diff.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DEFAULT_DESIGN_SYSTEM, SLIDE_16x9 } from '@/model';
import type { Slide, SlideElement } from '@/model';
import { fitSlide, isIdentity, placementFor } from '@/import/fit';
import { parsePptx } from '@/import/pptx';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function usage(): never {
  console.error('usage: npm run import:deck -- <file.pptx> <slug>');
  process.exit(1);
}

/**
 * Write a `data:` URL out as a file and return its public path. Named by a hash
 * of the bytes, so an image reused across slides is stored once and a re-import
 * of an unchanged deck rewrites identical filenames.
 */
function writeAsset(dataUrl: string, assetDir: string, slug: string): string | null {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const [, mime, b64] = m;
  const ext = MIME_EXT[mime];
  if (!ext) return null;
  const bytes = Buffer.from(b64, 'base64');
  const name = `img-${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
  writeFileSync(join(assetDir, name), bytes);
  return `/templates/${slug}/assets/${name}`;
}

function externalizePictures(el: SlideElement, assetDir: string, slug: string): SlideElement {
  if (el.type !== 'picture' || !el.src.startsWith('data:')) return el;
  const src = writeAsset(el.src, assetDir, slug);
  if (!src) {
    console.warn(`  ! unsupported image format on ${el.id}; left inline`);
    return el;
  }
  return { ...el, src };
}

async function main() {
  const [file, slug] = process.argv.slice(2);
  if (!file || !slug) usage();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    console.error(`slug ${JSON.stringify(slug)} must be kebab-case ([a-z0-9-]).`);
    process.exit(1);
  }

  const buf = readFileSync(file);
  const deck = await parsePptx(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    DEFAULT_DESIGN_SYSTEM,
  );

  /**
   * Fit the source page onto the app's canvas, through the SAME `fitSlide` an
   * uploaded deck goes through in the import dialog.
   *
   * A bundled slide carries no size of its own — a document is always
   * SLIDE_16x9 — so a source authored at PowerPoint's other widescreen size
   * (10in x 5.625in: 16:9, three quarters the measurements) would otherwise sit
   * in the top-left three quarters of every slide. Uploads never had that
   * problem because the dialog fits them on insert; this is the one path that
   * used to skip it.
   */
  const placement = placementFor(deck.slideSize, SLIDE_16x9);
  if (!isIdentity(placement)) {
    console.log(
      `  fitting source to the canvas: ${placement.scale.toFixed(4)}x` +
        (placement.dx || placement.dy ? `, centred +${placement.dx},${placement.dy} EMU` : ''),
    );
  }

  const assetDir = join(process.cwd(), 'public/templates', slug, 'assets');
  rmSync(join(process.cwd(), 'public/templates', slug), { recursive: true, force: true });
  mkdirSync(assetDir, { recursive: true });

  const raw = deck.slides.map(({ slide }: { slide: Slide }) => {
    let n = 0;
    const fitted = fitSlide(slide, placement);
    return {
      elements: fitted.elements.map((el) =>
        externalizePictures({ ...el, id: `el-${++n}` }, assetDir, slug),
      ),
      background: fitted.background,
    };
  });

  const out = join(process.cwd(), 'src/templates/data', `${slug}.json`);
  writeFileSync(out, JSON.stringify(raw, null, 1));

  const elements = raw.reduce((sum, s) => sum + s.elements.length, 0);
  console.log(
    `${basename(file)} -> ${slug}: ${raw.length} slides, ${elements} elements\n` +
      `  json   ${out}\n` +
      `  assets ${assetDir}`,
  );
  for (const note of deck.notes) console.log(`  note: ${note}`);
  const slideNotes = new Set(deck.slides.flatMap((s) => s.notes));
  for (const note of slideNotes) console.log(`  note: ${note}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
