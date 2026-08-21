import { describe, expect, it } from 'vitest';
import { elementIdFor, type ChartRef } from '@/model';
import {
  clickSelectParts,
  shiftClickParts,
  toggleClickParts,
  type PartEl,
} from './partSelect';

const C = 'chart-1';
const mark = (series: string, point: string): ChartRef =>
  ({ chartId: C, part: 'mark', series, point });
const label = (series: string, point: string): ChartRef =>
  ({ chartId: C, part: 'label', series, point });
const tick = (axis: 'x' | 'y', i: number): ChartRef =>
  ({ chartId: C, part: 'axis', axis, sub: 'tick', i });
const legend = (series: string): ChartRef => ({ chartId: C, part: 'legend.item', series });

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
  // One label in the OTHER series, so "all of them" and "this series" differ.
  d: id(label('s1', 'c0')),
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

  it('takes both series whole when the ends are in different ones', () => {
    // Not the two bars clicked, and not a category-order run between them:
    // reaching across series means the series.
    expect(shift(bars['s1.c1'], [bars['s0.c1']])).toEqual([
      bars['s0.c0'],
      bars['s1.c0'],
      bars['s0.c1'],
      bars['s1.c1'],
      bars['s0.c2'],
      bars['s1.c2'],
      bars['s0.c3'],
      bars['s1.c3'],
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

describe('clickSelectParts', () => {
  const click = (id: string, clicks: number) => clickSelectParts(id, parts, clicks);

  it('takes every label of the chart on the first click', () => {
    // Category-first, so the two labels on c0 come out together.
    expect(click(labels.a, 1)).toEqual([labels.a, labels.d, labels.b, labels.c]);
  });

  it('narrows to the series on the second, and to the one part on the third', () => {
    expect(click(labels.a, 2)).toEqual([labels.a, labels.b, labels.c]);
    expect(click(labels.a, 3)).toEqual([labels.a]);
    // …and a press past the last level stays on it.
    expect(click(labels.a, 7)).toEqual([labels.a]);
  });

  it('takes the ticks of the axis clicked, not the other axis', () => {
    expect(click(ticks[0], 1)).toEqual([ticks[0], ticks[1], ticks[2]]);
    expect(click(ticks[3], 1)).toEqual([ticks[3]]);
    expect(click(ticks[0], 2)).toEqual([ticks[0]]);
  });

  it('reaches one legend ENTRY in two clicks — swatch and name together', () => {
    // The compiler emits the name as its own part, keyed `<series>.label`.
    const keys = [
      id(legend('s0')),
      id(legend('s0.label')),
      id(legend('s1')),
      id(legend('s1.label')),
    ];
    expect(click(keys[3], 1)).toEqual(keys);
    expect(click(keys[3], 2)).toEqual([keys[2], keys[3]]);
    // A key IS its series, so there is nothing narrower than the entry.
    expect(click(keys[3], 3)).toEqual([keys[2], keys[3]]);
  });

  it('stays on the entry once the user is INSIDE the legend', () => {
    const keys = [
      id(legend('s0')),
      id(legend('s0.label')),
      id(legend('s1')),
      id(legend('s1.label')),
    ];
    // Drilled in: a plain click takes the entry clicked rather than stepping
    // back out to the whole legend.
    expect(clickSelectParts(keys[1], parts, 1, true)).toEqual([keys[0], keys[1]]);
    // And nothing else about it changes — a tick is not a legend.
    expect(clickSelectParts(ticks[0], parts, 1, true)).toEqual([
      ticks[0],
      ticks[1],
      ticks[2],
    ]);
  });

  it('leaves a mark alone — a bar is one object', () => {
    expect(click(bars['s0.c0'], 1)).toBeNull();
  });
});
