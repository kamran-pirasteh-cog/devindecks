import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, resolveColor, token } from '@/model/tokens';
import { contrastRatio } from '@/chart/color';
import type { Slide } from '@/model';
import {
  BODY_CONTRAST,
  enforceLegibility,
  groundBehind,
  LARGE_CONTRAST,
  legibleToken,
  requiredContrast,
} from './legibility';
import { at, picture, shape, slide, text } from './testkit';

const ds = DEFAULT_DESIGN_SYSTEM;

/** Resolve the first run's colour on a slide's element. */
const inkOf = (s: Slide, id: string) => {
  const el = s.elements.find((e) => e.id === id)!;
  const run = el.type === 'text' ? el.body.paragraphs[0].runs[0] : undefined;
  return run?.color ? resolveColor(run.color, ds) : undefined;
};

describe('requiredContrast', () => {
  it('holds body text to 4.5:1', () => {
    expect(requiredContrast(14, false)).toBe(BODY_CONTRAST);
  });

  it('relaxes to 3:1 for large text', () => {
    expect(requiredContrast(24, false)).toBe(LARGE_CONTRAST);
  });

  it('relaxes to 3:1 for bold text at any size', () => {
    expect(requiredContrast(12, true)).toBe(LARGE_CONTRAST);
  });
});

describe('groundBehind', () => {
  it('is the slide background when nothing covers the element', () => {
    const s = slide([text('hi', at(1, 2, 3, 0.4), { id: 't' })], '#101010');
    expect(groundBehind(s, s.elements[0], ds)).toBe('#101010');
  });

  it('is the brand surface when the slide states no background', () => {
    const s = slide([text('hi', at(1, 2, 3, 0.4), { id: 't' })]);
    expect(groundBehind(s, s.elements[0], ds)).toBe(
      ds.colors.find((c) => c.id === 'surface.base')!.hex,
    );
  });

  it('is a covering panel’s fill, not the slide background', () => {
    const panel = shape(at(0.5, 1.5, 6, 2), { fill: '#1F3864', id: 'p' });
    const label = text('on the panel', at(1, 2, 3, 0.4), { id: 't' });
    const s = slide([panel, label], '#FFFFFF');
    expect(groundBehind(s, label, ds)).toBe('#1F3864');
  });

  it('DECLINES when a picture is underneath — a photo has no one colour', () => {
    const photo = picture('data:X', at(0.5, 1.5, 6, 2), { id: 'pic' });
    const caption = text('over the photo', at(1, 2, 3, 0.4), { id: 't' });
    const s = slide([photo, caption], '#FFFFFF');
    expect(groundBehind(s, caption, ds)).toBeNull();
  });

  it('composites a TRANSLUCENT panel over what is behind it', () => {
    // The frosted card: white at 14% on a dark page is a dark card. Reading the
    // panel's own token as the ground answered "white", so this pass reversed
    // the card's type to dark ink — black on black.
    const card = shape(at(0.5, 1.5, 6, 2), { fill: '#FFFFFF', fillAlpha: 0.14, id: 'p' });
    const label = text('in the card', at(1, 2, 3, 0.4), { id: 't' });
    const s = slide([card, label], '#191919');
    const ground = groundBehind(s, label, ds)!;
    expect(contrastRatio(ground, '#FFFFFF')).toBeGreaterThan(LARGE_CONTRAST);
    expect(contrastRatio(ground, '#191919')).toBeLessThan(2);
  });

  it('keeps type light inside a frosted card on a dark page', () => {
    const card = shape(at(0.5, 1.5, 6, 2), { fill: '#FFFFFF', fillAlpha: 0.14, id: 'p' });
    const label = text('in the card', at(1, 2, 3, 0.4), { id: 't', color: '#FFFFFF' });
    const s = slide([card, label], '#191919');
    const out = enforceLegibility(s, ds);
    expect(inkOf(out.slide, 't')).toBe('#FFFFFF');
  });

  it('DECLINES when a fill covers some of the element but not most of it', () => {
    // A numeral centred on a disc a shade smaller than its own text box. The
    // area says "40% off the disc"; the glyph is on the disc. Unknowable.
    const disc = shape(at(1.1, 2.05, 0.3, 0.3), { fill: '#191919', id: 'd' });
    const numeral = text('1', at(1, 2, 0.5, 0.4), { id: 't', color: '#FFFFFF' });
    const s = slide([disc, numeral], '#FFFFFF');
    expect(groundBehind(s, numeral, ds)).toBeNull();
  });

  it('ignores a panel that does not actually cover the element', () => {
    const panel = shape(at(7, 1.5, 3, 2), { fill: '#1F3864', id: 'p' });
    const label = text('elsewhere', at(1, 2, 3, 0.4), { id: 't' });
    const s = slide([panel, label], '#FFFFFF');
    expect(groundBehind(s, label, ds)).toBe('#FFFFFF');
  });
});

