/**
 * A value scale over calendar time.
 *
 * `TimeScale` EXTENDS `LinearScale` deliberately. Days since the epoch are
 * linear, so `norm`/`invert` are the same arithmetic — which means
 * `projector(plot, scale, true)` takes one unchanged, and everything already
 * speaking `Projector` (the cartesian furniture, `placeAnnotations`, a
 * `ReferenceLine`) works on a time axis without knowing one exists. What a
 * calendar adds on top is STRUCTURE: months are not all the same width, and the
 * axis is a stack of bands rather than a row of ticks.
 *
 * The one thing not inherited is `niceDomain`. Its 1 / 2 / 2.5 / 5 ladder is a
 * ladder of magnitudes, and on a two-quarter plan it puts a gridline every 60
 * hours. Nice bounds for a calendar are whole calendar units, and the count
 * that matters is how many CELLS fit, not how many ticks.
 */
import { nextCell, startOf, type EMU, type EpochDay, type GanttGrain } from '@/model';
import { bandCells, type TimeBandCell } from '../format/date';
import { makeScale, type LinearScale } from './linear';

export interface TimeBand {
  grain: GanttGrain;
  cells: TimeBandCell[];
}

export interface TimeScale extends LinearScale {
  /** One per header row, COARSEST first. */
  bands: TimeBand[];
  /** The finest band's grain — what a gridline means on this axis. */
  grain: GanttGrain;
}

/** Coarsest to finest. Index order IS the ordering used everywhere below. */
export const GRAINS: GanttGrain[] = ['year', 'half', 'quarter', 'month', 'week', 'day'];

/** Nominal days per cell. Approximate for the calendar grains, and only ever
 * used to compare grains or to size a gutter — never to place a mark. */
export const NOMINAL_DAYS: Record<GanttGrain, number> = {
  year: 365.2425,
  half: 182.62,
  quarter: 91.31,
  month: 30.44,
  week: 7,
  day: 1,
};

export const coarser = (g: GanttGrain): GanttGrain => GRAINS[Math.max(0, GRAINS.indexOf(g) - 1)];
export const finer = (g: GanttGrain): GanttGrain =>
  GRAINS[Math.min(GRAINS.length - 1, GRAINS.indexOf(g) + 1)];

export interface TimeBandRequest {
  grain: GanttGrain;
  format?: string;
}

/**
 * Build the scale and its header bands.
 *
 * `ticks` carries the FINEST band's cell starts, so the generic gridline code
 * draws rules where a reader expects them. `step` is the mean cell width in
 * days — a lie for months, and a harmless one: nothing divides by it, and
 * `makeScale` only uses it to enumerate ticks, which are replaced here.
 */
export function timeScale(
  min: EpochDay,
  max: EpochDay,
  bands: TimeBandRequest[],
  opts: { weekStart?: 0 | 1 } = {},
): TimeScale {
  const lo = Math.round(min);
  const hi = Math.max(lo + 1, Math.round(max));

  // Coarsest first, deduplicated: two bands of the same grain is a header row
  // repeated, which is never what was meant.
  const seen = new Set<GanttGrain>();
  const wanted = bands
    .filter((b) => (seen.has(b.grain) ? false : (seen.add(b.grain), true)))
    .sort((a, b) => GRAINS.indexOf(a.grain) - GRAINS.indexOf(b.grain));

  const built: TimeBand[] = wanted.map((b) => ({
    grain: b.grain,
    cells: bandCells(b.grain, lo, hi, { weekStart: opts.weekStart, format: b.format }),
  }));

  const grain = built.length ? built[built.length - 1].grain : 'month';
  const base = makeScale(lo, hi, Math.max(1, NOMINAL_DAYS[grain]));

  return {
    ...base,
    step: NOMINAL_DAYS[grain],
    // Cell STARTS, not cell centres: a gridline separates two months, it does
    // not sit inside one. The trailing edge is the plot's own boundary.
    ticks: built.length
      ? built[built.length - 1].cells.map((c) => c.cellFrom).filter((d) => d > lo)
      : [],
    bands: built,
    grain,
  };
}

/**
 * Round a date range outward to whole calendar cells.
 *
 * Explicit `min`/`max` win over anything derived, matching `niceDomain`: an
 * author who pinned the timescale meant it, even when a task later runs past it.
 */
export function niceTimeDomain(
  values: EpochDay[],
  opts: { min?: EpochDay; max?: EpochDay; coarsest?: GanttGrain; weekStart?: 0 | 1 } = {},
): { min: EpochDay; max: EpochDay } {
  const finite = values.filter((v) => Number.isFinite(v)).map(Math.round);
  const coarsest = opts.coarsest ?? 'month';
  const weekStart = opts.weekStart ?? 1;

  // An empty schedule still needs an axis to be drawn against. Anchor it at the
  // epoch rather than at today: the compiler is pure and must not read a clock.
  const lo = finite.length ? Math.min(...finite) : 0;
  const hi = finite.length ? Math.max(...finite) : 30;

  const min = opts.min ?? startOf(coarsest, lo, weekStart);
  // `hi` is a half-open end, so a plan finishing exactly on 1 April must not
  // pull an empty April cell into the axis.
  const max = opts.max ?? (hi <= min ? nextCell(coarsest, min, weekStart) : snapUp(coarsest, hi, weekStart));

  return { min, max: Math.max(max, min + 1) };
}

const snapUp = (grain: GanttGrain, day: EpochDay, weekStart: 0 | 1): EpochDay => {
  const s = startOf(grain, day, weekStart);
  return s === day ? day : nextCell(grain, day, weekStart);
};

/**
 * The finest grain whose labels still fit.
 *
 * The answer to `maxTicksFor` on a numeric axis, and it plays the same role in
 * the two-pass solve: called once against the frame and again against the real
 * plot, because the width available depends on the description table, which
 * depends on nothing here.
 */
export function grainFor(
  spanInDays: number,
  plotExtentEmu: EMU,
  labelWidthEmu: EMU,
): GanttGrain {
  if (!(spanInDays > 0) || !(plotExtentEmu > 0) || !(labelWidthEmu > 0)) return 'month';
  const emuPerDay = plotExtentEmu / spanInDays;
  // Finest first: take the most detailed grain whose cell is wide enough to
  // carry its own label.
  for (let i = GRAINS.length - 1; i >= 0; i--) {
    if (NOMINAL_DAYS[GRAINS[i]] * emuPerDay >= labelWidthEmu) return GRAINS[i];
  }
  return 'year';
}

/**
 * The band stack for a range, coarsest first.
 *
 * Two rows is the think-cell default and the right answer nearly always — a
 * heading that says which year, and a row that says which month. One row when
 * the fine grain IS the coarse one (a plan spanning a single quarter of days).
 */
export function defaultBands(
  spanInDays: number,
  plotExtentEmu: EMU,
  labelWidthEmu: EMU,
): TimeBandRequest[] {
  const fine = grainFor(spanInDays, plotExtentEmu, labelWidthEmu);
  const coarse = coarser(fine);
  return fine === coarse ? [{ grain: fine }] : [{ grain: coarse }, { grain: fine }];
}
