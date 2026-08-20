/**
 * How tall is this text, and does it fit its box?
 *
 * The question nothing in the app could answer until now. `TextBodyView`
 * renders with `overflow: visible` on purpose — a PowerPoint text box with
 * autofit off does not clip, it spills — so a box holding 40% too much text
 * looks *correct* to the renderer and broken to a reader. Nothing measured it,
 * so nothing could report it.
 *
 * That gap is fine while every deck is authored in the app, against boxes an
 * author sized by eye. It stops being fine the moment we RESTYLE someone else's
 * deck: swap Arial 14 for Geist 14 and every wrap point moves. Brand conversion
 * is exactly that operation, at scale, unattended — so it needs a way to know
 * when it has broken a slide.
 *
 * Two constraints shape this file:
 *
 *  - It mirrors `ParagraphView` field for field. The numbers here are only
 *    worth having if they agree with what the browser will do, so every rule
 *    below cites the CSS it is standing in for. When one changes, both change.
 *
 *  - It takes a `TextMeasurer` by injection, exactly as the chart compiler
 *    does, so it runs in vitest, in SSR and in the CLI validator — not just in
 *    a browser with fonts loaded.
 */
import { EMU_PER_POINT, FONTS, textInsetBox, type EMU, type FontFamily } from '@/model';
import type { DesignSystem } from '@/model/tokens';
import type { Paragraph, Rect, TextBody, TextRun } from '@/model/types';
import { indentMetricsPt } from './bullets';
import { lineHeightEmu, type TextMeasurer, type TextStyleMetrics } from './measureText';

export interface MeasuredLine {
  /** Width of the laid-out text, excluding indent. */
  widthEmu: EMU;
  /** Height of this line's box — the paragraph's line height. */
  heightEmu: EMU;
  /** Left offset from the content box, from the paragraph's indent. */
  indentEmu: EMU;
}

export interface MeasuredParagraph {
  lines: MeasuredLine[];
  /** Line height + space before/after. What this paragraph costs vertically. */
  heightEmu: EMU;
}

export interface TextBodyMetrics {
  /** Widest laid-out line, including its indent. */
  widthEmu: EMU;
  /** Total height of every paragraph, stacked. */
  heightEmu: EMU;
  /** Total line count across all paragraphs. */
  lines: number;
  /**
   * How far the text exceeds its box vertically. Zero or negative means it
   * fits — callers should test `> 0`, not truthiness, since a box fitting
   * exactly reports 0.
   */
  overflowEmu: EMU;
  paragraphs: MeasuredParagraph[];
}

/**
 * The style a run paints at, with the design system's defaults resolved.
 *
 * `sizePt` and `font` are optional on a run and inherit from the design system
 * — the same fallbacks `ParagraphView` applies (`r.sizePt ?? ds.type.body.sizePt`,
 * `r.font ?? ds.fonts.body`). Measuring against different defaults than the
 * renderer uses is the one way this file can be wrong in a way tests won't see.
 */
function runStyle(run: TextRun, ds: DesignSystem): TextStyleMetrics {
  return {
    font: (run.font ?? ds.fonts.body) as FontFamily,
    sizePt: run.sizePt ?? ds.type.body.sizePt,
    // `runWeight` is not consulted: the measurers only distinguish bold from
    // not-bold, and a Medium (500) run measures as regular in both of them.
    bold: run.bold === true,
    caps: run.caps === true,
  };
}

/**
 * The run that sets a paragraph's line height — its LARGEST, which is how
 * PowerPoint sizes a line and what `ParagraphView` does via its `largest`
 * reduce. One 24pt word in a 12pt paragraph makes that whole line 24pt tall.
 */
function largestRun(p: Paragraph, ds: DesignSystem): { pt: number; font: FontFamily } {
  return p.runs.reduce<{ pt: number; font: FontFamily }>(
    (max, r) => {
      const pt = r.sizePt ?? ds.type.body.sizePt;
      return pt > max.pt ? { pt, font: (r.font ?? ds.fonts.body) as FontFamily } : max;
    },
    { pt: 0, font: ds.fonts.body as FontFamily },
  );
}

/** One paragraph's line height in EMU, mirroring `ParagraphView`'s `lineHeight`. */
export function paragraphLineHeightEmu(p: Paragraph, ds: DesignSystem): EMU {
  const largest = largestRun(p, ds);
  const linePt = largest.pt || ds.type.body.sizePt;
  // OOXML's 100% means one single-spaced line — the font's own ascent +
  // descent + gap — not 100% of the font size. Same derivation as the renderer.
  const factor = ((p.lineSpacingPct ?? 100) / 100) * FONTS[largest.font].singleLineFactor;
  return Math.round(linePt * EMU_PER_POINT * factor);
}

/** A word, tagged with the run it came from so it measures at its own size. */
interface Word {
  text: string;
  style: TextStyleMetrics;
}

/**
 * Split a paragraph's runs into words, preserving per-run styling.
 *
 * Runs are not word-aligned — bolding the middle of a word is legal and common
 * — so a run boundary inside a word must NOT become a break opportunity.
 * Trailing text from one run and leading text from the next join into a single
 * word whenever neither side has whitespace at the seam, and that word takes
 * the widest style of its parts (the one that decides whether it wraps).
 */
