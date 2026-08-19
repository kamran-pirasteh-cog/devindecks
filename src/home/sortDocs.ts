/**
 * How the document shelf is ordered.
 *
 * Split out of `Home` because two controls now drive the same order — the "Sort
 * by" dropdown and the table's column headers — and they have to agree about
 * what each key means, which way it points by default, and where documents that
 * are missing the value go.
 *
 * Two rules the comparator keeps in BOTH directions, because a list that broke
 * them would read as a bug rather than as a reverse sort:
 *
 * - **Blanks last.** An unassigned owner or an untagged client is an absence,
 *   not a value that sorts below "Aardvark" and above "Zoë". Reversing the sort
 *   reverses the documents that HAVE the value; it doesn't float the ones that
 *   don't to the top.
 * - **Ties break by name, ascending.** Otherwise two decks with the same owner
 *   swap places every time the list re-renders.
 */
import type { Deck } from '@/model';

export type SortBy = 'name' | 'updated' | 'created' | 'client' | 'owner' | 'slides';
export type SortDir = 'asc' | 'desc';

export interface DocSort {
  by: SortBy;
  dir: SortDir;
}

export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Date created' },
  { value: 'name', label: 'Name' },
  { value: 'client', label: 'Client' },
  { value: 'owner', label: 'Owner' },
  { value: 'slides', label: 'Slides' },
];

/**
 * Which way a key points when you first sort by it — the answer to "what did you
 * mean by that click?". Names and people read A→Z; recency and size read biggest
 * first, because "the newest" and "the longest" are what you're looking for.
 */
export const SORT_DEFAULT_DIR: Record<SortBy, SortDir> = {
  name: 'asc',
  updated: 'desc',
  created: 'desc',
  client: 'asc',
  owner: 'asc',
  slides: 'desc',
};

export const DEFAULT_DOC_SORT: DocSort = { by: 'updated', dir: 'desc' };

/** The client a document files under: its first tag, case-folded. */
export function firstClient(deck: Deck): string {
  return (deck.tags ?? [])[0]?.toLowerCase() ?? '';
}

/** True when this document has nothing to sort by on this key. */
function isBlank(deck: Deck, by: SortBy): boolean {
  if (by === 'owner') return !deck.owner;
  if (by === 'client') return !firstClient(deck);
  return false;
}

/** Ascending comparison on one key — A→Z, oldest first, fewest slides first. */
function compareBy(a: Deck, b: Deck, by: SortBy): number {
  switch (by) {
    case 'name':
      return a.title.localeCompare(b.title);
    case 'slides':
      return a.slides.length - b.slides.length;
    case 'created':
      return a.createdAt.localeCompare(b.createdAt);
    case 'owner':
      return (a.owner ?? '').toLowerCase().localeCompare((b.owner ?? '').toLowerCase());
    case 'client':
      return firstClient(a).localeCompare(firstClient(b));
    default:
      return a.updatedAt.localeCompare(b.updatedAt);
  }
}

/** A new array, ordered. Never sorts in place — the caller's list is the store's. */
export function sortDocs(docs: Deck[], sort: DocSort): Deck[] {
  const flip = sort.dir === 'asc' ? 1 : -1;
  return [...docs].sort((a, b) => {
    const blankA = isBlank(a, sort.by);
    const blankB = isBlank(b, sort.by);
    if (blankA !== blankB) return blankA ? 1 : -1;
    return compareBy(a, b, sort.by) * flip || a.title.localeCompare(b.title);
  });
}

/**
 * What clicking a column header does: the column you're already sorted by
 * reverses, and any other column takes its own default direction. Pressing
 * "Owner" three times therefore gives A→Z, Z→A, A→Z — never a sort direction
 * you didn't ask for and can't see the reason for.
 */
export function nextSort(current: DocSort, by: SortBy): DocSort {
  if (current.by === by) return { by, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { by, dir: SORT_DEFAULT_DIR[by] };
}
