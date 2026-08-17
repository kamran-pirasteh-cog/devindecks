/**
 * The bracket restack chords: ⌘[ / ⌘] step the selection one position through
 * z-order, and ⇧ takes it all the way to the back or the front. Photoshop,
 * Figma and Keynote all bind these, so they're the ones people's hands reach
 * for; the editor's ⌘⌥ + arrow chords keep working alongside them.
 *
 * `code` is checked first because ⇧ rewrites the character ("{" for "["), and
 * ⌘ suppresses that rewrite inconsistently across layouts — but non-US layouts
 * put brackets elsewhere entirely, so `key` is kept as the fallback.
 */
export type ReorderDir = 'front' | 'back' | 'forward' | 'backward';

export function reorderDirection(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}): ReorderDir | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;

  const back = e.code === 'BracketLeft' || e.key === '[' || e.key === '{';
  const front = e.code === 'BracketRight' || e.key === ']' || e.key === '}';
  if (!back && !front) return null;

  if (e.shiftKey) return front ? 'front' : 'back';
  return front ? 'forward' : 'backward';
}
