/**
 * "Select similar" — grow the selection to every sibling of the same kind.
 *
 * The gesture people want is Illustrator's Select > Same: point at one thing,
 * get all of its kin on the slide, then format them in one pass. So "similar"
 * is deliberately about WHAT AN OBJECT IS, not how it looks — matching fill or
 * size would make the command's reach unpredictable from the label, and the
 * whole point is to gather the boxes you are about to make look alike.
 *
 * Two families of element sit this out entirely, on both sides of the match:
 *
 * - **Chart parts** (`chartRef`). Their selection is the chart's, not the
 *   slide's — clicking a bar drills into a series, and the store repairs those
 *   ids across every recompile. Sweeping loose rectangles in beside them would
 *   read as a chart selection to everything downstream.
 * - **Grouped elements.** A group is one object; selection never holds half of
 *   one. Reaching into groups to pull out "the rectangles" would either
 *   half-select them or drag whole unrelated groups along.
 *
 * What remains is the loose, author-placed content on the slide — exactly what
 * the command is for.
 */
import type { ShapePreset, SlideElement } from '@/model';

/** Elements this command will look at, on either side of the match. */
const isCandidate = (el: SlideElement) => !el.chartRef && !el.groupIds?.length;

/**
 * What makes two elements the same kind of thing.
 *
 * Shapes carry their preset: a pill and a triangle are both `shape` to the
 * model, but nobody pointing at one means the other. Every other type is its
 * own answer — a text box is a text box whatever it holds.
 */
export type SimilarityKey = ElementKind | `shape:${ShapePreset}`;
type ElementKind = SlideElement['type'];

export function similarityKey(el: SlideElement): SimilarityKey {
  return el.type === 'shape' ? `shape:${el.preset}` : el.type;
}

/**
 * Everything on the slide matching the kinds already selected — the current
 * selection included, so this is always a growth, never a swap.
 *
 * Returned in slide (z-) order rather than selection order: the result is a set
 * of peers with no reference object among them, and z-order is the one ordering
 * the rest of the editor already agrees on.
 */
export function similarIds(elements: SlideElement[], selectedIds: string[]): string[] {
  const selected = new Set(selectedIds);
  const kinds = new Set(
    elements.filter((el) => selected.has(el.id) && isCandidate(el)).map(similarityKey),
  );
  if (!kinds.size) return [];
  return elements
    .filter((el) => isCandidate(el) && kinds.has(similarityKey(el)))
    .map((el) => el.id);
}

/** Plural noun for a set of matched kinds, for the menu label. */
const NOUNS: Record<ElementKind, string> = {
  text: 'text boxes',
  shape: 'shapes',
  line: 'lines',
  picture: 'images',
  path: 'shapes',
};

/**
 * The label to offer, or none when the command would do nothing — either
 * nothing in the selection can be matched on, or everything that matches is
 * already selected, and an item that visibly changes nothing is worse than no
 * item at all.
 *
 * A single-kind selection names what was recognized ("Select similar shapes"),
 * which is how the user confirms the command read their intent before running
 * it. A mixed one has no honest noun, so it stays generic.
 */
export function selectSimilarLabel(
  elements: SlideElement[],
  selectedIds: string[],
): string | null {
  const ids = similarIds(elements, selectedIds);
  if (!ids.length) return null;
  const selected = new Set(selectedIds);
  if (ids.every((id) => selected.has(id))) return null;

  const types = new Set(
    elements.filter((el) => ids.includes(el.id)).map((el) => el.type),
  );
  const nouns = new Set([...types].map((t) => NOUNS[t]));
  return nouns.size === 1 ? `Select similar ${[...nouns][0]}` : 'Select similar';
}
