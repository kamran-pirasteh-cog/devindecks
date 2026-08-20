import { beforeEach, describe, expect, it } from 'vitest';
import { inchesToEmu, type Deck, type ShapeElement, type Slide } from '@/model';
import { loadDeck, useEditor } from './editorStore';

const RECT = { x: 0, y: 0, w: inchesToEmu(2), h: inchesToEmu(1) };

function shape(id: string): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect: { ...RECT } };
}

function slide(id: string): Slide {
  return { id, elements: [shape(`${id}-e1`)] };
}

function deck(): Deck {
  return {
    id: 'd1',
    title: 'T',
    slideSize: { w: 12_192_000, h: 6_858_000 },
    slides: [slide('s1'), slide('s2'), slide('s3')],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const s = () => useEditor.getState();
const slideIds = () => s().deck.slides.map((sl) => sl.id);

describe('slide clipboard', () => {
  // Like the object clipboard, it outlives a deck load — a scratch register,
  // not deck state — so tests clear it by hand.
  beforeEach(() => {
    loadDeck(deck());
    useEditor.setState({ slideClipboard: null });
  });

  it('copies the filmstrip selection and pastes it after the current slide', () => {
    s().setCurrentSlide('s1');
    s().selectSlideRange('s2');
    s().copySlides();
    expect(slideIds()).toEqual(['s1', 's2', 's3']);

    s().setCurrentSlide('s3');
    s().pasteSlides();
    expect(slideIds().slice(0, 3)).toEqual(['s1', 's2', 's3']);
    const pasted = slideIds().slice(3);
    expect(pasted).toHaveLength(2);
    expect(s().selectedSlideIds).toEqual(pasted);
    expect(s().currentSlideId).toBe(pasted[0]);
  });

  it('gives every pasted slide fresh ids, so the copy is independent', () => {
    s().setCurrentSlide('s1');
    s().copySlides();
    s().pasteSlides();
    s().pasteSlides();

    const ids = slideIds();
    expect(new Set(ids).size).toBe(ids.length);
    const elementIds = s().deck.slides.flatMap((sl) => sl.elements.map((e) => e.id));
    expect(new Set(elementIds).size).toBe(elementIds.length);
    // The copy is detached: editing it leaves the original alone.
    const copy = s().deck.slides.find((sl) => sl.id !== 's1' && sl.id !== 's2' && sl.id !== 's3')!;
    expect(copy.elements[0]!.id).not.toBe('s1-e1');
  });

  it('cuts the selected slides out of the deck and pastes them back', () => {
    s().setCurrentSlide('s1');
    s().selectSlideRange('s2');
    s().cutSlides();
    expect(slideIds()).toEqual(['s3']);

    s().pasteSlides();
    expect(slideIds()).toHaveLength(3);
    expect(slideIds()[0]).toBe('s3');
  });

  it('refuses a cut that would empty the deck, buffer included', () => {
    s().setCurrentSlide('s1');
    s().selectSlideRange('s3');
    s().cutSlides();
    expect(slideIds()).toEqual(['s1', 's2', 's3']);
    expect(s().slideClipboard).toBeNull();
  });

  it('falls back to the current slide when nothing is multi-selected', () => {
    useEditor.setState({ currentSlideId: 's2', selectedSlideIds: [] });
    s().copySlides();
    expect(s().slideClipboard?.map((sl) => sl.id)).toEqual(['s2']);
  });

  it('undoes a paste in one step', () => {
    s().setCurrentSlide('s1');
    s().copySlides();
    s().pasteSlides();
    expect(slideIds()).toHaveLength(4);
    s().undo();
    expect(slideIds()).toEqual(['s1', 's2', 's3']);
  });

  it('toggles one slide in and out of the selection, in deck order', () => {
    s().setCurrentSlide('s3');
    s().toggleSlideSelection('s1');
    expect(s().selectedSlideIds).toEqual(['s1', 's3']);
    s().toggleSlideSelection('s3');
    expect(s().selectedSlideIds).toEqual(['s1']);
    // The last one standing stays: ⌘-click never clears the strip.
    s().toggleSlideSelection('s1');
    expect(s().selectedSlideIds).toEqual(['s1']);
  });
});

describe('duplicate slides', () => {
  beforeEach(() => {
    loadDeck(deck());
  });

  it('drops copies of the whole selection after the last of them', () => {
    s().setCurrentSlide('s1');
    s().selectSlideRange('s2');
    s().duplicateSlides();

    const ids = slideIds();
    expect(ids.slice(0, 2)).toEqual(['s1', 's2']);
    expect(ids[4]).toBe('s3');
    const copies = ids.slice(2, 4);
    expect(copies.every((id) => id !== 's1' && id !== 's2')).toBe(true);
    expect(s().selectedSlideIds).toEqual(copies);
    expect(s().currentSlideId).toBe(copies[0]);
  });

  it('falls back to the current slide when nothing is selected in the strip', () => {
    s().setCurrentSlide('s2');
    useEditor.setState({ selectedSlideIds: [] });
    s().duplicateSlides();

    expect(slideIds().slice(0, 2)).toEqual(['s1', 's2']);
    expect(slideIds()).toHaveLength(4);
    expect(s().currentSlideId).toBe(slideIds()[2]);
  });

  it('gives the copies their own elements, and undoes in one step', () => {
    s().setCurrentSlide('s1');
    s().duplicateSlides();
    const copyId = slideIds()[1];
    const original = s().deck.slides[0];
    const copy = s().deck.slides[1];
    expect(copy.elements[0].id).not.toBe(original.elements[0].id);

    s().undo();
    expect(slideIds()).toEqual(['s1', 's2', 's3']);
    expect(copyId).not.toBe('s2');
  });
});
