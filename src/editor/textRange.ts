/**
 * Character-range formatting inside one text body.
 *
 * The format painter works on whole elements on the canvas, but inside the text
 * editor PowerPoint narrows it to the SELECTION: ⌘⌥C samples the run under the
 * cursor and ⌘⌥V restyles only the highlighted characters. That needs offsets
 * the model can talk about, so a body is addressed here as one flat string —
 * paragraphs joined by a single newline, exactly as the editor reads its DOM
 * back out — and runs are split at the range edges on paste.
 */
import type { Paragraph, TextRun } from '@/model';
import { applyParagraphFormat, applyRunFormat, type ElementFormat } from './elementFormat';

/** Which run a global character offset lands in. */
export interface RunLocation {
  paragraph: number;
  run: number;
}

const paraLength = (p: Paragraph) => p.runs.reduce((n, r) => n + r.text.length, 0);

/**
 * The run at `offset`. `bias` decides which side of a boundary wins: 'after'
 * takes the character to the right (the first character of a selection),
 * 'before' the one to the left, which is what a bare caret samples — typing at
 * the end of a bold word continues it bold.
 */
export function locateRun(
  paragraphs: Paragraph[],
  offset: number,
  bias: 'before' | 'after' = 'after',
): RunLocation | null {
  if (!paragraphs.length) return null;
  let pos = 0;
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const runs = paragraphs[pi].runs;
    const len = paraLength(paragraphs[pi]);
    if (offset <= pos + len) {
      let local = offset - pos;
      if (bias === 'before' && local <= 0) return { paragraph: pi, run: 0 };
      for (let ri = 0; ri < runs.length; ri++) {
        const t = runs[ri].text.length;
        if (bias === 'before' ? local <= t && t > 0 : local < t) return { paragraph: pi, run: ri };
        local -= t;
      }
      return { paragraph: pi, run: Math.max(runs.length - 1, 0) };
    }
    // +1 for the newline between paragraphs.
    pos += len + 1;
  }
  const last = paragraphs.length - 1;
  return { paragraph: last, run: Math.max(paragraphs[last].runs.length - 1, 0) };
}

/** Adjacent runs that ended up identical after a restyle are one run again. */
function mergeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && sameFormat(last, run)) last.text += run.text;
    else out.push(run);
  }
  // A paragraph always keeps at least one run, even an empty one, so the
  // renderer and the editor have something to hang the paragraph's style on.
  return out.length ? out : runs.slice(0, 1);
}

/** Key order isn't format: a restyled run rebuilds its keys in RUN_KEYS order. */
function sameFormat(a: TextRun, b: TextRun): boolean {
  const strip = (run: TextRun) =>
    JSON.stringify(
      Object.entries(run)
        .filter(([k, v]) => k !== 'text' && v !== undefined)
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  return strip(a) === strip(b);
}

/**
 * Stamp a copied format onto the characters in `[start, end)`, splitting the
 * runs that straddle the edges.
 *
 * Paragraph properties (alignment, bullet, spacing) reach only the paragraphs
 * the range covers END TO END, which is the rule the Office painter follows:
 * highlighting one word inside a bulleted line asks for that word's type to
 * change, not for the line to stop being a bullet. Fill, outline and the
 * text-box properties never travel — they belong to the whole box, and a
 * selection is not the whole box.
 *
 * Returns fresh paragraphs; the input is left alone.
 */
export function formatRange(
  paragraphs: Paragraph[],
  start: number,
  end: number,
  fmt: ElementFormat,
): Paragraph[] {
  if (end <= start || !fmt.run) return paragraphs;
  let pos = 0;
  return paragraphs.map((p) => {
    const len = paraLength(p);
    const paraStart = pos;
    pos += len + 1;
    if (end <= paraStart || start >= paraStart + len) return p;

    const runs: TextRun[] = [];
    let at = paraStart;
    for (const r of p.runs) {
      const a = at;
      const b = at + r.text.length;
      at = b;
      const from = Math.max(a, start);
      const to = Math.min(b, end);
      if (to <= from) {
        runs.push({ ...r });
        continue;
      }
      if (from > a) runs.push({ ...r, text: r.text.slice(0, from - a) });
      const mid: TextRun = { ...r, text: r.text.slice(from - a, to - a) };
      applyRunFormat(mid, fmt.run!);
      runs.push(mid);
      if (to < b) runs.push({ ...r, text: r.text.slice(to - a) });
    }
    const out: Paragraph = { ...p, runs: mergeRuns(runs) };
    if (fmt.paragraph && start <= paraStart && end >= paraStart + len) {
      applyParagraphFormat(out, fmt.paragraph);
    }
    return out;
  });
}
