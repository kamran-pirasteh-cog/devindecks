import { describe, expect, it } from 'vitest';
import type { Slide, SlideElement, TextElement } from '@/model';
import type { StoredLayout } from './layoutRepository';
import { layoutDrift, reapplyLayout, stampLayoutProvenance, templateDrift } from './provenance';

const rect = (x: number, y: number, w = 100, h = 50) => ({ x, y, w, h });

const shape = (id: string, x: number, over: Partial<SlideElement> = {}) =>
  ({ id, type: 'shape', preset: 'rect', rect: rect(x, 0), ...over }) as unknown as SlideElement;

const text = (id: string, words: string[], over: Partial<TextElement> = {}) =>
  ({
    id,
    type: 'text',
    rect: rect(0, 0),
    body: { paragraphs: words.map((t) => ({ runs: [{ text: t }] })) },
    ...over,
  }) as unknown as SlideElement;

const layout = (slide: Slide, version = 1): StoredLayout => ({
  id: 'lay-1',
  name: 'Title',
  category: 'Blank',
  slide,
  version,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const master = (elements: SlideElement[]): Slide => ({ id: 's-master', elements });

/** What the repository does on insert: fresh ids, then stamp. */
const instantiate = (l: StoredLayout): Slide =>
  stampLayoutProvenance(
    {
      ...l.slide,
      id: 's-copy',
      elements: l.slide.elements.map((e) => ({ ...e, id: `${e.id}-copy` })),
    },
    l,
    l.slide,
  );

describe('stampLayoutProvenance', () => {
  it('ties each copied element back to the master it came from', () => {
    const l = layout(master([shape('a', 0), shape('b', 200)]));
    const slide = instantiate(l);

    expect(slide.layoutId).toBe('lay-1');
    expect(slide.layoutVersion).toBe(1);
    expect(slide.elements.map((e) => e.layoutElementId)).toEqual(['a', 'b']);
    // The whole point: the ids themselves were regenerated, so they can't be
    // the link.
    expect(slide.elements.map((e) => e.id)).toEqual(['a-copy', 'b-copy']);
  });
});

describe('layoutDrift', () => {
  it('is clean for a slide made from the current version', () => {
    const l = layout(master([shape('a', 0)]));
    expect(layoutDrift(instantiate(l), l).layoutStale).toBe(false);
  });

  it('reports stale once the master is re-saved', () => {
    const l = layout(master([shape('a', 0)]));
    const slide = instantiate(l);
    expect(layoutDrift(slide, { ...l, version: 2 }).layoutStale).toBe(true);
  });

  it('says nothing about a slide that never came from a layout', () => {
    const l = layout(master([shape('a', 0)]));
    expect(layoutDrift({ id: 's', elements: [] }, l).layoutStale).toBe(false);
  });

  it('says nothing about a slide made from a different layout', () => {
    const l = layout(master([shape('a', 0)]));
    const slide = { ...instantiate(l), layoutId: 'lay-other' };
    expect(layoutDrift(slide, { ...l, version: 9 }).layoutStale).toBe(false);
  });
});

describe('templateDrift', () => {
  const tpl = { id: 'tpl-1', version: 3 } as never;

  it('compares the deck against the version it was built from', () => {
    expect(templateDrift({ deckTemplateId: 'tpl-1', deckTemplateVersion: 3 }, tpl)).toBe(false);
    expect(templateDrift({ deckTemplateId: 'tpl-1', deckTemplateVersion: 2 }, tpl)).toBe(true);
  });

  it('ignores a deck with no template', () => {
    expect(templateDrift({}, tpl)).toBe(false);
  });
});

describe('reapplyLayout', () => {
  it('adopts the master geometry and re-stamps the version', () => {
    const l = layout(master([shape('a', 0)]));
    const slide = instantiate(l);

    const moved = layout(master([shape('a', 500)]), 2);
    const next = reapplyLayout(slide, moved);

    expect(next.elements[0].rect.x).toBe(500);
    expect(next.layoutVersion).toBe(2);
    expect(layoutDrift(next, moved).layoutStale).toBe(false);
  });

  it('never rewrites the author’s words', () => {
    const l = layout(master([text('t', ['Client name here'])]));
    const slide = instantiate(l);
    // The author typed over the placeholder.
    (slide.elements[0] as TextElement).body.paragraphs = [{ runs: [{ text: 'Fiserv' }] }];

    const restyled = layout(master([text('t', ['Client name here'], { rect: rect(9, 9) })]), 2);
    const next = reapplyLayout(slide, restyled);

    expect((next.elements[0] as TextElement).body.paragraphs[0].runs[0].text).toBe('Fiserv');
    expect(next.elements[0].rect.x).toBe(9);
  });

  it('leaves elements the author added alone', () => {
    const l = layout(master([shape('a', 0)]));
    const slide = instantiate(l);
    slide.elements.push(shape('mine', 42));

    const next = reapplyLayout(slide, layout(master([shape('a', 500)]), 2));

    const mine = next.elements.find((e) => e.id === 'mine');
    expect(mine?.rect.x).toBe(42);
    expect(mine?.layoutElementId).toBeUndefined();
  });

  it('brings across elements the master gained', () => {
    const l = layout(master([shape('a', 0)]));
    const slide = instantiate(l);

    const grown = layout(master([shape('a', 0), shape('footer', 10)]), 2);
    const next = reapplyLayout(slide, grown);

    expect(next.elements).toHaveLength(2);
    expect(next.elements[1].layoutElementId).toBe('footer');
  });

  it('keeps an element the master dropped, rather than deleting content', () => {
    const l = layout(master([shape('a', 0), text('b', ['Notes'])]));
    const slide = instantiate(l);

    const next = reapplyLayout(slide, layout(master([shape('a', 0)]), 2));

    expect(next.elements.map((e) => e.layoutElementId)).toEqual(['a', 'b']);
  });

  it('leaves an element alone when the master changed type under it', () => {
    const l = layout(master([text('a', ['Hello'])]));
    const slide = instantiate(l);

    const swapped = layout(master([shape('a', 700)]), 2);
    const next = reapplyLayout(slide, swapped);

    // The author's text element survives untouched...
    expect(next.elements[0].type).toBe('text');
    expect(next.elements[0].rect.x).toBe(0);
    // ...and the master's replacement arrives beside it instead.
    expect(next.elements[1].type).toBe('shape');
  });

  describe('adoptTextFormatting', () => {
    it('takes the master formatting and keeps the characters', () => {
      const l = layout(
        master([text('t', ['Placeholder'], { body: { paragraphs: [{ runs: [{ text: 'Placeholder', sizePt: 12 }] }] } } as never)]),
      );
      const slide = instantiate(l);
      (slide.elements[0] as TextElement).body.paragraphs = [
        { runs: [{ text: 'Real title', sizePt: 40 }] },
      ] as never;

      const bigger = layout(
        master([text('t', ['Placeholder'], { body: { paragraphs: [{ runs: [{ text: 'Placeholder', sizePt: 28 }] }] } } as never)]),
        2,
      );
      const next = reapplyLayout(slide, bigger, { adoptTextFormatting: true });

      const run = (next.elements[0] as TextElement).body.paragraphs[0].runs[0] as {
        text: string;
        sizePt: number;
      };
      expect(run.text).toBe('Real title');
      expect(run.sizePt).toBe(28);
    });

    it('does not truncate the author to the master’s paragraph count', () => {
      const l = layout(master([text('t', ['One'])]));
      const slide = instantiate(l);
      (slide.elements[0] as TextElement).body.paragraphs = [
        { runs: [{ text: 'One' }] },
        { runs: [{ text: 'Two' }] },
        { runs: [{ text: 'Three' }] },
      ] as never;

      const next = reapplyLayout(slide, layout(master([text('t', ['One'])]), 2), {
        adoptTextFormatting: true,
      });

      const paras = (next.elements[0] as TextElement).body.paragraphs;
      expect(paras.map((p) => p.runs[0].text)).toEqual(['One', 'Two', 'Three']);
    });

    it('is off by default', () => {
      const l = layout(master([text('t', ['x'], { body: { paragraphs: [{ runs: [{ text: 'x', sizePt: 12 }] }] } } as never)]));
      const slide = instantiate(l);
      (slide.elements[0] as TextElement).body.paragraphs = [
        { runs: [{ text: 'x', sizePt: 40 }] },
      ] as never;

      const next = reapplyLayout(
        slide,
        layout(master([text('t', ['x'], { body: { paragraphs: [{ runs: [{ text: 'x', sizePt: 28 }] }] } } as never)]), 2),
      );

      const run = (next.elements[0] as TextElement).body.paragraphs[0].runs[0] as { sizePt: number };
      expect(run.sizePt).toBe(40);
    });
  });
});
