/**
 * Which paragraph and run a stretch of the editable's text came from.
 *
 * `paint` stamps every block with its paragraph index and every run span with a
 * key naming BOTH its paragraph and its run, and `commit` reads the props CSS
 * can't round-trip (font, size, colour, weight) back off those claims.
 *
 * It used to work by position instead — block 0 was paragraph 0, and a span's
 * `data-run` was an index into whichever paragraph it had ended up inside. The
 * browser reshapes that structure freely: Enter splits a block, a paste can
 * leave bare text and <br>s at the top level, deleting a line drops a block.
 * The moment the DOM stopped matching the model one block per paragraph, every
 * span's index was read against the wrong paragraph — and since a lookup past
 * the end of `runs` fell back to the first run, a whole box could come back in
 * one format. A self-describing key survives any amount of reshuffling.
 */

/** The paragraph/run coordinates a span claims. */
export interface RunKey {
  para: number;
  run: number;
}

export const runKey = (para: number, run: number) => `${para}.${run}`;

export function parseRunKey(key: string | null | undefined): RunKey | null {
  const m = key ? /^(\d+)\.(\d+)$/.exec(key) : null;
  return m ? { para: Number(m[1]), run: Number(m[2]) } : null;
}

/** The run a key names, or null when the model no longer has it. */
export function runAt<R>(
  paragraphs: readonly { runs: readonly R[] }[],
  key: string | null | undefined,
): R | null {
  const at = parseRunKey(key);
  return (at && paragraphs[at.para]?.runs[at.run]) || null;
}

/**
 * The paragraph a block takes its style from.
 *
 * A block painted from the model says which paragraph it is. One the browser
 * made — the far half of an Enter, an implicit group of top-level text —
 * inherits from the paragraph before it, which is the one the author split.
 * Only the first group, with nothing to inherit from, falls back to its
 * position.
 */
export function paragraphSource(
  count: number,
  claimed: number | null,
  previous: number | null,
  position: number,
): number {
  if (claimed !== null && claimed >= 0 && claimed < count) return claimed;
  if (previous !== null) return previous;
  return Math.max(0, Math.min(position, count - 1));
}
