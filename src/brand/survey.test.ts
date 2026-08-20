import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM } from '@/model/tokens';
import { inchesToEmu } from '@/model';
import {
  bandOf,
  looksLikePageNumber,
  normalizeHex,
  surveyDeck,
  totalUsage,
  approxChroma,
} from './survey';
import { at, picture, resetIds, SIZE, shape, slide, sourceDeck, text } from './testkit';

const ds = DEFAULT_DESIGN_SYSTEM;
const survey = (slides: Parameters<typeof surveyDeck>[0]) => surveyDeck(slides, SIZE, ds);

describe('bandOf', () => {
  it('puts a title-band element in the title band', () => {
    expect(bandOf(at(0.9, 0.5, 11, 0.7), SIZE)).toBe('title');
  });

  it('puts a bottom-strip element in the footer', () => {
    expect(bandOf(at(0.9, 6.9, 4, 0.25), SIZE)).toBe('footer');
  });

  it('puts mid-slide content in the content band', () => {
    expect(bandOf(at(0.9, 3, 5, 2), SIZE)).toBe('content');
  });

  it('calls a full-bleed backdrop bleed, not content', () => {
    expect(bandOf({ x: 0, y: 0, w: SIZE.w, h: SIZE.h }, SIZE)).toBe('bleed');
  });

  it('does not call a wide thin rule bleed — it has no height', () => {
    expect(bandOf({ x: 0, y: inchesToEmu(3), w: SIZE.w, h: inchesToEmu(0.02) }, SIZE)).not.toBe(
      'bleed',
    );
  });
});

describe('looksLikePageNumber', () => {
  it('accepts a bare number matching the slide position', () => {
    expect(looksLikePageNumber('5', 4, 20)).toBe(true);
  });

  it('accepts n / total and Page n', () => {
    expect(looksLikePageNumber('5 / 20', 4, 20)).toBe(true);
    expect(looksLikePageNumber('Page 5', 4, 20)).toBe(true);
    expect(looksLikePageNumber('5 of 20', 4, 20)).toBe(true);
  });

  it('accepts a stated total that matches even when the index does not', () => {
    // A deck numbered from a cover offset still states the real total.
    expect(looksLikePageNumber('7 / 20', 2, 20)).toBe(true);
  });

  it('REFUSES a number that does not match the position — that is content', () => {
    // "42" low on slide 3 is a statistic. Stripping it would delete content.
    expect(looksLikePageNumber('42', 2, 20)).toBe(false);
  });

  it('refuses anything that is not just a number', () => {
    expect(looksLikePageNumber('$4.2M', 4, 20)).toBe(false);
    expect(looksLikePageNumber('Q3 2025', 4, 20)).toBe(false);
    expect(looksLikePageNumber('', 4, 20)).toBe(false);
  });
});

describe('surveyDeck — sizes', () => {
  it('ranks sizes by ink, so body copy outranks a stray label', () => {
    const slides = [
      slide([
        text('a very long paragraph of body copy repeated many times over', at(1, 2, 5, 2), {
          sizePt: 12,
        }),
        text('x', at(1, 5, 1, 0.3), { sizePt: 40 }),
      ]),
    ];
    expect(survey(slides).sizes[0].sizePt).toBe(12);
  });

  it('records which band each size appears in', () => {
    const s = survey(sourceDeck(6));
    const heading = s.sizes.find((z) => z.sizePt === 28);
    expect(heading?.bands.title).toBeGreaterThan(0);
  });

  it('counts distinct slides, not occurrences', () => {
    const s = survey(sourceDeck(6));
    // The 9pt footer/page-number size appears on all five content slides.
    expect(s.sizes.find((z) => z.sizePt === 9)?.slides).toBe(5);
  });

  it('tracks bold and caps share', () => {
    const slides = [
      slide([
        text('one', at(1, 2, 3, 0.4), { sizePt: 20, bold: true }),
        text('two', at(1, 3, 3, 0.4), { sizePt: 20 }),
      ]),
    ];
    expect(survey(slides).sizes.find((z) => z.sizePt === 20)?.boldShare).toBeCloseTo(0.5);
  });

  it('ignores whitespace-only runs', () => {
    const slides = [slide([text('   ', at(1, 2, 3, 0.4), { sizePt: 77 })])];
    expect(survey(slides).sizes.find((z) => z.sizePt === 77)).toBeUndefined();
  });

  it('excludes chart primitives — a chart must not outvote the body copy', () => {
    const tick = text('0', at(1, 2, 0.3, 0.2), { sizePt: 8 });
    const withChart = slide([
      text('real body copy on this slide', at(1, 3, 5, 1), { sizePt: 12 }),
      // Twenty tick labels, as a real compiled chart would have.
      ...Array.from({ length: 20 }, (_, i) => ({
        ...tick,
        id: `tick${i}`,
        chartRef: { chartId: 'c1', part: 'tick' } as never,
      })),
    ]);
    const s = survey([withChart]);
    expect(s.sizes.find((z) => z.sizePt === 8)).toBeUndefined();
    expect(s.sizes[0].sizePt).toBe(12);
  });
});

