import { beforeEach, describe, expect, it } from 'vitest';
import { inchesToEmu, type Deck, type ShapeElement } from '@/model';
import { DEFAULT_MARGINS } from '@/model/layout';
import { loadDeck, useEditor } from './editorStore';

const SIZE = { w: 12_192_000, h: 6_858_000 };
const RECT = { x: inchesToEmu(4), y: inchesToEmu(3), w: inchesToEmu(2), h: inchesToEmu(1) };

function shape(id: string, over: Partial<ShapeElement['rect']> = {}): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect: { ...RECT, ...over } };
}

function deck(elements: ShapeElement[]): Deck {
  return {
    id: 'd1',
    title: 'T',
    slideSize: SIZE,
    slides: [{ id: 's1', elements }],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const s = () => useEditor.getState();
const rectOf = (id: string) =>
  s().deck.slides.flatMap((sl) => sl.elements).find((e) => e.id === id)!.rect;

describe('align, one object selected', () => {
  beforeEach(() => {
    loadDeck(deck([shape('e1')]));
    s().select(['e1']);
  });

  it('snaps to the left and right margin guides', () => {
    s().align('left');
    expect(rectOf('e1').x).toBe(DEFAULT_MARGINS.left);
    s().align('right');
    const r = rectOf('e1');
    expect(r.x + r.w).toBe(SIZE.w - DEFAULT_MARGINS.right);
  });

  it('snaps top to the content-top guide, not the paper margin', () => {
    s().align('top');
    expect(rectOf('e1').y).toBe(DEFAULT_MARGINS.contentTop);
  });

  it('snaps bottom to the bottom margin guide', () => {
    s().align('bottom');
    const r = rectOf('e1');
    expect(r.y + r.h).toBe(SIZE.h - DEFAULT_MARGINS.bottom);
  });

  it('centres on the slide, not on the margin frame', () => {
    s().align('hcenter');
    s().align('vcenter');
    const r = rectOf('e1');
    expect(r.x + r.w / 2).toBe(SIZE.w / 2);
    expect(r.y + r.h / 2).toBe(SIZE.h / 2);
  });

  it('lands in one press from outside the guide, and stays put on a second', () => {
    // Overhanging the left guide: the old walk parked it on the guide's far
    // side first. One press now, and the second is a no-op — not another step.
    loadDeck(deck([shape('e1', { x: -inchesToEmu(1) })]));
    s().select(['e1']);
    s().align('left');
    expect(rectOf('e1').x).toBe(DEFAULT_MARGINS.left);
    s().align('left');
    expect(rectOf('e1').x).toBe(DEFAULT_MARGINS.left);
  });
});

describe('align, several objects selected', () => {
  it('still lines them up on their own outermost edge first', () => {
    loadDeck(deck([shape('e1', { x: inchesToEmu(2) }), shape('e2', { x: inchesToEmu(5) })]));
    s().select(['e1', 'e2']);
    s().align('left');
    expect(rectOf('e1').x).toBe(inchesToEmu(2));
    expect(rectOf('e2').x).toBe(inchesToEmu(2));
    // …and only then travels, as one block, to the guide.
    s().align('left');
    expect(rectOf('e1').x).toBe(DEFAULT_MARGINS.left);
    expect(rectOf('e2').x).toBe(DEFAULT_MARGINS.left);
  });
});
