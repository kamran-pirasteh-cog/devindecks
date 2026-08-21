/**
 * Filtering for the keyboard shortcut sheet's search box.
 *
 * The sheet is long enough that scanning it beats reading it, so the search has
 * to match the way people describe a shortcut rather than the way it's printed:
 * "cmd b" and "⌘B" are the same query, and so are "option" and "⌥". Every term
 * typed has to match somewhere in a row (label, note, or keys) for it to stay.
 */

/** How keys are spelled out loud, keyed by the glyph the sheet prints. */
const KEY_ALIASES: Record<string, string> = {
  '⌘': 'cmd command meta',
  '⇧': 'shift',
  '⌥': 'opt option alt',
  '⌃': 'ctrl control',
  Ctrl: 'ctrl control',
  '↵': 'enter return',
  '↑': 'up arrow',
  '↓': 'down arrow',
  '←': 'left arrow',
  '→': 'right arrow',
  '⌫': 'backspace delete',
  Delete: 'delete backspace del',
  Esc: 'esc escape',
  Tab: 'tab',
  Space: 'space spacebar',
  '+': 'plus',
  '−': 'minus',
  '>': 'greater than',
  '<': 'less than',
};

export interface SearchableShortcut {
  keys: string[];
  label: string;
  note?: string;
}

export interface SearchableGroup<T extends SearchableShortcut = SearchableShortcut> {
  title: string;
  items: T[];
}

/** Everything a query can match on, lower-cased and space-separated. */
const haystack = (group: string, s: SearchableShortcut): string =>
  [
    group,
    s.label,
    s.note ?? '',
    ...s.keys.flatMap((k) => [k, KEY_ALIASES[k] ?? '']),
  ]
    .join(' ')
    .toLowerCase();

/** Terms are whitespace-separated; punctuation stays, since ⌘+ and ⌘− differ. */
const terms = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

export function matchesShortcut(group: string, s: SearchableShortcut, query: string): boolean {
  const parts = terms(query);
  if (!parts.length) return true;
  const hay = haystack(group, s);
  return parts.every((t) => hay.includes(t));
}

/**
 * The groups narrowed to the rows that match, with emptied groups dropped so
 * the two-column layout doesn't leave headings stranded over nothing.
 */
export function filterShortcutGroups<T extends SearchableShortcut>(
  groups: SearchableGroup<T>[],
  query: string,
): SearchableGroup<T>[] {
  if (!terms(query).length) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((s) => matchesShortcut(g.title, s, query)) }))
    .filter((g) => g.items.length > 0);
}
