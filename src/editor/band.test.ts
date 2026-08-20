import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, SLIDE_16x9, emuToInches, token } from '@/model';
import {
  BAND_CARD_ROLE,
  BAND_PANEL_ROLE,
  bandRect,
  makeBand,
  type BandOptions,
} from './band';

const ds = DEFAULT_DESIGN_SYSTEM;
const opts = (o: Partial<BandOptions> = {}): BandOptions => ({
  side: 'left',
  fraction: 'third',
  content: 'title-subtitle',
  fill: token('ink.strong'),
  ...o,
});

describe('bandRect', () => {
  it('runs the full height of the page on the chosen edge', () => {
    const left = bandRect(SLIDE_16x9, 'left', 'third');
    expect(left.x).toBe(0);
    expect(left.y).toBe(0);
    expect(left.h).toBe(SLIDE_16x9.h);

    const right = bandRect(SLIDE_16x9, 'right', 'third');
    expect(right.x + right.w).toBe(SLIDE_16x9.w);
  });

  it('takes the fraction of the page it is asked for', () => {
    for (const [id, frac] of [
      ['quarter', 1 / 4],
      ['third', 1 / 3],
      ['half', 1 / 2],
    ] as const) {
      const r = bandRect(SLIDE_16x9, 'left', id);
      expect(r.w / SLIDE_16x9.w).toBeCloseTo(frac, 5);
    }
  });
});

describe('makeBand', () => {
  it('inserts an empty band as the panel alone', () => {
    const els = makeBand(ds, SLIDE_16x9, opts({ content: 'empty' }));
    expect(els).toHaveLength(1);
    expect(els[0].role).toBe(BAND_PANEL_ROLE);
  });

  it('stamps every part with one group id, panel first', () => {
    const els = makeBand(ds, SLIDE_16x9, opts({ content: 'cards' }));
    const gid = els[0].groupIds?.[0];
    expect(gid).toBeTruthy();
    expect(els.every((e) => e.groupIds?.[0] === gid)).toBe(true);
    expect(els[0].role).toBe(BAND_PANEL_ROLE);
  });

  it('keeps title and subtitle inside the panel, not across it', () => {
    const panelRect = bandRect(SLIDE_16x9, 'right', 'quarter');
    const els = makeBand(ds, SLIDE_16x9, opts({ side: 'right', fraction: 'quarter' }));
    for (const el of els.slice(1)) {
      expect(el.rect.x).toBeGreaterThanOrEqual(panelRect.x);
      expect(el.rect.x + el.rect.w).toBeLessThanOrEqual(panelRect.x + panelRect.w);
      expect(el.rect.y + el.rect.h).toBeLessThanOrEqual(SLIDE_16x9.h);
    }
  });

  it('stacks three equal cards that clear the bottom of the page', () => {
    const els = makeBand(ds, SLIDE_16x9, opts({ content: 'cards' }));
    const cards = els.filter((e) => e.role === BAND_CARD_ROLE);
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c) => c.rect.h)).size).toBe(1);
    // In order, non-overlapping, and clear of the page edge.
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i].rect.y).toBeGreaterThan(cards[i - 1].rect.y + cards[i - 1].rect.h);
    }
    expect(emuToInches(cards[2].rect.y + cards[2].rect.h)).toBeLessThanOrEqual(7.5);
  });

  it('takes light type on a dark panel and dark type on a light one', () => {
    const dark = makeBand(ds, SLIDE_16x9, opts({ fill: token('ink.strong') }));
    const light = makeBand(ds, SLIDE_16x9, opts({ fill: token('surface.base') }));
    const colorOf = (els: ReturnType<typeof makeBand>) => {
      const t = els.find((e) => e.type === 'text');
      return t?.type === 'text' ? t.body.paragraphs[0].runs[0].color : undefined;
    };
    expect(colorOf(dark)).toEqual(token('surface.base'));
    expect(colorOf(light)).toEqual(token('ink.strong'));
  });

  it('gives up panel padding rather than type width on a narrow band', () => {
    const narrow = { w: 9144000, h: 6858000 }; // 10in x 7.5in, 4:3
    const els = makeBand(ds, narrow, opts({ fraction: 'quarter' }));
    const title = els[1];
    expect(emuToInches(title.rect.w)).toBeGreaterThan(0.8);
  });
});
