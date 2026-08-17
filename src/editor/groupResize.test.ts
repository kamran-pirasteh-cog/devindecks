import { describe, expect, it } from 'vitest';
import { resizeFactor } from './groupResize';

describe('resizeFactor', () => {
  it('scales by the live size when Moveable measures the box correctly', () => {
    expect(resizeFactor(200, 150, -50)).toBeCloseTo(0.75);
    expect(resizeFactor(200, 400, 200)).toBeCloseTo(2);
  });

  it('falls back to the delta when the live size comes back 0', () => {
    // The chart case: a group holding a chart reports height 0 every frame.
    expect(resizeFactor(200, 0, -50)).toBeCloseTo(0.75);
    expect(resizeFactor(200, 0, 100)).toBeCloseTo(1.5);
  });

  it('holds the axis still rather than collapsing it', () => {
    // Neither a size nor a delta that can be believed.
    expect(resizeFactor(200, 0, -200)).toBe(1);
    expect(resizeFactor(200, 0, -400)).toBe(1);
    expect(resizeFactor(0, 0, 50)).toBe(1);
  });
});
