import { describe, expect, it } from 'vitest';
import { EMU_PER_POINT, FONTS } from '@/model';
import { defaultMeasurer, displayText, lineHeightEmu, metricMeasurer } from './measureText';

const m = metricMeasurer();
const geist = (sizePt: number, bold?: boolean) => ({ font: 'Geist' as const, sizePt, bold });

describe('lineHeightEmu', () => {
  it("uses the font's own single-line factor, not a hard-coded 1.2", () => {
    expect(lineHeightEmu(geist(10))).toBe(
      Math.round(10 * EMU_PER_POINT * FONTS.Geist.singleLineFactor),
    );
    expect(lineHeightEmu({ font: 'Source Serif 4', sizePt: 10 })).toBeGreaterThan(
      lineHeightEmu(geist(10)),
    );
  });
});

describe('metricMeasurer', () => {
  it('is deterministic', () => {
    expect(m.measure('1,240', geist(10))).toEqual(m.measure('1,240', geist(10)));
  });

  it('scales linearly with font size', () => {
    const a = m.measure('Enterprise', geist(10)).wEmu;
    const b = m.measure('Enterprise', geist(20)).wEmu;
    expect(b / a).toBeCloseTo(2, 1);
  });

  it('measures an empty string as zero width but a full line high', () => {
    const r = m.measure('', geist(10));
    expect(r.wEmu).toBe(0);
    expect(r.hEmu).toBe(lineHeightEmu(geist(10)));
  });

  it('makes wide glyphs wider than narrow ones', () => {
    expect(m.measure('MMMM', geist(10)).wEmu).toBeGreaterThan(
      m.measure('llll', geist(10)).wEmu,
    );
  });

  it('makes digits wider than a space', () => {
    expect(m.measure('8888', geist(10)).wEmu).toBeGreaterThan(
      m.measure('    ', geist(10)).wEmu,
    );
  });

  it('makes bold wider than regular', () => {
    expect(m.measure('Revenue', geist(10, true)).wEmu).toBeGreaterThan(
      m.measure('Revenue', geist(10)).wEmu,
    );
  });

  it('gives every character the same advance in the mono face', () => {
    const mono = (s: string) => m.measure(s, { font: 'Geist Mono', sizePt: 10 }).wEmu;
    expect(mono('MMMM')).toBe(mono('llll'));
  });

  it('grows monotonically with text length', () => {
    const w = (s: string) => m.measure(s, geist(10)).wEmu;
    expect(w('FY2')).toBeGreaterThan(w('FY'));
    expect(w('FY25 revenue')).toBeGreaterThan(w('FY25'));
  });

  it('produces plausible widths for a typical tick label', () => {
    // "1,240" at 10pt should land near 0.35in — a sanity bound, not a snapshot.
    const w = m.measure('1,240', geist(10)).wEmu;
    expect(w).toBeGreaterThan(0.2 * 914_400);
    expect(w).toBeLessThan(0.6 * 914_400);
  });
});

describe('caps', () => {
  it('uppercases only when the style asks', () => {
    expect(displayText('FY25 revenue', geist(10))).toBe('FY25 revenue');
    expect(displayText('FY25 revenue', { ...geist(10), caps: true })).toBe('FY25 REVENUE');
  });

  it('measures the uppercased string, not the one passed in', () => {
    // The whole point: a gutter sized for "revenue" and then filled with
    // "REVENUE" overhangs the plot.
    const plain = m.measure('revenue', geist(10)).wEmu;
    const caps = m.measure('revenue', { ...geist(10), caps: true }).wEmu;
    expect(caps).toBeGreaterThan(plain);
    expect(caps).toBe(m.measure('REVENUE', geist(10)).wEmu);
  });
});

describe('defaultMeasurer', () => {
  it('falls back to metrics with no DOM, so tests and SSR still lay out', () => {
    expect(defaultMeasurer().measure('1,240', geist(10))).toEqual(
      m.measure('1,240', geist(10)),
    );
  });
});
