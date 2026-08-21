/**
 * Backspace at the START of a list paragraph, PowerPoint's way.
 *
 * The editor draws bullets as `contenteditable=false` marker spans at the head
 * of the block, so a browser's own Backspace at the start of a bulleted line
 * eats the marker instead of the line — and the next `syncMarkers` puts it
 * straight back. An empty bullet was therefore impossible to delete.
 *
 * PowerPoint peels the list style off one layer at a time: Backspace promotes
 * a demoted paragraph a level, then drops the bullet entirely, and only once
 * the paragraph is plain does it merge into the line above. That last step is
 * ordinary contentEditable behaviour, so we hand it back to the browser.
 */
import type { BulletKind, Paragraph } from '@/model';

export type ListState = Pick<Paragraph, 'bullet' | 'level'>;

/**
 * The list style the paragraph should take, or null to let the browser handle
 * the keystroke (which merges the paragraph into the one above it).
 */
export function backspaceList(list: ListState): { bullet?: BulletKind; level?: number } | null {
  const level = list.level ?? 0;
  const bulleted = !!list.bullet && list.bullet !== 'none';
  // An indented paragraph promotes first, bullet and all — the same thing
  // Shift+Tab does, which is what PowerPoint gives you here.
  if (level > 0) return { bullet: list.bullet, level: level - 1 };
  if (bulleted) return { bullet: undefined, level: 0 };
  return null;
}
