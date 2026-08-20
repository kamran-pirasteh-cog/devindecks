/**
 * These tests are the contract between this measurer and `ParagraphView`. They
 * assert the RULES the renderer follows (largest run sets line height, blank
 * paragraphs keep their box, run boundaries inside a word are not break
 * opportunities), not specific EMU totals — the metric measurer is good to a
 * few percent and pinning exact widths would make it untouchable.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM } from '@/model/tokens';
import { EMU_PER_POINT, FONTS, inchesToEmu } from '@/model';
import type { Paragraph, Rect, TextBody } from '@/model/types';
import { metricMeasurer } from './measureText';
import {
  measureTextBody,
  neededHeightEmu,
  overflows,
  paragraphLineHeightEmu,
  wrapParagraph,
} from './measureTextBody';

const ds = DEFAULT_DESIGN_SYSTEM;
const m = metricMeasurer();

const para = (text: string, extra: Partial<Paragraph> = {}): Paragraph => ({
  runs: [{ text, sizePt: 14, font: 'Geist' }],
  ...extra,
});

const body = (paragraphs: Paragraph[], extra: Partial<TextBody> = {}): TextBody => ({
  paragraphs,
  ...extra,
});

const rect = (wIn: number, hIn: number): Rect => ({
  x: 0,
  y: 0,
  w: inchesToEmu(wIn),
  h: inchesToEmu(hIn),
});

describe('paragraphLineHeightEmu', () => {
  it('is the font size times its own single-line factor', () => {
    const h = paragraphLineHeightEmu(para('hello'), ds);
    expect(h).toBe(Math.round(14 * EMU_PER_POINT * FONTS.Geist.singleLineFactor));
  });

  it('scales with lineSpacingPct', () => {
    const single = paragraphLineHeightEmu(para('hello'), ds);
    const double = paragraphLineHeightEmu(para('hello', { lineSpacingPct: 200 }), ds);
    expect(double).toBe(single * 2);
  });

  it('takes its size from the LARGEST run, as PowerPoint does', () => {
    const mixed: Paragraph = {
      runs: [
        { text: 'small ', sizePt: 10, font: 'Geist' },
        { text: 'BIG', sizePt: 40, font: 'Geist' },
      ],
    };
    expect(paragraphLineHeightEmu(mixed, ds)).toBe(
      Math.round(40 * EMU_PER_POINT * FONTS.Geist.singleLineFactor),
    );
  });

  it('falls back to the design system body size for a run with no size', () => {
    const bare: Paragraph = { runs: [{ text: 'x' }] };
    expect(paragraphLineHeightEmu(bare, ds)).toBe(
      Math.round(ds.type.body.sizePt * EMU_PER_POINT * FONTS[ds.fonts.body].singleLineFactor),
    );
  });
});

describe('wrapParagraph', () => {
  it('wraps a long paragraph into several lines', () => {
    const long = para('the quick brown fox jumps over the lazy dog again and again and again');
    const lines = wrapParagraph(long, inchesToEmu(2), ds, m);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('keeps a short paragraph on one line', () => {
    expect(wrapParagraph(para('short'), inchesToEmu(6), ds, m)).toHaveLength(1);
  });

  it('gives a blank paragraph one full-height line', () => {
    const empty: Paragraph = { runs: [{ text: '', sizePt: 14, font: 'Geist' }] };
    const lines = wrapParagraph(empty, inchesToEmu(4), ds, m);
    expect(lines).toHaveLength(1);
    expect(lines[0].heightEmu).toBe(paragraphLineHeightEmu(empty, ds));
  });

  it('gives a paragraph with no runs at all one line rather than zero', () => {
    expect(wrapParagraph({ runs: [] }, inchesToEmu(4), ds, m)).toHaveLength(1);
  });

  it('does not break inside a word split across two runs', () => {
    // "extraordinary" arrives as two runs because its middle is bolded. A naive
    // per-run split would offer a break at the seam and wrap it into two lines.
    const split: Paragraph = {
      runs: [
        { text: 'extra', sizePt: 14, font: 'Geist' },
        { text: 'ordinary', sizePt: 14, font: 'Geist', bold: true },
      ],
    };
    const whole: Paragraph = { runs: [{ text: 'extraordinary', sizePt: 14, font: 'Geist' }] };
    const narrow = inchesToEmu(1.1);
    expect(wrapParagraph(split, narrow, ds, m)).toHaveLength(
      wrapParagraph(whole, narrow, ds, m).length,
    );
  });

  it('does break where a run boundary carries whitespace', () => {
    const spaced: Paragraph = {
      runs: [
        { text: 'alpha ', sizePt: 14, font: 'Geist' },
        { text: 'beta', sizePt: 14, font: 'Geist' },
      ],
    };
    // Narrow enough that two words cannot share a line.
    expect(wrapParagraph(spaced, inchesToEmu(0.5), ds, m)).toHaveLength(2);
  });

  it('lets a single unbreakable word exceed the line rather than inventing lines', () => {
    const huge = para('pneumonoultramicroscopicsilicovolcanoconiosis');
    const lines = wrapParagraph(huge, inchesToEmu(0.4), ds, m);
    expect(lines).toHaveLength(1);
    expect(lines[0].widthEmu).toBeGreaterThan(inchesToEmu(0.4));
  });

  it('honours wrap: false with a single line', () => {
    const long = para('the quick brown fox jumps over the lazy dog again and again');
    const lines = wrapParagraph(long, inchesToEmu(1), ds, m, { wrap: false });
    expect(lines).toHaveLength(1);
  });

  it('indents a bulleted paragraph, leaving less room for text', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const plain = wrapParagraph(para(text), inchesToEmu(2), ds, m);
    const bulleted = wrapParagraph(
      para(text, { bullet: 'bullet', level: 2 }),
      inchesToEmu(2) - 0, // same box; the indent comes off inside measureTextBody
      ds,
      m,
    );
    expect(bulleted[0].indentEmu).toBeGreaterThan(0);
    expect(plain[0].indentEmu).toBe(0);
  });
});

describe('measureTextBody', () => {
  it('reports no overflow for text that comfortably fits', () => {
    const metrics = measureTextBody(body([para('one line')]), rect(6, 2), ds, m);
    expect(metrics.overflowEmu).toBeLessThanOrEqual(0);
    expect(metrics.lines).toBe(1);
  });

  it('reports overflow for text far too big for its box', () => {
    const many = Array.from({ length: 20 }, (_, i) => para(`line number ${i}`));
    const metrics = measureTextBody(body(many), rect(6, 1), ds, m);
    expect(metrics.overflowEmu).toBeGreaterThan(0);
  });

  it('height is the sum of every line plus paragraph spacing', () => {
    const p = para('one', { spaceBeforePt: 6, spaceAfterPt: 12 });
    const metrics = measureTextBody(body([p]), rect(6, 4), ds, m);
    expect(metrics.heightEmu).toBe(
      paragraphLineHeightEmu(p, ds) +
        Math.round(6 * EMU_PER_POINT) +
        Math.round(12 * EMU_PER_POINT),
    );
  });

  it('counts space-after and the next space-before separately (flex items do not collapse)', () => {
    const a = para('a', { spaceAfterPt: 10 });
    const b = para('b', { spaceBeforePt: 10 });
    const metrics = measureTextBody(body([a, b]), rect(6, 4), ds, m);
    const lines = paragraphLineHeightEmu(a, ds) + paragraphLineHeightEmu(b, ds);
    expect(metrics.heightEmu).toBe(lines + Math.round(20 * EMU_PER_POINT));
  });

  it('subtracts insets from the available box, so insets can cause overflow', () => {
    const text = body([para('the quick brown fox jumps over the lazy dog')]);
    const tight = rect(2.2, 0.32);
    const without = measureTextBody(text, tight, ds, m);
    const withInsets = measureTextBody(
      { ...text, insets: { l: inchesToEmu(0.5), t: 0, r: inchesToEmu(0.5), b: 0 } },
      tight,
      ds,
      m,
    );
    expect(withInsets.lines).toBeGreaterThan(without.lines);
  });

  it('a bulleted list needs more height than the same text unbulleted', () => {
    const text = 'the quick brown fox jumps over the lazy dog and keeps on running';
    const plain = measureTextBody(body([para(text)]), rect(3, 4), ds, m);
    const bulleted = measureTextBody(
      body([para(text, { bullet: 'bullet', level: 1 })]),
      rect(3, 4),
      ds,
      m,
    );
    expect(bulleted.lines).toBeGreaterThanOrEqual(plain.lines);
  });

  it('scales height with font size', () => {
    const small = measureTextBody(
      body([{ runs: [{ text: 'x', sizePt: 10, font: 'Geist' }] }]),
      rect(6, 4),
      ds,
      m,
    );
    const large = measureTextBody(
      body([{ runs: [{ text: 'x', sizePt: 30, font: 'Geist' }] }]),
      rect(6, 4),
      ds,
      m,
    );
    expect(large.heightEmu).toBeGreaterThan(small.heightEmu * 2);
  });

  it('measures caps text wider than the same string in mixed case', () => {
    const plain = measureTextBody(
      body([{ runs: [{ text: 'brand identity', sizePt: 14, font: 'Geist' }] }]),
      rect(6, 4),
      ds,
      m,
    );
    const caps = measureTextBody(
      body([{ runs: [{ text: 'brand identity', sizePt: 14, font: 'Geist', caps: true }] }]),
      rect(6, 4),
      ds,
      m,
    );
    expect(caps.widthEmu).toBeGreaterThan(plain.widthEmu);
  });

  it('is deterministic', () => {
    const b = body([para('the quick brown fox'), para('jumps over the lazy dog')]);
    expect(measureTextBody(b, rect(3, 2), ds, m)).toEqual(
      measureTextBody(b, rect(3, 2), ds, m),
    );
  });

  it('handles an empty body without throwing', () => {
    const metrics = measureTextBody(body([]), rect(6, 2), ds, m);
    expect(metrics.lines).toBe(0);
    expect(metrics.heightEmu).toBe(0);
  });
});

describe('overflows / neededHeightEmu', () => {
  it('overflows() tolerates sub-point rounding', () => {
    const p = para('one line');
    const needed = paragraphLineHeightEmu(p, ds);
    // A box exactly one line tall, minus half a point — inside tolerance.
    const box: Rect = { x: 0, y: 0, w: inchesToEmu(6), h: needed - EMU_PER_POINT / 2 };
    expect(overflows(body([p]), box, ds, m)).toBe(false);
  });

  it('neededHeightEmu returns a height the same text then fits in', () => {
    const b = body([para('the quick brown fox jumps over the lazy dog once more')]);
    const tight = rect(2, 0.3);
    const needed = neededHeightEmu(b, tight, ds, m);
    expect(overflows(b, { ...tight, h: needed }, ds, m)).toBe(false);
  });

  it('neededHeightEmu accounts for insets', () => {
    const paragraphs = [para('hello')];
    const tight = rect(6, 0.3);
    const bare = neededHeightEmu(body(paragraphs), tight, ds, m);
    const inset = neededHeightEmu(
      body(paragraphs, { insets: { l: 0, t: inchesToEmu(0.2), r: 0, b: inchesToEmu(0.2) } }),
      tight,
      ds,
      m,
    );
    expect(inset).toBeGreaterThan(bare);
  });
});
