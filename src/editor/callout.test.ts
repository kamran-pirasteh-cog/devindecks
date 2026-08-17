import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, inchesToEmu, isShape, isText, resolveColor } from '@/model';
import {
  CALLOUT_PARTS,
  DEFAULT_CALLOUT_OPTIONS,
  calloutHeightIn,
  isLightFill,
  makeCallout,
} from './callout';

const ds = DEFAULT_DESIGN_SYSTEM;

describe('makeCallout', () => {
  it('returns a box under a text box, grouped together', () => {
    const [box, text] = makeCallout(ds, DEFAULT_CALLOUT_OPTIONS);
    expect(isShape(box)).toBe(true);
    expect(isText(text)).toBe(true);
    const gid = box.groupIds?.[0];
    expect(gid).toBeTruthy();
    expect(text.groupIds).toEqual([gid]);
    // Text sits inside the box, not on top of its edges.
    expect(text.rect.x).toBeGreaterThan(box.rect.x);
    expect(text.rect.x + text.rect.w).toBeLessThan(box.rect.x + box.rect.w);
  });

  it('rounds or squares the corners on request', () => {
    const [round] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, corners: 'round' });
    const [square] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, corners: 'square' });
    expect(isShape(round) && round.preset).toBe('roundRect');
    expect(isShape(square) && square.preset).toBe('rect');
  });

  it('fills with the chosen token', () => {
    const [box] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, fillToken: 'brand.accent' });
    expect(isShape(box) && box.fill).toEqual({
      kind: 'solid',
      color: { kind: 'token', token: 'brand.accent' },
    });
  });

  it('stacks the chosen parts in canonical order, whatever order they were picked', () => {
    const [, text] = makeCallout(ds, {
      ...DEFAULT_CALLOUT_OPTIONS,
      parts: ['subtitle', 'eyebrow', 'number'],
    });
    const sizes = isText(text) ? text.body.paragraphs.map((p) => p.runs[0].sizePt) : [];
    expect(sizes).toEqual([ds.type.caption.sizePt, ds.type.kpiValue.sizePt, ds.type.body.sizePt]);
  });

  it('flips the type to light on a dark box and back on a light one', () => {
    const onDark = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, fillToken: 'brand.primary' })[1];
    const onLight = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, fillToken: 'surface.subtle' })[1];
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
    const [box, text] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, parts });
    const typeIn = calloutHeightIn(parts, ds) - 0.6; // both pads
    expect(text.rect.h).toBeGreaterThanOrEqual(inchesToEmu(typeIn) - 1);
    expect(text.rect.y + text.rect.h).toBeLessThanOrEqual(box.rect.y + box.rect.h);
  });

  it('never inserts a text box with no paragraphs', () => {
    const [, text] = makeCallout(ds, { ...DEFAULT_CALLOUT_OPTIONS, parts: [] });
    expect(isText(text) && text.body.paragraphs.length).toBe(1);
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
