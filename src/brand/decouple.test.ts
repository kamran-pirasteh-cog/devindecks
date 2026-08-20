import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM } from '@/model/tokens';
import { inchesToEmu } from '@/model';
import { decoupleSlide, needsDecoupling, PANEL_ROLE, panelIsLight, textRectFor } from './decouple';
import { at, picture, shape, slide, text } from './testkit';

const ds = DEFAULT_DESIGN_SYSTEM;
const ids = () => {
  let n = 0;
  return (p: string) => `${p}_${(n += 1)}`;
};

describe('needsDecoupling', () => {
  it('yes for a filled shape with text', () => {
    expect(needsDecoupling(shape(at(1, 1, 3, 1), { fill: '#123456', label: 'hi' }))).toBe(true);
  });

  it('yes for an outlined shape with text', () => {
    expect(needsDecoupling(shape(at(1, 1, 3, 1), { outlineColor: '#123456', label: 'hi' }))).toBe(
      true,
    );
  });

  it('NO for an unfilled, unstroked shape with text — there is no panel to protect', () => {
    expect(needsDecoupling(shape(at(1, 1, 3, 1), { label: 'hi' }))).toBe(false);
  });

  it('no for a filled shape with no text', () => {
    expect(needsDecoupling(shape(at(1, 1, 3, 1), { fill: '#123456' }))).toBe(false);
  });

  it('no for a plain text element', () => {
    expect(needsDecoupling(text('hi', at(1, 1, 3, 1)))).toBe(false);
  });

  it('no for a picture', () => {
    expect(needsDecoupling(picture('data:X', at(1, 1, 3, 1)))).toBe(false);
  });

  it('never touches a chart’s own compiled shapes', () => {
    const part = {
      ...shape(at(1, 1, 3, 1), { fill: '#123456', label: 'bar' }),
      chartRef: { chartId: 'c1', part: 'series' } as never,
    };
    expect(needsDecoupling(part)).toBe(false);
  });
});

describe('textRectFor', () => {
  it('insets the text inside the panel', () => {
    const panel = at(1, 1, 4, 2);
    const inner = textRectFor(panel);
    expect(inner.x).toBeGreaterThan(panel.x);
    expect(inner.w).toBeLessThan(panel.w);
    expect(inner.y).toBeGreaterThan(panel.y);
    expect(inner.h).toBeLessThan(panel.h);
  });

  it('honours explicit insets when the panel had them', () => {
    const panel = at(1, 1, 4, 2);
    const insets = { l: inchesToEmu(0.5), t: 0, r: 0, b: 0 };
    expect(textRectFor(panel, insets).x).toBe(panel.x + insets.l);
  });

  it('never pads a thin bar out of existence', () => {
    // A 0.12in-tall coloured bar with a label on it.
    const bar = at(1, 1, 4, 0.12);
    const inner = textRectFor(bar);
    expect(inner.h).toBeGreaterThan(0);
    expect(inner.w).toBeGreaterThan(0);
  });
});

