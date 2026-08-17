/**
 * The bundled reference decks, and the one way into them.
 *
 * Both the deck templates (`registry.ts`) and the slide layouts
 * (`slideLayouts.ts`) are built from this data, so it lives here rather than in
 * either of them — a layout that pulled slide 11 out of the BVA deck through
 * the registry would make the two files import each other.
 */
import { DEFAULT_DESIGN_SYSTEM, SLIDE_16x9 } from '@/model';
import type { Slide } from '@/model';
import { ingestSlides, type RawSlide } from '@/model/ingest';
import { nanoid } from 'nanoid';
import bvaPitchSlides from './data/bva-pitch.json';
import fiservExecReadoutSlides from './data/fiserv-exec-readout.json';
import wayfairReskinSlides from './data/wayfair-reskin.json';

export type DeckSlug = 'bva-pitch' | 'fiserv-exec-readout' | 'wayfair-reskin';

export const DECK_DATA: Record<DeckSlug, RawSlide[]> = {
  'bva-pitch': bvaPitchSlides as RawSlide[],
  'fiserv-exec-readout': fiservExecReadoutSlides as RawSlide[],
  'wayfair-reskin': wayfairReskinSlides as RawSlide[],
};

const sid = () => `s-${nanoid(8)}`;
const eid = (p: string) => `${p}-${nanoid(6)}`;

/**
 * A deck imported element-by-element (text boxes, shapes, lines, pictures) from a
 * reference .pptx, so every run and rect is directly editable — not a flattened
 * screenshot. Fresh ids are assigned per build so re-inserting never collides.
 *
 * Everything from outside the app goes through `ingestSlides`, which resolves
 * inherited run styling to explicit values and reports fidelity risks. Run
 * `npm run validate:decks` to see the diagnostics for the bundled decks; here we
 * only surface errors, and only in dev, since a template build is a hot path.
 *
 * Normalization resolves against DEFAULT_DESIGN_SYSTEM, not the *active* one, on
 * purpose: an imported deck should look the way it was imported, so a later
 * brand edit must not retroactively resize runs whose size the source file
 * omitted. It also keeps this path identical to `npm run validate:decks`.
 */
export function importedDeckSlides(raw: RawSlide[]): Slide[] {
  const { slides, diagnostics } = ingestSlides(raw, {
    designSystem: DEFAULT_DESIGN_SYSTEM,
    slideSize: SLIDE_16x9,
    slideId: sid,
    elementId: eid,
  });

  if (process.env.NODE_ENV !== 'production') {
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      console.warn(
        `[ingest] ${errors.length} error(s) in imported deck:\n` +
          errors.map((d) => `  slide ${d.slide}: ${d.code} — ${d.message}`).join('\n'),
      );
    }
  }

  return slides;
}

/**
 * One slide out of a bundled deck, by its position in the source file as a
 * human counts them (slide 1 is `n = 1`, matching the deck's own page numbers
 * and `validate:decks` output).
 *
 * This is what makes a layout a REPLICA rather than a lookalike: the slide runs
 * through the same ingestion the whole deck does, so it arrives with the source
 * file's geometry, type and imagery intact, down to the rect.
 */
export function deckSlide(deck: DeckSlug, n: number): Slide {
  const raw = DECK_DATA[deck][n - 1];
  if (!raw) throw new Error(`${deck} has no slide ${n}`);
  return importedDeckSlides([raw])[0];
}
