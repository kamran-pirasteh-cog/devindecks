/**
 * Shift- and ⌘-click inside a chart: what the selection becomes.
 *
 * Split out of `EditorCanvas` so the rules are testable and stated once.
 *
 * The ordinary shift-click grows any id into its whole GROUP, and a chart's
 * group is every one of its thirty-odd parts — so shift-clicking a second bar
 * used to jump back out to the whole chart, and there was no way to format
 * three labels at once. Inside a chart the two modifiers split the way they do
 * in PowerPoint's slide list and in think-cell:
 *
 * - **Shift** takes the RANGE. Click the first bar, shift-click the fifth, and
 *   the three in between come with them — reading order, not click order.
 * - **⌘/Ctrl** takes one part at a time: it adds the part clicked, or drops it
 *   back out, which is the only way to build a selection with a hole in it.
 *
 * Both rules stop at the kind boundary: a part of a different kind starts its
 * own selection rather than joining, because the controls a bar and a tick have
 * in common are none. And neither ever empties the selection — that closes the
 * panel and drops the user out of the chart mid-edit.
 */
import { partKind, type ChartRef } from '@/model';
import { partsInReadingOrder, type PartEl } from './partOrder';

export type { PartEl };

const refIn = (parts: PartEl[], id: string): ChartRef | null =>
  parts.find((p) => p.id === id)?.chartRef ?? null;

const kindIn = (parts: PartEl[], id: string): string | null => {
  const ref = refIn(parts, id);
  return ref ? partKind(ref) : null;
};

/** True when everything selected is of `kind` — the precondition for joining it. */
const allOfKind = (parts: PartEl[], selected: string[], kind: string): boolean =>
  selected.length > 0 && selected.every((id) => kindIn(parts, id) === kind);

/**
 * Where the range is measured from.
 *
 * The anchor is the last part picked WITHOUT shift, so a second shift-click
 * re-measures from the same place and the range grows or shrinks under the
 * pointer, rather than ratcheting outwards from wherever the last one ended.
 * It has to still be in the selection to be meaningful: selections also arrive
 * from the popover and from Devin, and a range drawn from a part the user can
 * no longer see is a jump, not a range.
 */
const anchorFor = (
  parts: PartEl[],
  selected: string[],
  anchor: string | null,
  kind: string,
): string | null => {
  if (anchor && selected.includes(anchor) && kindIn(parts, anchor) === kind) return anchor;
  for (let i = selected.length - 1; i >= 0; i--) {
    if (kindIn(parts, selected[i]) === kind) return selected[i];
  }
  return null;
};

/**
 * Shift-click: everything from the anchor to the part clicked, inclusive.
 *
 * `parts` is every element of the chart, in painted order; `anchor` is the last
 * part clicked without a modifier. The range replaces the selection rather than
 * adding to it, exactly as it does in the slide list — that is what lets a
 * second shift-click pull the range back in.
 */
export function shiftClickParts(
  clicked: string,
  selected: string[],
  anchor: string | null,
  parts: PartEl[],
): string[] {
  const clickedRef = refIn(parts, clicked);
  if (!clickedRef) return [clicked];
  const kind = partKind(clickedRef);
  if (!allOfKind(parts, selected, kind)) return [clicked];

  const from = anchorFor(parts, selected, anchor, kind);
  if (!from || from === clicked) return [clicked];
  const fromRef = refIn(parts, from)!;

  // Two points of the SAME series run along that series alone: the reader who
  // shift-clicks the first and last marker of one line means those markers, not
  // every other line's points that fall between them in category order.
  const sameSeries =
    (clickedRef.part === 'mark' || clickedRef.part === 'label') &&
    (fromRef.part === 'mark' || fromRef.part === 'label') &&
    clickedRef.series === fromRef.series
      ? clickedRef.series
      : null;

  const ordered = partsInReadingOrder(parts, kind, sameSeries);
  const a = ordered.indexOf(from);
  const b = ordered.indexOf(clicked);
  // No shared ordering (a kind reading order can't rank, say): fall back to
  // gathering the one part clicked rather than losing the click.
  if (a < 0 || b < 0) return selected.includes(clicked) ? selected : [...selected, clicked];
  return ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * ⌘/Ctrl-click: the part clicked joins the selection, or leaves it.
 *
 * The last part never leaves — an empty selection closes the panel and drops
 * the user out of the chart mid-edit.
 */
export function toggleClickParts(
  clicked: string,
  selected: string[],
  parts: PartEl[],
): string[] {
  if (selected.includes(clicked)) {
    const rest = selected.filter((id) => id !== clicked);
    return rest.length ? rest : selected;
  }
  const kind = kindIn(parts, clicked);
  if (!kind) return [clicked];
  return allOfKind(parts, selected, kind) ? [...selected, clicked] : [clicked];
}
