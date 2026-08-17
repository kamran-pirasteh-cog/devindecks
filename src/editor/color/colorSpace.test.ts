import { describe, expect, it } from 'vitest';
import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  isLight,
  normalizeHex,
  rgbToHex,
  rgbToHsv,
} from './colorSpace';

describe('normalizeHex', () => {
  it('accepts full, shorthand, bare and mixed-case input', () => {
    expect(normalizeHex('#2600ff')).toBe('#2600FF');
    expect(normalizeHex('2600FF')).toBe('#2600FF');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('  #FFF  ')).toBe('#FFFFFF');
  });

  it('rejects anything that is not yet a colour', () => {
    // A field is in these states on nearly every keystroke, so they have to be
    // "not a colour" rather than a bad one.
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('#26')).toBeNull();
    expect(normalizeHex('#2600f')).toBeNull();
    expect(normalizeHex('#2600fff')).toBeNull();
    expect(normalizeHex('#zzzzzz')).toBeNull();
    expect(normalizeHex('rgb(1,2,3)')).toBeNull();
  });
});

describe('hex ⇄ rgb', () => {
  it('round-trips', () => {
    expect(hexToRgb('#2600FF')).toEqual({ r: 0x26, g: 0, b: 0xff });
    expect(rgbToHex({ r: 38, g: 0, b: 255 })).toBe('#2600FF');
  });

  it('falls back to black rather than NaN channels', () => {
    expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('clamps out-of-range channels', () => {
    expect(rgbToHex({ r: 300, g: -20, b: 12.6 })).toBe('#FF000D');
  });
});

describe('rgb ⇄ hsv', () => {
  it('places the primaries on their hue spokes', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 1, v: 1 });
  });

  it('reports greys as hueless', () => {
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 1 });
  });

  it('round-trips every hue sector', () => {
    for (const hex of ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('round-trips arbitrary colours', () => {
    for (const hex of ['#191919', '#2600FF', '#6B7280', '#F5F5F5', '#E5E7EB', '#7A3B12']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('wraps hue and clamps s/v instead of producing garbage', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual({ r: 0, g: 0, b: 255 });
    expect(hsvToRgb({ h: 0, s: 4, v: 9 })).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('isLight', () => {
  it('weights channels rather than averaging them', () => {
    // Same channel average, opposite answers — the reason this isn't (r+g+b)/3.
    expect(isLight('#00FF00')).toBe(true);
    expect(isLight('#0000FF')).toBe(false);
  });

  it('agrees with the obvious cases', () => {
    expect(isLight('#FFFFFF')).toBe(true);
    expect(isLight('#F5F5F5')).toBe(true);
    expect(isLight('#191919')).toBe(false);
    expect(isLight('#6B7280')).toBe(false);
  });
});
