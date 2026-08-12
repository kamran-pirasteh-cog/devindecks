/**
 * PowerPoint's grow/shrink-font shortcuts.
 *
 * PPT binds ⌘⇧> / ⌘⇧< (Ctrl+Shift+> / < on Windows) to stepping the font size.
 * We also keep the older ⌘⌥> / ⌘⌥< binding working. Layouts disagree on what
 * `key` is for shifted period/comma, so `code` is checked as a fallback.
 */
export function fontSizeDirection(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}): 'up' | 'down' | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (!e.shiftKey && !e.altKey) return null;

  const up = e.key === '>' || e.key === '.' || e.code === 'Period';
  const down = e.key === '<' || e.key === ',' || e.code === 'Comma';
  return up ? 'up' : down ? 'down' : null;
}
