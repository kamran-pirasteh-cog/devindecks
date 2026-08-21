import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  SLIDE_16x9,
  emuToInches,
  inchesToEmu,
  token,
  type Slide,
  type SlideElement,
  type TextElement,
} from '@/model';
import {
  QUICK_FURNITURE_ROLE,
  QUICK_LAYOUTS,
  applyQuickLayoutTo,
  quickLayout,
  slideTitle,
} from './quickLayout';

const ds = DEFAULT_DESIGN_SYSTEM;
const size = SLIDE_16x9;

const def = (id: string) => {
  const d = quickLayout(id);
  if (!d) throw new Error(`no quick layout ${id}`);
  return d;
};

/** A slide's title box after a layout has landed — the one thing every one has. */
const titleBox = (s: Slide) => {
  const el = s.elements.find((e) => e.role === 'title') as TextElement | undefined;
  if (!el) throw new Error('no title on the slide');
  return el;
};
const words = (el: TextElement) =>
  el.body.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('');
const sizes = (el: TextElement) =>
  el.body.paragraphs.flatMap((p) => p.runs.map((r) => r.sizePt));
/** The colour of the first run that actually says something. */
const ink = (el: TextElement) =>
  el.body.paragraphs.flatMap((p) => p.runs).find((r) => r.text.trim())?.color;
const pictures = (s: Slide) => s.elements.filter((el) => el.type === 'picture');
const furniture = (s: Slide) => s.elements.filter((el) => el.role === QUICK_FURNITURE_ROLE);

function text(
  id: string,
  role: string | undefined,
  copy: string,
  opts: { y?: number; sizePt?: number } = {},
): TextElement {
  return {
    id,
    type: 'text',
    role,
    rect: { x: 0, y: inchesToEmu(opts.y ?? 0.5), w: inchesToEmu(8), h: inchesToEmu(0.6) },
    body: {
      autofit: 'none',
      paragraphs: [{ runs: [{ text: copy, sizePt: opts.sizePt ?? 34, color: token('ink.strong') }] }],
    },
  };
}

const slide = (elements: SlideElement[] = []): Slide => ({ id: 's1', elements });
const apply = (s: Slide, id: string) => applyQuickLayoutTo(s, def(id), ds, size);

