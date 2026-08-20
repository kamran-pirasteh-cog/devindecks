/**
 * How the deck-template shelf in Admin is ordered and narrowed.
 *
 * The deliberate twin of `home/sortDocs.ts` — Admin's template repo is the
 * documents shelf with a different noun in it, so the two have to agree about
 * what a click on a column heading means. Same three rules:
 *
 * - **Ties break by name, ascending**, so equal rows don't swap on re-render.
 * - **A column keeps its meaning in both directions**; reversing reverses the
 *   templates, it doesn't re-rank them.
 * - **Authored order is the default.** Templates carry an `order` from the
 *   built-in registry (the reference decks are meant to be read in that
 *   sequence), so the shelf opens in it rather than alphabetically.
 *
 * Kept free of React and of the repository — the repository is a `'use client'`
 * module that reaches for `localStorage` on import — so this is the part that
 * unit tests can hold.
 */

/** The fields of a stored template this module needs. Structural on purpose:
 *  the test can build one without the repository, and a Playground-side
 *  template that gains fields doesn't have to be threaded through here. */
export interface SortableTemplate {
  name: string;
  category: string;
  order?: number;
  slides: unknown[];
  createdAt: string;
  updatedAt: string;
}

export type TemplateSortBy = 'authored' | 'name' | 'updated' | 'created' | 'slides' | 'category';
export type SortDir = 'asc' | 'desc';

export interface TemplateSort {
  by: TemplateSortBy;
  dir: SortDir;
}

export const TEMPLATE_SORT_OPTIONS: { value: TemplateSortBy; label: string }[] = [
  { value: 'authored', label: 'Shelf order' },
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Date created' },
  { value: 'name', label: 'Name' },
  { value: 'category', label: 'Category' },
  { value: 'slides', label: 'Slides' },
];

/** Which way a key points the first time you sort by it — names and categories
 *  read A→Z, recency and size read biggest first. */
export const TEMPLATE_SORT_DEFAULT_DIR: Record<TemplateSortBy, SortDir> = {
  authored: 'asc',
  name: 'asc',
  updated: 'desc',
  created: 'desc',
  category: 'asc',
  slides: 'desc',
};

export const DEFAULT_TEMPLATE_SORT: TemplateSort = { by: 'authored', dir: 'asc' };

/** Ascending comparison on one key. */
function compareBy(a: SortableTemplate, b: SortableTemplate, by: TemplateSortBy): number {
  switch (by) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'category':
      return a.category.localeCompare(b.category);
    case 'slides':
      return a.slides.length - b.slides.length;
    case 'created':
      return a.createdAt.localeCompare(b.createdAt);
    case 'updated':
      return a.updatedAt.localeCompare(b.updatedAt);
    default:
      // Admin's own templates have no authored position, so they fall to the
      // end rather than to the front — the built-in shelf is the thing this
      // order exists to preserve.
      return (a.order ?? Infinity) - (b.order ?? Infinity);
  }
}

/** A new array, ordered. Never sorts in place — the caller's list is the store's. */
export function sortTemplates<T extends SortableTemplate>(templates: T[], sort: TemplateSort): T[] {
  const flip = sort.dir === 'asc' ? 1 : -1;
  return [...templates].sort(
    (a, b) => compareBy(a, b, sort.by) * flip || a.name.localeCompare(b.name),
  );
}

/**
 * What clicking a column header does: the column already in force reverses,
 * any other takes its own default direction.
 */
export function nextTemplateSort(current: TemplateSort, by: TemplateSortBy): TemplateSort {
  if (current.by === by) return { by, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { by, dir: TEMPLATE_SORT_DEFAULT_DIR[by] };
}

/**
 * The search box and the category dropdown, in one pass.
 *
 * Search spans name, description and category, because all three are what
 * someone types when they're looking for "the exec readout" — and it's matched
 * case-insensitively on a trimmed query so a trailing space doesn't empty the
 * shelf.
 */
export function filterTemplates<T extends SortableTemplate & { description?: string }>(
  templates: T[],
  opts: { query?: string; category?: string } = {},
): T[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const category = opts.category ?? '';
  return templates.filter((t) => {
    if (category && t.category !== category) return false;
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  });
}
