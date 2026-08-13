/**
 * ⌘⌥Ctrl + arrow aligns the TEXT inside the selected boxes, as opposed to the
 * boxes themselves: the ⌘/Ctrl+arrow chords move objects on the slide, and
 * adding the third modifier moves the words within them.
 *
 * The direction you press is still the edge the text goes to — left/right for
 * paragraph alignment, up/down for the body's vertical anchor. Pressing the
 * edge the text already sits on centers it instead, so both centered values
 * are reachable without a chord of their own (and pressing that edge again
 * returns to it).
 */
import type { ParaAlign, VerticalAnchor } from '@/model';

export type TextAlignEdge = 'left' | 'right' | 'top' | 'bottom';

const EDGES: Record<string, TextAlignEdge | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'top',
  ArrowDown: 'bottom',
};

/**
 * All three modifiers are required. Ctrl alone reads as ⌘ everywhere else in
 * the editor, so anything less would collide with the object-alignment and
 * restack chords.
 */
export function textAlignEdge(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  key: string;
}): TextAlignEdge | null {
  if (!e.metaKey || !e.ctrlKey || !e.altKey) return null;
  return EDGES[e.key] ?? null;
}

/** Horizontal edges only; `current` is the alignment in force today. */
export function nextParaAlign(
  edge: 'left' | 'right',
  current: ParaAlign | undefined,
): ParaAlign {
  return current === edge ? 'center' : edge;
}

/** Vertical edges only. 'bottom'/'top' map straight across; middle is the toggle. */
export function nextAnchor(
  edge: 'top' | 'bottom',
  current: VerticalAnchor | undefined,
): VerticalAnchor {
  // An unset anchor renders as 'top', so ↑ on a fresh box centers it rather
  // than doing nothing visible.
  return (current ?? 'top') === edge ? 'middle' : edge;
}
