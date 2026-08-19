import { describe, expect, it } from 'vitest';
import type { Deck } from '@/model';
import { SLIDE_16x9 } from '@/model';
import { DEFAULT_DOC_SORT, nextSort, sortDocs, type DocSort } from './sortDocs';

const deck = (
  title: string,
  o: { owner?: string; tags?: string[]; slides?: number; updated?: string; created?: string } = {},
): Deck => ({
  id: `d-${title}`,
  title,
  slideSize: SLIDE_16x9,
  slides: Array.from({ length: o.slides ?? 1 }, (_, i) => ({ id: `s${i}`, elements: [] })),
  designSystemId: 'ds.default',
  designSystemVersion: 1,
  createdAt: o.created ?? '2026-01-01T00:00:00.000Z',
  updatedAt: o.updated ?? '2026-01-01T00:00:00.000Z',
  owner: o.owner,
  tags: o.tags,
});

const titles = (docs: Deck[], sort: DocSort) => sortDocs(docs, sort).map((d) => d.title);

describe('sortDocs', () => {
  const docs = [
    deck('Beta', { owner: 'Ada', tags: ['Wayfair'], slides: 12, updated: '2026-03-01T00:00:00Z' }),
    deck('alpha', { owner: 'zoe', tags: ['Acme'], slides: 30, updated: '2026-02-01T00:00:00Z' }),
    deck('Gamma', { slides: 4, updated: '2026-04-01T00:00:00Z' }),
  ];

  it('orders by name, case-insensitively, both ways', () => {
    expect(titles(docs, { by: 'name', dir: 'asc' })).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(titles(docs, { by: 'name', dir: 'desc' })).toEqual(['Gamma', 'Beta', 'alpha']);
  });

  it('orders by slide count', () => {
    expect(titles(docs, { by: 'slides', dir: 'desc' })).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(titles(docs, { by: 'slides', dir: 'asc' })).toEqual(['Gamma', 'Beta', 'alpha']);
  });

  it('orders by last updated, newest first by default', () => {
    expect(titles(docs, DEFAULT_DOC_SORT)).toEqual(['Gamma', 'Beta', 'alpha']);
    expect(titles(docs, { by: 'updated', dir: 'asc' })).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('keeps documents with no owner last in EITHER direction', () => {
    // Gamma has no owner: reversing the sort reverses the ones that have one.
    expect(titles(docs, { by: 'owner', dir: 'asc' })).toEqual(['Beta', 'alpha', 'Gamma']);
    expect(titles(docs, { by: 'owner', dir: 'desc' })).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('keeps untagged documents last in either direction', () => {
    expect(titles(docs, { by: 'client', dir: 'asc' })).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(titles(docs, { by: 'client', dir: 'desc' })).toEqual(['Beta', 'alpha', 'Gamma']);
  });

  it('breaks ties by name, so the order never wobbles', () => {
    const tied = [
      deck('Zeta', { owner: 'Ada' }),
      deck('Alpha', { owner: 'Ada' }),
      deck('Mid', { owner: 'Ada' }),
    ];
    expect(titles(tied, { by: 'owner', dir: 'asc' })).toEqual(['Alpha', 'Mid', 'Zeta']);
    expect(titles(tied, { by: 'owner', dir: 'desc' })).toEqual(['Alpha', 'Mid', 'Zeta']);
  });

  it('leaves the caller′s array alone', () => {
    const before = docs.map((d) => d.title);
    sortDocs(docs, { by: 'name', dir: 'asc' });
    expect(docs.map((d) => d.title)).toEqual(before);
  });
});

describe('nextSort', () => {
  it('reverses the column already in force', () => {
    expect(nextSort({ by: 'name', dir: 'asc' }, 'name')).toEqual({ by: 'name', dir: 'desc' });
    expect(nextSort({ by: 'name', dir: 'desc' }, 'name')).toEqual({ by: 'name', dir: 'asc' });
  });

  it('gives a new column its own default direction', () => {
    // Names read A→Z; recency and size read biggest first.
    expect(nextSort({ by: 'name', dir: 'desc' }, 'owner')).toEqual({ by: 'owner', dir: 'asc' });
    expect(nextSort({ by: 'name', dir: 'asc' }, 'updated')).toEqual({ by: 'updated', dir: 'desc' });
    expect(nextSort({ by: 'name', dir: 'asc' }, 'slides')).toEqual({ by: 'slides', dir: 'desc' });
  });
});
