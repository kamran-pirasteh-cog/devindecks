/**
 * Shift-click inside a chart: what the selection becomes.
 *
 * Split out of `EditorCanvas` so the rules are testable and stated once.
 *
 * The ordinary shift-click grows any id into its whole GROUP, and a chart's
 * group is every one of its thirty-odd parts — so shift-clicking a second bar
 * used to jump back out to the whole chart, and there was no way to format
 * three labels at once. Inside a chart, shift-click gathers parts instead:
 *
 * - the same kind joins the selection (three bars, four labels, two ticks),
 * - a part already in it drops out, but never the last one — emptying the
 *   selection closes the panel and drops the user out of the chart mid-edit,
 * - a different kind starts its own selection rather than joining, because the
 *   controls a bar and a tick have in common are none.
 */
export function shiftClickParts(
  clicked: string,
  selected: string[],
  kindOf: (id: string) => string | null,
): string[] {
  if (selected.includes(clicked)) {
    const rest = selected.filter((id) => id !== clicked);
    return rest.length ? rest : selected;
  }
  const kinds = new Set(selected.map(kindOf).filter((k): k is string => !!k));
  const clickedKind = kindOf(clicked);
  const same = !!clickedKind && kinds.size === 1 && kinds.has(clickedKind);
  return same ? [...selected, clicked] : [clicked];
}
