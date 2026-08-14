import { describe, it, expect } from 'vitest';
import { commentAnchorId, elementLabel } from './commentAnchor';
import type { SlideElement } from '@/model';

const text = (id: string, s: string, extra: Partial<SlideElement> = {}): SlideElement =>
  ({
    id,
    type: 'text',
    rect: { x: 0, y: 0, w: 100, h: 100 },
    body: { paragraphs: [{ runs: [{ text: s }] }] },
    ...extra,
  }) as SlideElement;

const box = (id: string, extra: Partial<SlideElement> = {}): SlideElement =>
  ({
    id,
    type: 'shape',
    preset: 'rect',
    rect: { x: 0, y: 0, w: 100, h: 100 },
    ...extra,
  }) as SlideElement;

describe('elementLabel', () => {
  it('reads the object out as its own text', () => {
    expect(elementLabel(text('a', 'CI/CD + bugs'))).toBe('CI/CD + bugs');
  });

  it('collapses the whitespace between runs and paragraphs', () => {
    const el = {
      ...text('a', ''),
      body: {
        paragraphs: [
          { runs: [{ text: 'Wave one\n' }, { text: '  results' }] },
          { runs: [{ text: 'Q3' }] },
        ],
      },
    } as SlideElement;
    expect(elementLabel(el)).toBe('Wave one results Q3');
  });

  it('ignores a writer-generated name from a PPTX import', () => {
    expect(elementLabel(box('a', { name: 'TextBox 4' }))).toBe('shape');
    expect(elementLabel(box('a', { name: 'Google Shape;12;p3' }))).toBe('shape');
    expect(elementLabel(box('a', { name: 'Rectangle 7' }))).toBe('shape');
  });

  it('keeps a name a human plausibly typed', () => {
    expect(elementLabel(box('a', { name: 'Savings callout' }))).toBe('Savings callout');
  });

  it('borrows the group text when the anchor is the backing shape', () => {
    const backing = box('bg', { groupIds: ['g1'], name: 'Rectangle 2' });
    const label = box('lbl', { groupIds: ['g1'] });
    const words = text('w', 'Deploys per week', { groupIds: ['g1'] });
    expect(elementLabel(backing, [backing, label, words])).toBe('Deploys per week');
  });

  it('falls back to a readable type name, never the raw type', () => {
    expect(elementLabel(text('a', ''))).toBe('text box');
    expect(elementLabel({ ...box('a'), type: 'picture' } as SlideElement)).toBe('image');
  });

  it('truncates so a paragraph does not take over the rail', () => {
    expect(elementLabel(text('a', 'x'.repeat(50)))).toBe(`${'x'.repeat(32)}…`);
  });
});

describe('commentAnchorId', () => {
  it('pins to the selected object that carries the text', () => {
    const els = [box('bg'), text('w', 'Deploys per week')];
    expect(commentAnchorId(['bg', 'w'], els)).toBe('w');
  });

  it('falls back to the first selection when nothing has text', () => {
    const els = [box('bg'), box('other')];
    expect(commentAnchorId(['bg', 'other'], els)).toBe('bg');
  });

  it('is undefined with an empty selection — a comment on the slide', () => {
    expect(commentAnchorId([], [])).toBeUndefined();
  });
});
