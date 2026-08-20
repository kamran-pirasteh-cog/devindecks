import type { GanttGrain } from './chart/spec';

/**
 * Units. PowerPoint's native coordinate unit is the EMU (English Metric Unit).
 * We store *everything* geometric in EMU so export to .pptx is lossless — no
 * rounding drift between what the editor shows and what PowerPoint/Google Slides
 * render. Pixels exist only at render time, derived via a scale factor.
 */

export type EMU = number;

export const EMU_PER_INCH = 914_400;
export const EMU_PER_POINT = 12_700; // 72 pt / inch
export const EMU_PER_CM = 360_000;

/** Standard 16:9 slide: 13.333in × 7.5in. */
export const SLIDE_16x9 = {
  w: 12_192_000 as EMU,
  h: 6_858_000 as EMU,
} as const;

/** 4:3 slide: 10in × 7.5in. */
export const SLIDE_4x3 = {
  w: 9_144_000 as EMU,
  h: 6_858_000 as EMU,
} as const;

export const inchesToEmu = (n: number): EMU => Math.round(n * EMU_PER_INCH);
export const pointsToEmu = (n: number): EMU => Math.round(n * EMU_PER_POINT);
export const cmToEmu = (n: number): EMU => Math.round(n * EMU_PER_CM);

export const emuToInches = (e: EMU): number => e / EMU_PER_INCH;
export const emuToPoints = (e: EMU): number => e / EMU_PER_POINT;

/**
 * Scale to convert EMU -> CSS px for a given rendered slide width.
 * px = emu * scale.
 */
export const scaleForWidth = (renderedWidthPx: number, slideWidthEmu: EMU): number =>
  renderedWidthPx / slideWidthEmu;

export const emuToPx = (e: EMU, scale: number): number => e * scale;
export const pxToEmu = (px: number, scale: number): EMU => Math.round(px / scale);

/**
 * A calendar day, as days since 1970-01-01, in the proleptic Gregorian
 * calendar.
 *
 * NOT a timestamp and never a `Date`. A schedule's atom is a whole day, and the
 * moment a day becomes an instant, a deck authored in Berlin and exported in
 * California disagree about which quarter a bar ends in. Integer civil-date
 * arithmetic has no timezone, no DST and no locale — the same reason everything
 * geometric here is an integer EMU rather than a float inch.
 *
 * See `src/chart/format/date.ts` for the arithmetic and the formatter.
 */
export type EpochDay = number;

/** Integer division that floors toward negative infinity, as C++'s does not. */
const idiv = (a: number, b: number): number => Math.floor(a / b);

/* ------------------------------------------------------------------ */
/* Civil date <-> epoch day                                           */
/* ------------------------------------------------------------------ */

/** `m` is 1..12 and `d` is 1..31. Out-of-range values roll over sensibly. */
export function toEpochDay(y: number, m: number, d: number): EpochDay {
  // Normalise the month first so `toEpochDay(2026, 13, 1)` is January 2027 —
  // month arithmetic elsewhere ("three months on") is written that way.
  const y0 = y + idiv(m - 1, 12);
  const m0 = ((((m - 1) % 12) + 12) % 12) + 1;

  const yy = y0 - (m0 <= 2 ? 1 : 0);
  const era = idiv(yy, 400);
  const yoe = yy - era * 400; // [0, 399]
  const doy = idiv(153 * (m0 + (m0 > 2 ? -3 : 9)) + 2, 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + idiv(yoe, 4) - idiv(yoe, 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

export interface CivilDate {
  y: number;
  /** 1..12. */
  m: number;
  /** 1..31. */
  d: number;
  /** 0 = Sunday. */
  dow: number;
}

export function fromEpochDay(day: EpochDay): CivilDate {
  const z = Math.trunc(day) + 719468;
  const era = idiv(z, 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = idiv(doe - idiv(doe, 1460) + idiv(doe, 36524) - idiv(doe, 146096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + idiv(yoe, 4) - idiv(yoe, 100)); // [0, 365]
  const mp = idiv(5 * doy + 2, 153); // [0, 11]
  const d = doy - idiv(153 * mp + 2, 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return {
    y: y + (m <= 2 ? 1 : 0),
    m,
    d,
    // 1970-01-01 (day 0) was a Thursday, which is 4 with Sunday as 0.
    dow: ((((Math.trunc(day) % 7) + 7) % 7) + 4) % 7,
  };
}

/** ISO `YYYY-MM-DD`, which is what the datasheet stores. */
export const toIso = (day: EpochDay): string => {
  const { y, m, d } = fromEpochDay(day);
  const yy = y < 0 ? `-${String(-y).padStart(4, '0')}` : String(y).padStart(4, '0');
  return `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** `YYYY-MM-DD` only — anything looser belongs in `parseDay`, not here. */
export function fromIso(iso: string): EpochDay | null {
  const m = /^(-?\d{4,6})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const day = toEpochDay(y, mo, d);
  // Reject 31 February rather than silently rolling it into March.
  const back = fromEpochDay(day);
  return back.y === y && back.m === mo && back.d === d ? day : null;
}

export const isLeapYear = (y: number): boolean =>
  (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (y: number, m: number): number =>
  m === 2 ? (isLeapYear(y) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export const addDays = (day: EpochDay, n: number): EpochDay => day + n;

/** Clamped to the target month's length, so 31 Jan + 1 month is 28/29 Feb. */
export function addMonths(day: EpochDay, n: number): EpochDay {
  const { y, m, d } = fromEpochDay(day);
  const total = y * 12 + (m - 1) + n;
  const y2 = idiv(total, 12);
  const m2 = (((total % 12) + 12) % 12) + 1;
  return toEpochDay(y2, m2, Math.min(d, daysInMonth(y2, m2)));
}

/** The first day of the grain's cell containing `day`. */
export function startOf(grain: GanttGrain, day: EpochDay, weekStart: 0 | 1 = 1): EpochDay {
  const c = fromEpochDay(day);
  switch (grain) {
    case 'year':
      return toEpochDay(c.y, 1, 1);
    case 'half':
      return toEpochDay(c.y, c.m <= 6 ? 1 : 7, 1);
    case 'quarter':
      return toEpochDay(c.y, Math.floor((c.m - 1) / 3) * 3 + 1, 1);
    case 'month':
      return toEpochDay(c.y, c.m, 1);
    case 'week':
      return day - ((((c.dow - weekStart) % 7) + 7) % 7);
    case 'day':
      return day;
  }
}

/** The first day of the NEXT cell — the half-open end of this one. */
export function nextCell(grain: GanttGrain, day: EpochDay, weekStart: 0 | 1 = 1): EpochDay {
  const s = startOf(grain, day, weekStart);
  switch (grain) {
    case 'year':
      return addMonths(s, 12);
    case 'half':
      return addMonths(s, 6);
    case 'quarter':
      return addMonths(s, 3);
    case 'month':
      return addMonths(s, 1);
    case 'week':
      return s + 7;
    case 'day':
      return s + 1;
  }
}
