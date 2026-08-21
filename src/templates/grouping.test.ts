import { describe, expect, it } from 'vitest';
import {
  UNFILED_KEY,
  countTemplatesByFolder,
  groupTemplatesByFolder,
  templatesInFolder,
} from './grouping';

const folders = [
  { id: 'f-sales', name: 'Sales decks' },
  { id: 'f-qbr', name: 'QBR' },
  { id: 'f-empty', name: 'COE content' },
];

const t = (name: string, folderId?: string) => ({ name, folderId });

const templates = [
  t('BVA Pitch', 'f-sales'),
  t('Fiserv Readout', 'f-qbr'),
  t('Wayfair Reskin', 'f-qbr'),
  t('Scratch deck'),
  // Points at a folder that has been deleted — the case the module exists for.
  t('Orphan', 'f-gone'),
];

describe('countTemplatesByFolder', () => {
  it('counts each folder, including the empty ones', () => {
    const counts = countTemplatesByFolder(templates, folders);
    expect(counts['f-sales']).toBe(1);
    expect(counts['f-qbr']).toBe(2);
    // Present and zero, not absent: the rail puts a badge on every row.
    expect(counts['f-empty']).toBe(0);
  });

  it('counts an unset folder and a dangling one alike as unfiled', () => {
    expect(countTemplatesByFolder(templates, folders)[UNFILED_KEY]).toBe(2);
  });

  it('accounts for every template exactly once', () => {
    const counts = countTemplatesByFolder(templates, folders);
    const total = Object.values(counts).reduce((n, c) => n + c, 0);
    expect(total).toBe(templates.length);
  });

  it('reports zeroes rather than nothing for an empty shelf', () => {
    expect(countTemplatesByFolder([], folders)).toEqual({
      [UNFILED_KEY]: 0,
      'f-sales': 0,
      'f-qbr': 0,
      'f-empty': 0,
    });
  });
});

describe('templatesInFolder', () => {
  it('returns the templates filed in one folder', () => {
    expect(templatesInFolder(templates, folders, 'f-qbr').map((x) => x.name)).toEqual([
      'Fiserv Readout',
      'Wayfair Reskin',
    ]);
  });

  it('collects the unfiled and the orphaned under null', () => {
    expect(templatesInFolder(templates, folders, null).map((x) => x.name)).toEqual([
      'Scratch deck',
      'Orphan',
    ]);
  });

  it('is empty for a folder nothing is filed in', () => {
    expect(templatesInFolder(templates, folders, 'f-empty')).toEqual([]);
  });

  it('agrees with the counts, folder for folder', () => {
    const counts = countTemplatesByFolder(templates, folders);
    for (const f of folders) {
      expect(templatesInFolder(templates, folders, f.id)).toHaveLength(counts[f.id]);
    }
    expect(templatesInFolder(templates, folders, null)).toHaveLength(counts[UNFILED_KEY]);
  });
});

describe('groupTemplatesByFolder', () => {
  it('keeps the folders in their own order, not alphabetically', () => {
    const groups = groupTemplatesByFolder(templates, folders);
    expect(groups.map((g) => g.label)).toEqual(['Sales decks', 'QBR', 'Other']);
  });

  it('drops a folder with nothing in it', () => {
    const groups = groupTemplatesByFolder(templates, folders);
    expect(groups.some((g) => g.key === 'f-empty')).toBe(false);
  });

  it('puts the unfiled last, so nothing on offer goes unlisted', () => {
    const groups = groupTemplatesByFolder(templates, folders);
    const last = groups[groups.length - 1];
    expect(last.key).toBe(UNFILED_KEY);
    expect(last.items.map((x) => x.name)).toEqual(['Scratch deck', 'Orphan']);
  });

  it('lists every template exactly once across the groups', () => {
    const listed = groupTemplatesByFolder(templates, folders).flatMap((g) =>
      g.items.map((x) => x.name),
    );
    expect(listed.sort()).toEqual(templates.map((x) => x.name).sort());
  });

  it('takes a caller-chosen label for the unfiled group', () => {
    const groups = groupTemplatesByFolder([t('Loose')], folders, 'Unfiled');
    expect(groups).toEqual([{ key: UNFILED_KEY, label: 'Unfiled', items: [t('Loose')] }]);
  });

  it('has no unfiled group when everything is filed', () => {
    const groups = groupTemplatesByFolder([t('BVA Pitch', 'f-sales')], folders);
    expect(groups.map((g) => g.key)).toEqual(['f-sales']);
  });

  it('is empty when there is nothing to show', () => {
    expect(groupTemplatesByFolder([], folders)).toEqual([]);
  });
});
