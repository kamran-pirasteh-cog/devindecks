import { describe, expect, it } from 'vitest';
import { filterShortcutGroups, matchesShortcut } from './shortcutSearch';

const groups = [
  {
    title: 'General',
    items: [
      { keys: ['⌘', 'Z'], label: 'Undo' },
      { keys: ['⌘', 'Y'], label: 'Redo', note: 'or ⌘⇧Z' },
      { keys: ['Esc'], label: 'Clear selection', note: 'exits text editing first' },
    ],
  },
  {
    title: 'Text',
    items: [
      { keys: ['⌘', 'B'], label: 'Bold', note: 'text boxes and chart data labels' },
      { keys: ['⌘', '⌥', 'Ctrl', '←'], label: 'Align the text left' },
    ],
  },
];

describe('matchesShortcut', () => {
  const bold = groups[1].items[0];

  it('keeps everything for a blank query', () => {
    expect(matchesShortcut('Text', bold, '')).toBe(true);
    expect(matchesShortcut('Text', bold, '   ')).toBe(true);
  });

  it('matches the label, whatever the case', () => {
    expect(matchesShortcut('Text', bold, 'BOLD')).toBe(true);
  });

  it('matches the note', () => {
    expect(matchesShortcut('Text', bold, 'data labels')).toBe(true);
  });

  it('matches the group title, so a whole section can be pulled up', () => {
    expect(matchesShortcut('Text', bold, 'text')).toBe(true);
    expect(matchesShortcut('General', groups[0].items[0], 'text')).toBe(false);
  });

  it('matches the printed glyphs', () => {
    expect(matchesShortcut('Text', bold, '⌘b')).toBe(false);
    expect(matchesShortcut('Text', bold, '⌘ b')).toBe(true);
  });

  it('matches keys by the names people say out loud', () => {
    expect(matchesShortcut('Text', bold, 'cmd b')).toBe(true);
    expect(matchesShortcut('Text', bold, 'command')).toBe(true);
    expect(matchesShortcut('Text', groups[1].items[1], 'option')).toBe(true);
    expect(matchesShortcut('Text', groups[1].items[1], 'alt left')).toBe(true);
    expect(matchesShortcut('General', groups[0].items[2], 'escape')).toBe(true);
  });

  it('requires every term to land somewhere', () => {
    expect(matchesShortcut('Text', bold, 'bold italic')).toBe(false);
  });
});

describe('filterShortcutGroups', () => {
  it('returns the groups untouched for a blank query', () => {
    expect(filterShortcutGroups(groups, '')).toBe(groups);
  });

  it('drops the rows that do not match', () => {
    expect(filterShortcutGroups(groups, 'undo')).toEqual([
      { title: 'General', items: [{ keys: ['⌘', 'Z'], label: 'Undo' }] },
    ]);
  });

  it('drops groups that end up empty rather than leaving a stranded heading', () => {
    const kept = filterShortcutGroups(groups, 'align');
    expect(kept.map((g) => g.title)).toEqual(['Text']);
    expect(kept[0].items).toHaveLength(1);
  });

  it('comes back empty when nothing matches', () => {
    expect(filterShortcutGroups(groups, 'zzzz')).toEqual([]);
  });
});
