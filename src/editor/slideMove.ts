/**
 * PowerPoint's ⌘↑ / ⌘↓ on the slide strip: the selected slides step one
 * position through the deck, and ⇧ takes them all the way to the start or the
 * end. The selection is treated as one block even when it isn't contiguous —
 * the slides gather at the destination, which is what the filmstrip's own
 * drag-and-drop does too.
 *
 * Expressed as the `beforeId` that `moveSlides` takes: the id to insert the
 * block ahead of, or null for the end of the deck. `undefined` means the move
 * is a no-op (already at that edge, or nothing selected).
 */
export function slideMoveTarget(
  order: string[],
  selectedIds: string[],
  dir: 'up' | 'down',
  toEdge = false,
): string | null | undefined {
  const sel = new Set(selectedIds);
  const rest = order.filter((id) => !sel.has(id));
  // Everything selected, or nothing: no position left to move to.
  if (rest.length === 0 || sel.size === 0) return undefined;

  if (toEdge) {
    // Already parked against that edge — the block would land where it is.
    const edge = dir === 'up' ? order.slice(0, sel.size) : order.slice(order.length - sel.size);
    if (edge.every((id) => sel.has(id))) return undefined;
    return dir === 'up' ? rest[0] : null;
  }

  if (dir === 'up') {
    const first = order.findIndex((id) => sel.has(id));
    // The nearest unselected slide above the block is the one to jump over.
    for (let i = first - 1; i >= 0; i--) if (!sel.has(order[i])) return order[i];
    return undefined;
  }

  let last = -1;
  for (let i = order.length - 1; i >= 0; i--) {
    if (sel.has(order[i])) {
      last = i;
      break;
    }
  }
  // The slide below the block moves above it, so the block lands before
  // whatever followed that one — null when it was the deck's last slide.
  for (let i = last + 1; i < order.length; i++) {
    if (!sel.has(order[i])) {
      const restIdx = rest.indexOf(order[i]);
      return rest[restIdx + 1] ?? null;
    }
  }
  return undefined;
}
