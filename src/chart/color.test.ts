import { describe, expect, it } from 'vitest';
import {
  buildRamp,
  contrastRatio,
  hexToOklch,
  inkOn,
  isTooPale,
  oklchToHex,
  relativeLuminance,
  shadeOf,
  tooSimilar,
} from './color';

describe('sRGB <-> OKLCH', () => {
  it('round-trips a saturated brand colour', () => {
    expect(oklchToHex(hexToOklch('#4F46E5'))).toBe('#4F46E5');
  });

  it('round-trips the achromatic ends', () => {
    expect(oklchToHex(hexToOklch('#FFFFFF'))).toBe('#FFFFFF');
    expect(oklchToHex(hexToOklch('#000000'))).toBe('#000000');
  });

  it('accepts three-digit hex', () => {
    expect(oklchToHex(hexToOklch('#fff'))).toBe('#FFFFFF');
  });

  it('orders lightness the way the eye does', () => {
    // Pure yellow is far lighter than pure blue despite both being "full"
    // colours — the property sRGB arithmetic gets wrong and OKLCH gets right.
    expect(hexToOklch('#FFFF00').l).toBeGreaterThan(hexToOklch('#0000FF').l);
  });

  it('keeps hue when a requested colour is outside sRGB', () => {
    // Chroma 0.4 at this lightness is not representable; the result must still
    // be recognisably blue rather than clipping its way to purple.
    const out = hexToOklch(oklchToHex({ l: 0.5, c: 0.4, h: 264 }));
    expect(Math.abs(out.h - 264)).toBeLessThan(6);
  });
});

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#4F46E5', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#4F46E5'), 6);
  });

  it('ranks luminance sensibly', () => {
    expect(relativeLuminance('#FFFFFF')).toBeGreaterThan(relativeLuminance('#4F46E5'));
  });
});

describe('inkOn', () => {
  it('goes white on a dark brand fill', () => {
    // The exact defect this exists to fix: a near-black label on the indigo
    // accent, which is what every stacked chart currently renders.
    expect(inkOn('#4F46E5')).toBe('#FFFFFF');
  });

  it('goes dark on a pale fill', () => {
    expect(inkOn('#E5E7EB')).toBe('#0A0A0A');
  });

  it('always clears 4.5:1 against the fill it was chosen for', () => {
    for (const bg of ['#4F46E5', '#0A0A0A', '#6B7280', '#E5E7EB', '#FFFFFF', '#111111']) {
      expect(contrastRatio(bg, inkOn(bg))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks the better of the two even for an awkward mid-tone', () => {
    const bg = '#808080';
    const chosen = inkOn(bg);
    const other = chosen === '#FFFFFF' ? '#0A0A0A' : '#FFFFFF';
    expect(contrastRatio(bg, chosen)).toBeGreaterThanOrEqual(contrastRatio(bg, other));
  });
});

describe('buildRamp', () => {
  it('leads with the seed colour untouched', () => {
    expect(buildRamp('#4F46E5', 5)[0]).toBe('#4F46E5');
  });

  it('returns exactly what was asked for', () => {
    for (const n of [1, 2, 3, 5, 8, 12]) {
      expect(buildRamp('#4F46E5', n)).toHaveLength(n);
    }
  });

  it('is empty for a zero count rather than throwing', () => {
    expect(buildRamp('#4F46E5', 0)).toEqual([]);
  });

  it('never emits a colour too pale to see on a white slide', () => {
    for (const c of buildRamp('#4F46E5', 12)) expect(isTooPale(c)).toBe(false);
  });

  it('keeps neighbours visually distinct', () => {
    const ramp = buildRamp('#4F46E5', 8);
    for (let i = 1; i < ramp.length; i++) {
      expect(tooSimilar(ramp[i - 1], ramp[i])).toBe(false);
    }
  });

  it('has no exact duplicates', () => {
    const ramp = buildRamp('#4F46E5', 12);
    expect(new Set(ramp).size).toBe(ramp.length);
  });

  it('stays on one hue while the tonal ladder has room', () => {
    const hues = buildRamp('#4F46E5', 4).map((c) => hexToOklch(c).h);
    for (const h of hues) expect(Math.abs(h - hues[0])).toBeLessThan(12);
  });

  it('introduces a second hue only once the ladder is spent', () => {
    const hues = buildRamp('#4F46E5', 8).map((c) => hexToOklch(c).h);
    expect(Math.abs(hues[4] - hues[0])).toBeGreaterThan(60);
  });

  it('builds a usable ramp from a grey seed that has no hue of its own', () => {
    const ramp = buildRamp('#6B7280', 5);
    expect(ramp).toHaveLength(5);
    for (const c of ramp) expect(isTooPale(c)).toBe(false);
  });

  it('rescues a seed that is itself too pale to be a series', () => {
    for (const c of buildRamp('#FAFAFA', 4)) expect(isTooPale(c)).toBe(false);
  });
});

describe('shadeOf', () => {
  it('leaves the first cycle alone', () => {
    expect(shadeOf('#4F46E5', 0)).toBe('#4F46E5');
  });

  it('makes each later cycle a distinguishable variant', () => {
    const base = '#4F46E5';
    const seen = [base, shadeOf(base, 1), shadeOf(base, 2)];
    expect(new Set(seen).size).toBe(3);
    expect(tooSimilar(seen[0], seen[1])).toBe(false);
  });

  it('keeps shades inside the legible band', () => {
    for (let cycle = 1; cycle < 6; cycle++) {
      expect(isTooPale(shadeOf('#4F46E5', cycle))).toBe(false);
    }
  });
});
