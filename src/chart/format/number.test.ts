import { describe, expect, it } from 'vitest';
import { DEFAULT_NUMBER_FORMAT, type NumberFormat } from '@/model';
import { formatNumber, formatSet, resolveAutoDecimals, resolveScale } from './number';

const fmt = (over: Partial<NumberFormat> = {}): NumberFormat => ({
  ...DEFAULT_NUMBER_FORMAT,
  ...over,
});

const text = (v: number, f?: Partial<NumberFormat>, peers?: number[]) =>
  formatNumber(v, fmt(f), peers ? { peers } : {}).text;

describe('resolveAutoDecimals', () => {
  it('uses none when every value is whole', () => {
    expect(resolveAutoDecimals([0, 200, 400], fmt())).toBe(0);
  });

  it('uses the fewest decimals that keep every value exact', () => {
    expect(resolveAutoDecimals([1.5, 2, 3], fmt())).toBe(1);
    expect(resolveAutoDecimals([1.25, 2, 3], fmt())).toBe(2);
  });

  it('caps at two', () => {
    expect(resolveAutoDecimals([1.23456], fmt())).toBe(2);
  });

  it('honours an explicit decimals setting', () => {
    expect(resolveAutoDecimals([1, 2, 3], fmt({ decimals: 3 }))).toBe(3);
  });

  it('resolves against the SCALED magnitude, not the raw one', () => {
    // 1_500_000 -> 1.5M needs a decimal even though the raw value is whole.
    expect(resolveAutoDecimals([1_500_000, 2_000_000], fmt({ scale: 'M' }))).toBe(1);
  });
});

describe('resolveScale', () => {
  it('leaves an explicit scale alone', () => {
    expect(resolveScale([5], fmt({ scale: 'B' }))).toBe('B');
  });

  it('picks a scale from the largest magnitude in the set', () => {
    expect(resolveScale([900, 1_100], fmt({ scale: 'auto' }))).toBe('none');
    expect(resolveScale([12_000, 400], fmt({ scale: 'auto' }))).toBe('K');
    expect(resolveScale([4.2e6], fmt({ scale: 'auto' }))).toBe('M');
    expect(resolveScale([9.9e9], fmt({ scale: 'auto' }))).toBe('B');
  });

  it('survives an empty set', () => {
    expect(resolveScale([], fmt({ scale: 'auto' }))).toBe('none');
  });
});

describe('formatNumber', () => {
  it('groups thousands by default', () => {
    expect(text(1234567)).toBe('1,234,567');
  });

  it('can turn grouping off', () => {
    expect(text(1234567, { thousands: false })).toBe('1234567');
  });

  it('applies scale suffixes', () => {
    expect(text(1_240_000, { scale: 'M', decimals: 1 })).toBe('1.2M');
    expect(text(2_500, { scale: 'K', decimals: 1 })).toBe('2.5K');
  });

  it('renders percentages as whole-number percents', () => {
    expect(text(0.427, { style: 'percent', decimals: 1 })).toBe('42.7%');
  });

  it('prefixes a currency symbol', () => {
    expect(text(1240, { style: 'currency', currency: 'USD' })).toBe('$1,240');
    expect(text(1240, { style: 'currency', currency: 'EUR' })).toBe('€1,240');
  });

  it('falls back to the code for an unknown currency', () => {
    expect(text(5, { style: 'currency', currency: 'ZZZ' })).toBe('ZZZ5');
  });

  it('supports accounting negatives', () => {
    expect(text(-1234, { negative: 'parens' })).toBe('(1,234)');
    expect(text(-1234, { negative: 'minus' })).toBe('-1,234');
  });

  it('reports red negatives as a style hint rather than baking it into text', () => {
    const r = formatNumber(-5, fmt({ negative: 'red' }));
    expect(r.text).toBe('-5');
    expect(r.red).toBe(true);
    expect(formatNumber(5, fmt({ negative: 'red' })).red).toBe(false);
  });

  it('applies prefix and suffix', () => {
    expect(text(12, { prefix: '~', suffix: ' pts' })).toBe('~12 pts');
  });

  it('renders non-finite values as an em dash rather than NaN', () => {
    expect(text(NaN)).toBe('—');
    expect(text(Infinity)).toBe('—');
  });
});

describe('formatSet', () => {
  it('gives every member the same decimals so the column lines up', () => {
    expect(formatSet([1.5, 2, 3], fmt()).map((f) => f.text)).toEqual(['1.5', '2.0', '3.0']);
  });

  it('gives every member the same auto scale', () => {
    expect(formatSet([900, 12_000], fmt({ scale: 'auto' })).map((f) => f.text)).toEqual([
      '0.9K',
      '12.0K',
    ]);
  });
});
