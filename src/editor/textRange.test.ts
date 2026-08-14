import { describe, expect, it } from 'vitest';
import type { Paragraph } from '@/model';
import type { ElementFormat } from './elementFormat';
import { formatRange, locateRun } from './textRange';

const para = (...runs: { text: string; bold?: boolean; sizePt?: number }[]): Paragraph => ({
  runs: runs.map((r) => ({ ...r })),
});

const text = (paragraphs: Paragraph[]) =>
  paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');

const bold: ElementFormat = { run: { bold: true } };

describe('locateRun', () => {
  const body = [para({ text: 'abc' }, { text: 'def' }), para({ text: 'ghi' })];

  it('finds the run holding the character to the right', () => {
    expect(locateRun(body, 0)).toEqual({ paragraph: 0, run: 0 });
    expect(locateRun(body, 3)).toEqual({ paragraph: 0, run: 1 });
    // 7 is one past the newline at 6, so the second paragraph's first character.
    expect(locateRun(body, 7)).toEqual({ paragraph: 1, run: 0 });
  });

  it('samples behind the caret with the "before" bias', () => {
    expect(locateRun(body, 3, 'before')).toEqual({ paragraph: 0, run: 0 });
    expect(locateRun(body, 0, 'before')).toEqual({ paragraph: 0, run: 0 });
  });

  it('clamps past the end and handles an empty body', () => {
    expect(locateRun(body, 999)).toEqual({ paragraph: 1, run: 0 });
    expect(locateRun([], 0)).toBeNull();
  });
});

describe('formatRange', () => {
  it('splits a run at both edges and formats only the middle', () => {
    const out = formatRange([para({ text: 'hello world' })], 6, 11, bold);
    expect(out[0].runs).toEqual([
      { text: 'hello ' },
      { text: 'world', bold: true },
    ]);
    expect(text(out)).toBe('hello world');
  });

  it('leaves paragraphs the range misses untouched', () => {
    const body = [para({ text: 'one' }), para({ text: 'two' })];
    const out = formatRange(body, 0, 3, bold);
    expect(out[1]).toBe(body[1]);
    expect(out[0].runs[0].bold).toBe(true);
  });

  it('spans paragraphs, counting one newline between them', () => {
    const out = formatRange([para({ text: 'one' }), para({ text: 'two' })], 2, 5, bold);
    expect(out[0].runs).toEqual([{ text: 'on' }, { text: 'e', bold: true }]);
    expect(out[1].runs).toEqual([{ text: 't', bold: true }, { text: 'wo' }]);
  });

  it('merges neighbours that end up identical', () => {
    const out = formatRange([para({ text: 'ab', bold: true }, { text: 'cd' })], 2, 4, bold);
    expect(out[0].runs).toEqual([{ text: 'abcd', bold: true }]);
  });

  it('clears overrides the sampled format does not carry', () => {
    const out = formatRange([para({ text: 'big', sizePt: 40 })], 0, 3, bold);
    expect(out[0].runs[0]).toEqual({ text: 'big', bold: true });
  });

  it('carries paragraph properties only to paragraphs covered end to end', () => {
    const body = [para({ text: 'one' }), para({ text: 'two' })];
    const fmt: ElementFormat = { run: {}, paragraph: { align: 'center' } };
    // 0..7 covers both paragraphs and the newline between them.
    expect(formatRange(body, 0, 7, fmt).map((p) => p.align)).toEqual(['center', 'center']);
    // 0..5 clips the second paragraph, which keeps its own paragraph style.
    expect(formatRange(body, 0, 5, fmt).map((p) => p.align)).toEqual(['center', undefined]);
  });

  it('leaves a partly selected bullet a bullet', () => {
    const body: Paragraph[] = [{ ...para({ text: 'a point' }), bullet: 'bullet', level: 1 }];
    const out = formatRange(body, 2, 7, { run: { bold: true }, paragraph: {} });
    expect(out[0].bullet).toBe('bullet');
    expect(out[0].level).toBe(1);
  });

  it('is a no-op for an empty range or a format with no run', () => {
    const body = [para({ text: 'one' })];
    expect(formatRange(body, 2, 2, bold)).toBe(body);
    expect(formatRange(body, 0, 3, {})).toBe(body);
  });
});