describe('quick layouts', () => {
  it('every layout finds its slot on the deck slide it is lifted from', () => {
    for (const l of QUICK_LAYOUTS) {
      const s = slide();
      applyQuickLayoutTo(s, l, ds, size);
      // The deck's own copy comes with it — that is what tells an author the
      // register the box is written in.
      expect(words(titleBox(s)).trim().length, l.id).toBeGreaterThan(0);
    }
  });

  it('casts a cover as the deck sets it: light ground, texture, lockup, 64pt title', () => {
    const s = slide();
    apply(s, 'title');

    expect(s.background).toEqual({ kind: 'solid', color: { kind: 'hex', hex: '#FCFCFC' } });
    // The full-bleed texture and the logo lockup.
    expect(pictures(s)).toHaveLength(2);
    expect(sizes(titleBox(s))).toContain(64);
    // The eyebrow above the title is the layout's, in the box the deck put it.
    expect(words(titleBox(s))).toContain('COGNITION TRANSFORMATION PARTNERSHIP');
  });

  it('casts the dark divider with its badge and its statement low on the page', () => {
    const s = slide();
    apply(s, 'section-dark');

    expect(s.background).toEqual({ kind: 'solid', color: token('ink.strong') });
    const badge = s.elements.find(
      (el) => el.type === 'shape' && el.fill?.kind === 'solid' && el.fill.color.kind === 'hex' && el.fill.color.hex === '#F4E79F',
    );
    expect(badge).toBeDefined();
    expect(sizes(titleBox(s))).toContain(41.3);
    expect(emuToInches(titleBox(s).rect.y)).toBeGreaterThan(4);
  });

  it("puts the light divider on the cover's ground, statement and all", () => {
    const s = slide();
    apply(s, 'section-light');

    expect(s.background).toEqual({ kind: 'solid', color: { kind: 'hex', hex: '#FCFCFC' } });
    // The cover's light art, not the divider's dark texture.
    expect(pictures(s)).toHaveLength(1);
    // The deck's near-white statement would vanish here, so it is re-inked.
    expect(ink(titleBox(s))).toEqual(token('ink.strong'));
    // The badge is black type on gold: read against the chip, not the slide.
    const label = s.elements.find(
      (el) => el.type === 'text' && words(el as TextElement).includes('next question'),
    ) as TextElement;
    expect(ink(label)).toEqual(token('ink.strong'));
  });

  it('takes only the title box from a content slide, not the story on it', () => {
    const light = slide();
    apply(light, 'content-light');
    expect(light.elements).toHaveLength(1);
    expect(sizes(titleBox(light))).toContain(34.7);
    expect(emuToInches(titleBox(light).rect.y)).toBeLessThan(1);

    const dark = slide();
    apply(dark, 'content-dark');
    expect(dark.elements).toHaveLength(1);
    expect(dark.background).toEqual({ kind: 'solid', color: { kind: 'hex', hex: '#0B0B0B' } });
    expect(ink(titleBox(dark))).toEqual(token('surface.base'));
  });

  it("moves the slide's own title into the layout's setting, and only once", () => {
    const s = slide([text('t1', 'title', 'Where the value showed up')]);
    apply(s, 'content-light');

    expect(s.elements.filter((el) => el.role === 'title')).toHaveLength(1);
    expect(words(titleBox(s))).toBe('Where the value showed up');
    // The template's type, not the 34pt the box carried.
    expect(sizes(titleBox(s))).toEqual([34.7]);
    expect(s.elements.find((el) => el.id === 't1')).toBeUndefined();
  });

  it('finds a role-less title by where it hangs, so replicas re-cast cleanly', () => {
    const s = slide([
      text('big', undefined, 'The imported title', { y: 0.62, sizePt: 34.7 }),
      text('small', undefined, 'A LABEL', { y: 0.9, sizePt: 9 }),
    ]);
    expect(slideTitle(s)?.id).toBe('big');

    apply(s, 'section-dark');
    expect(words(titleBox(s))).toBe('The imported title');
    // The little label is the author's; it stays where they put it.
    expect(s.elements.some((el) => el.id === 'small')).toBe(true);
  });

  it('swaps one layout for the next instead of stacking them', () => {
    const s = slide([text('t1', 'title', 'A statement')]);
    apply(s, 'title');
    const brought = furniture(s).length;
    expect(brought).toBeGreaterThan(0);

    apply(s, 'title');
    expect(furniture(s)).toHaveLength(brought);

    apply(s, 'section-dark');
    // The divider's dark texture, in the two offset copies the deck carries.
    expect(pictures(s)).toHaveLength(2);
    expect(words(titleBox(s))).toBe('A statement');
    expect(s.background).toEqual({ kind: 'solid', color: token('ink.strong') });
  });

  it("leaves the author's own work on the slide, re-inked for the new ground", () => {
    const body = text('b1', undefined, 'A supporting line', { y: 3, sizePt: 14 });
    const accent = text('a1', undefined, 'Accented', { y: 4, sizePt: 14 });
    accent.body.paragraphs[0].runs[0].color = token('brand.accent');
    const s = slide([body, accent]);

    apply(s, 'content-dark');

    expect(ink(s.elements.find((el) => el.id === 'b1') as TextElement)).toEqual(
      token('surface.base'),
    );
    expect(ink(s.elements.find((el) => el.id === 'a1') as TextElement)).toEqual(
      token('brand.accent'),
    );
  });

  it('leaves chart-owned text to the chart', () => {
    const part = text('c1', undefined, 'Series label', { y: 3, sizePt: 12 });
    part.chartRef = { chartId: 'ch1', part: 'title' };
    const s = slide([part]);

    apply(s, 'content-dark');
    expect(ink(s.elements.find((el) => el.id === 'c1') as TextElement)).toEqual(
      token('ink.strong'),
    );
  });

  it("never brings the deck's literal page-number field along", () => {
    const s = slide();
    apply(s, 'section-dark');
    expect(s.elements.some((el) => el.type === 'text' && words(el as TextElement).includes('‹#›'))).toBe(
      false,
    );
  });
});