describe('surveyDeck — colours', () => {
  it('collects text, fill, outline and background separately', () => {
    const slides = [
      slide(
        [
          text('ink', at(1, 2, 3, 0.4), { color: '#111111' }),
          shape(at(1, 3, 3, 1), { fill: '#EEEEEE', outlineColor: '#CCCCCC' }),
        ],
        '#FFFFFF',
      ),
    ];
    const s = survey(slides);
    expect(s.colors.find((c) => c.hex === '#111111')?.usage.text).toBeGreaterThan(0);
    expect(s.colors.find((c) => c.hex === '#EEEEEE')?.usage.fill).toBeGreaterThan(0);
    expect(s.colors.find((c) => c.hex === '#CCCCCC')?.usage.outline).toBeGreaterThan(0);
    expect(s.colors.find((c) => c.hex === '#FFFFFF')?.usage.background).toBeGreaterThan(0);
  });

  it('records luminance and chroma so ink can be told from an accent', () => {
    const slides = [
      slide([
        text('dark', at(1, 2, 3, 0.4), { color: '#111111' }),
        text('red', at(1, 3, 3, 0.4), { color: '#FF0000' }),
      ]),
    ];
    const s = survey(slides);
    const ink = s.colors.find((c) => c.hex === '#111111')!;
    const accent = s.colors.find((c) => c.hex === '#FF0000')!;
    expect(ink.chroma).toBeLessThan(0.1);
    expect(accent.chroma).toBeGreaterThan(0.9);
    expect(ink.luminance).toBeLessThan(accent.luminance);
  });

  it('sorts by total usage weight', () => {
    const s = survey(sourceDeck(6));
    for (let i = 1; i < s.colors.length; i += 1) {
      expect(totalUsage(s.colors[i - 1])).toBeGreaterThanOrEqual(totalUsage(s.colors[i]));
    }
  });
});

describe('surveyDeck — source chrome', () => {
  it('finds a logo repeated in the footer of every content slide', () => {
    const s = survey(sourceDeck(6));
    const logo = s.chrome.find((c) => c.key.startsWith('picture:'));
    expect(logo).toBeDefined();
    expect(logo!.slides.length).toBe(5);
    expect(s.chromeElementIds.size).toBeGreaterThan(0);
  });

  it('finds a repeated footer line', () => {
    const s = survey(sourceDeck(6));
    expect(s.chrome.some((c) => c.key.includes('confidential'))).toBe(true);
  });

  it('finds the page numbers even though their text differs every slide', () => {
    const s = survey(sourceDeck(6));
    expect(s.pageNumberElementIds.length).toBe(5);
  });

  it('does NOT treat mid-slide content as chrome, however often it repeats', () => {
    // The same sentence in the content area of every slide is a design choice,
    // not furniture — and deleting it would delete content.
    const slides = Array.from({ length: 6 }, () =>
      slide([text('Our strategic priority', at(1, 3, 5, 0.5), { sizePt: 14 })]),
    );
    expect(survey(slides).chrome).toHaveLength(0);
  });

  it('does not call something chrome in a deck too short for repeats to mean anything', () => {
    const slides = Array.from({ length: 2 }, () =>
      slide([picture('data:LOGO', at(11.9, 6.85, 0.8, 0.3))]),
    );
    expect(survey(slides).chrome).toHaveLength(0);
  });

  it('requires a real share of slides, not just two occurrences in a long deck', () => {
    const withLogo = Array.from({ length: 2 }, () =>
      slide([picture('data:LOGO', at(11.9, 6.85, 0.8, 0.3))]),
    );
    const without = Array.from({ length: 18 }, () =>
      slide([text('content', at(1, 3, 4, 0.5))]),
    );
    expect(survey([...withLogo, ...without]).chrome).toHaveLength(0);
  });
});

describe('surveyDeck — determinism and stability', () => {
  it('is deterministic', () => {
    resetIds();
    const a = survey(sourceDeck(6));
    resetIds();
    const b = survey(sourceDeck(6));
    expect({ ...a, chromeElementIds: [...a.chromeElementIds] }).toEqual({
      ...b,
      chromeElementIds: [...b.chromeElementIds],
    });
  });

  it('size and colour tables are stable under slide REORDERING', () => {
    // The whole point of a deck-wide table: the same deck shuffled must produce
    // the same mapping, or two exports of one deck would convert differently.
    const slides = sourceDeck(6);
    const forward = survey(slides);
    const reversed = survey([...slides].reverse());
    expect(reversed.sizes).toEqual(forward.sizes);
    expect(reversed.colors).toEqual(forward.colors);
  });

  it('collects the source fonts for the report', () => {
    expect(survey(sourceDeck(3)).sourceFonts).toContain('Geist');
  });
});

describe('helpers', () => {
  it('normalizeHex expands shorthand, uppercases, and drops alpha', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('ff0000')).toBe('#FF0000');
    expect(normalizeHex('#FF000080')).toBe('#FF0000');
    expect(normalizeHex('nonsense')).toBeNull();
  });

  it('approxChroma reads greys as unsaturated and primaries as saturated', () => {
    expect(approxChroma('#808080')).toBe(0);
    expect(approxChroma('#0000FF')).toBe(1);
  });
});
