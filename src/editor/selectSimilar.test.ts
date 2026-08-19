import { describe, expect, it } from 'vitest';
import { selectSimilarLabel, similarIds, similarityKey } from './selectSimilar';
import type { SlideElement } from '@/model';

const el = (id: string, type: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    ...extra,
  }) as unknown as SlideElement;

const rect = (id: string, extra?: Record<string, unknown>) =>
  el(id, 'shape', { preset: 'rect', ...extra });
const pill = (id: string) => el(id, 'shape', { preset: 'pill' });
const text = (id: string, extra?: Record<string, unknown>) => el(id, 'text', extra);

describe('similarityKey', () => {
  it('splits shapes by preset but leaves other types whole', () => {
    expect(similarityKey(rect('a'))).toBe('shape:rect');
    expect(similarityKey(pill('b'))).toBe('shape:pill');
    expect(similarityKey(text('c'))).toBe('text');
  });
});

describe('similarIds', () => {
  const els = [rect('r1'), rect('r2'), pill('p1'), text('t1'), text('t2'), el('l1', 'line')];

  it('gathers every element of the selected kind, itself included', () => {
    expect(similarIds(els, ['r1'])).toEqual(['r1', 'r2']);
    expect(similarIds(els, ['t2'])).toEqual(['t1', 't2']);
    expect(similarIds(els, ['l1'])).toEqual(['l1']);
  });

  it('does not treat a different preset as the same kind of shape', () => {
    expect(similarIds(els, ['p1'])).toEqual(['p1']);
  });

  it('unions the kinds of a mixed selection', () => {
    expect(similarIds(els, ['r1', 't1'])).toEqual(['r1', 'r2', 't1', 't2']);
  });

  it('returns slide order regardless of selection order', () => {
    expect(similarIds(els, ['t2', 'r2'])).toEqual(['r1', 'r2', 't1', 't2']);
  });

  it('leaves chart parts and grouped elements out on both sides', () => {
    const mixed = [
      rect('loose'),
      rect('bar', { chartRef: { chartId: 'c1', node: 'series' } }),
      rect('member', { groupIds: ['g1'] }),
    ];
    expect(similarIds(mixed, ['loose'])).toEqual(['loose']);
    expect(similarIds(mixed, ['bar'])).toEqual([]);
    expect(similarIds(mixed, ['member'])).toEqual([]);
  });

  it('is empty for an empty selection', () => {
    expect(similarIds(els, [])).toEqual([]);
  });
});

describe('selectSimilarLabel', () => {
  const els = [rect('r1'), rect('r2'), text('t1'), text('t2'), el('l1', 'line')];

  it('names the recognized kind', () => {
    expect(selectSimilarLabel(els, ['r1'])).toBe('Select similar shapes');
    expect(selectSimilarLabel(els, ['t1'])).toBe('Select similar text boxes');
  });

  it('stays generic for a mixed selection', () => {
    expect(selectSimilarLabel(els, ['r1', 't1'])).toBe('Select similar');
  });

  it('is absent when there is nothing new to select', () => {
    // The only line on the slide, and an already-complete set.
    expect(selectSimilarLabel(els, ['l1'])).toBeNull();
    expect(selectSimilarLabel(els, ['r1', 'r2'])).toBeNull();
    expect(selectSimilarLabel(els, [])).toBeNull();
  });

  it('is absent when the selection is a chart part or grouped', () => {
    const mixed = [rect('loose'), rect('bar', { chartRef: { chartId: 'c1', node: 'series' } })];
    expect(selectSimilarLabel(mixed, ['bar'])).toBeNull();
  });

  it('offers the command when only part of the family is selected', () => {
    const many = [rect('r1'), rect('r2'), rect('r3')];
    expect(selectSimilarLabel(many, ['r1', 'r2'])).toBe('Select similar shapes');
  });

  it('calls pictures images', () => {
    const pics = [el('p1', 'picture', { src: 'a' }), el('p2', 'picture', { src: 'b' })];
    expect(selectSimilarLabel(pics, ['p1'])).toBe('Select similar images');
  });
});
