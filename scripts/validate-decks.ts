/**
 * Validates every bundled reference deck through the real ingestion gate, and
 * fails the build on errors. Run with `npm run validate:decks`.
 *
 * This exists because the defects that break imported decks are invisible to
 * both TypeScript and ESLint: a text run missing `sizePt`, a rect with zero
 * height, a font outside the allowed set, a picture with no `src`. They all
 * typecheck cleanly and only show up as a visibly wrong slide. This is the
 * gate that catches them before a human has to notice.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SLIDE_16x9 } from '../src/model/units';
import { DEFAULT_DESIGN_SYSTEM } from '../src/model/tokens';
import { ingestSlides, summarize, type Diagnostic, type RawSlide } from '../src/model/ingest';

const DATA_DIR = join(process.cwd(), 'src/templates/data');

let totalErrors = 0;
let totalWarnings = 0;

const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));

if (files.length === 0) {
  console.error(`No deck JSON found in ${DATA_DIR}`);
  process.exit(1);
}

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as RawSlide[];

  let n = 0;
  const { slides, diagnostics } = ingestSlides(raw, {
    designSystem: DEFAULT_DESIGN_SYSTEM,
    slideSize: SLIDE_16x9,
    slideId: () => `s-${++n}`,
    elementId: (t) => `${t}-${++n}`,
  });

  const { errors, warnings } = summarize(diagnostics);
  totalErrors += errors;
  totalWarnings += warnings;

  const elements = slides.reduce((sum, s) => sum + s.elements.length, 0);
  const status = errors > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'OK';
  console.log(
    `\n${status}  ${file} — ${slides.length} slides, ${elements} elements, ` +
      `${errors} error(s), ${warnings} warning(s)`,
  );

  // Group by code so a systemic problem reads as one line, not 200.
  const byCode = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const list = byCode.get(d.code) ?? [];
    list.push(d);
    byCode.set(d.code, list);
  }

  for (const [code, list] of [...byCode.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const worst = list.some((d) => d.severity === 'error') ? 'error' : 'warning';
    const slidesHit = [...new Set(list.map((d) => d.slide))].sort((a, b) => a - b);
    console.log(
      `    [${worst}] ${code} ×${list.length} (slides ${slidesHit.join(', ')})\n` +
        `        e.g. ${list[0].message}`,
    );
  }
}

console.log(
  `\n${totalErrors === 0 ? 'PASS' : 'FAIL'}: ${files.length} deck(s), ` +
    `${totalErrors} error(s), ${totalWarnings} warning(s).`,
);

process.exit(totalErrors > 0 ? 1 : 0);
