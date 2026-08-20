import { describe, expect, it } from 'vitest';
import { slideMoveTarget } from './slideMove';

const deck = ['a', 'b', 'c', 'd', 'e'];

/** Apply the target the way `moveSlides` does, so the tests read as orders. */
function apply(order: string[], ids: string[], beforeId: string | null) {
  const sel = new Set(ids);
  const moved = order.filter((id) => sel.has(id));
  const rest = order.filter((id) => !sel.has(id));
  const at = beforeId ? rest.indexOf(beforeId) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, ...moved);
  return rest;
}

describe('slideMoveTarget', () => {
  it('steps a single slide one position each way', () => {
    expect(apply(deck, ['c'], slideMoveTarget(deck, ['c'], 'up')!)).toEqual([
      'a',
      'c',
      'b',
      'd',
      'e',
    ]);
    expect(apply(deck, ['c'], slideMoveTarget(deck, ['c'], 'down')!)).toEqual([
      'a',
      'b',
      'd',
      'c',
      'e',
    ]);
  });

  it('moves a contiguous block as one', () => {
    expect(apply(deck, ['b', 'c'], slideMoveTarget(deck, ['b', 'c'], 'down')!)).toEqual([
      'a',
      'd',
      'b',
      'c',
      'e',
    ]);
  });

  it('gathers a gapped selection at the destination', () => {
    expect(apply(deck, ['b', 'd'], slideMoveTarget(deck, ['b', 'd'], 'up')!)).toEqual([
      'b',
      'd',
      'a',
      'c',
      'e',
    ]);
  });

  it('sends the block to either end with ⇧', () => {
    expect(apply(deck, ['d'], slideMoveTarget(deck, ['d'], 'up', true)!)).toEqual([
      'd',
      'a',
      'b',
      'c',
      'e',
    ]);
    expect(apply(deck, ['b'], slideMoveTarget(deck, ['b'], 'down', true)!)).toEqual([
      'a',
      'c',
      'd',
      'e',
      'b',
    ]);
  });

  it('is a no-op against the edge it already sits on', () => {
    expect(slideMoveTarget(deck, ['a'], 'up')).toBeUndefined();
    expect(slideMoveTarget(deck, ['e'], 'down')).toBeUndefined();
    expect(slideMoveTarget(deck, ['a', 'b'], 'up', true)).toBeUndefined();
    expect(slideMoveTarget(deck, ['d', 'e'], 'down', true)).toBeUndefined();
  });

  it('is a no-op with nothing selected, or with the whole deck selected', () => {
    expect(slideMoveTarget(deck, [], 'down')).toBeUndefined();
    expect(slideMoveTarget(deck, deck, 'up')).toBeUndefined();
  });
});
