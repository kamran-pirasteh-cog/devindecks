import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, inchesToEmu, isShape, isText, resolveColor, token } from '@/model';
import {
  CALLOUT_PARTS,
  DEFAULT_CALLOUT_OPTIONS,
  calloutHeightIn,
  isLightFill,
  makeCallout,
} from './callout';

const ds = DEFAULT_DESIGN_SYSTEM;

describe('makeCallout', () => {
  it('returns a box under one text box per slot, grouped together', () => {
    const [box, ...texts] = makeCallout(ds, DEFAULT_CALLOUT_OPTIONS);
    expect(isShape(box)).toBe(true);
    expect(texts).toHaveLength(DEFAULT_CALLOUT_OPTIONS.parts.length);
    expect(texts.every(isText)).toBe(true);
    const gid = box.groupIds?.[0];
    expect(gid).toBeTruthy();
    for (const text of texts) {
      expect(text.groupIds).toEqual([gid]);
      // Each slot carries its own line, not a stack of paragraphs.
      expect(isText(text) && text.body.paragraphs).toHaveLength(1);
      // Text sits inside the box, not on top of its edges.
      expect(text.rect.x).toBeGreaterThan(box.rect.x);
      expect(text.rect.x + text.rect.w).toBeLessThan(box.rect.x + box.rect.w);
    }
  });

  it('stacks the slot boxes top to bottom without overlapping', () => {
    const [, ...texts] = makeCallout(ds, {
      ...DEFAULT_CALLOUT_OPTIONS,
      parts: [...CALLOUT_PARTS],
    });
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i].rect.y).toBeGreaterThanOrEqual(texts[i - 1].rect.y + texts[i - 1].rect.h);
    }
  });

  it('rounds or squares the corners on request', () => {
    const [round] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, corners: 'round' });
    const [square] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, corners: 'square' });
    expect(isShape(round) && round.preset).toBe('roundRect');
    expect(isShape(square) && square.preset).toBe('rect');
  });

  it('fills with the chosen token', () => {
    const [box] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, fill: token('brand.accent') });
    expect(isShape(box) && box.fill).toEqual({
      kind: 'solid',
      color: { kind: 'token', token: 'brand.accent' },
    });
  });

  it('stacks the chosen parts in canonical order, whatever order they were picked', () => {
    const [, ...texts] = makeCallout(ds, {
      ...DEFAULT_CALLOUT_OPTIONS,
      parts: ['subtitle', 'eyebrow', 'number'],
    });
    const sizes = texts.map((t) => (isText(t) ? t.body.paragraphs[0].runs[0].sizePt : 0));
    expect(sizes).toEqual([ds.type.caption.sizePt, ds.type.kpiValue.sizePt, ds.type.body.sizePt]);
  });

  it('flips the type to light on a dark box and back on a light one', () => {
    const onDark = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, fill: token('ink.strong') })[1];
    const onLight = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, fill: token('surface.subtle') })[1];
    const first = (el: typeof onDark) => (isText(el) ? el.body.paragraphs[0].runs[0].color : null);
    expect(resolveColor(first(onDark)!, ds)).toBe('#FFFFFF');
    expect(resolveColor(first(onLight)!, ds)).not.toBe('#FFFFFF');
  });

  it('grows the box for each slot, keeping the type inside it', () => {
    const one = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, parts: ['number'] })[0];
    const all = makeCallout(ds, {
      ...DEFAULT_CALLOUT_OPTIONS,
      parts: ['eyebrow', 'number', 'title', 'subtitle'],
    })[0];
    expect(all.rect.h).toBeGreaterThan(one.rect.h);
    // Both stay centred on the same line, so ticking a slot on doesn't walk the
    // card down the slide.
    // Within an EMU — the two heights round independently.
    expect(Math.abs(one.rect.y + one.rect.h / 2 - (all.rect.y + all.rect.h / 2))).toBeLessThan(1);
  });

  it('leaves room for the tallest slot stack inside the padding', () => {
    const parts = [...CALLOUT_PARTS];
    const [box, ...texts] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, parts });
    const first = texts[0];
    const last = texts[texts.length - 1];
    const typeIn = calloutHeightIn(parts, ds) - 0.6; // both pads
    expect(last.rect.y + last.rect.h - first.rect.y).toBeGreaterThanOrEqual(
      inchesToEmu(typeIn) - 1,
    );
    expect(first.rect.y).toBeGreaterThanOrEqual(box.rect.y);
    expect(last.rect.y + last.rect.h).toBeLessThanOrEqual(box.rect.y + box.rect.h);
  });

  it('never inserts a card with no text box at all', () => {
    const [, ...texts] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, parts: [] });
    expect(texts).toHaveLength(1);
    expect(isText(texts[0]) && texts[0].body.paragraphs.length).toBe(1);
  });
});

describe('isLightFill', () => {
  it('splits dark brand ink from pale surfaces', () => {
    expect(isLightFill('#111111')).toBe(false);
    expect(isLightFill('#4F46E5')).toBe(false);
    expect(isLightFill('#FFFFFF')).toBe(true);
    expect(isLightFill('#F5F5F5')).toBe(true);
  });
});
