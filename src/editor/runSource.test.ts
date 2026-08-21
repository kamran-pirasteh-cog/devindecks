import { describe, expect, it } from 'vitest';
import { paragraphSource, parseRunKey, runAt, runKey } from './runSource';

const paragraphs = [
  { runs: [{ text: 'eyebrow' }, { text: ' mono' }] },
  { runs: [{ text: 'title' }] },
];

describe('run keys', () => {
  it('round-trips a paragraph/run pair', () => {
    expect(parseRunKey(runKey(3, 12))).toEqual({ para: 3, run: 12 });
  });

  it('rejects anything that is not a pair of indices', () => {
    for (const key of [null, undefined, '', '0', 'a.b', '1.', '.1', '1.2.3', '-1.0'])
      expect(parseRunKey(key)).toBeNull();
  });

  it('finds the run a key names, wherever its span ended up in the DOM', () => {
    expect(runAt(paragraphs, runKey(0, 1))).toEqual({ text: ' mono' });
    expect(runAt(paragraphs, runKey(1, 0))).toEqual({ text: 'title' });
  });

  it('is null for a run the model no longer has, rather than the wrong run', () => {
    expect(runAt(paragraphs, runKey(0, 9))).toBeNull();
    expect(runAt(paragraphs, runKey(9, 0))).toBeNull();
    expect(runAt(paragraphs, null)).toBeNull();
  });
});

describe('paragraphSource', () => {
  it('believes a block that says which paragraph it is', () => {
    // The third block on screen still styles as paragraph 0 when that is what
    // it was painted from — an Enter above it must not shift its style.
    expect(paragraphSource(2, 0, 1, 2)).toBe(0);
  });

  it('inherits from the paragraph before it when the browser made the block', () => {
    expect(paragraphSource(2, null, 0, 5)).toBe(0);
  });

  it('falls back to position for the first group, clamped to the last paragraph', () => {
    expect(paragraphSource(3, null, null, 1)).toBe(1);
    expect(paragraphSource(2, null, null, 7)).toBe(1);
    expect(paragraphSource(0, null, null, 3)).toBe(0);
  });

  it('ignores a claim the model cannot honour', () => {
    expect(paragraphSource(2, 5, 1, 0)).toBe(1);
  });
});
