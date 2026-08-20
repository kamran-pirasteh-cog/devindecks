import { describe, expect, it } from 'vitest';
import { inchesToEmu } from '@/model';
import type { Rect } from '@/model';
import { liveFitRect } from './liveFit';

const box: Rect = {
  x: inchesToEmu(1),
  y: inchesToEmu(2),
  w: inchesToEmu(4),
  h: inchesToEmu(1),
};

describe('liveFitRect', () => {
  it('grows a box that no longer holds its text, top edge pinned', () => {
    const fit = liveFitRect(box, inchesToEmu(2));
    expect(fit).not.toBeNull();
    expect(fit!.y).toBe(box.y);
    expect(fit!.h).toBe(inchesToEmu(2));
    expect(fit!.w).toBe(box.w);
    expect(fit!.x).toBe(box.x);
  });

  it('leaves an authored box alone while the text still fits', () => {
    expect(liveFitRect(box, inchesToEmu(0.5))).toBeNull();
    expect(liveFitRect(box, inchesToEmu(0.5), { autofit: 'none' })).toBeNull();
  });

  it("shrinks back only when the box IS the text's size", () => {
    const fit = liveFitRect(box, inchesToEmu(0.5), { autofit: 'resize' });
    expect(fit!.h).toBe(inchesToEmu(0.5));
    expect(fit!.y).toBe(box.y);
  });

  it('declines to resize a box whose TEXT is what gives', () => {
    expect(liveFitRect(box, inchesToEmu(3), { autofit: 'shrink' })).toBeNull();
  });

  it('grows upward from a bottom-anchored box, so the last line stays put', () => {
    const fit = liveFitRect(box, inchesToEmu(2), { anchor: 'bottom' });
    expect(fit!.h).toBe(inchesToEmu(2));
    expect(fit!.y + fit!.h).toBe(box.y + box.h);
  });

  it('grows from both edges of a middle-anchored box', () => {
    const fit = liveFitRect(box, inchesToEmu(2), { anchor: 'middle' });
    expect(fit!.y + fit!.h / 2).toBe(box.y + box.h / 2);
  });

  it('grows along a turned box own downward axis', () => {
    const fit = liveFitRect(box, inchesToEmu(2), { rotation: 90 });
    // Turned a quarter turn clockwise, "down the box" points slide-left: the
    // centre moves in x, not y.
    expect(fit!.h).toBe(inchesToEmu(2));
    const grew = inchesToEmu(1) / 2;
    expect(fit!.x + fit!.w / 2).toBe(box.x + box.w / 2 - grew);
    expect(fit!.y + fit!.h / 2).toBe(box.y + box.h / 2);
  });

  it('ignores sub-tolerance measurement noise', () => {
    expect(liveFitRect(box, box.h + 40, { autofit: 'resize', tolerance: 100 })).toBeNull();
    expect(liveFitRect(box, box.h + 400, { autofit: 'resize', tolerance: 100 })).not.toBeNull();
  });

  it('ignores an unmeasurable body', () => {
    expect(liveFitRect(box, 0, { autofit: 'resize' })).toBeNull();
  });
});
