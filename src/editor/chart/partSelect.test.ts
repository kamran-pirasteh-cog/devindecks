import { describe, expect, it } from 'vitest';
import { elementIdFor, type ChartRef } from '@/model';
import { shiftClickParts, toggleClickParts, type PartEl } from './partSelect';

const C = 'chart-1';
const mark = (series: string, point: string): ChartRef =>
  ({ chartId: C, part: 'mark', series, point });
const label = (series: string, point: string): ChartRef =>
  ({ chartId: C, part: 'label', series, point });
const tick = (axis: 'x' | 'y', i: number): ChartRef =>
  ({ chartId: C, part: 'axis', axis, sub: 'tick', i });

/**
 * The chart's elements in PAINTED order — series-major, the way the compiler
 * emits them — so the tests exercise the reordering rather than assuming it.
 */
const parts: PartEl[] = [];
const id = (ref: ChartRef) => {
  const elId = elementIdFor(ref);
  if (!parts.some((p) => p.id === elId)) parts.push({ id: elId, chartRef: ref });
  return elId;
};

const shift = (clicked: string, selected: string[], anchor: string | null = selected[0] ?? null) =>
  shiftClickParts(clicked, selected, anchor, parts);
const toggle = (clicked: string, selected: string[]) => toggleClickParts(clicked, selected, parts);

// Two series over four categories, emitted series-major.
const bars: Record<string, string> = {};
for (const s of ['s0', 's1']) {
  for (const c of ['c0', 'c1', 'c2', 'c3']) bars[`${s}.${c}`] = id(mark(s, c));
}
const labels = {
  a: id(label('s0', 'c0')),
  b: id(label('s0', 'c1')),
  c: id(label('s0', 'c2')),
};
const ticks = [id(tick('y', 0)), id(tick('y', 1)), id(tick('y', 2)), id(tick('x', 0))];

describe('shiftClickParts', () => {
  it('takes the range between the anchor and the part clicked', () => {
    expect(shift(labels.c, [labels.a])).toEqual([labels.a, labels.b, labels.c]);
  });

  it('runs along one series when both ends are in it', () => {
    expect(shift(bars['s0.c2'], [bars['s0.c0']])).toEqual([
      bars['s0.c0'],
      bars['s0.c1'],
      bars['s0.c2'],
    ]);
  });

  it('reads category-first when the ends are in different series', () => {
    // Painted order is s0.c0, s0.c1, … s1.c0 — the range must not sweep the
    // whole of s0 to reach s1's second bar.
    expect(shift(bars['s1.c1'], [bars['s0.c1']])).toEqual([
      bars['s0.c1'],
      bars['s1.c1'],
    ]);
    expect(shift(bars['s1.c0'], [bars['s0.c0']])).toEqual([
      bars['s0.c0'],
      bars['s1.c0'],
    ]);
  });

  it('is symmetric — clicking backwards gives the same run', () => {
    expect(shift(bars['s0.c0'], [bars['s0.c3']])).toEqual([
      bars['s0.c0'],
      bars['s0.c1'],
      bars['s0.c2'],
      bars['s0.c3'],
    ]);
  });

  it('re-measures from the anchor, so a second shift-click can shrink it', () => {
    const first = shift(labels.c, [labels.a]);
    expect(shift(labels.b, first, labels.a)).toEqual([labels.a, labels.b]);
  });

  it('falls back to the last part selected when the anchor has gone stale', () => {
    expect(shift(ticks[2], [ticks[0], ticks[1]], 'chart-1::mark.s0.c0')).toEqual([
      ticks[1],
      ticks[2],
    ]);
  });

  it('starts over when the kinds have nothing in common', () => {
    expect(shift(labels.a, [bars['s0.c0']])).toEqual([labels.a]);
    expect(shift(ticks[3], [ticks[0], ticks[1]])).toEqual([ticks[3]]);
  });

  it('keeps a single part rather than emptying the selection', () => {
    expect(shift(labels.a, [labels.a])).toEqual([labels.a]);
  });
});

describe('toggleClickParts', () => {
  it('gathers parts of the same kind, in click order', () => {
    expect(toggle(bars['s0.c3'], [bars['s0.c0']])).toEqual([bars['s0.c0'], bars['s0.c3']]);
  });

  it('drops a part that is already in the selection', () => {
    expect(toggle(labels.a, [labels.a, labels.b])).toEqual([labels.b]);
  });

  it('keeps the last part rather than emptying the selection', () => {
    expect(toggle(labels.a, [labels.a])).toEqual([labels.a]);
  });

  it('starts over when the kinds have nothing in common', () => {
    expect(toggle(labels.a, [bars['s0.c0']])).toEqual([labels.a]);
  });
});
