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
import { legendSeriesKey, partKind, type ChartRef } from '@/model';
import { partsInReadingOrder, seriesOrder, type PartEl } from './partOrder';

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

  const seriesOf = (ref: ChartRef): string | null =>
    ref.part === 'mark' || ref.part === 'label' ? ref.series : null;
  const clickedSeries = seriesOf(clickedRef);
  const fromSeries = seriesOf(fromRef);

  // Two ends in DIFFERENT series mean the series, not a run of individual
  // points: nobody shift-clicks a bar in one row and a bar in another to get
  // those two bars. So the span is taken over the series — every part of the
  // kind in each series from the anchor's to the clicked one's, inclusive —
  // which is what makes "these two rows, all of them" a two-click gesture.
  if (clickedSeries && fromSeries && clickedSeries !== fromSeries) {
    const order = seriesOrder(parts);
    const a = order.indexOf(fromSeries);
    const b = order.indexOf(clickedSeries);
    if (a >= 0 && b >= 0) {
      const span = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1));
      const inSpan = partsInReadingOrder(parts, kind).filter((id) => {
        const ref = refIn(parts, id);
        const s = ref ? seriesOf(ref) : null;
        return !!s && span.has(s);
      });
      if (inSpan.length) return inSpan;
    }
  }

  // Both ends in the SAME series run along that series alone: the reader who
  // shift-clicks the first and last marker of one line means those markers, not
  // every other line's points that fall between them in category order.
  const sameSeries = clickedSeries && clickedSeries === fromSeries ? clickedSeries : null;

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

/**
 * Is this part one of MANY of its kind — a tick, a label, a legend key?
 *
 * The parts a reader thinks of as a set, and therefore the ones a plain click
 * takes all of (see `clickSelectParts`). Marks are deliberately not here: a bar
 * is an object, and clicking one has always meant that bar.
 */
export function isPopulationPart(ref: ChartRef): boolean {
  switch (ref.part) {
    case 'label':
    case 'total':
    case 'legend.item':
    case 'axis':
      return true;
    default:
      return false;
  }
}

/**
 * A plain click on a POPULATION part: how wide the selection gets.
 *
 * A chart's ticks, its data labels and its legend keys are populations, not
 * objects — nobody wants one tick in a different font from the other five, and
 * the edit almost always means all of them. So a click widens, the way a click
 * in a word processor selects a word, a double-click a sentence:
 *
 * 1. **click** — every part of that kind: all the labels, all of that axis's
 *    ticks, the whole legend.
 * 2. **double-click** — the ones in the series clicked, so one line's markers
 *    or one colour's labels can differ from the rest.
 * 3. **triple-click** — the single part under the pointer.
 *
 * Levels that would come out identical collapse, so on a single-series chart
 * the second click already reaches the one label, and a legend entry — swatch
 * and name together, which is as narrow as a legend gets — is reached on the
 * second rather than the third. `clicks` is a mousedown's
 * `detail`; anything past the last level clamps to it.
 *
 * Null for everything else — a bar, a slice, a Gantt row — which stays one
 * click, one object.
 */
export function clickSelectParts(
  clicked: string,
  parts: PartEl[],
  clicks: number,
  /**
   * Already INSIDE the legend — one entry selected rather than all of them.
   *
   * Once someone has double-clicked their way in, the next plain click means
   * the entry they clicked, not the whole legend again: stepping back out on
   * every click makes the drilled-in state impossible to move around in, the
   * same way a text box you've entered doesn't spit you back out to the object
   * when you click the next word. Leaving the legend — clicking a bar, an axis,
   * the plot — ends it, because the selection stops being a legend subset.
   */
  drilledLegend = false,
): string[] | null {
  const ref = refIn(parts, clicked);
  if (!ref || !isPopulationPart(ref)) return null;
  const kind = partKind(ref);
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id, i) => id === b[i]);
  const levels: string[][] = [];
  const add = (ids: string[]) => {
    if (ids.length && !levels.some((l) => same(l, ids))) levels.push(ids);
  };
  const ofKind = partsInReadingOrder(parts, kind);

  add(ofKind);
  if (ref.part === 'label' || ref.part === 'mark') {
    add(partsInReadingOrder(parts, kind, ref.series));
  } else if (ref.part === 'legend.item') {
    // A legend ENTRY is two parts — the swatch and the name beside it, which
    // carry different series keys (see `legendSeriesKey`) — so the middle level
    // is the entry, not the one node clicked. That is also the last level: a
    // legend key IS its series, so there is nothing narrower to reach.
    const key = legendSeriesKey(ref);
    add(
      ofKind.filter((id) => {
        const r = refIn(parts, id);
        return r?.part === 'legend.item' && legendSeriesKey(r) === key;
      }),
    );
  }
  // Not for a legend: the entry above is the narrowest thing there, and half of
  // one — a swatch with no name — is not a selection anyone means.
  if (ref.part !== 'legend.item') add([clicked]);

  const from = ref.part === 'legend.item' && drilledLegend ? clicks + 1 : clicks;
  return levels[Math.min(Math.max(from, 1), levels.length) - 1];
}
