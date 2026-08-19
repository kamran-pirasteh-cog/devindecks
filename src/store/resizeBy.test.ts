import { beforeEach, describe, expect, it } from 'vitest';
import { inchesToEmu, type Deck, type PictureElement, type ShapeElement } from '@/model';
import { loadDeck, useEditor } from './editorStore';

const SIZE = { w: 12_192_000, h: 6_858_000 };
/** 4:3, so a distorted result is obvious in either direction. */
const RECT = { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(4), h: inchesToEmu(3) };
const STEP = inchesToEmu(1);

function picture(id: string, over: Partial<PictureElement['rect']> = {}): PictureElement {
  return { id, type: 'picture', src: 'data:,', rect: { ...RECT, ...over } };
}

function shape(id: string): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect: { ...RECT } };
}

function shapeAt(id: string, over: Partial<ShapeElement['rect']>): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect: { ...RECT, ...over } };
}

function deck(elements: (PictureElement | ShapeElement)[]): Deck {
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
const elOf = (id: string) =>
  s().deck.slides.flatMap((sl) => sl.elements).find((e) => e.id === id)!;
const rectOf = (id: string) => elOf(id).rect;
const aspect = (id: string) => {
  const r = rectOf(id);
  return r.w / r.h;
};

describe('resizeBy on a picture', () => {
  beforeEach(() => {
    loadDeck(deck([picture('p1')]));
    s().select(['p1']);
  });

  it('scales both sides from a horizontal step, keeping the aspect ratio', () => {
    s().resizeBy(['p1'], STEP, 0);
    const r = rectOf('p1');
    expect(r.w).toBe(inchesToEmu(5));
    // 4:3 grown to 5 wide is 3.75 tall.
    expect(r.h).toBeCloseTo(inchesToEmu(3.75), -3);
    expect(aspect('p1')).toBeCloseTo(4 / 3, 5);
  });

  it('scales both sides from a vertical step too', () => {
    s().resizeBy(['p1'], 0, STEP);
    const r = rectOf('p1');
    expect(r.h).toBe(inchesToEmu(4));
    expect(aspect('p1')).toBeCloseTo(4 / 3, 5);
  });

  it('keeps the aspect ratio while shrinking', () => {
    s().resizeBy(['p1'], -STEP, 0);
    expect(rectOf('p1').w).toBe(inchesToEmu(3));
    expect(aspect('p1')).toBeCloseTo(4 / 3, 5);
  });

  it('holds the ratio at the minimum size instead of flattening one side', () => {
    // Far more shrink than the box has, the way holding the key down would.
    for (let i = 0; i < 40; i++) s().resizeBy(['p1'], -STEP, 0);
    const r = rectOf('p1');
    expect(aspect('p1')).toBeCloseTo(4 / 3, 3);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });

  it('stretches one side when the caller asks for it (⌥⇧ + arrow)', () => {
    s().resizeBy(['p1'], STEP, 0, { stretch: true });
    const r = rectOf('p1');
    expect(r.w).toBe(inchesToEmu(5));
    expect(r.h).toBe(inchesToEmu(3));
  });

  it('leaves the top-left corner pinned', () => {
    s().resizeBy(['p1'], STEP, 0);
    const r = rectOf('p1');
    expect(r.x).toBe(inchesToEmu(1));
    expect(r.y).toBe(inchesToEmu(1));
  });
});

describe('resizeBy on everything else', () => {
  it('still resizes a shape on one axis only', () => {
    loadDeck(deck([shape('e1')]));
    s().select(['e1']);
    s().resizeBy(['e1'], STEP, 0);
    const r = rectOf('e1');
    expect(r.w).toBe(inchesToEmu(5));
    expect(r.h).toBe(inchesToEmu(3));
  });

  it('keeps each picture proportional in a mixed selection', () => {
    loadDeck(deck([picture('p1'), shape('e1')]));
    s().select(['p1', 'e1']);
    s().resizeBy(['p1', 'e1'], STEP, 0);
    expect(aspect('p1')).toBeCloseTo(4 / 3, 5);
    expect(rectOf('e1').h).toBe(inchesToEmu(3));
  });
});

describe('rotateBy', () => {
  beforeEach(() => {
    loadDeck(deck([shape('e1'), shape('e2')]));
  });

  it('steps clockwise onto the 22.5° grid', () => {
    s().select(['e1']);
    s().rotateBy(['e1'], 1);
    expect(elOf('e1').rotation).toBe(22.5);
    s().rotateBy(['e1'], 1);
    expect(elOf('e1').rotation).toBe(45);
  });

  it('leaves no angle behind when it comes back to upright', () => {
    s().select(['e1']);
    s().rotateBy(['e1'], -1);
    expect(elOf('e1').rotation).toBe(337.5);
    s().rotateBy(['e1'], 1);
    expect(elOf('e1').rotation).toBeUndefined();
  });

  it('leaves a lone box where it stands', () => {
    s().select(['e1']);
    s().rotateBy(['e1'], 1);
    expect(rectOf('e1')).toEqual(RECT);
  });

  it('turns a multi-selection about its own centre, so members orbit', () => {
    loadDeck(deck([shape('e1'), shapeAt('e2', { x: inchesToEmu(6), y: inchesToEmu(1) })]));
    s().select(['e1', 'e2']);
    const centre = (id: string) => {
      const r = rectOf(id);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    };
    const before = [centre('e1'), centre('e2')];
    const mid = {
      x: (before[0].x + before[1].x) / 2,
      y: (before[0].y + before[1].y) / 2,
    };
    s().rotateBy(['e1', 'e2'], 1);
    const after = [centre('e1'), centre('e2')];
    // Both spun by the step...
    expect(elOf('e1').rotation).toBe(22.5);
    expect(elOf('e2').rotation).toBe(22.5);
    // ...and both moved, each staying the same distance from the shared centre.
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - mid.x, p.y - mid.y);
    expect(after[0].y).not.toBe(before[0].y);
    expect(dist(after[0])).toBeCloseTo(dist(before[0]), -3);
    expect(dist(after[1])).toBeCloseTo(dist(before[1]), -3);
  });

  it('is one undo step for the whole selection', () => {
    s().select(['e1', 'e2']);
    s().rotateBy(['e1', 'e2'], 1);
    s().undo();
    expect(elOf('e1').rotation).toBeUndefined();
    expect(elOf('e2').rotation).toBeUndefined();
  });
});