function wordsOf(p: Paragraph, ds: DesignSystem): Word[] {
  const words: Word[] = [];
  let openWord = false; // the last word can still be extended by the next run

  for (const run of p.runs) {
    const style = runStyle(run, ds);
    const text = run.text ?? '';
    if (text === '') continue;

    // Keep the whitespace flags: they decide whether this run's first fragment
    // joins the previous word, and whether the next run's can join its last.
    const startsWithSpace = /^\s/.test(text);
    const endsWithSpace = /\s$/.test(text);
    const fragments = text.split(/\s+/).filter((f) => f !== '');

    if (fragments.length === 0) {
      // Whitespace only — it can't extend the open word, but it does close it.
      openWord = false;
      continue;
    }

    fragments.forEach((fragment, i) => {
      const joins = i === 0 && openWord && !startsWithSpace;
      if (joins) {
        const prev = words[words.length - 1];
        prev.text += fragment;
        // The larger style wins: it's what determines the word's width, and so
        // whether the line it lands on overflows.
        if (style.sizePt > prev.style.sizePt) prev.style = style;
      } else {
        words.push({ text: fragment, style });
      }
    });

    openWord = !endsWithSpace;
  }

  return words;
}

/**
 * Greedy line breaking — first fit, which is what every browser does for
 * ordinary text (neither CSS nor PowerPoint runs Knuth-Plass).
 *
 * A word wider than the line gets its own line and is allowed to exceed it: the
 * renderer does the same (no hyphenation, `overflow-wrap` unset), and the extra
 * width surfaces as a wider `widthEmu` rather than as invented extra lines.
 */
export function wrapParagraph(
  p: Paragraph,
  availableWidthEmu: EMU,
  ds: DesignSystem,
  measurer: TextMeasurer,
  opts: { wrap?: boolean } = {},
): MeasuredLine[] {
  const lineHeight = paragraphLineHeightEmu(p, ds);
  const indentEmu = Math.round(indentMetricsPt(p).indentPt * EMU_PER_POINT);
  const blank = (widthEmu: EMU): MeasuredLine => ({ widthEmu, heightEmu: lineHeight, indentEmu });

  const words = wordsOf(p, ds);

  // A paragraph whose runs are all empty is a deliberate blank line, and the
  // renderer gives it a <br> so it keeps its full line box. Measuring it as
  // zero-height is how a spacer paragraph silently stops counting.
  if (words.length === 0) return [blank(0)];

  const widthOf = (w: Word) => measurer.measure(w.text, w.style).wEmu;
  const spaceWidth = (style: TextStyleMetrics) => measurer.measure(' ', style).wEmu;

  // `wrap: false` on the body maps to `white-space: nowrap` — one line, however
  // wide it comes out. The chart engine relies on this for labels it has
  // already sized to fit.
  if (opts.wrap === false) {
    let total = 0;
    words.forEach((w, i) => {
      total += widthOf(w) + (i > 0 ? spaceWidth(w.style) : 0);
    });
    return [blank(total)];
  }

  const lines: MeasuredLine[] = [];
  let current = 0;
  let count = 0;

  for (const word of words) {
    const wordWidth = widthOf(word);
    const advance = count === 0 ? wordWidth : spaceWidth(word.style) + wordWidth;
    if (count > 0 && current + advance > availableWidthEmu) {
      lines.push(blank(current));
      current = wordWidth;
      count = 1;
    } else {
      current += advance;
      count += 1;
    }
  }
  lines.push(blank(current));

  return lines;
}

/**
 * Lay out a text body inside a rect and report whether it fits.
 *
 * The rect is the ELEMENT's rect; insets are applied here via `textInsetBox`,
 * matching the padding `TextBodyView` puts on its container.
 */
export function measureTextBody(
  body: TextBody,
  rect: Rect,
  ds: DesignSystem,
  measurer: TextMeasurer,
): TextBodyMetrics {
  const box = textInsetBox(rect, body.insets);
  const paragraphs: MeasuredParagraph[] = [];
  let heightEmu = 0;
  let widthEmu = 0;
  let lines = 0;

  for (const p of body.paragraphs ?? []) {
    const indentEmu = Math.round(indentMetricsPt(p).indentPt * EMU_PER_POINT);
    // A box narrower than its own indent has no room for text at all; clamp so
    // wrapping puts one word per line rather than dividing into a negative.
    const available = Math.max(1, box.w - indentEmu);
    const measured = wrapParagraph(p, available, ds, measurer, { wrap: body.wrap });

    // Margins on adjacent <p> elements inside a flex column do NOT collapse —
    // they are flex items — so space-after and the next space-before both count.
    const before = Math.round((p.spaceBeforePt ?? 0) * EMU_PER_POINT);
    const after = Math.round((p.spaceAfterPt ?? 0) * EMU_PER_POINT);
    const paraHeight =
      before + after + measured.reduce((sum, l) => sum + l.heightEmu, 0);

    paragraphs.push({ lines: measured, heightEmu: paraHeight });
    heightEmu += paraHeight;
    lines += measured.length;
    for (const line of measured) {
      widthEmu = Math.max(widthEmu, line.widthEmu + line.indentEmu);
    }
  }

  return {
    widthEmu,
    heightEmu,
    lines,
    overflowEmu: heightEmu - box.h,
    paragraphs,
  };
}

/** Does this text exceed its box? Tolerance absorbs sub-point rounding. */
export function overflows(
  body: TextBody,
  rect: Rect,
  ds: DesignSystem,
  measurer: TextMeasurer,
  toleranceEmu: EMU = EMU_PER_POINT,
): boolean {
  return measureTextBody(body, rect, ds, measurer).overflowEmu > toleranceEmu;
}

/**
 * The height this body needs at a given width — what a box would have to be to
 * fit it. The measurement `refit`'s grow step is built on.
 */
export function neededHeightEmu(
  body: TextBody,
  rect: Rect,
  ds: DesignSystem,
  measurer: TextMeasurer,
): EMU {
  const metrics = measureTextBody(body, rect, ds, measurer);
  const insetH = rect.h - textInsetBox(rect, body.insets).h;
  return metrics.heightEmu + insetH;
}

/** One line of this paragraph's type — for callers sizing an empty box. */
export { lineHeightEmu };
