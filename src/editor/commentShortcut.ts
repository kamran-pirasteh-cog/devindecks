/**
 * Google Slides' insert-comment chord: ⌘⌥M on macOS, Ctrl+Alt+M on Windows.
 *
 * `code` is the reliable side of the match, because Option on macOS rewrites
 * the character — ⌥M arrives as "µ". `key` is still checked, both for that
 * substitute and for environments that leave `code` empty.
 */
const COMMENT_KEYS = ['m', 'µ'];

export function isCommentShortcut(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  key: string;
  code?: string;
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || !e.altKey) return false;
  return e.code === 'KeyM' || COMMENT_KEYS.includes(e.key.toLowerCase());
}