describe('legibleToken', () => {
  it('picks a light token on a dark ground', () => {
    const chosen = legibleToken('#191919', BODY_CONTRAST, ds, false);
    expect(contrastRatio(resolveColor(chosen, ds), '#191919')).toBeGreaterThanOrEqual(
      BODY_CONTRAST,
    );
  });

  it('picks a dark token on a light ground', () => {
    const chosen = legibleToken('#FFFFFF', BODY_CONTRAST, ds, false);
    expect(contrastRatio(resolveColor(chosen, ds), '#FFFFFF')).toBeGreaterThanOrEqual(
      BODY_CONTRAST,
    );
  });

  it('prefers a muted token for supporting text when it is legible enough', () => {
    // On white, `ink.muted` clears 4.5:1 — so supporting text stays supporting
    // rather than being promoted to full-strength ink.
    const chosen = legibleToken('#FFFFFF', BODY_CONTRAST, ds, true);
    expect(chosen).toEqual(token('ink.muted'));
  });

  it('abandons the muted preference when muted is not readable', () => {
    const chosen = legibleToken('#191919', BODY_CONTRAST, ds, true);
    expect(chosen).not.toEqual(token('ink.muted'));
  });

  it('always returns a token the design system actually has', () => {
    const available = new Set(ds.colors.map((c) => c.id));
    for (const ground of ['#000000', '#FFFFFF', '#808080', '#2600FF']) {
      const chosen = legibleToken(ground, BODY_CONTRAST, ds, false);
      expect(chosen.kind).toBe('token');
      if (chosen.kind === 'token') expect(available.has(chosen.token)).toBe(true);
    }
  });
});

