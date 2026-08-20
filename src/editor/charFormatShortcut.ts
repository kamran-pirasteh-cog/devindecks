/**
 * ⌘B / ⌘I / ⌘U — the character-format chords, and what each one means when the
 * thing selected is a CHART DATA LABEL rather than a text box.
 *
 * These used to be three inline branches in `Editor.tsx`. They are here because
 * the chart case has a rule that is worth stating once and testing, rather than
 * rediscovering: a chart's text is not stored on the box the compiler emitted,
 * it is stored in the spec (`LabelFont`), and the spec can hold bold and italic
 * but NOT underline.
 *
 * That asymmetry is not an oversight. `chartFontFromRun` returns null for a
 * patch a chart cannot keep, and the store then does nothing at all — because
 * the alternative is writing underline onto the emitted text box, where it
 * survives exactly until the next recompile (dragging the chart's handle is one).
 * A formatting change that visibly reverts a few seconds later is worse than one
 * that never happened, so ⌘U on a data label is deliberately inert.
 *
 * Underline is also the one of the three that a data label has least use for:
 * bold says "this is the number", italic says "this number is qualified", and
 * underline says neither while colliding with the descenders of the label above.
 */

export type CharFormat = 'bold' | 'italic' | 'underline';

const KEYS: Record<string, CharFormat | undefined> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
};

/**
 * Which character format this keystroke asks for, or null.
 *
 * Deliberately permissive about Shift and Alt, matching the behaviour these
 * chords already had: nothing else in the editor binds ⌘⇧B or ⌘⌥I, and the
 * chords that DO carry those modifiers (the format painter's ⌘⌥C/⌘⇧C, the size
 * steps' ⌘⇧>) are matched earlier in the handler, so they never reach here.
 *
 * `code` is checked alongside `key` for the same reason `formatShortcut` does
 * it: on macOS Option rewrites the character, so ⌥I can arrive as a dead-key
 * combining mark rather than as "i".
 */
export function charFormatAction(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  key: string;
  code?: string;
}): CharFormat | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  const byKey = KEYS[e.key.toLowerCase()];
  if (byKey) return byKey;
  // `code` is layout-independent: KeyB is KeyB on AZERTY too.
  if (e.code === 'KeyB') return 'bold';
  if (e.code === 'KeyI') return 'italic';
  if (e.code === 'KeyU') return 'underline';
  return null;
}

/**
 * Can a chart's spec store this format?
 *
 * `LabelFont` carries `bold` and `italic`; there is no field for underline. See
 * `chartFontFromRun`, which is where a patch this returns false for turns into
 * the null that makes the store leave the selection alone.
 */
export const chartCanStore = (format: CharFormat): boolean => format !== 'underline';

/**
 * The run patch for toggling `format` off its current value.
 *
 * `current` is read from the first run of the primary target — for a data label
 * that is the emitted run, which carries whatever the spec resolved, so the
 * toggle reads the state the user can actually see.
 */
export function charFormatPatch(
  format: CharFormat,
  current: { bold?: boolean; italic?: boolean; underline?: boolean } | undefined,
): { bold?: boolean } | { italic?: boolean } | { underline?: boolean } {
  switch (format) {
    case 'bold':
      return { bold: !current?.bold };
    case 'italic':
      return { italic: !current?.italic };
    default:
      return { underline: !current?.underline };
  }
}
