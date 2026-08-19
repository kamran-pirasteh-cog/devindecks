'use client';

/**
 * Measure the box a text body actually wants — PowerPoint's "resize shape to
 * fit text", triggered by double-clicking the bottom-right handle.
 *
 * The measurement is done on a CLONE of the live text box rather than on a
 * rebuilt approximation: TextBodyView already resolves insets, per-paragraph
 * font sizes, line-height factors and per-run fonts into inline px styles at
 * the current scale, so cloning it measures exactly the type the canvas draws.
 * Anything reconstructed here would drift from the renderer the moment either
 * side changed.
 *
 * Width shrinks to the text's natural (unwrapped) width but never grows past
 * the current width: growing it would silently unwrap paragraphs the author
 * deliberately sized to wrap. Height is then whatever the text needs once
 * wrapped at that width, so an overflowing box grows to contain its text.
 */

/** Both values in px, at the same scale as the node that was measured. */
export function measureTextFitPx(
  node: HTMLElement,
  currentWidthPx: number,
): { w: number; h: number } | null {
  const body = node.querySelector<HTMLElement>('.dd-text-body');
  if (!body) return null;

  const clone = body.cloneNode(true) as HTMLElement;
  // Off-layout, but still laid out: `display: none` or `visibility: hidden` on
  // an unattached node would report zero. Padding is left alone — the insets
  // are part of the box being fitted.
  clone.style.position = 'fixed';
  clone.style.left = '-100000px';
  clone.style.top = '0px';
  clone.style.right = 'auto';
  clone.style.bottom = 'auto';
  clone.style.visibility = 'hidden';
  clone.style.pointerEvents = 'none';
  clone.style.maxWidth = 'none';
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  // `max-content` is the width the text would take with no wrapping at all.
  clone.style.width = 'max-content';
  document.body.appendChild(clone);

  try {
    const naturalW = clone.getBoundingClientRect().width;
    if (!naturalW) return null;
    const w = Math.min(currentWidthPx, Math.ceil(naturalW));
    // Re-measure the height with the width it will actually have, so wrapped
    // lines are counted.
    clone.style.width = `${w}px`;
    const h = Math.ceil(clone.getBoundingClientRect().height);
    if (!h) return null;
    return { w, h };
  } finally {
    clone.remove();
  }
}

/**
 * The height the OPEN text editor's content wants, in px at the node's own
 * scale — the measurement behind a sticky note growing as it's typed into.
 *
 * The live editable is `inset: 0` on a fixed-height box, so its own geometry
 * says nothing about how much type is in it; a clone at the same width with
 * `height: auto` does. The clone carries the editor's inline styles and its
 * per-run spans, which is the same reason `measureTextFitPx` clones the
 * renderer's body rather than rebuilding it.
 */
export function measureEditableHeightPx(node: HTMLElement): number | null {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.removeAttribute('contenteditable');
  clone.style.position = 'fixed';
  clone.style.inset = 'auto';
  clone.style.left = '-100000px';
  clone.style.top = '0px';
  clone.style.width = `${node.offsetWidth}px`;
  clone.style.height = 'auto';
  clone.style.maxHeight = 'none';
  clone.style.visibility = 'hidden';
  clone.style.pointerEvents = 'none';
  // The editor anchors its type with `justify-content`; on an auto-height clone
  // that would stretch nothing and measure nothing extra, but a bottom-anchored
  // box still reads clearer measured from the top.
  clone.style.justifyContent = 'flex-start';
  clone.style.outline = 'none';
  document.body.appendChild(clone);
  try {
    const h = Math.ceil(clone.getBoundingClientRect().height);
    return h || null;
  } finally {
    clone.remove();
  }
}
