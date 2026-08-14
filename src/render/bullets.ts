/**
 * Bullet + numbering layout, shared by the renderer and the in-place editor.
 *
 * The model already carries `bullet` and `level` per paragraph (and the export
 * hands both to PowerPoint); this module is the one place that decides what a
 * list paragraph LOOKS like, so the slide, the thumbnail, the editing overlay
 * and the .pptx all agree.
 *
 * Layout is PowerPoint's hanging indent, expressed in points and converted by
 * the caller: the paragraph is indented by `indentPt`, the marker sits in a
 * `hangPt`-wide gutter to its left, and wrapped lines line up under the text
 * rather than under the marker.
 */
import type { Paragraph } from '@/model';

/** Marker glyph per indent level, cycling like PowerPoint's default scheme. */
const BULLET_GLYPHS = ['▪', '▫', '▪', '–', '·'];

/**
 * How big a bullet glyph is relative to the text it leads, as a percentage —
 * PowerPoint's `buSzPct`. The square glyphs are drawn small inside their em box,
 * so at 100% they read as specks next to body text; the bump makes them square
 * dots of the weight a reader expects. Numbers are text and stay at 100%.
 */
export const BULLET_SIZE_PCT = 145;

/** The factor a marker's font size is scaled by — 1 for numbers and plain text. */
export const markerSizeScale = (p: Pick<Paragraph, 'bullet'>) =>
  p.bullet === 'bullet' ? BULLET_SIZE_PCT / 100 : 1;

/**
 * How far a square bullet is nudged down, as a fraction of the paragraph's own
 * font size. The ▪/▫ glyphs are drawn high in their em box — their centre sits
 * well above the middle of the x-height — and `BULLET_SIZE_PCT` scales that
 * offset up with them, so left alone a bullet floats near the cap line instead
 * of centring on the text it leads. Numbers are ordinary text sitting on the
 * baseline and get no shift.
 *
 * The value is measured, not guessed: at `BULLET_SIZE_PCT` the ink box of ▪
 * centres ~0.5em above the baseline while the x-height centres at ~0.265em,
 * so the glyph needs ~0.235em of the text's size to sit on the text's middle.
 */
export const BULLET_SHIFT_EM = 0.235;

/** Downward shift of a marker, in ems of the paragraph's font size. */
export const markerShiftEm = (p: Pick<Paragraph, 'bullet'>) =>
  p.bullet === 'bullet' ? BULLET_SHIFT_EM : 0;

/** The glyph a bulleted paragraph at this level draws, for renderers and export. */
export const bulletGlyph = (level: number) =>
  BULLET_GLYPHS[clampLevel(level) % BULLET_GLYPHS.length];

/** Points of extra indent per level, and the width of the marker gutter. */
export const LEVEL_INDENT_PT = 18;
export const BULLET_GUTTER_PT = 22;

/** Deepest level the model allows (see `Paragraph.level`). */
export const MAX_LEVEL = 4;

export const clampLevel = (level: number | undefined) =>
  Math.min(MAX_LEVEL, Math.max(0, Math.round(level ?? 0)));

export const isListParagraph = (p: Paragraph) => p.bullet === 'bullet' || p.bullet === 'number';

const ROMAN: [number, string][] = [
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

const roman = (n: number) => {
  let out = '';
  let left = n;
  for (const [value, digit] of ROMAN) {
    while (left >= value) {
      out += digit;
      left -= value;
    }
  }
  return out || '1';
};

/** a, b, … z, aa, ab … — spreadsheet-column style, so it never runs out. */
const alpha = (n: number) => {
  let out = '';
  let left = n;
  while (left > 0) {
    const rem = (left - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    left = Math.floor((left - 1) / 26);
  }
  return out;
};

/** The number label for the nth item at a level: 1. / a. / i. / 1) / a). */
const numberLabel = (level: number, n: number) => {
  switch (level % 5) {
    case 0:
      return `${n}.`;
    case 1:
      return `${alpha(n)}.`;
    case 2:
      return `${roman(n)}.`;
    case 3:
      return `${n})`;
    default:
      return `${alpha(n)})`;
  }
};

/**
 * The marker for every paragraph in a body, or null where there is none.
 *
 * Numbering has to be computed over the whole body, not per paragraph: an item
 * counts its siblings at the same level, a deeper list restarts, and any
 * paragraph that isn't numbered at that level ends the run — so a bulleted or
 * plain line between two numbered ones restarts at 1, as it does in PowerPoint.
 */
export function bulletMarkers(paragraphs: Paragraph[]): (string | null)[] {
  const counters: number[] = [];
  return paragraphs.map((p) => {
    const level = clampLevel(p.level);
    // Anything nested deeper than this paragraph is a finished sub-list.
    counters.length = level + 1;
    if (p.bullet === 'number') {
      counters[level] = (counters[level] ?? 0) + 1;
      return numberLabel(level, counters[level]);
    }
    counters[level] = 0;
    return p.bullet === 'bullet' ? bulletGlyph(level) : null;
  });
}

/**
 * Indent metrics in points. `hangPt` is the marker gutter — zero for a plain
 * paragraph, which then just carries its level indent.
 */
export function indentMetricsPt(p: Paragraph): { indentPt: number; hangPt: number } {
  const level = clampLevel(p.level);
  const hangPt = isListParagraph(p) ? BULLET_GUTTER_PT : 0;
  return { indentPt: level * LEVEL_INDENT_PT + hangPt, hangPt };
}
