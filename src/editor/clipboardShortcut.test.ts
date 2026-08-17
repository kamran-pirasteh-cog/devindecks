import { describe, expect, it } from 'vitest';
import { clipboardAction } from './clipboardShortcut';

const ev = (over: Partial<Parameters<typeof clipboardAction>[0]>) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  key: '',
  ...over,
});

describe('clipboardAction', () => {
  it('reads ⌘X, ⌘C and ⌘V', () => {
    expect(clipboardAction(ev({ metaKey: true, key: 'x', code: 'KeyX' }))).toBe('cut');
    expect(clipboardAction(ev({ metaKey: true, key: 'c', code: 'KeyC' }))).toBe('copy');
    expect(clipboardAction(ev({ metaKey: true, key: 'v', code: 'KeyV' }))).toBe('paste');
  });

  it('takes Ctrl for the same three', () => {
    expect(clipboardAction(ev({ ctrlKey: true, key: 'x', code: 'KeyX' }))).toBe('cut');
  });

  it('falls back to the character when `code` is empty', () => {
    expect(clipboardAction(ev({ metaKey: true, key: 'X' }))).toBe('cut');
  });

  it('leaves the format painter its chords', () => {
    // ⌘⌥C / ⌘⌥V and Ctrl+Shift+C / Ctrl+Shift+V belong to `formatShortcut`.
    expect(clipboardAction(ev({ metaKey: true, altKey: true, key: 'ç', code: 'KeyC' }))).toBeNull();
    expect(
      clipboardAction(ev({ ctrlKey: true, shiftKey: true, key: 'v', code: 'KeyV' })),
    ).toBeNull();
  });

  it('ignores the keys without a modifier, and other keys with one', () => {
    expect(clipboardAction(ev({ key: 'x', code: 'KeyX' }))).toBeNull();
    expect(clipboardAction(ev({ metaKey: true, key: 'd', code: 'KeyD' }))).toBeNull();
  });
});
