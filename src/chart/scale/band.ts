/**
 * Band scale — categories to positions along the category axis.
 *
 * Gap and overlap are PowerPoint's, not our own invention, because authors
 * round-trip these charts through PowerPoint and expect the same knobs:
 *
 * - `gapWidthPct` 150 means the space between category groups is 1.5× the
 *   width of one bar.
 * - `overlapPct` is how much bars inside a group overlap: -27 is PowerPoint's
 *   clustered default (a small gap between bars), 100 stacks them exactly.
 */

export interface BandScale {
  /** Center of a category group, 0..1 along the axis. */
  center(i: number): number;
  /** Full width of one category group, as a fraction of the axis. */
  bandWidth: number;
  /** Width of one bar within a group, as a fraction of the axis. */
  barWidth: number;
  /** Left edge of series `s` within category `i`, 0..1. */
  barStart(i: number, s: number): number;
}

export interface BandOptions {
  count: number;
  /** Bars per category. Stacked charts pass 1 — the stack IS the bar. */
  seriesCount: number;
  gapWidthPct: number;
  overlapPct: number;
}

export function bandScale({
  count,
  seriesCount,
  gapWidthPct,
  overlapPct,
}: BandOptions): BandScale {
  const n = Math.max(1, count);
  const s = Math.max(1, seriesCount);
  const bandWidth = 1 / n;

  // Solve for bar width from the gap ratio: one band holds `s` bars laid out
  // with `overlap` between them, plus a gap of `gap × barWidth`.
  const gap = Math.max(0, gapWidthPct) / 100;
  const overlap = Math.max(-100, Math.min(100, overlapPct)) / 100;
  const advance = 1 - overlap; // how far each successive bar steps over
  const spanInBars = 1 + (s - 1) * advance;
  const barWidth = (bandWidth / (spanInBars + gap)) * 1;

  const groupSpan = barWidth * spanInBars;

  return {
    bandWidth,
    barWidth,
    center: (i) => (i + 0.5) * bandWidth,
    barStart: (i, si) =>
      (i + 0.5) * bandWidth - groupSpan / 2 + si * barWidth * advance,
  };
}

/**
 * Variable-width bands, for Mekko: each column's width is proportional to its
 * weight. Returns fractions of the axis that sum to 1 minus the gaps.
 */
export function weightedBands(weights: number[], gapFraction = 0.01): { start: number; width: number }[] {
  const n = weights.length;
  if (!n) return [];
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0) || n;
  const gaps = gapFraction * Math.max(0, n - 1);
  const usable = Math.max(0, 1 - gaps);

  let x = 0;
  return weights.map((w, i) => {
    const width = (Math.max(0, w) / total) * usable;
    const start = x;
    x += width + (i < n - 1 ? gapFraction : 0);
    return { start, width };
  });
}
