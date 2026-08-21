import { beforeEach, describe, expect, it } from 'vitest';
import { defaultChartSpec, inchesToEmu, type Deck, type ShapeElement, type Slide } from '@/model';
import { loadDeck, useEditor } from './editorStore';

const RECT = { x: 0, y: 0, w: inchesToEmu(2), h: inchesToEmu(1) };
const STEP = inchesToEmu(0.1);

function shape(id: string, x = 0): ShapeElement {
  return { id, type: 'shape', preset: 'rect', rect: { ...RECT, x } };
}

function slide(id: string, elements: ShapeElement[]): Slide {
  return { id, elements };
}

function deck(): Deck {
  return {
    id: 'd1',
    title: 'T',
    slideSize: { w: 12_192_000, h: 6_858_000 },
    slides: [slide('s1', [shape('e1'), shape('e2', inchesToEmu(3))]), slide('s2', [])],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const s = () => useEditor.getState();
const elementsOn = (id: string) => s().deck.slides.find((sl) => sl.id === id)!.elements;

describe('object clipboard', () => {
  // The clipboard deliberately outlives a deck load — it's a scratch register,
  // and a copy from one deck pastes into the next — so tests clear it by hand.
  beforeEach(() => {
    loadDeck(deck());
    useEditor.setState({ clipboard: null });
  });

  it('cuts the selection off the slide and pastes it back', () => {
    s().select(['e1']);
    s().cutSelection();
    expect(elementsOn('s1').map((e) => e.id)).toEqual(['e2']);

    s().pasteClipboard();
    const pasted = elementsOn('s1').filter((e) => e.id !== 'e2');
    expect(pasted).toHaveLength(1);
    expect(s().selectedIds).toEqual(pasted.map((e) => e.id));
    // Back onto the slide it was cut from, so it steps clear of where it sat.
    expect(pasted[0]!.rect.x).toBe(STEP);
  });

  it('leaves the slide alone when there is nothing selected to cut', () => {
    s().clearSelection();
    s().cutSelection();
    expect(elementsOn('s1')).toHaveLength(2);
    expect(s().clipboard).toBeNull();
  });

  it('copies without removing, and each paste lands past the last', () => {
    s().select(['e1']);
    s().copySelection();
    s().pasteClipboard();
    s().pasteClipboard();

    const xs = elementsOn('s1')
      .filter((e) => e.id !== 'e1' && e.id !== 'e2')
      .map((e) => e.rect.x);
    expect(elementsOn('s1')).toHaveLength(4);
    expect(xs).toEqual([STEP, STEP * 2]);
  });

  it('pastes onto another slide in place, and outlives an undo of the cut', () => {
    s().select(['e1', 'e2']);
    s().cutSelection();
    s().undo();
    expect(elementsOn('s1')).toHaveLength(2);

    s().setCurrentSlide('s2');
    s().pasteClipboard();
    expect(elementsOn('s2').map((e) => e.rect.x)).toEqual([0, inchesToEmu(3)]);
  });

  it('pastes a chart as its OWN chart, not a second handle on the original', () => {
    s().insertChart(defaultChartSpec('column', 'stacked'));
    const chartId = s().currentSlide().charts![0]!.id;
    s().select(s().currentSlide().elements.filter((e) => e.chartRef).map((e) => e.id));
    s().copySelection();
    s().pasteClipboard();

    const charts = s().currentSlide().charts!;
    expect(charts).toHaveLength(2);
    expect(charts[1]!.id).not.toBe(chartId);
    // Every pasted element belongs to the new chart, so a recompile of the
    // original can't reach into the copy.
    expect(
      s()
        .currentSlide()
        .elements.filter((e) => s().selectedIds.includes(e.id))
        .every((e) => e.chartRef?.chartId === charts[1]!.id),
    ).toBe(true);
  });

  it("carries the author's brief onto the copy", () => {
    const spec = defaultChartSpec('column', 'stacked');
    spec.authorBrief = {
      v: 1,
      description: 'ARR by segment, last 8 quarters',
      subjectFrom: 'unknown',
      measure: 'ARR',
      measureFrom: 'stated',
      measures: ['ARR'],
      dimensionFrom: 'stated',
      dimension: 'segment',
      periodFrom: 'inferred',
      unitFrom: 'inferred',
      gaps: [],
    };
    s().insertChart(spec);
    s().select(s().currentSlide().elements.filter((e) => e.chartRef).map((e) => e.id));
    s().copySelection();
    s().pasteClipboard();

    // A pasted chart that lost its brief would silently fall back to guessing
    // its own measure off the picture.
    expect(s().currentSlide().charts![1]!.spec.authorBrief?.description).toBe(
      'ARR by segment, last 8 quarters',
    );
  });

  it('undoes a paste in one step', () => {
    s().select(['e1']);
    s().copySelection();
    s().pasteClipboard();
    s().undo();
    expect(elementsOn('s1').map((e) => e.id)).toEqual(['e1', 'e2']);
  });
});
