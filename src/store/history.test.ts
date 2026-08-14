import { beforeEach, describe, expect, it } from 'vitest';
import { inchesToEmu, type Deck, type ShapeElement } from '@/model';
import { loadDeck, useEditor } from './editorStore';

const RECT = { x: 0, y: 0, w: inchesToEmu(2), h: inchesToEmu(1) };

function shape(id: string, x = 0): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect: { ...RECT, x } };
}

function deck(): Deck {
  return {
    id: 'd1',
    title: 'T',
    slideSize: { w: 12_192_000, h: 6_858_000 },
    slides: [{ id: 's1', elements: [shape('e1')] }],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const s = () => useEditor.getState();
const xOf = (id: string) =>
  s().deck.slides.flatMap((sl) => sl.elements).find((e) => e.id === id)!.rect.x;

describe('undo/redo', () => {
  beforeEach(() => loadDeck(deck()));

  it('steps back over a committed move', () => {
    s().moveBy(['e1'], inchesToEmu(1), 0);
    expect(xOf('e1')).toBe(inchesToEmu(1));
    s().undo();
    expect(xOf('e1')).toBe(0);
    s().redo();
    expect(xOf('e1')).toBe(inchesToEmu(1));
  });

  it('steps back to BEFORE a transient burst, not to its last preview', () => {
    // The drag: several previews, then one commit — exactly the cadence the
    // canvas and the chart datasheet use.
    s().moveBy(['e1'], inchesToEmu(1), 0, true);
    s().moveBy(['e1'], inchesToEmu(1), 0, true);
    s().moveBy(['e1'], inchesToEmu(1), 0);
    expect(xOf('e1')).toBe(inchesToEmu(3));

    s().undo();
    expect(xOf('e1')).toBe(0);
    s().redo();
    expect(xOf('e1')).toBe(inchesToEmu(3));
  });

  it('costs one step per burst, however many previews it contained', () => {
    s().moveBy(['e1'], inchesToEmu(1), 0, true);
    s().moveBy(['e1'], inchesToEmu(1), 0, true);
    s().moveBy(['e1'], inchesToEmu(1), 0);
    expect(s().past).toHaveLength(1);
  });

  it('takes an abandoned preview back with the step it belongs to', () => {
    s().moveBy(['e1'], inchesToEmu(1), 0);
    s().moveBy(['e1'], inchesToEmu(5), 0, true); // never committed
    s().undo();
    expect(xOf('e1')).toBe(0);
  });

  it('lands on a slide that still exists', () => {
    s().addSlide();
    const added = s().currentSlideId;
    s().undo();
    expect(s().deck.slides.some((sl) => sl.id === added)).toBe(false);
    expect(s().currentSlideId).toBe('s1');
    // The editor is still live: without the clamp every mutation would look
    // the missing slide up and silently do nothing.
    s().select(['e1']);
    s().moveBy(['e1'], inchesToEmu(1), 0);
    expect(xOf('e1')).toBe(inchesToEmu(1));
  });

  it('drops the redo branch once a new edit lands', () => {
    s().moveBy(['e1'], inchesToEmu(1), 0);
    s().undo();
    s().moveBy(['e1'], inchesToEmu(2), 0);
    expect(s().future).toHaveLength(0);
    s().redo();
    expect(xOf('e1')).toBe(inchesToEmu(2));
  });

  it('is a no-op at the ends of the ring', () => {
    s().undo();
    s().redo();
    expect(xOf('e1')).toBe(0);
  });
});
