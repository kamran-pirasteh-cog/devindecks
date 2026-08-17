/**
 * The object clipboard chords: ⌘X / ⌘C / ⌘V (Ctrl on Windows).
 *
 * Deliberately narrow — no Alt, no Shift. The format painter takes ⌘⌥C / ⌘⌥V
 * and Ctrl+Shift+C / Ctrl+Shift+V (see `formatShortcut.ts`), so a chord with
 * either modifier on it belongs to the painter, not here.
 *
 * Matched on `code` first and on the character second, so the chord is reachable
 * both from the physical X/C/V keys and from wherever the user's layout prints
 * those letters — the two only disagree on a remapped layout, where either
 * answer is the one some editor on the machine already gives.
 */
export type ClipboardAction = 'cut' | 'copy' | 'paste';

const KEYS: Record<string, ClipboardAction> = { KeyX: 'cut', KeyC: 'copy', KeyV: 'paste' };
const CHARS: Record<string, ClipboardAction> = { x: 'cut', c: 'copy', v: 'paste' };

export function clipboardAction(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}): ClipboardAction | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  return (e.code && KEYS[e.code]) || CHARS[e.key.toLowerCase()] || null;
}
