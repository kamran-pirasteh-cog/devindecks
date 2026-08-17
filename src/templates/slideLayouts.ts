/**
 * Single-slide layouts, bucketed into families the way PowerPoint buckets
 * SmartArt: pick the SHAPE of the idea (a list, a process, a comparison, a
 * hierarchy) and get a slide already arranged for it.
 *
 * Every layout is a REPLICA — an actual slide lifted out of one of the three
 * standard reference decks, through the same ingestion the decks themselves
 * use, so the geometry, type, rules and imagery are the source file's, not an
 * approximation of it. Hand-authored lookalikes were the first attempt here and
 * they were wrong in the way that matters: a layout is only worth reaching for
 * if what lands on the canvas is the slide you have already seen approved.
 *
 * That makes the copy real too. "Ties to a hard ROI metric / Concrete P&L
 * variable: FTE contractor cuts, licenses, velocity" tells an author how long
 * the row runs and in what register; "Body text here" tells them nothing until
 * they have already ruined the slide. Customer names stay as the decks have
 * them — the Wayfair deck's own `[Company]` placeholders included.
 *
 * The families are drawn from what the decks actually contain. There is no
 * Cycle family because none of the three decks has a cycle slide, and an empty
 * album promising one would be a worse lie than a missing family.
 */
import { nanoid } from 'nanoid';
import { SLIDE_16x9, token } from '@/model';
import type { Slide } from '@/model';
import { deckSlide, type DeckSlug } from './decks';

export type SlideLayoutCategory =
  | 'Title'
  | 'Section'
  | 'List'
  | 'Process'
  | 'Hierarchy'
  | 'Timeline'
  | 'Comparison'
  | 'Matrix'
  | 'Metrics'
  | 'Chart'
  | 'Table'
  | 'Quote'
  | 'Proof'
  | 'Blank';

export const SLIDE_LAYOUT_CATEGORIES: SlideLayoutCategory[] = [
  'Title',
  'Section',
  'List',
  'Process',
  'Hierarchy',
  'Timeline',
  'Comparison',
  'Matrix',
  'Metrics',
  'Chart',
  'Table',
  'Quote',
  'Proof',
  'Blank',
];

/** One line about what belongs in each family, for the album shelf. */
export const CATEGORY_BLURBS: Record<SlideLayoutCategory, string> = {
  Title: 'Openers and covers.',
  Section: 'Dividers and single-statement slides.',
  List: 'Parallel points, numbered or plain.',
  Process: 'Steps that run in one direction.',
  Hierarchy: 'People, teams and reporting structure.',
  Timeline: 'Anything ordered by when it happens.',
  Comparison: 'Two or three things held side by side.',
  Matrix: 'A grid of cells read both ways.',
  Metrics: 'Numbers that carry the slide.',
  Chart: 'A chart and the takeaway it earns.',
  Table: 'Dense figures, read row by row.',
  Quote: 'Customer voice, verbatim.',
  Proof: 'Logos and third-party evidence.',
  Blank: 'Start empty.',
};

/** Retired families and where their layouts moved, so a bump can re-bucket them. */
export const LAYOUT_CATEGORY_MOVES: Record<string, SlideLayoutCategory> = {
  KPI: 'Metrics',
  // The hand-authored pass shipped a Cycle family; the decks have no cycle
  // slide, so anything filed there lands in Process, its nearest real family.
  Cycle: 'Process',
};

export interface SlideLayoutDef {
  id: string;
  name: string;
  layout: SlideLayoutCategory;
  /** Where the replica comes from, shown as provenance in Admin. */
  source?: { deck: DeckSlug; slide: number };
  buildSlide: () => Slide;
}

/** Short deck labels for ids and for the "from" line on a layout card. */
export const DECK_LABELS: Record<DeckSlug, string> = {
  'bva-pitch': 'BVA Pitch',
  'fiserv-exec-readout': 'Fiserv Exec Readout',
  'wayfair-reskin': 'Wayfair Reskin',
};

const ID_PREFIX: Record<DeckSlug, string> = {
  'bva-pitch': 'bva',
  'fiserv-exec-readout': 'fiserv',
  'wayfair-reskin': 'wayfair',
};

/**
 * A layout that is slide `n` of `deck`, verbatim.
 *
 * The id encodes the source, so re-running this list is stable and a layout can
 * always be traced back to the slide it came from.
 */
function replica(
  deck: DeckSlug,
  n: number,
  name: string,
  layout: SlideLayoutCategory,
): SlideLayoutDef {
  return {
    id: `layout-${ID_PREFIX[deck]}-${n}`,
    name,
    layout,
    source: { deck, slide: n },
    buildSlide: () => deckSlide(deck, n),
  };
}