describe('decoupleSlide', () => {
  const card = () =>
    slide([
      text('Heading', at(0.9, 0.5, 8, 0.6), { sizePt: 28, id: 'h' }),
      shape(at(0.9, 2, 3, 1.5), { fill: '#1F3864', label: 'Revenue', id: 'panel' }),
    ]);

  it('produces a panel with no body, plus a separate text element', () => {
    const { slide: out, splits } = decoupleSlide(card(), ds, ids());
    expect(splits).toBe(1);
    const panel = out.elements.find((el) => el.id === 'panel')!;
    expect(panel.type).toBe('shape');
    expect(panel.type === 'shape' && panel.body).toBeUndefined();
    const label = out.elements.find(
      (el) => el.type === 'text' && el.body.paragraphs[0].runs[0].text === 'Revenue',
    );
    expect(label).toBeDefined();
  });

  it('the panel keeps its EXACT geometry', () => {
    const original = card();
    const rect = original.elements.find((el) => el.id === 'panel')!.rect;
    const { slide: out } = decoupleSlide(original, ds, ids());
    expect(out.elements.find((el) => el.id === 'panel')!.rect).toEqual(rect);
  });

  it('keeps the pair in one group, so they still select and drag together', () => {
    const { slide: out } = decoupleSlide(card(), ds, ids());
    const panel = out.elements.find((el) => el.id === 'panel')!;
    const label = out.elements.find((el) => el.type === 'text' && el.id !== 'h')!;
    expect(panel.groupIds).toBeDefined();
    expect(panel.groupIds).toEqual(label.groupIds);
  });

  it('reports the panel as frozen', () => {
    const { frozen } = decoupleSlide(card(), ds, ids());
    expect(frozen.has('panel')).toBe(true);
  });

  it('pins the split text to autofit: none', () => {
    // The reason `band.ts` gives: a measure pass must not resize one slot out
    // from under the next.
    const { slide: out } = decoupleSlide(card(), ds, ids());
    const label = out.elements.find((el) => el.type === 'text' && el.id !== 'h')!;
    expect(label.type === 'text' && label.body.autofit).toBe('none');
  });

  it('the text inherits the shape’s semantic role', () => {
    const withRole = slide([
      shape(at(1, 2, 3, 1), { fill: '#123456', label: 'KPI', role: 'kpiValue', id: 'p' }),
    ]);
    const { slide: out } = decoupleSlide(withRole, ds, ids());
    const label = out.elements.find((el) => el.type === 'text')!;
    expect(label.role).toBe('kpiValue');
  });

  it('stamps a panel with no role as PANEL_ROLE', () => {
    const { slide: out } = decoupleSlide(card(), ds, ids());
    expect(out.elements.find((el) => el.id === 'panel')!.role).toBe(PANEL_ROLE);
  });

  it('preserves an existing group rather than inventing a new one', () => {
    const grouped = slide([
      { ...shape(at(1, 2, 3, 1), { fill: '#123456', label: 'x', id: 'p' }), groupIds: ['g-outer'] },
    ]);
    const { slide: out } = decoupleSlide(grouped, ds, ids());
    for (const el of out.elements) expect(el.groupIds).toEqual(['g-outer']);
  });

  it('leaves everything else exactly as it was', () => {
    const original = card();
    const { slide: out } = decoupleSlide(original, ds, ids());
    expect(out.elements.find((el) => el.id === 'h')).toEqual(
      original.elements.find((el) => el.id === 'h'),
    );
  });

  it('does nothing to a slide with no filled text shapes', () => {
    const plain = slide([text('a', at(1, 2, 3, 1)), picture('data:X', at(1, 4, 3, 1))]);
    const { slide: out, splits, frozen } = decoupleSlide(plain, ds, ids());
    expect(splits).toBe(0);
    expect(frozen.size).toBe(0);
    expect(out.elements).toEqual(plain.elements);
  });

  it('is deterministic', () => {
    const input = card();
    const a = decoupleSlide(input, ds, ids());
    const b = decoupleSlide(input, ds, ids());
    expect(a.slide).toEqual(b.slide);
  });
});

describe('panelIsLight', () => {
  it('true for a pale panel', () => {
    expect(panelIsLight(shape(at(1, 1, 2, 1), { fill: '#F5F5F5' }), ds)).toBe(true);
  });

  it('false for a dark panel', () => {
    expect(panelIsLight(shape(at(1, 1, 2, 1), { fill: '#1F3864' }), ds)).toBe(false);
  });

  it('true for an unfilled shape — the slide behind it is presumed light', () => {
    expect(panelIsLight(shape(at(1, 1, 2, 1)), ds)).toBe(true);
  });

  it('resolves a TOKEN fill through the design system', () => {
    const tokened = {
      ...shape(at(1, 1, 2, 1)),
      fill: { kind: 'solid' as const, color: { kind: 'token' as const, token: 'ink.strong' } },
    };
    expect(panelIsLight(tokened, ds)).toBe(false);
  });
});
