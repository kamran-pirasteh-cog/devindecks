import { describe, expect, it } from 'vitest';
import { FONT_CHOICES, fontChoiceIdOf, fontChoicePatch } from './fonts';

describe('font choices', () => {
  it('offers Geist Medium alongside the families', () => {
    expect(FONT_CHOICES.map((c) => c.id)).toEqual([
      'Geist',
      'Geist Medium',
      'Geist Mono',
      'Source Serif 4',
    ]);
  });

  it('reads a Medium run back as Geist Medium', () => {
    expect(fontChoiceIdOf({ font: 'Geist', weight: 500 }, 'Geist')).toBe('Geist Medium');
    expect(fontChoiceIdOf({ font: 'Geist' }, 'Geist')).toBe('Geist');
  });

  it('ignores bold, which is its own toggle', () => {
    expect(fontChoiceIdOf({ font: 'Geist', bold: true } as never, 'Geist')).toBe('Geist');
  });

  it('falls back to the design system font for a run with none', () => {
    expect(fontChoiceIdOf(undefined, 'Source Serif 4')).toBe('Source Serif 4');
  });

  it('patches family and weight together, so picking Geist clears Medium', () => {
    expect(fontChoicePatch('Geist Medium')).toEqual({ font: 'Geist', weight: 500 });
    expect(fontChoicePatch('Geist')).toEqual({ font: 'Geist', weight: 400 });
    expect(fontChoicePatch('Geist Mono')).toEqual({ font: 'Geist Mono', weight: 400 });
  });
});
