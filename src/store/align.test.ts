import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  inchesToEmu,
  type Deck,
  type ShapeElement,
  type Slide,
} from '@/model';
import { DEFAULT_MARGINS } from '@/model/layout';
import { insertChartInto } from './chartActions';
import { loadDeck, useEditor } from './editorStore';

const SIZE = { w: 12_192_000, h: 6_858_000 };
const CHART_FRAME = { x: inchesToEmu(4), y: inchesToEmu(2), w: inchesToEmu(6), h: inchesToEmu(4) };
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

  it('walks on up to the title top guide and then the slide top', () => {
    s().align('top');
    expect(rectOf('e1').y).toBe(DEFAULT_MARGINS.contentTop);
    s().align('top');
    expect(rectOf('e1').y).toBe(DEFAULT_MARGINS.top);
    s().align('top');
    expect(rectOf('e1').y).toBe(0);
    s().align('top'); // nothing further up — stops dead
    expect(rectOf('e1').y).toBe(0);
  });

  it('takes the top margin guide going up, rather than dropping to content-top', () => {
    // Sitting between the two top guides, ⌘↑ must go UP to the nearer one. The
    // content-top guide is below it, and a press on the up arrow that moves the
    // object down reads as a bug however "canonical" that guide is.
    const mid = Math.round((DEFAULT_MARGINS.top + DEFAULT_MARGINS.contentTop) / 2);
    loadDeck(deck([shape('e1', { y: mid })]));
    s().select(['e1']);
    s().align('top');
    expect(rectOf('e1').y).toBe(DEFAULT_MARGINS.top);
    s().align('top');
    expect(rectOf('e1').y).toBe(0);
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

  it('lands on the guide in one press from outside it', () => {
    // Overhanging the left guide: the old walk parked it on the guide's far
    // side first. One press now — the guide itself, not an intermediate stop.
    loadDeck(deck([shape('e1', { x: -inchesToEmu(1) })]));
    s().select(['e1']);
    s().align('left');
    expect(rectOf('e1').x).toBe(DEFAULT_MARGINS.left);
    // …and only then does it carry on to the slide edge.
    s().align('left');
    expect(rectOf('e1').x).toBe(0);
    s().align('left');
    expect(rectOf('e1').x).toBe(0);
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

describe('align, a chart selected', () => {
  /** A chart's parts are one group, so a click on it selects all of them. */
  function withChart() {
    const slide: Slide = { id: 's1', elements: [] };
    insertChartInto(slide, defaultChartSpec('column'), CHART_FRAME, DEFAULT_DESIGN_SYSTEM);
    loadDeck({ ...deck([]), slides: [slide] });
    const ids = s().deck.slides[0].elements.filter((e) => e.chartRef).map((e) => e.id);
    s().select(ids);
    return ids;
  }
  const frame = () => s().deck.slides[0].charts![0].frame;

  it('carries the chart FRAME along with its parts', () => {
    // The elements are only a rendering of the frame: a frame left behind puts
    // the chart back where it was the moment anything recompiles it.
    const ids = withChart();
    const partX = () => Math.min(...s().deck.slides[0].elements.filter((e) => ids.includes(e.id)).map((e) => e.rect.x));
    const before = { frame: frame().x, part: partX() };
    s().align('left');
    expect(frame().x - before.frame).toBe(partX() - before.part);
    expect(frame().x).toBeLessThan(before.frame);
  });

  it('moves it as ONE unit, not part by part', () => {
    const ids = withChart();
    const spread = () => {
      const rects = s().deck.slides[0].elements.filter((e) => ids.includes(e.id)).map((e) => e.rect);
      return Math.max(...rects.map((r) => r.x)) - Math.min(...rects.map((r) => r.x));
    };
    const before = spread();
    s().align('left');
    expect(spread()).toBe(before);
  });
});
