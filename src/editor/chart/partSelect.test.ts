import { describe, expect, it } from 'vitest';
import { elementIdFor, partKind, type ChartRef } from '@/model';
import { shiftClickParts } from './partSelect';

const C = 'chart-1';
const mark = (series: string, point: string): ChartRef =>
  ({ chartId: C, part: 'mark', series, point });
const label = (series: string, point: string): ChartRef =>
  ({ chartId: C, part: 'label', series, point });
const tick = (axis: 'x' | 'y', i: number): ChartRef =>
  ({ chartId: C, part: 'axis', axis, sub: 'tick', i });

const refs = new Map<string, ChartRef>();
const id = (ref: ChartRef) => {
  const key = elementIdFor(ref);
  refs.set(key, ref);
  return key;
};
const kindOf = (elId: string) => {
  const ref = refs.get(elId);
  return ref ? partKind(ref) : null;
};
const click = (clicked: string, selected: string[]) =>
  shiftClickParts(clicked, selected, kindOf);

describe('shiftClickParts', () => {
  it('gathers parts of the same kind', () => {
    const a = id(mark('s0', 'c0'));
    const b = id(mark('s0', 'c1'));
    const c = id(mark('s1', 'c2'));
    expect(click(b, [a])).toEqual([a, b]);
    expect(click(c, [a, b])).toEqual([a, b, c]);
  });

  it('drops a part that is already in the selection', () => {
    const a = id(label('s0', 'c0'));
    const b = id(label('s0', 'c1'));
    expect(click(a, [a, b])).toEqual([b]);
  });

  it('keeps the last part rather than emptying the selection', () => {
    const a = id(label('s0', 'c0'));
    expect(click(a, [a])).toEqual([a]);
  });

  it('starts over when the kinds have nothing in common', () => {
    const bar = id(mark('s0', 'c0'));
    const number = id(label('s0', 'c0'));
    expect(click(number, [bar])).toEqual([number]);
  });

  it('treats the two axes as different populations', () => {
    const y0 = id(tick('y', 0));
    const y1 = id(tick('y', 1));
    const x0 = id(tick('x', 0));
    expect(click(y1, [y0])).toEqual([y0, y1]);
    expect(click(x0, [y0, y1])).toEqual([x0]);
  });
});
