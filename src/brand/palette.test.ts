import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, type DesignSystem } from '@/model/tokens';
import { buildColorMap, mapColor, readable, WEAK_AFFINITY } from './palette';
import { surveyDeck } from './survey';
import { at, shape, SIZE, slide, sourceDeck, text } from './testkit';

const ds = DEFAULT_DESIGN_SYSTEM;
const survey = (slides: Parameters<typeof surveyDeck>[0]) => surveyDeck(slides, SIZE, ds);
const mapOf = (slides: Parameters<typeof surveyDeck>[0]) => buildColorMap(survey(slides), ds);

/** The token a given source hex ended up on. */
const tokenFor = (slides: Parameters<typeof surveyDeck>[0], hex: string) => {
  const ref = mapOf(slides).refs.get(hex);
  return ref?.kind === 'token' ? ref.token : undefined;
};

describe('buildColorMap — mapping by JOB, not by hue', () => {
  it('maps the source brand’s dark ink to our ink, not to our accent', () => {
    // The critical case. Source ink is navy; our accent is blue. Hue-nearest
    // matching would turn every paragraph in the deck accent-coloured.
    const slides = [
      slide(
        [
          text('a long paragraph of body copy '.repeat(20), at(1, 2, 6, 3), {
            color: '#1F3864',
          }),
        ],
        '#FFFFFF',
      ),
    ];
    expect(tokenFor(slides, '#1F3864')).toBe('ink.strong');
  });

  it('maps a sparingly-used saturated text colour to the accent', () => {
    const slides = [
      slide(
        [
          text('a long paragraph of body copy '.repeat(30), at(1, 2, 6, 3), {
            color: '#333333',
          }),
          text('KEY', at(1, 5.5, 1, 0.4), { color: '#FF6600' }),
        ],
        '#FFFFFF',
      ),
    ];
    expect(tokenFor(slides, '#FF6600')).toBe('brand.accent');
    expect(tokenFor(slides, '#333333')).toBe('ink.strong');
  });

  it('maps a mid-grey supporting text colour to ink.muted', () => {
    const slides = [slide([text('supporting line', at(1, 2, 4, 0.4), { color: '#7F7F7F' })])];
    expect(tokenFor(slides, '#7F7F7F')).toBe('ink.muted');
  });

  it('maps a light slide background to surface.base', () => {
    const slides = [slide([text('x', at(1, 2, 2, 0.4))], '#FFFFFF')];
    expect(tokenFor(slides, '#FFFFFF')).toBe('surface.base');
  });

  it('maps a NEUTRAL dark slide background to surface.base too', () => {
    // A charcoal ground says nothing about the source brand, and carrying it
    // over turns the whole deck black.
    const slides = [slide([text('x', at(1, 2, 2, 0.4), { color: '#FFFFFF' })], '#101010')];
    expect(tokenFor(slides, '#101010')).toBe('surface.base');
  });

  it('maps a pale coloured GROUND to ink.strong too', () => {
    // The full-page version of the same case: a lavender cover page came back
    // as an ordinary light-grey slide, which is the complaint that produced
    // `spread`.
    const slides = [slide([text('x', at(1, 2, 2, 0.4), { color: '#FFFFFF' })], '#EFE3F7')];
    expect(tokenFor(slides, '#EFE3F7')).toBe('ink.strong');
  });

  it('but a warm WHITE ground is still paper', () => {
    const slides = [slide([text('x', at(1, 2, 2, 0.4), { color: '#222222' })], '#FFFEF9')];
    expect(tokenFor(slides, '#FFFEF9')).toBe('surface.base');
  });

  it('maps a COLOURED full-page ground to ink.strong — a ground stays a ground', () => {
    // A colour page is the deck's punctuation. Flattened to white it becomes an
    // ordinary slide; mapped to the accent it puts our accent behind every page.
    // Ink is the only full-bleed ground our palette has.
    const slides = [slide([text('x', at(1, 2, 2, 0.4), { color: '#FFFFFF' })], '#6B2FA0')];
    expect(tokenFor(slides, '#6B2FA0')).toBe('ink.strong');
  });

  it('keeps a ground a ground even when the same colour also draws hairlines', () => {
    // The defect: deck-wide stroke weight is a hairline total and one slide's
    // ground is ten orders of magnitude bigger, so normalizing each usage
    // against its own total let a few card borders outvote a full-bleed page.
    // A deep-purple section opener was classified as a stroke colour and came
    // back as `line.default` — a pale grey slide.
    const opener = slide([text('The approach', at(1, 2, 6, 0.6), { color: '#FFFFFF' })], '#7B189F');
    const rest = [1, 2, 3, 4].map(() =>
      slide(
        [
          text('body copy '.repeat(20), at(1, 2, 6, 2)),
          shape(at(1, 4.5, 3, 1.5), { outlineColor: '#7B189F', outlineWidthPt: 1 }),
        ],
        '#FFFFFF',
      ),
    );
    expect(tokenFor([opener, ...rest], '#7B189F')).toBe('ink.strong');
  });

  it('maps a VERY pale tint card to ink.strong — the case a ratio could not see', () => {
    // #F1E8FA is violet paper: eighteen points of channel spread, and an HSV
    // saturation of 0.07 that no ratio threshold can tell from a neutral grey
    // without also blacking out actual paper. `spread` separates them, because
    // a true grey is 0 however light it is.
    const slides = [slide([shape(at(1, 2, 4, 2.5), { fill: '#F1E8FA' })], '#FFFFFF')];
    expect(tokenFor(slides, '#F1E8FA')).toBe('ink.strong');
  });

  it('leaves a genuinely neutral pale panel alone', () => {
    // The other side of the same line. A cool grey card is a grey card, and
    // blacking it out would be the mirror of the defect above.
    const slides = [slide([shape(at(1, 2, 4, 2.5), { fill: '#EEF2F7' })], '#FFFFFF')];
    expect(tokenFor(slides, '#EEF2F7')).toBe('surface.subtle');
  });

  it('maps a pale TINT card to ink.strong, not to the same grey as everything else', () => {
    // The defect this fixes: a lightness-first test read every lavender, mint
    // and blush card as "pale panel" and returned one grey. A deck that used
    // three colours to separate three kinds of content came back with three
    // identical boxes.
    const slides = [slide([shape(at(1, 2, 4, 2.5), { fill: '#E4D3F5' })], '#FFFFFF')];
    expect(tokenFor(slides, '#E4D3F5')).toBe('ink.strong');
  });

  it('…but a saturated CHIP is still an accent mark, not an ink block', () => {
    // The size of the biggest single instance is what separates them: a pill is
    // a mark, a card is a box. Blacking out every chip on the deck would be the
    // mirror of the defect above.
    const slides = [
      slide([
        shape(at(1, 2, 0.9, 0.25), { fill: '#E4D3F5' }),
        text('lots and lots of body copy '.repeat(40), at(1, 3, 6, 3), { color: '#222222' }),
      ]),
    ];
    expect(tokenFor(slides, '#E4D3F5')).toBe('brand.accent');
  });

  it('maps a pale panel fill to surface.subtle', () => {
    const slides = [slide([shape(at(1, 2, 5, 2), { fill: '#F2F2F2' })], '#FFFFFF')];
    expect(tokenFor(slides, '#F2F2F2')).toBe('surface.subtle');
  });

  it('maps a hairline stroke to line.default', () => {
    const slides = [slide([shape(at(1, 3, 8, 0.01), { outlineColor: '#D9D9D9' })])];
    expect(tokenFor(slides, '#D9D9D9')).toBe('line.default');
  });

  it('maps a saturated accent block to the accent', () => {
    const slides = [
      slide([
        shape(at(1, 2, 0.8, 0.1), { fill: '#E8112D' }),
        text('lots and lots of body copy '.repeat(40), at(1, 3, 6, 3), { color: '#222222' }),
      ]),
    ];
    expect(tokenFor(slides, '#E8112D')).toBe('brand.accent');
  });

  it('a saturated colour covering most of the deck is a GROUND, not an accent', () => {
    // Scarcity is half the definition of an accent. A deck built on full-bleed
    // navy panels has navy as its surface, and calling it the accent would put
    // our accent behind every slide.
    const slides = Array.from({ length: 4 }, () =>
      slide([shape({ x: 0, y: 0, w: SIZE.w, h: SIZE.h }, { fill: '#0A1E3C' })]),
    );
    expect(tokenFor(slides, '#0A1E3C')).not.toBe('brand.accent');
  });

  it('maps light text (sitting on a dark ground) to a light token', () => {
    const slides = [
      slide([text('reversed out', at(1, 2, 5, 0.5), { color: '#FFFFFF' })], '#101010'),
    ];
    expect(tokenFor(slides, '#FFFFFF')).toBe('surface.base');
  });
});

