/**
 * How many category ticks an axis WRITES, out of the ones it has.
 *
 * The value axis has always chosen its own tick count from the space it was
 * given (`maxTicksFor`), because it invents its own numbers. The category axis
 * can't invent anything — it has the categories it has — so its only lever is
 * to write every nth one. Without that lever a line over ninety days renders
 * ninety labels on top of each other, which is the one axis failure that makes
 * a chart look broken rather than merely tight.
 *
 * Two rules, in this order:
 *
 * 1. **Nothing may touch its neighbour.** The minimum stride is the smallest
 *    one where every surviving pair clears, measured on the labels actually
 *    kept — not on an average, because "Dec-24" and "1/7" are not the same
 *    width and the widest pair is the one that collides.
 * 2. **A dated axis strides in its own units.** Every 5th day is arithmetic;
 *    every 7th is a week, and reads as one — the same label on the same weekday
 *    down the axis. So a dated axis rounds its stride UP to the next step on
 *    its grain's ladder, and an undated one (product names, segments) takes the
 *    minimum as-is because there is nothing to round to.
 *
 * The stride is a function of the plot's extent, so it re-solves whenever the
 * chart is resized: widen a chart and the labels come back on their own.
 */
import type { EMU } from '@/model';
import type { DateGrain } from '@/model';

/**
 * The strides that read as a unit, per grain.
 *
 * Days go 1, 2, weekly, fortnightly, then roughly monthly and quarterly; weeks
 * go weekly, fortnightly, four-weekly, then quarter- and half-yearly. The
 * approximations (28 days for a month, 91 for a quarter) are deliberate: the
 * labels are drawn from the categories the sheet holds, and a stride is a count
 * of rows, not a calendar walk.
 */
export const STRIDE_LADDER: Record<DateGrain, number[]> = {
  day: [1, 2, 7, 14, 28, 91, 182, 364],
  week: [1, 2, 4, 13, 26, 52],
  month: [1, 2, 3, 6, 12, 24, 60],
  quarter: [1, 2, 4, 8, 20, 40],
  half: [1, 2, 4, 10, 20],
  year: [1, 2, 5, 10, 25, 50],
};

export interface StrideInput {
  /** 0..1 centre of each category along the category axis. */
  centers: number[];
  /** The plot's extent along that axis. */
  extentEmu: EMU;
  /** What label `i` costs along the axis, including the room it wants beside it. */
  sizeEmu: (i: number) => EMU;
  /** The axis's grain, when it is dated — see rule 2. */
  grain?: DateGrain | null;
}

/**
 * Write every nth category label. 1 means every one.
 *
 * Returns at most `centers.length`, so the answer always leaves the first label
 * standing: an axis with one label is tight, an axis with none is a bug.
 */
export function categoryLabelStride(input: StrideInput): number {
  const { centers, extentEmu, sizeEmu, grain } = input;
  const n = centers.length;
  if (n < 2 || extentEmu <= 0) return 1;

  const clears = (stride: number): boolean => {
    for (let a = 0; a + stride < n; a += stride) {
      const b = a + stride;
      const apart = Math.abs((centers[b] ?? 0) - (centers[a] ?? 0)) * extentEmu;
      if (apart < (sizeEmu(a) + sizeEmu(b)) / 2) return false;
    }
    return true;
  };

  let min = 1;
  while (min < n && !clears(min)) min++;
  if (min === 1) return 1;

  const ladder = grain ? STRIDE_LADDER[grain] : null;
  if (!ladder) return min;
  // Round up to the next step that reads as a unit — but never past the axis:
  // a ladder rung wider than the data would drop every label but the first.
  const nice = ladder.find((s) => s >= min && s < n);
  return nice ?? min;
}
