/**
 * Where the caret lands when you double-click into a text box.
 *
 * The editable doesn't exist yet at double-click time — the box is still drawn
 * by <ElementVisual> — so the point is remembered and hit-tested once the
 * editor has painted and covers the same rectangle. Anything the point can't
 * resolve to a spot inside the editable falls back to the caller's default
 * (end of the last paragraph), which is where the caret used to always go.
 */

export interface CaretPoint {
  x: number;
  y: number;
}

/** A caret position as the DOM expresses one. */
export interface CaretSpot {
  node: Node;
  offset: number;
}

/**
 * Pull a raw hit-test result onto a spot the caret can actually occupy inside
 * `root`. Returns null when the point missed the editable entirely.
 *
 * Bullet glyphs are `contenteditable=false` spans, so a click on one (or on the
 * hanging indent it fills) resolves *to* the span. The caret can't live there —
 * it belongs at the start of the paragraph's text, which is right after it.
 */
export const caretSpotIn = (
  root: HTMLElement,
  node: Node | null,
  offset: number,
): CaretSpot | null => {
  if (!node || !root.contains(node)) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const marker = el?.closest<HTMLElement>('[data-marker]');
  if (marker) {
    const parent = marker.parentNode;
    if (!parent) return null;
    return { node: parent, offset: Array.from(parent.childNodes).indexOf(marker) + 1 };
  }
  return { node, offset };
};

/** The document's caret hit-test, under either of its two spellings. */
const hitTest = (pt: CaretPoint): CaretSpot | null => {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(pt.x, pt.y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  const range = doc.caretRangeFromPoint?.(pt.x, pt.y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
};

/**
 * Put the caret where `pt` (viewport coordinates) points inside `root`.
 * Reports whether it managed to — a miss leaves the selection untouched so the
 * caller's own placement stands.
 */
export const placeCaretAt = (root: HTMLElement, pt: CaretPoint): boolean => {
  const raw = hitTest(pt);
  const spot = raw && caretSpotIn(root, raw.node, raw.offset);
  if (!spot) return false;
  const range = document.createRange();
  try {
    range.setStart(spot.node, spot.offset);
  } catch {
    return false;
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return true;
};
