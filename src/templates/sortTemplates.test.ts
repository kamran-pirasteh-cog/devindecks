import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_SORT,
  filterTemplates,
  nextTemplateSort,
  sortTemplates,
  type SortableTemplate,
} from './sortTemplates';

type T = SortableTemplate & { id: string; description?: string };

const tpl = (id: string, over: Partial<T> = {}): T => ({
  id,
  name: id,
  category: 'Business Review',
  slides: [{}],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('sortTemplates', () => {
  it('opens in authored shelf order, with Admin’s own templates after it', () => {
    const list = [
      tpl('mine'),
      tpl('second', { order: 1 }),
      tpl('first', { order: 0 }),
    ];
    expect(sortTemplates(list, DEFAULT_TEMPLATE_SORT).map((t) => t.id)).toEqual([
      'first',
      'second',
      'mine',
    ]);
  });

  it('breaks ties by name so equal rows keep a stable position', () => {
    const list = [tpl('b'), tpl('c'), tpl('a')];
    expect(sortTemplates(list, { by: 'updated', dir: 'desc' }).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('reverses the templates rather than re-ranking them', () => {
    const list = [
      tpl('old', { updatedAt: '2026-01-01T00:00:00.000Z' }),
      tpl('new', { updatedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(sortTemplates(list, { by: 'updated', dir: 'desc' }).map((t) => t.id)).toEqual([
      'new',
      'old',
    ]);
    expect(sortTemplates(list, { by: 'updated', dir: 'asc' }).map((t) => t.id)).toEqual([
      'old',
      'new',
    ]);
  });

  it('sorts by slide count', () => {
    const list = [tpl('one'), tpl('three', { slides: [{}, {}, {}] })];
    expect(sortTemplates(list, { by: 'slides', dir: 'desc' }).map((t) => t.id)).toEqual([
      'three',
      'one',
    ]);
  });

  it('leaves the caller’s array alone', () => {
    const list = [tpl('b', { order: 1 }), tpl('a', { order: 0 })];
    sortTemplates(list, DEFAULT_TEMPLATE_SORT);
    expect(list.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('nextTemplateSort', () => {
  it('reverses the column already in force', () => {
    expect(nextTemplateSort({ by: 'name', dir: 'asc' }, 'name')).toEqual({
      by: 'name',
      dir: 'desc',
    });
  });

  it('gives a new column its own default direction', () => {
    expect(nextTemplateSort({ by: 'name', dir: 'desc' }, 'updated')).toEqual({
      by: 'updated',
      dir: 'desc',
    });
    expect(nextTemplateSort({ by: 'updated', dir: 'asc' }, 'name')).toEqual({
      by: 'name',
      dir: 'asc',
    });
  });
});

describe('filterTemplates', () => {
  const list = [
    tpl('Fiserv Exec Readout', {
      name: 'Fiserv Exec Readout',
      description: 'Standard reference deck',
      category: 'Business Review',
    }),
    tpl('BVA Pitch', { name: 'BVA Pitch', description: 'value analysis', category: 'Value' }),
  ];

  it('matches name, description and category, case-insensitively', () => {
    expect(filterTemplates(list, { query: 'fiserv' }).map((t) => t.id)).toEqual([
      'Fiserv Exec Readout',
    ]);
    expect(filterTemplates(list, { query: 'ANALYSIS' }).map((t) => t.id)).toEqual(['BVA Pitch']);
    expect(filterTemplates(list, { query: 'business' }).map((t) => t.id)).toEqual([
      'Fiserv Exec Readout',
    ]);
  });

  it('ignores surrounding whitespace instead of emptying the shelf', () => {
    expect(filterTemplates(list, { query: '  ' })).toHaveLength(2);
    expect(filterTemplates(list, { query: ' bva ' }).map((t) => t.id)).toEqual(['BVA Pitch']);
  });

  it('narrows by category, and combines with the query', () => {
    expect(filterTemplates(list, { category: 'Value' }).map((t) => t.id)).toEqual(['BVA Pitch']);
    expect(filterTemplates(list, { category: 'Value', query: 'fiserv' })).toEqual([]);
  });
});
