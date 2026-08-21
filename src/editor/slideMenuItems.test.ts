import { beforeEach, describe, expect, it } from 'vitest';
import { inchesToEmu, type Deck, type ShapeElement, type Slide } from '@/model';
import { loadDeck, useEditor } from '@/store/editorStore';
import { slideMenuItems } from './slideMenuItems';
import type { MenuItem } from './ContextMenu';

function shape(id: string): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect: { x: 0, y: 0, w: inchesToEmu(2), h: inchesToEmu(1) } };
}

const slide = (id: string): Slide => ({ id, elements: [shape(`${id}-e1`)] });

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
const labels = (items: MenuItem[]) => items.map((i) => i.label);
const find = (items: MenuItem[], label: string) => {
  const item = items.find((i) => i.label === label);
  if (!item) throw new Error(`no item ${label}`);
  return item;
};
const slideById = (id: string) => s().deck.slides.find((sl) => sl.id === id)!;

describe('slide context menu', () => {
  beforeEach(() => {
    loadDeck(deck());
    useEditor.setState({ slideClipboard: null });
  });

  it('offers the clipboard commands and the layout submenu', () => {
    const items = slideMenuItems(['s1']);
    expect(labels(items)).toEqual(['Copy', 'Cut', 'Duplicate', 'Quick Layout']);
    expect(find(items, 'Quick Layout').items?.map((i) => i.label)).toEqual([
      'Title',
      'Section break, dark',
      'Section break, light',
      'Content, light',
      'Content, dark',
    ]);
  });

  it('counts the slides it will act on', () => {
    expect(labels(slideMenuItems(['s1', 's2']))).toContain('Copy 2 slides');
  });

  it('drops Cut when it would empty the deck', () => {
    expect(labels(slideMenuItems(['s1', 's2', 's3']))).toEqual([
      'Copy 3 slides',
      'Duplicate 3 slides',
      'Quick Layout',
    ]);
  });

  it('acts on the slides it was given, not on the current one', () => {
    s().setCurrentSlide('s1');
    find(slideMenuItems(['s3']), 'Copy').run?.();
    expect(s().slideClipboard?.map((sl) => sl.id)).toEqual(['s3']);

    find(slideMenuItems(['s2']), 'Duplicate').run?.();
    const ids = s().deck.slides.map((sl) => sl.id);
    expect(ids.slice(0, 2)).toEqual(['s1', 's2']);
    // The copy lands right after the slide it came from, however it's named.
    expect(ids).toHaveLength(4);
    expect(ids[3]).toBe('s3');
  });

  it('re-casts every slide in the group, as one undo step', () => {
    const dark = find(slideMenuItems(['s1', 's2']), 'Quick Layout').items!;
    find(dark, 'Content, dark').run?.();

    for (const id of ['s1', 's2']) {
      // The dark content ground the deck itself uses.
      expect(slideById(id).background).toEqual({
        kind: 'solid',
        color: { kind: 'hex', hex: '#0B0B0B' },
      });
      expect(slideById(id).elements.some((el) => el.role === 'title')).toBe(true);
    }
    expect(slideById('s3').background).toBeUndefined();

    s().undo();
    expect(slideById('s1').background).toBeUndefined();
    expect(slideById('s1').elements.map((el) => el.id)).toEqual(['s1-e1']);
  });
});