describe('buildColorMap — totality and safety', () => {
  it('is total: every surveyed colour gets a token', () => {
    const s = survey(sourceDeck(6));
    const map = buildColorMap(s, ds);
    for (const stat of s.colors) expect(map.refs.has(stat.hex)).toBe(true);
  });

  it('only ever emits token refs, never raw hex', () => {
    const map = mapOf(sourceDeck(6));
    for (const ref of map.refs.values()) expect(ref.kind).toBe('token');
  });

  it('only emits tokens the design system actually has', () => {
    const map = mapOf(sourceDeck(6));
    const available = new Set(ds.colors.map((c) => c.id));
    for (const ref of map.refs.values()) {
      if (ref.kind === 'token') expect(available.has(ref.token)).toBe(true);
    }
  });

  it('falls back sanely when the brand is missing a token', () => {
    // A brand with no `surface.subtle` must not leave elements pointing at it —
    // `resolveColor` would answer black and the panel would go dark.
    const sparse: DesignSystem = {
      ...ds,
      colors: ds.colors.filter((c) => c.id !== 'surface.subtle'),
    };
    const slides = [slide([shape(at(1, 2, 5, 2), { fill: '#F2F2F2' })], '#FFFFFF')];
    const map = buildColorMap(surveyDeck(slides, SIZE, ds), sparse);
    const ref = map.refs.get('#F2F2F2');
    expect(ref).toEqual({ kind: 'token', token: 'surface.base' });
  });

  it('flags weak mappings rather than hiding them', () => {
    // A mid-tone unsaturated fill has no strong signal either way.
    const slides = [slide([shape(at(1, 2, 5, 2), { fill: '#8A8A8A' })])];
    const map = buildColorMap(survey(slides), ds);
    expect(map.weak.some((w) => w.hex === '#8A8A8A')).toBe(true);
    expect(map.weak.every((w) => w.confidence < WEAK_AFFINITY)).toBe(true);
  });

  it('gives every assignment a reason', () => {
    for (const a of mapOf(sourceDeck(6)).assignments) {
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });

  it('is stable under slide reordering', () => {
    const slides = sourceDeck(6);
    const forward = buildColorMap(survey(slides), ds);
    const reversed = buildColorMap(survey([...slides].reverse()), ds);
    expect([...reversed.refs.entries()].sort()).toEqual([...forward.refs.entries()].sort());
  });
});

describe('mapColor', () => {
  it('is case-insensitive on the source hex', () => {
    const map = mapOf([slide([text('x', at(1, 2, 3, 0.4), { color: '#1F3864' })])]);
    expect(mapColor(map, '#1f3864')).toEqual(mapColor(map, '#1F3864'));
  });

  it('falls back to ink for an unseen colour rather than a surprise accent', () => {
    const map = mapOf(sourceDeck(3));
    expect(mapColor(map, '#123456')).toEqual({ kind: 'token', token: 'ink.strong' });
    expect(mapColor(map, undefined)).toEqual({ kind: 'token', token: 'ink.strong' });
  });
});

describe('readable', () => {
  it('holds body text to 4.5:1 and large text to 3:1', () => {
    expect(readable('#FFFFFF', '#000000', false)).toBe(true);
    expect(readable('#777777', '#FFFFFF', false)).toBe(false);
    expect(readable('#777777', '#FFFFFF', true)).toBe(true);
  });
});
