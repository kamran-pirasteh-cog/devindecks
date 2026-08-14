/**
 * Linear value scales and "nice" tick selection.
 *
 * Ticks land on 1 / 2 / 2.5 / 5 × 10ⁿ — the same ladder PowerPoint and Excel
 * climb, so a chart built here and a chart built there pick the same gridlines.
 * The domain is padded outward to the nearest tick rather than to the data, or
 * the tallest bar would touch the top of the plot with no headroom for its
 * label.
 */

export interface LinearScale {
  min: number;
  max: number;
  ticks: number[];
  step: number;
  /** value -> 0..1 along the axis. */
  norm(v: number): number;
  /** 0..1 -> value. The inverse is what makes drag-a-bar-to-edit possible. */
  invert(t: number): number;
}

/** The 1/2/2.5/5 ladder, as multipliers of a power of ten. */
const STEPS = [1, 2, 2.5, 5, 10];

/** The smallest nice step that yields at most `maxTicks` intervals. */
export function niceStep(span: number, maxTicks: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const rough = span / Math.max(1, maxTicks);
  const mag = 10 ** Math.floor(Math.log10(rough));
  for (const s of STEPS) {
    if (mag * s >= rough) return mag * s;
  }
  return mag * 10;
}

export interface NiceDomainOptions {
  /** Force the axis to include zero. Bar charts must; line charts needn't. */
  includeZero?: boolean;
  /** Target tick count; the step ladder means the result is approximate. */
  maxTicks?: number;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Round a data range outward to nice bounds.
 *
 * Explicit `min`/`max`/`step` win over anything derived — an author who pins an
 * axis meant it, even when the data later exceeds it.
 */
export function niceDomain(values: number[], opts: NiceDomainOptions = {}): LinearScale {
  const maxTicks = opts.maxTicks ?? 5;
  const finite = values.filter((v) => Number.isFinite(v));

  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 1;
  if (opts.includeZero !== false) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  // A flat series has zero span; give it something to be drawn against.
  if (lo === hi) {
    if (lo === 0) {
      hi = 1;
    } else {
      const pad = Math.abs(lo) * 0.1;
      lo -= pad;
      hi += pad;
    }
  }

  const step = opts.step ?? niceStep(hi - lo, maxTicks);
  const min = opts.min ?? Math.floor(lo / step) * step;
  const max = opts.max ?? Math.ceil(hi / step) * step;

  return makeScale(min, max, step);
}

export function makeScale(min: number, max: number, step: number): LinearScale {
  const span = max - min || 1;
  const ticks: number[] = [];
  if (step > 0) {
    // Accumulate by index, not by repeated addition — 0.1 + 0.1 + 0.1 drifts.
    const count = Math.round(span / step);
    for (let i = 0; i <= count; i++) ticks.push(round(min + i * step));
  }
  return {
    min,
    max,
    step,
    ticks,
    norm: (v) => (v - min) / span,
    invert: (t) => min + t * span,
  };
}

/**
 * Kill floating-point fuzz on tick values. Without this an axis of 0.1 steps
 * renders 0.30000000000000004 and the label formatter faithfully prints it.
 */
const round = (v: number): number => {
  const r = Number(v.toPrecision(12));
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Where the value axis crosses. Charts with negative values need a baseline
 * inside the plot, not at the bottom edge.
 */
export const baselineOf = (s: LinearScale): number =>
  s.min <= 0 && s.max >= 0 ? s.norm(0) : s.min > 0 ? 0 : 1;
