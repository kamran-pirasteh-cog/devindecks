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
