import { describe, expect, it } from 'vitest';
import {
  inchesToEmu,
  marginBox,
  type Deck,
  type PictureElement,
  type ShapeElement,
  type SlideElement,
} from '@/model';
import { loadDeck, useEditor } from './editorStore';

const SIZE = { w: 12_192_000, h: 6_858_000 };
const FRAME = marginBox(SIZE);

function shape(id: string, rect: ShapeElement['rect']): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect };
}

function picture(id: string, rect: PictureElement['rect']): PictureElement {
  return { id, type: 'picture', src: 'asset:1', rect };
}

function deck(elements: SlideElement[]): Deck {
  return {
    id: 'd1',
    title: 'T',
    slideSize: SIZE,
    slides: [
      { id: 's1', elements },
      {
        id: 's2',
        elements: [shape('other', { x: 0, y: 0, w: inchesToEmu(1), h: inchesToEmu(1) })],
      },
    ],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const s = () => useEditor.getState();
const rectOf = (id: string) =>
  s()
    .deck.slides.flatMap((sl) => sl.elements)
    .find((e) => e.id === id)!.rect;

describe('fitToMargins', () => {
  it('drags the overhanging sides in and leaves the far sides where they were', () => {
    // Two shapes an inch apart, the pair hanging off the top-left corner.
    loadDeck(
      deck([
        shape('a', {
          x: -inchesToEmu(1),
          y: -inchesToEmu(1),
          w: inchesToEmu(2),
          h: inchesToEmu(2),
        }),
        shape('b', { x: inchesToEmu(2), y: -inchesToEmu(1), w: inchesToEmu(2), h: inchesToEmu(2) }),
      ]),
    );
    s().fitToMargins();
    const a = rectOf('a');
    const b = rectOf('b');
    expect(a.x).toBe(FRAME.x); // overhanging left edge on the left guide
    expect(a.y).toBe(FRAME.y); // overhanging top edge on the top guide
    // The block's far edges never overhung anything, so they did not move.
    expect(b.x + b.w).toBe(inchesToEmu(4));
    expect(Math.max(a.y + a.h, b.y + b.h)).toBe(inchesToEmu(1));
    // Which makes each axis its own factor, and the gap follows the x one.
    const kx = (inchesToEmu(4) - FRAME.x) / inchesToEmu(5);
    expect(Math.abs(b.x - (a.x + a.w) - inchesToEmu(1) * kx)).toBeLessThanOrEqual(1);
  });

  it('slides the block so a leading title sits on the top guide', () => {
    // Title well below the guide with nothing overhanging: the block still
    // travels, because the title's place on the page is the brand's call.
    const drop = inchesToEmu(1.5);
    loadDeck(
      deck([
        { ...shape('title', { x: FRAME.x, y: drop, w: inchesToEmu(6), h: inchesToEmu(1) }), role: 'title' },
        shape('body', { x: FRAME.x, y: drop + inchesToEmu(2), w: inchesToEmu(6), h: inchesToEmu(2) }),
      ]),
    );
    s().fitToMargins();
    const title = rectOf('title');
    const body = rectOf('body');
    expect(title.y).toBe(FRAME.y); // top-aligned to the top margin guide
    expect(title.h).toBe(inchesToEmu(1)); // slid, never stretched
    expect(body.y - (title.y + title.h)).toBe(inchesToEmu(1)); // gap intact
  });

  it('does not haul the block up by a title that is not its top edge', () => {
    loadDeck(
      deck([
        shape('above', { x: FRAME.x, y: inchesToEmu(1), w: inchesToEmu(2), h: inchesToEmu(1) }),
        {
          ...shape('title', { x: FRAME.x, y: inchesToEmu(3), w: inchesToEmu(6), h: inchesToEmu(1) }),
          role: 'title',
        },
      ]),
    );
    s().fitToMargins();
    // `above` stays: sliding the whole block by this title would push it off
    // the top of the page. The title alone travels to its corner.
    expect(rectOf('above').y).toBe(inchesToEmu(1));
    expect(rectOf('title')).toEqual({
      x: FRAME.x,
      y: FRAME.y,
      w: inchesToEmu(6),
      h: inchesToEmu(1),
    });
  });

  it('parks the title on the corner of the safe area', () => {
    // Title indented and dropped from the corner, with everything comfortably
    // inside the guides: the block needs no fitting, the title still moves.
    loadDeck(
      deck([
        {
          ...shape('title', {
            x: FRAME.x + inchesToEmu(2),
            y: FRAME.y + inchesToEmu(1),
            w: inchesToEmu(6),
            h: inchesToEmu(1),
          }),
          role: 'title',
        },
        shape('body', {
          x: FRAME.x + inchesToEmu(2),
          y: FRAME.y + inchesToEmu(3),
          w: inchesToEmu(6),
          h: inchesToEmu(2),
        }),
      ]),
    );
    s().fitToMargins();
    const title = rectOf('title');
    expect(title.x).toBe(FRAME.x); // left edge on the left guide
    expect(title.y).toBe(FRAME.y); // top edge on the top guide
    expect(title.w).toBe(inchesToEmu(6)); // moved, never stretched
    expect(title.h).toBe(inchesToEmu(1));
    // The block rode up with its leading title, but the corner's LEFT pull is
    // the title's own: the body keeps the indent its layout gave it.
    expect(rectOf('body').x).toBe(FRAME.x + inchesToEmu(2));
    expect(rectOf('body').y).toBe(FRAME.y + inchesToEmu(2));
  });

  it('carries a grouped title\u2019s companions onto the corner with it', () => {
    const eyebrow = {
      x: FRAME.x + inchesToEmu(2),
      y: FRAME.y + inchesToEmu(1),
      w: inchesToEmu(2),
      h: inchesToEmu(0.3),
    };
    loadDeck(
      deck([
        { ...shape('eyebrow', eyebrow), groupIds: ['g1'] },
        {
          ...shape('title', {
            x: eyebrow.x,
            y: eyebrow.y + eyebrow.h,
            w: inchesToEmu(6),
            h: inchesToEmu(1),
          }),
          role: 'title',
          groupIds: ['g1'],
        },
      ]),
    );
    s().fitToMargins();
    // The unit's box lands on the corner, so the eyebrow above the title is
    // what sits on the guides — the group did not come apart.
    expect(rectOf('eyebrow').x).toBe(FRAME.x);
    expect(rectOf('eyebrow').y).toBe(FRAME.y);
    expect(rectOf('title').x).toBe(FRAME.x);
    expect(rectOf('title').y).toBe(FRAME.y + eyebrow.h);
  });

  it('leaves a title already on the corner alone', () => {
    loadDeck(
      deck([
        {
          ...shape('title', { x: FRAME.x, y: FRAME.y, w: inchesToEmu(6), h: inchesToEmu(1) }),
          role: 'title',
        },
      ]),
    );
    const before = s().deck;
    s().fitToMargins();
    expect(s().deck).toBe(before); // no state change, so no undo step
  });

  it('pulls an overhanging right/bottom block back onto those guides', () => {
    loadDeck(
      deck([
        shape('a', {
          x: SIZE.w - inchesToEmu(1),
          y: SIZE.h - inchesToEmu(1),
          w: inchesToEmu(2),
          h: inchesToEmu(2),
        }),
      ]),
    );
    s().fitToMargins();
    const a = rectOf('a');
    expect(a.x + a.w).toBe(FRAME.x + FRAME.w);
    expect(a.y + a.h).toBe(FRAME.y + FRAME.h);
  });

  it('fits the axes independently, so a wide block is not also flattened', () => {
    // Wider than the safe area and starting inside it, but well short of the
    // bottom guide: the height has no business changing.
    const w = FRAME.w + inchesToEmu(2);
    loadDeck(deck([shape('a', { x: FRAME.x, y: FRAME.y, w, h: inchesToEmu(3) })]));
    s().fitToMargins();
    const a = rectOf('a');
    expect(a.w).toBe(FRAME.w); // right edge dragged onto the right guide
    expect(a.h).toBe(inchesToEmu(3)); // and the other axis untouched
    expect(a.x).toBe(FRAME.x); // the side that already fit is pinned
    expect(a.y).toBe(FRAME.y);
  });

  it('scales the gaps with the block, not just the objects in it', () => {
    const w = (FRAME.w + inchesToEmu(2)) / 2;
    loadDeck(
      deck([
        shape('a', { x: FRAME.x, y: FRAME.y, w: w - inchesToEmu(1), h: inchesToEmu(2) }),
        shape('b', { x: FRAME.x + w, y: FRAME.y, w: w - inchesToEmu(1), h: inchesToEmu(2) }),
      ]),
    );
    s().fitToMargins();
    const a = rectOf('a');
    const b = rectOf('b');
    const k = FRAME.w / (w * 2 - inchesToEmu(1));
    // Gap scaled too, to within a rounding step.
    expect(Math.abs(b.x - (a.x + a.w) - inchesToEmu(1) * k)).toBeLessThanOrEqual(1);
    expect(b.x + b.w).toBe(FRAME.x + FRAME.w); // block spans the guides
  });

  it('shrinks to fit rather than tearing a too-wide block apart', () => {
    // The reported slide: a chart already spanning the safe width and a title
    // poking out past the left guide, so the block overflows by that much.
    const out = FRAME.x - inchesToEmu(0.2);
    loadDeck(
      deck([
        shape('chart', { x: FRAME.x, y: inchesToEmu(2), w: FRAME.w, h: inchesToEmu(4) }),
        shape('title', { x: out, y: inchesToEmu(0.5), w: inchesToEmu(8), h: inchesToEmu(1) }),
      ]),
    );
    s().fitToMargins();
    const title = rectOf('title');
    const chart = rectOf('chart');
    expect(title.x).toBe(FRAME.x); // block pulled onto the left guide
    expect(chart.x + chart.w).toBeLessThanOrEqual(FRAME.x + FRAME.w); // and inside the right
    // Both shrank by the SAME factor — the layout is intact, not re-stacked.
    const k = FRAME.w / (FRAME.w + inchesToEmu(0.2));
    expect(chart.w).toBe(Math.round(FRAME.w * k));
    expect(title.w).toBe(Math.round(inchesToEmu(8) * k));
  });

  it('leaves a full-bleed object alone, and does not let it shrink the rest', () => {
    // The side-band case: a panel running the full height of the page, with a
    // text box beside it that overhangs the right guide.
    const band = { x: 0, y: 0, w: inchesToEmu(4), h: SIZE.h };
    loadDeck(
      deck([
        shape('band', band),
        shape('body', {
          x: SIZE.w - inchesToEmu(1),
          y: inchesToEmu(2),
          w: inchesToEmu(2),
          h: inchesToEmu(2),
        }),
      ]),
    );
    s().fitToMargins();
    expect(rectOf('band')).toEqual(band); // untouched: off the margins on purpose
    const body = rectOf('body');
    expect(body.h).toBe(inchesToEmu(2)); // not crushed to fit the band's height
    expect(body.x).toBe(SIZE.w - inchesToEmu(1)); // left edge never overhung
    expect(body.x + body.w).toBe(FRAME.x + FRAME.w); // only the right side moved
  });

  it('leaves a whole band group alone when its panel is full-bleed', () => {
    const panel = { x: 0, y: 0, w: inchesToEmu(4), h: SIZE.h };
    const title = { x: inchesToEmu(0.5), y: inchesToEmu(1), w: inchesToEmu(3), h: inchesToEmu(2) };
    loadDeck(
      deck([
        { ...shape('panel', panel), groupIds: ['g1'] },
        { ...shape('title', title), groupIds: ['g1'] },
      ]),
    );
    s().fitToMargins();
    // The title is inside the guides' left edge, but it rides with its panel
    // rather than being pulled off it.
    expect(rectOf('panel')).toEqual(panel);
    expect(rectOf('title')).toEqual(title);
  });

  it('does nothing when everything in scope is full-bleed', () => {
    loadDeck(deck([shape('a', { x: 0, y: 0, w: SIZE.w, h: SIZE.h })]));
    const before = s().deck;
    s().fitToMargins();
    expect(s().deck).toBe(before);
  });

  it('leaves a block that already sits inside the guides alone', () => {
    loadDeck(deck([shape('a', { x: FRAME.x, y: FRAME.y, w: inchesToEmu(2), h: inchesToEmu(2) })]));
    const before = s().deck;
    s().fitToMargins();
    expect(s().deck).toBe(before); // no state change, so no undo step either
  });

  it('touches only the current slide', () => {
    loadDeck(
      deck([
        shape('a', {
          x: -inchesToEmu(1),
          y: -inchesToEmu(1),
          w: inchesToEmu(2),
          h: inchesToEmu(2),
        }),
      ]),
    );
    s().fitToMargins();
    expect(rectOf('other')).toEqual({ x: 0, y: 0, w: inchesToEmu(1), h: inchesToEmu(1) });
  });

  it('fits just the selection when there is one', () => {
    loadDeck(
      deck([
        shape('a', {
          x: -inchesToEmu(1),
          y: -inchesToEmu(1),
          w: inchesToEmu(2),
          h: inchesToEmu(2),
        }),
        shape('b', { x: -inchesToEmu(1), y: inchesToEmu(3), w: inchesToEmu(2), h: inchesToEmu(2) }),
      ]),
    );
    s().select(['a']);
    s().fitToMargins();
    expect(rectOf('a').x).toBe(FRAME.x);
    expect(rectOf('b').x).toBe(-inchesToEmu(1)); // untouched
  });

  it('keeps a picture\u2019s aspect ratio when the axes take different factors', () => {
    // The block overhangs on the right only, so x shrinks and y does not — the
    // combination that used to stretch every photo in the block sideways.
    const w = inchesToEmu(4);
    const h = inchesToEmu(3);
    loadDeck(
      deck([
        picture('pic', { x: FRAME.x, y: FRAME.y, w, h }),
        shape('b', { x: FRAME.x + w, y: FRAME.y, w: inchesToEmu(20), h }),
      ]),
    );
    s().fitToMargins();
    const pic = rectOf('pic');
    expect(pic.w).toBeLessThan(w); // it did take the fit
    expect(Math.abs(pic.w / pic.h - w / h)).toBeLessThan(0.01);
  });

  it('does not group the objects it moved', () => {
    loadDeck(
      deck([
        shape('a', {
          x: -inchesToEmu(1),
          y: -inchesToEmu(1),
          w: inchesToEmu(2),
          h: inchesToEmu(2),
        }),
        shape('b', { x: inchesToEmu(2), y: -inchesToEmu(1), w: inchesToEmu(2), h: inchesToEmu(2) }),
      ]),
    );
    s().fitToMargins();
    for (const id of ['a', 'b']) {
      const el = s()
        .deck.slides.flatMap((sl) => sl.elements)
        .find((e) => e.id === id)!;
      expect(el.groupIds ?? []).toEqual([]);
    }
  });
});
