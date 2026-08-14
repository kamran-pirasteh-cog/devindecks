import { describe, expect, it } from 'vitest';
import type { ShapeElement, SlideElement } from '@/model';
import { detachChartElements, reconcileChartElements, stripChartElements } from './reconcile';

const shape = (id: string, x = 0, extra: Partial<ShapeElement> = {}): ShapeElement => ({
  id,
  type: 'shape',
  preset: 'rect',
  rect: { x, y: 0, w: 100, h: 100 },
  ...extra,
});

const ids = (els: SlideElement[]) => els.map((e) => e.id);

describe('reconcileChartElements', () => {
  it('leaves non-chart elements completely alone', () => {
    const before = [shape('title'), shape('c1::mark.s0.c0'), shape('logo')];
    const after = reconcileChartElements(before, 'c1', [shape('c1::mark.s0.c0', 50)]);
    expect(ids(after)).toEqual(['title', 'c1::mark.s0.c0', 'logo']);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it('never touches a sibling chart on the same slide', () => {
    const before = [shape('c1::mark.s0.c0'), shape('c2::mark.s0.c0', 7)];
    const after = reconcileChartElements(before, 'c1', [shape('c1::mark.s0.c0', 99)]);
    expect(after.find((e) => e.id === 'c2::mark.s0.c0')!.rect.x).toBe(7);
    expect(after.find((e) => e.id === 'c1::mark.s0.c0')!.rect.x).toBe(99);
  });

  it('patches survivors in place, holding their z-position', () => {
    const before = [shape('c1::a'), shape('other'), shape('c1::b')];
    const after = reconcileChartElements(before, 'c1', [shape('c1::b', 5), shape('c1::a', 9)]);
    // Order follows the SLIDE, not the compile output — z-order is preserved.
    expect(ids(after)).toEqual(['c1::a', 'other', 'c1::b']);
    expect(after[0].rect.x).toBe(9);
    expect(after[2].rect.x).toBe(5);
  });

  it('removes parts the new spec no longer produces', () => {
    const before = [shape('c1::a'), shape('c1::b'), shape('keep')];
    const after = reconcileChartElements(before, 'c1', [shape('c1::a')]);
    expect(ids(after)).toEqual(['c1::a', 'keep']);
  });

  it('inserts new parts inside the chart run, not at the end of the slide', () => {
    const before = [shape('c1::a'), shape('overlay')];
    const after = reconcileChartElements(before, 'c1', [shape('c1::a'), shape('c1::b')]);
    expect(ids(after)).toEqual(['c1::a', 'c1::b', 'overlay']);
  });

  it('inserts new parts in compile order so z-order is deterministic', () => {
    const after = reconcileChartElements([], 'c1', [shape('c1::x'), shape('c1::y'), shape('c1::z')]);
    expect(ids(after)).toEqual(['c1::x', 'c1::y', 'c1::z']);
  });

  it('is idempotent — recompiling unchanged output changes nothing', () => {
    const next = [shape('c1::a'), shape('c1::b')];
    const once = reconcileChartElements([shape('other'), ...next], 'c1', next);
    expect(reconcileChartElements(once, 'c1', next)).toEqual(once);
  });

  it("preserves the author's lock, which the compiler does not own", () => {
    const before = [shape('c1::a', 0, { locked: true })];
    const after = reconcileChartElements(before, 'c1', [shape('c1::a', 42)]);
    expect(after[0]).toMatchObject({ rect: { x: 42 }, locked: true });
  });

  it('handles a chart appearing on a slide that had none', () => {
    const after = reconcileChartElements([shape('title')], 'c1', [shape('c1::a')]);
    expect(ids(after)).toEqual(['title', 'c1::a']);
  });
});

describe('stripChartElements', () => {
  it('removes only the named chart', () => {
    const els = [shape('c1::a'), shape('c2::a'), shape('title')];
    expect(ids(stripChartElements(els, 'c1'))).toEqual(['c2::a', 'title']);
  });
});

describe('detachChartElements', () => {
  it('keeps the primitives but cuts them loose from the spec', () => {
    const els = [
      shape('c1::mark.s0.c0', 0, { chartRef: { chartId: 'c1', part: 'mark', series: 's0', point: 'c0' } }),
      shape('title'),
    ];
    const after = detachChartElements(els, 'c1');
    expect(after[0].chartRef).toBeUndefined();
    expect(after[0].rect).toEqual(els[0].rect);
    expect(after[1]).toBe(els[1]);
  });

  it('renames ids out of the chart namespace so a new chart cannot adopt them', () => {
    const after = detachChartElements([shape('c1::mark.s0.c0')], 'c1');
    expect(after[0].id).toBe('c1-mark.s0.c0');
    // And a later chart reusing the id "c1" no longer sees them as its own.
    expect(ids(reconcileChartElements(after, 'c1', [shape('c1::mark.s0.c0')]))).toEqual([
      'c1-mark.s0.c0',
      'c1::mark.s0.c0',
    ]);
  });
});
