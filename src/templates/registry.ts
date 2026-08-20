/**
 * Deck template registry — the built-in starter decks, as the code ships them.
 *
 * These are the SEED, not the library: `repository.ts` copies them into the
 * template store on first run, and Admin's Templates tab authors and versions
 * them from there (`resetBuiltInTemplates` is the way back to what's here).
 * Each template only uses safe primitives, so anything created from one is
 * export-safe by birth.
 */
import { nanoid } from 'nanoid';
import { token } from '@/model';
import type { Slide } from '@/model';
import { DECK_DATA, importedDeckSlides } from './decks';

/**
 * The buckets a deck template files under, in the order Admin offers them.
 * A tuple rather than a bare union so the Admin shelf can enumerate it — the
 * category dropdown and the type stay one list.
 */
export const TEMPLATE_CATEGORIES = [
  'Business Review',
  'Value',
  'Enablement',
  'Blank',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Lower sorts first; built-ins without an order fall to the end, alphabetically. */
  order?: number;
  buildSlides: () => Slide[];
}

const sid = () => `s-${nanoid(8)}`;

const surface = { kind: 'solid', color: token('surface.base') } as const;


/**
 * Slide layouts live in `slideLayouts.ts` — a shelf of SmartArt-style families
 * rather than the four buckets this file used to carry. Re-exported here
 * because every call site already reaches for them through the registry.
 */
export {
  BUILTIN_LAYOUT_IDS,
  CATEGORY_BLURBS,
  DECK_LABELS,
  LAYOUT_CATEGORY_MOVES,
  LAYOUT_SOURCES,
  RETIRED_LAYOUT_IDS,
  SLIDE_LAYOUT_CATEGORIES,
  SLIDE_LAYOUTS,
  type SlideLayoutCategory,
  type SlideLayoutDef,
} from './slideLayouts';
export { deckSlide, importedDeckSlides, type DeckSlug } from './decks';

/**
 * The three reference decks are the standard, so they're the whole list: every
 * new document starts from one of them (or from Blank). The synthetic starter
 * decks that used to live here — QBR / BVA / Power User, assembled from local
 * `titleSlide`/`sectionSlide`/`kpiSlide` helpers — are gone, and those helpers
 * with them; slide-level starting points now come from `slideLayouts.ts`.
 */
export const TEMPLATES: TemplateDef[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Start from an empty slide.',
    category: 'Blank',
    buildSlides: () => [{ id: sid(), background: surface, elements: [] }],
  },
  {
    id: 'wayfair-reskin',
    name: 'Wayfair Reskin',
    description: 'Standard reference deck: the Wayfair reskin. Every text box and shape is directly editable.',
    category: 'Business Review',
    order: 0,
    buildSlides: () => importedDeckSlides(DECK_DATA['wayfair-reskin']),
  },
  {
    id: 'bva-pitch',
    name: 'BVA Pitch',
    description: 'Standard reference deck: business value analysis pitch. Every text box and shape is directly editable.',
    category: 'Value',
    order: 1,
    buildSlides: () => importedDeckSlides(DECK_DATA['bva-pitch']),
  },
  {
    id: 'fiserv-exec-readout',
    name: 'Fiserv Exec Readout',
    description: 'Standard reference deck: the Fiserv executive readout. Every text box and shape is directly editable.',
    category: 'Business Review',
    order: 2,
    buildSlides: () => importedDeckSlides(DECK_DATA['fiserv-exec-readout']),
  },
];

/**
 * Built-ins that shipped before and no longer exist. The template store seeds
 * built-ins into localStorage, so a removed one would otherwise live on forever
 * in every browser that had already seen it — this list is what lets the store
 * clear them out without touching templates Admin authored.
 */
export const RETIRED_TEMPLATE_IDS = [
  'wave-one-exec-readout',
  'qbr',
  'bva',
  'power-user',
] as const;

export const getTemplate = (id: string): TemplateDef | undefined =>
  TEMPLATES.find((t) => t.id === id);