describe('enforceLegibility', () => {
  it('fixes muted text on a dark ground — the defect the corpus found', () => {
    // `ink.muted` (#6B7280) on `ink.strong` (#191919) is 3.6:1. Both mappings
    // are individually right; the pair is unreadable.
    const s = slide(
      [text('supporting line', at(1, 2, 4, 0.4), { id: 't', sizePt: 12 })],
      '#191919',
    );
    const withMuted: Slide = {
      ...s,
      elements: s.elements.map((el) =>
        el.type === 'text'
          ? {
              ...el,
              body: {
                ...el.body,
                paragraphs: el.body.paragraphs.map((p) => ({
                  ...p,
                  runs: p.runs.map((r) => ({ ...r, color: token('ink.muted') })),
                })),
              },
            }
          : el,
      ),
      background: { kind: 'solid', color: token('ink.strong') },
    };

    const { slide: fixed, fixes } = enforceLegibility(withMuted, ds);
    expect(fixes).toHaveLength(1);
    const ink = inkOf(fixed, 't')!;
    expect(contrastRatio(ink, '#191919')).toBeGreaterThanOrEqual(BODY_CONTRAST);
  });

  it('leaves legible text completely alone', () => {
    const s: Slide = {
      ...slide([text('readable', at(1, 2, 4, 0.4), { id: 't', sizePt: 12 })]),
      background: { kind: 'solid', color: token('surface.base') },
    };
    const withInk: Slide = {
      ...s,
      elements: s.elements.map((el) =>
        el.type === 'text'
          ? {
              ...el,
              body: {
                ...el.body,
                paragraphs: el.body.paragraphs.map((p) => ({
                  ...p,
                  runs: p.runs.map((r) => ({ ...r, color: token('ink.strong') })),
                })),
              },
            }
          : el,
      ),
    };
    const { slide: out, fixes } = enforceLegibility(withInk, ds);
    expect(fixes).toEqual([]);
    expect(out.elements).toEqual(withInk.elements);
  });

  it('does not touch text over a picture — the ground is unknowable', () => {
    const photo = picture('data:X', at(0.5, 1.5, 6, 2), { id: 'pic' });
    const caption = text('over the photo', at(1, 2, 3, 0.4), { id: 't', color: '#777777' });
    const s = slide([photo, caption], '#FFFFFF');
    expect(enforceLegibility(s, ds).fixes).toEqual([]);
  });

  it('does not touch chart primitives — the chart engine does its own contrast', () => {
    const tick = {
      ...text('0', at(1, 2, 0.4, 0.2), { id: 'tick', color: '#777777' }),
      chartRef: { chartId: 'c1', part: 'tick' } as never,
    };
    const s = slide([tick], '#808080');
    expect(enforceLegibility(s, ds).fixes).toEqual([]);
  });

  it('relaxes the bar for large text, as WCAG does', () => {
    // `ink.muted` on `surface.subtle` is 4.4:1 — short of the 4.5 body bar, and
    // comfortably over the 3:1 large-text one. (On plain white muted is 4.83:1
    // and legible either way, which is why the panel is needed to show this.)
    const build = (sizePt: number): Slide => ({
      id: 's1',
      background: { kind: 'solid', color: token('surface.base') },
      elements: [
        {
          id: 'panel',
          type: 'shape',
          preset: 'rect',
          rect: at(0.5, 1.5, 6, 2),
          fill: { kind: 'solid', color: token('surface.subtle') },
        },
        {
          id: 't',
          type: 'text',
          rect: at(1, 2, 4, 0.6),
          body: {
            paragraphs: [
              {
                runs: [
                  { text: 'heading', font: 'Geist' as const, sizePt, color: token('ink.muted') },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(enforceLegibility(build(24), ds).fixes).toEqual([]);
    expect(enforceLegibility(build(12), ds).fixes).toHaveLength(1);
  });

  it('reports what it changed and why', () => {
    const s: Slide = {
      ...slide([text('x', at(1, 2, 4, 0.4), { id: 't', sizePt: 12 })]),
      background: { kind: 'solid', color: token('ink.strong') },
      elements: [
        {
          ...text('x', at(1, 2, 4, 0.4), { id: 't', sizePt: 12 }),
          body: {
            paragraphs: [
              { runs: [{ text: 'x', font: 'Geist' as const, sizePt: 12, color: token('ink.muted') }] },
            ],
          },
        },
      ],
    };
    const { fixes } = enforceLegibility(s, ds);
    expect(fixes[0]).toMatchObject({ elementId: 't', groundHex: '#191919' });
    expect(fixes[0].ratio).toBeLessThan(BODY_CONTRAST);
  });

  it('is deterministic', () => {
    const s: Slide = {
      ...slide([text('x', at(1, 2, 4, 0.4), { id: 't', sizePt: 12, color: '#6B7280' })]),
      background: { kind: 'solid', color: token('ink.strong') },
    };
    expect(enforceLegibility(s, ds).slide).toEqual(enforceLegibility(s, ds).slide);
  });

  it('handles a slide with no text without throwing', () => {
    const s = slide([shape(at(1, 1, 2, 2), { fill: '#123456' })]);
    expect(enforceLegibility(s, ds).fixes).toEqual([]);
  });
});
