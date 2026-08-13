/**
 * PowerPoint's format painter shortcuts.
 *
 * Mac PowerPoint binds ⌘⌥C / ⌘⌥V to copy/paste formatting; Windows uses
 * Ctrl+Shift+C / Ctrl+Shift+V. Both are accepted here.
 *
 * `code` is the reliable side of the match, because Option on macOS rewrites
 * the character: ⌥C arrives as "ç" and ⌥V as "√". `key` is still checked, both
 * for those substitutes and for environments that leave `code` empty.
 */
const COPY_KEYS = ['c', 'ç'];
const PASTE_KEYS = ['v', '√'];

export function formatPainterAction(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}): 'copy' | 'paste' | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (!e.altKey && !e.shiftKey) return null;
  const key = e.key.toLowerCase();
  if (e.code === 'KeyC' || COPY_KEYS.includes(key)) return 'copy';
  if (e.code === 'KeyV' || PASTE_KEYS.includes(key)) return 'paste';
  return null;
}
