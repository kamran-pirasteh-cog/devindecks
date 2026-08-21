/**
 * Paste is text only, everywhere.
 *
 * A copy from a browser, from Word or from another deck carries its source
 * styling as `text/html` — fonts, sizes, colours, background shading, even
 * whole tables. Letting the browser drop that into the editable imports
 * formatting the deck never chose, and the run parser then reads it back into
 * the model as if the author had asked for it. So we take the plain text and
 * let the box's own styling stand.
 *
 * Plain inputs and textareas already behave this way; this is for the
 * contentEditable surfaces.
 */

/**
 * The plain text on the clipboard, as lines. Empty when there is nothing
 * pastable (an image, a file).
 *
 * Line endings are normalised, because the three platforms disagree and the
 * caller turns each break into a paragraph.
 */
export function plainPasteLines(
  data: { getData: (type: string) => string } | null,
): string[] {
  const text = data?.getData("text/plain") ?? "";
  if (!text) return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}
