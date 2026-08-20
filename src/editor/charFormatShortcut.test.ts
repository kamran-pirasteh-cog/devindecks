import { describe, expect, it } from 'vitest';
import {
  charFormatAction,
  charFormatPatch,
  chartCanStore,
  type CharFormat,
} from './charFormatShortcut';

/** A keydown, with the modifiers the handler reads. */
const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}, code?: string) => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  key: k,
  ...(code ? { code } : {}),
  ...mods,
});

describe('charFormatAction', () => {
  it('matches ⌘B / ⌘I / ⌘U', () => {
    expect(charFormatAction(key('b', { metaKey: true }))).toBe('bold');
    expect(charFormatAction(key('i', { metaKey: true }))).toBe('italic');
    expect(charFormatAction(key('u', { metaKey: true }))).toBe('underline');
  });

  it('matches the Ctrl form for Windows', () => {
    expect(charFormatAction(key('b', { ctrlKey: true }))).toBe('bold');
  });

  it('is case-insensitive, so Shift does not break it', () => {
    expect(charFormatAction(key('B', { metaKey: true, shiftKey: true }))).toBe('bold');
    expect(charFormatAction(key('I', { metaKey: true, shiftKey: true }))).toBe('italic');
  });

  it('falls back to `code`, so a non-QWERTY layout still works', () => {
    // On macOS Option rewrites the character; on AZERTY the letter moves. The
    // physical key is the reliable side of the match.
    expect(charFormatAction(key('ˆ', { metaKey: true, altKey: true }, 'KeyI'))).toBe('italic');
    expect(charFormatAction(key('∫', { metaKey: true, altKey: true }, 'KeyB'))).toBe('bold');
  });

  it('needs a modifier — plain typing is not a format chord', () => {
    expect(charFormatAction(key('b'))).toBeNull();
    expect(charFormatAction(key('i', { shiftKey: true }))).toBeNull();
  });

  it('ignores keys it does not own', () => {
    expect(charFormatAction(key('c', { metaKey: true }))).toBeNull();
    expect(charFormatAction(key('v', { metaKey: true }))).toBeNull();
    expect(charFormatAction(key('>', { metaKey: true, shiftKey: true }))).toBeNull();
  });

  it('does not claim the format-painter chords', () => {
    // ⌘⌥C / ⌘⇧V are matched earlier in the handler; this must not shadow them.
    expect(charFormatAction(key('ç', { metaKey: true, altKey: true }, 'KeyC'))).toBeNull();
    expect(charFormatAction(key('√', { metaKey: true, altKey: true }, 'KeyV'))).toBeNull();
  });
});

describe('chartCanStore', () => {
  it('a chart spec can keep bold and italic', () => {
    expect(chartCanStore('bold')).toBe(true);
    expect(chartCanStore('italic')).toBe(true);
  });

  it('but NOT underline — `LabelFont` has no field for it', () => {
    // The honest outcome is a no-op. Writing underline onto the emitted text box
    // would survive until the next recompile and then vanish, which reads as a
    // bug rather than as an unsupported option.
    expect(chartCanStore('underline')).toBe(false);
  });
});

describe('charFormatPatch', () => {
  it('turns a format on when it is off', () => {
    expect(charFormatPatch('bold', undefined)).toEqual({ bold: true });
    expect(charFormatPatch('italic', {})).toEqual({ italic: true });
    expect(charFormatPatch('underline', {})).toEqual({ underline: true });
  });

  it('turns it back off when it is on, with an EXPLICIT false', () => {
    // `false` rather than `undefined` matters for chart labels: `fontOver` gates
    // on `!== undefined`, so only an explicit false clears an italic inherited
    // from the series or the chart.
    expect(charFormatPatch('bold', { bold: true })).toEqual({ bold: false });
    expect(charFormatPatch('italic', { italic: true })).toEqual({ italic: false });
  });

  it('touches only the one field it is toggling', () => {
    const current = { bold: true, italic: true, underline: true };
    for (const f of ['bold', 'italic', 'underline'] as CharFormat[]) {
      expect(Object.keys(charFormatPatch(f, current))).toEqual([f]);
    }
  });

  it('reads each format independently — bold and italic compose', () => {
    // Italicizing an already-bold label must not clear the bold.
    expect(charFormatPatch('italic', { bold: true })).toEqual({ italic: true });
    expect(charFormatPatch('bold', { italic: true })).toEqual({ bold: true });
  });
});
