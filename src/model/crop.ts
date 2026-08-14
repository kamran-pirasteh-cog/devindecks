/**
 * Picture cropping — the geometry shared by the renderer, the crop overlay and
 * the PPTX exporter, so all three agree on what a `Crop` means.
 *
 * One idea runs through the whole file: the **plane**. A cropped picture's rect
 * shows a window onto a larger rectangle — where the WHOLE source image would
 * sit if nothing were trimmed. Insets and rect are two views of the same plane:
 *
 *     plane.w = rect.w / (1 - left - right)
 *     plane.x = rect.x - left * plane.w
 *
 * Dragging a crop handle moves the window on a FIXED plane, which is why the
 * pixels the user keeps don't drift under the cursor while they drag.
 */
import type { Crop, Rect } from './types';

/** No trim on any side — what "uncropped, expressed as insets" looks like. */
export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

/** A crop that keeps nothing would divide by zero; every edge stops short. */
const MIN_VISIBLE = 0.02;

export function isCropped(crop: Crop | undefined): crop is Crop {
  return (
    !!crop && (crop.left > 0 || crop.top > 0 || crop.right > 0 || crop.bottom > 0)
  );
}

/** The fraction of the source that survives horizontally / vertically. */
export function cropScale(crop: Crop | undefined) {
  const c = crop ?? NO_CROP;
  return {
    x: Math.max(MIN_VISIBLE, 1 - c.left - c.right),
    y: Math.max(MIN_VISIBLE, 1 - c.top - c.bottom),
  };
}

/**
 * Where the full source image would be drawn, given the window (`rect`) and the
 * insets that produced it. Units are whatever `rect` is in — EMU on the model
 * side, px in the overlay.
 */
export function cropPlane(rect: Rect, crop: Crop | undefined): Rect {
  const c = crop ?? NO_CROP;
  const s = cropScale(crop);
  const w = rect.w / s.x;
  const h = rect.h / s.y;
  return { x: rect.x - c.left * w, y: rect.y - c.top * h, w, h };
}

/**
 * The inverse: a window somewhere on a known plane, expressed as insets. The
 * window is clamped into the plane first, so a handle dragged past the image's
 * edge stops at it rather than inventing transparent margin.
 */
export function cropWindow(plane: Rect, window: Rect): { rect: Rect; crop: Crop } {
  const x = clamp(window.x, plane.x, plane.x + plane.w - plane.w * MIN_VISIBLE);
  const y = clamp(window.y, plane.y, plane.y + plane.h - plane.h * MIN_VISIBLE);
  const w = clamp(window.w, plane.w * MIN_VISIBLE, plane.x + plane.w - x);
  const h = clamp(window.h, plane.h * MIN_VISIBLE, plane.y + plane.h - y);
  return {
    rect: { x, y, w, h },
    crop: {
      left: (x - plane.x) / plane.w,
      top: (y - plane.y) / plane.h,
      right: (plane.x + plane.w - x - w) / plane.w,
      bottom: (plane.y + plane.h - y - h) / plane.h,
    },
  };
}

/**
 * The cover fit an UNCROPPED picture is rendered with, written as insets.
 *
 * Entering crop mode calls this so the first frame of the overlay looks exactly
 * like the picture did a moment earlier: cover already trims the long axis, and
 * cropping has to start from what's on screen, not from the untrimmed source.
 * Needs the source's pixel size, which only the browser (or the importer) can
 * supply — hence its own function rather than a branch inside `cropPlane`.
 */
export function coverCrop(natural: { w: number; h: number }, rect: Rect): Crop {
  if (!(natural.w > 0) || !(natural.h > 0) || !(rect.w > 0) || !(rect.h > 0)) {
    return { ...NO_CROP };
  }
  const boxRatio = rect.h / rect.w;
  const imgRatio = natural.h / natural.w;
  if (imgRatio > boxRatio) {
    // Taller than the box: cover trims equal slices off top and bottom.
    const keep = boxRatio / imgRatio;
    const trim = (1 - keep) / 2;
    return { left: 0, right: 0, top: trim, bottom: trim };
  }
  const keep = imgRatio / boxRatio;
  const trim = (1 - keep) / 2;
  return { left: trim, right: trim, top: 0, bottom: 0 };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