/**
 * Ids are permanent: the layout store seeds against them, so renaming one
 * orphans whatever has already been edited under the old id.
 *
 * Order within a family is authored — the plainest, most reusable arrangement
 * first — and the store preserves it rather than alphabetizing.
 */
export const SLIDE_LAYOUTS: SlideLayoutDef[] = [
  replica('bva-pitch', 1, 'Cover', 'Title'),

  replica('bva-pitch', 4, 'Statement divider', 'Section'),
  replica('fiserv-exec-readout', 6, 'Question divider', 'Section'),
  replica('wayfair-reskin', 4, 'Numbered question divider', 'Section'),

  replica('fiserv-exec-readout', 3, 'Executive summary, numbered', 'List'),
  replica('bva-pitch', 11, 'Criteria list with funnel', 'List'),
  replica('bva-pitch', 8, 'Positioning points, two column', 'List'),
  replica('bva-pitch', 10, 'What it is / how it’s measured', 'List'),

  replica('wayfair-reskin', 3, 'Objectives, 01 → 02 → 03', 'Process'),
  replica('fiserv-exec-readout', 7, 'Model input → estimator → output', 'Process'),

  replica('fiserv-exec-readout', 2, 'Team introductions', 'Hierarchy'),

  replica('bva-pitch', 14, 'Next two weeks', 'Timeline'),
  replica('bva-pitch', 13, 'Phased plan', 'Timeline'),
  replica('wayfair-reskin', 14, 'Metrics roadmap', 'Timeline'),

  replica('bva-pitch', 7, 'Challenge / solution / outcome', 'Comparison'),
  replica('wayfair-reskin', 10, 'Why this matters / what we’ve done', 'Comparison'),
  replica('fiserv-exec-readout', 15, 'What it means / what we need', 'Comparison'),

  replica('fiserv-exec-readout', 14, 'Program pillars', 'Matrix'),
  replica('bva-pitch', 9, 'Statement panel with product grid', 'Matrix'),

  replica('fiserv-exec-readout', 10, 'Hero stats with breakdown', 'Metrics'),
  replica('wayfair-reskin', 5, 'Six-stat grid', 'Metrics'),
  replica('fiserv-exec-readout', 12, 'Capacity waterfall', 'Metrics'),

  replica('bva-pitch', 3, 'Two charts with headline', 'Chart'),
  replica('bva-pitch', 5, 'Chart with impact panel', 'Chart'),
  replica('fiserv-exec-readout', 4, 'Cohort curve with hero number', 'Chart'),
  replica('wayfair-reskin', 13, 'Ranked bars against a band', 'Chart'),

  replica('fiserv-exec-readout', 8, 'Department table with SDLC breadth', 'Table'),
  replica('wayfair-reskin', 8, 'Use-case mix', 'Table'),

  replica('wayfair-reskin', 9, 'Customer quotes', 'Quote'),

  replica('bva-pitch', 2, 'Logo wall with quote', 'Proof'),

  {
    id: 'layout-blank',
    name: 'Blank',
    layout: 'Blank',
    buildSlide: () => ({
      id: `s-${nanoid(8)}`,
      background: { kind: 'solid', color: token('surface.base') },
      elements: [],
    }),
  },
];

/** Ids that ship with the app, for the store to tell built-ins from user work. */
export const BUILTIN_LAYOUT_IDS = SLIDE_LAYOUTS.map((l) => l.id);

/**
 * Built-in layouts that shipped before and no longer exist: the four originals
 * and the hand-authored family set that replaced them. Without this list the
 * store would keep serving them forever — they are already in storage, and
 * nothing about a stored layout says who wrote it.
 */
export const RETIRED_LAYOUT_IDS = [
  'layout-title',
  'layout-title-split',
  'layout-section',
  'layout-section-statement',
  'layout-list-numbered',
  'layout-list-two-column',
  'layout-process-funnel',
  'layout-process-steps',
  'layout-cycle-loop',
  'layout-hierarchy-team',
  'layout-hierarchy-org',
  'layout-timeline-weeks',
  'layout-timeline-phases',
  'layout-comparison-two-up',
  'layout-comparison-challenge',
  'layout-matrix-quad',
  'layout-matrix-cards',
  'layout-kpi',
  'layout-metrics-hero',
  'layout-chart-takeaway',
  'layout-chart-two-up',
  'layout-quote-single',
  'layout-quote-three-up',
];

/** Provenance by layout id, for the "from" line Admin shows on a replica. */
export const LAYOUT_SOURCES: Record<string, { deck: DeckSlug; slide: number }> =
  Object.fromEntries(
    SLIDE_LAYOUTS.flatMap((l) => (l.source ? [[l.id, l.source] as const] : [])),
  );

export const SLIDE_SIZE = SLIDE_16x9;
