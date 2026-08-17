import { describe, expect, it } from 'vitest';
import { nearestLegendSide } from './ChartPartOverlay';

/** A chart twice as wide as it is tall — the shape that breaks a pixel test. */
const WIDE = { x: 100, y: 100, w: 400, h: 200 };

describe('nearestLegendSide', () => {
  it('picks the edge the pointer is nearest', () => {
    expect(nearestLegendSide(WIDE, 300, 110)).toBe('top');
    expect(nearestLegendSide(WIDE, 300, 290)).toBe('bottom');
    expect(nearestLegendSide(WIDE, 110, 200)).toBe('left');
    expect(nearestLegendSide(WIDE, 490, 200)).toBe('right');
  });

  it('measures in proportion, not in pixels', () => {
    // 60px above the centre of a 200-tall chart is 60% of the way to the top
    // edge; the same 60px sideways is only 30% of the way to the left one. In
    // raw pixels the two distances tie and the drop is a coin flip.
    expect(nearestLegendSide(WIDE, 240, 140)).toBe('top');
  });

  it('sends the dead centre to the bottom rather than to a side', () => {
    // A legend is wide and short: a tie costs the plot least below it.
    expect(nearestLegendSide(WIDE, 300, 200)).toBe('bottom');
  });

  it('drops into the chart body when the pointer is well inside it', () => {
    // The band is 40px on this frame, so anything past x=140 / y=140 is inside.
    // Left and right halves of the inside's top half are the two corners.
    expect(nearestLegendSide(WIDE, 200, 160)).toBe('insideTopLeft');
    expect(nearestLegendSide(WIDE, 400, 160)).toBe('insideTopRight');
  });

  it('leaves the lower half of the inside to the edges', () => {
    // An inside legend is always top-aligned, so a target down here would light
    // up nowhere near where the legend lands — and this is the airspace a drag
    // heading for the bottom edge passes through.
    expect(nearestLegendSide(WIDE, 280, 220)).toBe('bottom');
  });

  it('survives a zero-sized frame', () => {
    // A chart can be mid-insert or collapsed; the drag must still resolve to
    // something rather than dividing by zero.
    expect(nearestLegendSide({ x: 0, y: 0, w: 0, h: 0 }, 0, 0)).toBe('bottom');
  });
});
