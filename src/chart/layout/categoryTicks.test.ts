import { describe, expect, it } from 'vitest';
import { inchesToEmu, pointsToEmu } from '@/model';
import { categoryLabelStride } from './categoryTicks';

/** Evenly spaced categories, as a line or column chart lays them out. */
const evenly = (n: number) => Array.from({ length: n }, (_, i) => (n > 1 ? i / (n - 1) : 0.5));

const fixed = (emu: number) => () => emu;

describe('categoryLabelStride', () => {
  it('writes every label when they all clear', () => {
    expect(
      categoryLabelStride({
        centers: evenly(4),
        extentEmu: inchesToEmu(6),
        sizeEmu: fixed(pointsToEmu(30)),
      }),
    ).toBe(1);
  });

  it('thins until neighbours stop touching', () => {
    // 6in of plot, 40 labels: ~0.15in apart, each wanting 0.5in.
    const stride = categoryLabelStride({
      centers: evenly(40),
      extentEmu: inchesToEmu(6),
      sizeEmu: fixed(inchesToEmu(0.5)),
    });
    expect(stride).toBeGreaterThan(1);
    const apart = (inchesToEmu(6) / 39) * stride;
    expect(apart).toBeGreaterThanOrEqual(inchesToEmu(0.5));
  });

  it('comes back down as the chart widens', () => {
    const args = { centers: evenly(40), sizeEmu: fixed(inchesToEmu(0.4)) };
    const narrow = categoryLabelStride({ ...args, extentEmu: inchesToEmu(3) });
    const wide = categoryLabelStride({ ...args, extentEmu: inchesToEmu(12) });
    expect(wide).toBeLessThan(narrow);
  });

  it('measures the labels it keeps, not the average', () => {
    // Every third label is wide; the stride that lands on them has to clear
    // THEM, not the narrow ones between.
    const sizeEmu = (i: number) => (i % 3 === 0 ? inchesToEmu(1) : pointsToEmu(6));
    const stride = categoryLabelStride({
      centers: evenly(30),
      extentEmu: inchesToEmu(6),
      sizeEmu,
    });
    const apart = (inchesToEmu(6) / 29) * stride;
    for (let i = 0; i + stride < 30; i += stride) {
      expect(apart).toBeGreaterThanOrEqual((sizeEmu(i) + sizeEmu(i + stride)) / 2);
    }
    // A uniform axis of the NARROW label would have kept every one of them.
    expect(stride).toBeGreaterThan(1);
  });

  it('strides a daily axis by the week', () => {
    expect(
      categoryLabelStride({
        centers: evenly(90),
        extentEmu: inchesToEmu(6),
        sizeEmu: fixed(pointsToEmu(24)),
        grain: 'day',
      }),
    ).toBe(7);
  });

  it('strides a monthly axis by the quarter', () => {
    const stride = categoryLabelStride({
      centers: evenly(36),
      extentEmu: inchesToEmu(6),
      sizeEmu: fixed(pointsToEmu(36)),
      grain: 'month',
    });
    expect([3, 6]).toContain(stride);
  });

  it('never rounds a stride past the end of the axis', () => {
    const stride = categoryLabelStride({
      centers: evenly(10),
      extentEmu: inchesToEmu(1),
      sizeEmu: fixed(inchesToEmu(1)),
      grain: 'day',
    });
    expect(stride).toBeLessThan(10);
  });

  it('leaves a one-label axis alone', () => {
    expect(
      categoryLabelStride({ centers: [0.5], extentEmu: 0, sizeEmu: fixed(inchesToEmu(9)) }),
    ).toBe(1);
  });
});
