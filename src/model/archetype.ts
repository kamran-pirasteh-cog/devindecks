/**
 * What KIND of slide this is — the coarse shape a reader recognizes before
 * they've read a word: a title, a divider, a list, a wall of stats, a chart.
 *
 * A sibling of `SlideElement.role`, one level up. Role says what a single
 * element is for; archetype says what the slide as a whole is doing, and that's
 * the unit brand decisions are made at — where the logo goes, whether page
 * numbers show, whether an eyebrow belongs. A logo bottom-right is right on a
 * content slide and wrong on the title.
 *
 * It lives in the model rather than in `brand/classify.ts` (which infers it)
 * because the design system STORES decisions keyed by it, and the model can't
 * import from a layer above itself.
 *
 * Deliberately the same vocabulary as `SlideLayoutCategory` in
 * `templates/slideLayouts.ts`, lowercased — the categories the layout library
 * is already organized by are the categories a reader already perceives, and
 * inventing a second taxonomy would mean maintaining a mapping between them.
 */

export const SLIDE_ARCHETYPES = [
  'title',
  'section',
  'list',
  'metrics',
  'chart',
  'table',
  'comparison',
  'quote',
  'image',
  /** Legible content, but too much of it to read as any of the above. */
  'dense',
  /** Classification declined. Treated as a content slide everywhere. */
  'other',
] as const;

export type SlideArchetype = (typeof SLIDE_ARCHETYPES)[number];

/**
 * Archetypes that fill the frame edge to edge, where brand chrome placed at a
 * margin would land on top of artwork rather than beside it.
 */
export const FULL_BLEED_ARCHETYPES: readonly SlideArchetype[] = ['title', 'section', 'image'];

export const isSlideArchetype = (s: string): s is SlideArchetype =>
  (SLIDE_ARCHETYPES as readonly string[]).includes(s);
