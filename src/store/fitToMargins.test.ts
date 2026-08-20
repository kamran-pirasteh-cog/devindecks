import { beforeEach, describe, expect, it } from 'vitest';
import { inchesToEmu, marginBox, type Deck, type ShapeElement } from '@/model';
import { loadDeck, useEditor } from './editorStore';

const SIZE = { w: 12_192_000, h: 6_858_000 };
const FRAME = marginBox(SIZE);

function shape(id: string, rect: ShapeElement['rect']): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect };
}

function deck(elements: ShapeElement[]): Deck {
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
  it('moves the whole slide as one block, keeping the gaps between objects', () => {
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
    expect(a.x).toBe(FRAME.x); // outermost left edge on the left guide
    expect(a.y).toBe(FRAME.y); // outermost top edge on the top guide
    expect(b.x - (a.x + a.w)).toBe(inchesToEmu(1)); // gap survives
    expect(a.w).toBe(inchesToEmu(2)); // nothing resized: it already fit
    expect(b.h).toBe(inchesToEmu(2));
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

  it('shrinks the block uniformly when it is too big, anchored on its top-left', () => {
    // Wider than the safe area and starting inside it, so the shrink alone
    // fixes the overhang and no move is needed.
    const w = FRAME.w + inchesToEmu(2);
    loadDeck(deck([shape('a', { x: FRAME.x, y: FRAME.y, w, h: inchesToEmu(3) })]));
    s().fitToMargins();
    const a = rectOf('a');
    const k = FRAME.w / w;
    expect(a.w).toBe(Math.round(w * k));
    expect(a.h).toBe(Math.round(inchesToEmu(3) * k)); // one factor, both axes
    expect(a.x).toBe(FRAME.x); // top-left pinned
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
    expect(body.w).toBe(inchesToEmu(2)); // not crushed to fit the band's height
    expect(body.h).toBe(inchesToEmu(2));
    expect(body.x + body.w).toBe(FRAME.x + FRAME.w);
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
