import { describe, expect, it } from 'vitest';
import type { NumberFormat } from '@/model';
import { formatNumber } from './number';
import { numberPatternOf, parseNumberPattern } from './pattern';

/** What a pattern actually renders — the only test that matters to a reader. */
const shown = (pattern: string, value: number): string => {
  const f = parseNumberPattern(pattern);
  if (!f) throw new Error(`unparsed: ${pattern}`);
  return formatNumber(value, f).text;
};

describe('parseNumberPattern', () => {
  it('reads grouping and decimals off the digit block', () => {
    expect(parseNumberPattern('#,##0')).toMatchObject({
      style: 'number',
      thousands: true,
      decimals: 0,
      scale: 'none',
    });
    expect(parseNumberPattern('0.00')).toMatchObject({ thousands: false, decimals: 2 });
  });

  it('treats a fraction of hashes as auto decimals', () => {
    expect(parseNumberPattern('#,##0.##')?.decimals).toBeUndefined();
  });

  it('reads a trailing comma as a scale divisor, not a separator', () => {
    expect(parseNumberPattern('#,##0.0,')).toMatchObject({ scale: 'K', decimals: 1 });
    expect(parseNumberPattern('$0.0,,')).toMatchObject({ scale: 'M', style: 'currency' });
    expect(parseNumberPattern('0,,,')).toMatchObject({ scale: 'B' });
    // Grouping still comes off the block itself, with the divisor stripped.
    expect(parseNumberPattern('#,##0,,')).toMatchObject({ thousands: true, scale: 'M' });
  });

  it('reads currency, percent and literal affixes', () => {
    expect(parseNumberPattern('$#,##0')).toMatchObject({ style: 'currency', currency: 'USD' });
    expect(parseNumberPattern('€#,##0')).toMatchObject({ style: 'currency', currency: 'EUR' });
    expect(parseNumberPattern('0.0%')).toMatchObject({ style: 'percent', decimals: 1 });
    expect(parseNumberPattern('"FY"0.0,')).toMatchObject({ prefix: 'FY', scale: 'K' });
    // The space inside the quotes is part of the literal, not padding.
    expect(parseNumberPattern('#,##0" bn"')).toMatchObject({ suffix: ' bn' });
  });

  it('reads the negative section', () => {
    expect(parseNumberPattern('#,##0;(#,##0)')?.negative).toBe('parens');
    expect(parseNumberPattern('#,##0;[Red]-#,##0')?.negative).toBe('red');
    expect(parseNumberPattern('#,##0')?.negative).toBe('minus');
  });

  it('refuses what it cannot draw', () => {
    expect(parseNumberPattern('')).toBeNull();
    expect(parseNumberPattern('   ')).toBeNull();
    expect(parseNumberPattern('hello')).toBeNull();
    // Five divisors is past trillions; a fraction is a second digit block.
    expect(parseNumberPattern('0,,,,,')).toBeNull();
    expect(parseNumberPattern('# ?/?')).toBeNull();
    expect(parseNumberPattern('0" of "0')).toBeNull();
  });

  it('renders what the pattern says', () => {
    expect(shown('#,##0', 1234.5)).toBe('1,235');
    expect(shown('0.0', 1234.5)).toBe('1234.5');
    expect(shown('#,##0.0,,', 1_240_000)).toBe('1.2M');
    expect(shown('$0.0,,', 1_240_000)).toBe('$1.2M');
    expect(shown('#.0,', 12_340)).toBe('12.3K');
    expect(shown('0.0%', 0.1234)).toBe('12.3%');
    expect(shown('"FY"0.0,', 12_340)).toBe('FY12.3K');
    expect(shown('#,##0;(#,##0)', -1234)).toBe('(1,234)');
  });
});

describe('numberPatternOf', () => {
  const round = (f: NumberFormat) => {
    const pattern = numberPatternOf(f);
    expect(pattern).not.toBeNull();
    return parseNumberPattern(pattern!);
  };

  it('writes a format the parser reads back unchanged', () => {
    const cases: NumberFormat[] = [
      { style: 'number', thousands: true, decimals: 0, scale: 'none', negative: 'minus' },
      { style: 'number', thousands: false, decimals: 1, scale: 'K', negative: 'parens' },
      { style: 'currency', currency: 'EUR', thousands: true, decimals: 2, scale: 'M', negative: 'red' },
      { style: 'percent', thousands: true, decimals: 1, scale: 'none', negative: 'minus' },
      { style: 'number', thousands: true, scale: 'B', negative: 'minus', prefix: 'ca. ', suffix: ' units' },
    ];
    for (const f of cases) expect(round(f)).toEqual(f);
  });

  it('has no pattern for an auto scale, because no pattern says that', () => {
    expect(numberPatternOf({ style: 'number', thousands: true, scale: 'auto' })).toBeNull();
  });

  it('writes auto decimals as the two places the engine resolves to', () => {
    expect(numberPatternOf({ style: 'number', thousands: true, scale: 'none' })).toBe('#,##0.##');
  });
});
