import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, DEFAULT_MARGINS, SLIDE_16x9 } from '@/model';
import type { SlideElement, TextElement } from '@/model';
import { inRect, titleBandPx, titleElement, titleSlotAction } from './titleSlot';
import { makeTitle } from './factories';

const ds = DEFAULT_DESIGN_SYSTEM;

const text = (role: string, words: string): TextElement => ({
  id: `t-${role}-${words.length}`,
  type: 'text',
  role,
  rect: { x: 0, y: 0, w: 100, h: 100 },
  body: { paragraphs: [{ runs: [{ text: words, font: 'Geist', sizePt: 24 }] }] },
});

describe('titleSlotAction', () => {
  it('offers to add a title to a slide that has none', () => {
    expect(titleSlotAction([])).toBe('add');
    expect(titleSlotAction([text('body', 'Just some prose')])).toBe('add');
  });

  it('leaves a titled slide alone — either type role counts', () => {
    expect(titleSlotAction([text('title', 'Q4 in review')])).toBe('none');
    expect(titleSlotAction([text('heading', 'Where things stand')])).toBe('none');
  });

  it('re-opens a title box that was added and never typed into', () => {
    expect(titleSlotAction([text('title', '')])).toBe('edit');
    expect(titleSlotAction([text('title', '   ')])).toBe('edit');
  });

  it('finds the title element itself', () => {
    const t = text('title', 'Q4 in review');
    const els: SlideElement[] = [text('body', 'prose'), t];
    expect(titleElement(els)?.id).toBe(t.id);
    expect(titleElement([text('body', 'prose')])).toBeUndefined();
  });
});

describe('titleBandPx', () => {
  it('is the top-left of the safe area, scaled to the canvas', () => {
    const band = titleBandPx(SLIDE_16x9, 0.5);
    expect(band.x).toBeCloseTo(DEFAULT_MARGINS.left * 0.5);
    expect(band.y).toBeCloseTo(DEFAULT_MARGINS.top * 0.5);
    expect(band.h).toBeCloseTo((DEFAULT_MARGINS.contentTop - DEFAULT_MARGINS.top) * 0.5);
    // Reaches the right margin, and stops short of the content guide.
    expect(band.x + band.w).toBeCloseTo((SLIDE_16x9.w - DEFAULT_MARGINS.right) * 0.5);
  });

  it('contains points in the band and nothing below it', () => {
    const band = titleBandPx(SLIDE_16x9, 0.5);
    expect(inRect(band, band.x + 5, band.y + 5)).toBe(true);
    expect(inRect(band, band.x - 5, band.y + 5)).toBe(false);
    expect(inRect(band, band.x + 5, band.y + band.h + 5)).toBe(false);
  });
});

describe('makeTitle', () => {
  it('lands in the title band, spanning the safe area', () => {
    const t = makeTitle(ds, SLIDE_16x9);
    expect(t.role).toBe('title');
    expect(t.rect.x).toBe(DEFAULT_MARGINS.left);
    expect(t.rect.y).toBe(DEFAULT_MARGINS.top);
    expect(t.rect.x + t.rect.w).toBe(SLIDE_16x9.w - DEFAULT_MARGINS.right);
    expect(t.rect.h).toBeLessThanOrEqual(DEFAULT_MARGINS.contentTop - DEFAULT_MARGINS.top);
  });

  it('carries the brand title type on an empty run, so typing inherits it', () => {
    const run = makeTitle(ds, SLIDE_16x9).body.paragraphs[0].runs[0];
    expect(run.text).toBe('');
    expect(run.sizePt).toBe(ds.type.title.sizePt);
    expect(run.font).toBe(ds.type.title.font);
    expect(run.bold).toBe(ds.type.title.bold);
    // Medium is the title ladder's own face, and it only reaches the slide if
    // the role's weight rides along with the family.
    expect(run.weight).toBe(ds.type.title.weight);
    expect(run.color).toEqual({ kind: 'token', token: ds.type.title.colorToken });
  });

  it('reads as an untyped title slot, so the canvas re-opens it', () => {
    expect(titleSlotAction([makeTitle(ds, SLIDE_16x9)])).toBe('edit');
  });
});
