import { describe, expect, it } from 'vitest';
import { isSoleGroup } from './group';
import type { SlideElement } from './types';

const el = (id: string, groupIds?: string[]) =>
  ({ id, type: 'shape', rect: { x: 0, y: 0, w: 10, h: 10 }, groupIds }) as unknown as SlideElement;

describe('isSoleGroup', () => {
  const els = [el('a', ['g1']), el('b', ['g1']), el('c', ['g2']), el('d', ['g2']), el('loose')];

  it('is true for a whole group', () => {
    expect(isSoleGroup(els, ['a', 'b'])).toBe(true);
    expect(isSoleGroup(els, ['b', 'a'])).toBe(true);
  });

  it('is false for two groups selected together', () => {
    expect(isSoleGroup(els, ['a', 'b', 'c', 'd'])).toBe(false);
  });

  it('is false for a group plus a loose element', () => {
    expect(isSoleGroup(els, ['a', 'b', 'loose'])).toBe(false);
  });

  it('is false for a partly selected group', () => {
    const three = [...els, el('e', ['g1'])];
    expect(isSoleGroup(three, ['a', 'b'])).toBe(false);
  });

  it('is false for loose elements and single selections', () => {
    expect(isSoleGroup(els, ['loose'])).toBe(false);
    expect(isSoleGroup(els, ['a'])).toBe(false);
    expect(isSoleGroup(els, [])).toBe(false);
  });

  it('reads the outermost group, so a nested group inside a selected parent counts as one box', () => {
    const nested = [el('a', ['outer', 'inner']), el('b', ['outer', 'inner']), el('c', ['outer'])];
    expect(isSoleGroup(nested, ['a', 'b', 'c'])).toBe(true);
    expect(isSoleGroup(nested, ['a', 'b'])).toBe(false);
  });
});
