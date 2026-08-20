/**
 * Runs real presentations through the brand conversion engine and fails on any
 * defect. `npm run validate:brand`.
 *
 * This is the script that makes "converted decks are defect free" a property of
 * the system rather than a claim about it. The unit tests in `src/brand` prove
 * each rule in isolation against slides written to exercise that rule; this
 * proves the whole pipeline against decks nobody wrote for it — which is the
 * only place the interesting failures live.
 *
 * Two ways to run it:
 *
 *   - Point it at a corpus: put .pptx files in `fixtures/brand-corpus/` and they
 *     are parsed with the real importer and converted. That's the mode that
 *     matters; seed it with actual client decks.
 *   - With no corpus, it falls back to the three BUNDLED reference decks
 *     (`src/templates/data/*.json`). Those are already on-brand, so converting
 *     them is a weaker test — but it is a real end-to-end run, it needs no
 *     fixtures to exist, and it catches a regression that breaks the pipeline
 *     outright. CI gets a signal from day one either way.
 *
 * Exit code is 1 on any error-severity diagnostic. Warnings and info are printed
 * and do not fail: an off-margin element or an off-ladder shrink is a judgement
 * call, and a gate that fails on judgement calls gets switched off.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SLIDE_16x9 } from '../src/model/units';
import { DEFAULT_DESIGN_SYSTEM } from '../src/model/tokens';
import { ingestSlides, summarize, type Diagnostic, type RawSlide } from '../src/model/ingest';
import { metricMeasurer } from '../src/render/measureText';
import { convertDeck } from '../src/brand/convert';
import type { Slide } from '../src/model/types';

const CORPUS_DIR = join(process.cwd(), 'fixtures/brand-corpus');
const BUNDLED_DIR = join(process.cwd(), 'src/templates/data');

/** Codes that are informational by nature and never worth printing in bulk. */
const QUIET_CODES = new Set(['size-off-ladder']);

interface Case {
  name: string;
  slides: Slide[];
}

/** Load the bundled reference decks through the same ingestion gate the app uses. */
function bundledCases(): Case[] {
  if (!existsSync(BUNDLED_DIR)) return [];
  return readdirSync(BUNDLED_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(BUNDLED_DIR, file), 'utf8')) as RawSlide[];
      let n = 0;
      const { slides } = ingestSlides(raw, {
        designSystem: DEFAULT_DESIGN_SYSTEM,
        slideSize: SLIDE_16x9,
        slideId: () => `s-${++n}`,
        elementId: (t) => `${t}-${++n}`,
      });
      return { name: `${file} (bundled)`, slides };
    });
}

/**
 * Load .pptx files from the corpus.
 *
 * `parsePptx` is browser-and-Node alike — `import/zip.ts` uses only WHATWG
 * `DecompressionStream`, which Node has had since 18 — so the corpus goes
 * through the exact code path an upload does.
 */
async function corpusCases(): Promise<Case[]> {
  if (!existsSync(CORPUS_DIR)) return [];
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.pptx'));
  if (!files.length) return [];

  const { parsePptx } = await import('../src/import/pptx/index');
  const cases: Case[] = [];
  for (const file of files) {
    const bytes = readFileSync(join(CORPUS_DIR, file));
    try {
      // `parsePptx` takes an ArrayBuffer, and a Node Buffer is a VIEW onto a
      // possibly-larger pool — so hand over a copy of just this file's bytes
      // rather than `bytes.buffer`, which can carry a neighbour's data.
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const deck = await parsePptx(buffer, DEFAULT_DESIGN_SYSTEM);
      cases.push({ name: file, slides: deck.slides.map((s) => s.slide) });
    } catch (err) {
      console.error(`\nFAIL  ${file} — could not be parsed: ${(err as Error).message}`);
      cases.push({ name: file, slides: [] });
    }
  }
  return cases;
}

function report(name: string, diagnostics: Diagnostic[], slideCount: number, clean: boolean) {
  const { errors, warnings, info } = summarize(diagnostics);
  const status = errors > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'OK';
  console.log(
    `\n${status}  ${name} — ${slideCount} slides, ` +
      `${errors} error(s), ${warnings} warning(s), ${info} note(s)` +
      `${clean ? '' : '  [not clean]'}`,
  );

  // Grouped by code AND severity. Severity has to be part of the key: the same
  // code can be an error on one slide and a note on another (`text-overflow`
  // depends on whether the spill actually lands on anything), and grouping on
  // the code alone printed one bucket labelled `error` whose example was a note.
  const byCode = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const key = `${d.severity}|${d.code}`;
    byCode.set(key, [...(byCode.get(key) ?? []), d]);
  }
  for (const [key, list] of [...byCode.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const [worst, code] = key.split('|');
    if (QUIET_CODES.has(code)) {
      console.log(`    [${worst}] ${code} ×${list.length}`);
      continue;
    }
    const slidesHit = [...new Set(list.map((d) => d.slide))].sort((a, b) => a - b);
    console.log(
      `    [${worst}] ${code} ×${list.length} (slides ${slidesHit.slice(0, 12).join(', ')}` +
        `${slidesHit.length > 12 ? ', …' : ''})\n        e.g. ${list[0].message}`,
    );
  }
}

async function main() {
  const corpus = await corpusCases();
  const cases = corpus.length ? corpus : bundledCases();

  if (!cases.length) {
    console.error(
      `No decks to validate.\n` +
        `  Put .pptx files in ${CORPUS_DIR}, or keep the bundled decks in ${BUNDLED_DIR}.`,
    );
    process.exit(1);
  }

  if (!corpus.length) {
    console.log(
      'No corpus found — falling back to the bundled reference decks.\n' +
        `Add real .pptx files to ${CORPUS_DIR} for a meaningful gate.`,
    );
  }

  let totalErrors = 0;
  let notClean = 0;

  for (const testCase of cases) {
    // The deterministic measurer, so this gate agrees with the unit tests and
    // with the SSR thumbnails rather than with whatever fonts a CI box has.
    let n = 0;
    const { slides, diagnostics, report: conversion } = convertDeck(testCase.slides, {
      ds: DEFAULT_DESIGN_SYSTEM,
      slideSize: SLIDE_16x9,
      measurer: metricMeasurer(),
      newId: (prefix) => `${prefix}_${++n}`,
    });

    const { errors } = summarize(diagnostics);
    totalErrors += errors;
    if (!conversion.clean) notClean += 1;
    report(testCase.name, diagnostics, slides.length, conversion.clean);

    // Structural invariants, checked here as well as in the unit tests: these
    // are the properties a converted deck must have whatever it came from, and
    // a corpus deck is exactly where an untested combination would break one.
    for (const slide of slides) {
      for (const el of slide.elements) {
        const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
        for (const p of body?.paragraphs ?? []) {
          for (const run of p.runs ?? []) {
            if (run.color && run.color.kind !== 'token') {
              console.error(`    INVARIANT: raw hex on run in ${el.id} (${testCase.name})`);
              totalErrors += 1;
            }
            if (run.sizePt === undefined) {
              console.error(`    INVARIANT: run with no size in ${el.id} (${testCase.name})`);
              totalErrors += 1;
            }
          }
        }
      }
    }
  }

  console.log(
    `\n${totalErrors === 0 ? 'PASS' : 'FAIL'}: ${cases.length} deck(s) converted, ` +
      `${totalErrors} error(s), ${notClean} not clean.`,
  );
  process.exit(totalErrors > 0 ? 1 : 0);
}

void main();
