import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, DEFAULT_MARGINS, SLIDE_16x9, inchesToEmu, token } from '@/model';
import type { Fill, SlideElement, TextElement } from '@/model';
import {
  EYEBROW_MARK_ROLE,
  EYEBROW_ROLE,
  eyebrowBlockHeight,
  eyebrowElement,
  eyebrowInk,
  eyebrowOrigin,
  eyebrowSlotAction,
  makeEyebrow,
  titleYUnderEyebrow,
} from './eyebrow';

const ds = DEFAULT_DESIGN_SYSTEM;

const text = (role: string, words: string, x = 0): TextElement => ({
  id: `t-${role}-${words.length}`,
  type: 'text',
  role,
  rect: { x, y: DEFAULT_MARGINS.top, w: 100, h: 100 },
  body: { paragraphs: [{ runs: [{ text: words, font: 'Geist', sizePt: 24 }] }] },
});

const make = (background?: Fill) =>
  makeEyebrow(ds, { x: DEFAULT_MARGINS.left, y: DEFAULT_MARGINS.top }, background, undefined, SLIDE_16x9);

describe('eyebrowSlotAction', () => {
  it('offers to add one to a slide that has none', () => {
    expect(eyebrowSlotAction([])).toBe('add');
    expect(eyebrowSlotAction([text('title', 'Q4 in review')])).toBe('add');
  });

  it('re-opens an eyebrow that was added and never typed into', () => {
    expect(eyebrowSlotAction([text(EYEBROW_ROLE, '')])).toBe('edit');
    expect(eyebrowSlotAction([text(EYEBROW_ROLE, '  ')])).toBe('edit');
  });

  it('leaves a slide that already has one alone', () => {
    expect(eyebrowSlotAction([text(EYEBROW_ROLE, 'WHY NOW')])).toBe('none');
  });

  it('finds the text half', () => {
    const e = text(EYEBROW_ROLE, 'WHY NOW');
    expect(eyebrowElement([text('title', 'T'), e])?.id).toBe(e.id);
  });
});

describe('eyebrowOrigin', () => {
  it('hangs off the safe area when the slide has no title', () => {
    expect(eyebrowOrigin([])).toEqual({ x: DEFAULT_MARGINS.left, y: DEFAULT_MARGINS.top });
  });

  it('takes the title’s left edge, so the two line up', () => {
    const x = inchesToEmu(0.9);
    expect(eyebrowOrigin([text('title', 'Q4', x)]).x).toBe(x);
    // 'heading' is the title on a content slide.
    expect(eyebrowOrigin([text('heading', 'Q4', x)]).x).toBe(x);
  });
});

describe('makeEyebrow', () => {
  it('is a square then the type, both left-anchored on the origin', () => {
    const [mark, body] = make();
    expect(mark.role).toBe(EYEBROW_MARK_ROLE);
    expect(body.role).toBe(EYEBROW_ROLE);
    // The MARK is what lines up with the title; the type sits right of it.
    expect(mark.rect.x).toBe(DEFAULT_MARGINS.left);
    expect(body.rect.x).toBeGreaterThan(mark.rect.x + mark.rect.w);
    // Square.
    expect(mark.rect.w).toBe(mark.rect.h);
    // Centred on the line of type rather than sitting on its top edge.
    expect(mark.rect.y).toBeGreaterThan(body.rect.y);
    expect(mark.rect.y + mark.rect.h).toBeLessThan(body.rect.y + body.rect.h);
    // One line of type, running to the right margin.
    expect(body.rect.y).toBe(DEFAULT_MARGINS.top);
    expect(body.rect.x + body.rect.w).toBe(SLIDE_16x9.w - DEFAULT_MARGINS.right);
  });

  it('arrives as one group, so a click grabs both halves', () => {
    const [mark, body] = make();
    expect(mark.groupIds?.length).toBe(1);
    expect(mark.groupIds).toEqual(body.groupIds);
  });

  it('is inserted empty, styled, and ready to type into', () => {
    const [, body] = make();
    expect(body.type).toBe('text');
    if (body.type !== 'text') return;
    const run = body.body.paragraphs[0].runs[0];
    expect(run.text).toBe('');
    expect(run.bold).toBe(true);
    expect(run.sizePt).toBe(ds.type.caption.sizePt);
    // A fixed frame: a fit pass must not shrink-wrap it off the mark's spacing.
    expect(body.body.autofit).toBe('none');
  });

  it('is brand blue on a light slide and white on a black one', () => {
    const onWhite = make({ kind: 'solid', color: token('surface.base') });
    const onBlack = make({ kind: 'solid', color: token('ink.strong') });
    const inkOf = (els: SlideElement[]) => {
      const [mark, body] = els;
      const fill = mark.type === 'shape' ? mark.fill : undefined;
      const run = body.type === 'text' ? body.body.paragraphs[0].runs[0] : undefined;
      return [fill?.kind === 'solid' ? fill.color : undefined, run?.color];
    };
    // Mark and type always match — the pair reads as one object.
    expect(inkOf(onWhite)).toEqual([token('brand.accent'), token('brand.accent')]);
    expect(inkOf(onBlack)).toEqual([token('surface.base'), token('surface.base')]);
  });

  it('treats a slide with no background of its own as light', () => {
    expect(eyebrowInk(undefined, ds)).toEqual(token('brand.accent'));
  });
});

describe('titleYUnderEyebrow', () => {
  it('pushes a title hanging in the band down by the eyebrow’s block', () => {
    const y = titleYUnderEyebrow(ds, DEFAULT_MARGINS.top);
    expect(y).toBe(DEFAULT_MARGINS.top + eyebrowBlockHeight(ds));
    // Slightly: the pair still clears the content guide.
    expect(y + inchesToEmu(0.45)).toBeLessThan(DEFAULT_MARGINS.contentTop);
  });

  it('leaves a title already clear of the eyebrow where it is', () => {
    const low = inchesToEmu(3.5);
    expect(titleYUnderEyebrow(ds, low)).toBe(low);
  });
});
