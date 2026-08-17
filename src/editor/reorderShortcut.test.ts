import { describe, expect, it } from 'vitest';
import { reorderDirection } from './reorderShortcut';

const ev = (over: Partial<Parameters<typeof reorderDirection>[0]>) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  key: '',
  ...over,
});

describe('reorderDirection', () => {
  it('steps one position on ⌘[ and ⌘]', () => {
    expect(reorderDirection(ev({ metaKey: true, key: '[', code: 'BracketLeft' }))).toBe('backward');
    expect(reorderDirection(ev({ metaKey: true, key: ']', code: 'BracketRight' }))).toBe('forward');
  });

  it('goes all the way with ⇧, including the rewritten characters', () => {
    expect(
      reorderDirection(ev({ metaKey: true, shiftKey: true, key: '{', code: 'BracketLeft' })),
    ).toBe('back');
    expect(
      reorderDirection(ev({ metaKey: true, shiftKey: true, key: '}', code: 'BracketRight' })),
    ).toBe('front');
  });

  it('reads the bracket from `key` when the layout puts it on another code', () => {
    expect(reorderDirection(ev({ metaKey: true, key: ']', code: 'Digit9' }))).toBe('forward');
  });

  it('ignores the brackets without the modifier, and with ⌥ on top', () => {
    expect(reorderDirection(ev({ key: '[', code: 'BracketLeft' }))).toBeNull();
    expect(reorderDirection(ev({ metaKey: true, altKey: true, code: 'BracketLeft', key: '[' }))).toBeNull();
  });

  it('ignores other keys held with the modifier', () => {
    expect(reorderDirection(ev({ metaKey: true, key: 'g', code: 'KeyG' }))).toBeNull();
  });
});
