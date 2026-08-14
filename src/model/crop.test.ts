import { describe, expect, it } from 'vitest';
import { coverCrop, cropPlane, cropScale, cropWindow, isCropped, NO_CROP } from './crop';
import type { Rect } from './types';

const rect: Rect = { x: 100, y: 200, w: 400, h: 300 };

describe('crop insets', () => {
  it('reads an all-zero crop as uncropped', () => {
    expect(isCropped(undefined)).toBe(false);
    expect(isCropped(NO_CROP)).toBe(false);
    expect(isCropped({ ...NO_CROP, right: 0.01 })).toBe(true);
  });

  it('never scales to nothing, however greedy the insets', () => {
    const s = cropScale({ left: 0.7, right: 0.7, top: 0, bottom: 0 });
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBe(1);
  });
});

describe('plane', () => {
  it('is the rect itself when nothing is trimmed', () => {
    expect(cropPlane(rect, undefined)).toEqual(rect);
  });

  it('grows so the rect lands on it at the given insets', () => {
    const crop = { left: 0.25, top: 0.5, right: 0.25, bottom: 0 };
    const plane = cropPlane(rect, crop);
    expect(plane.w).toBe(800);
    expect(plane.h).toBe(600);
    // The rect sits a quarter in from the left and half way down.
    expect(plane.x).toBe(rect.x - 200);
    expect(plane.y).toBe(rect.y - 300);
  });

  it('round-trips through cropWindow', () => {
    const crop = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.05 };
    const { rect: back, crop: insets } = cropWindow(cropPlane(rect, crop), rect);
    expect(back).toEqual(rect);
    expect(insets.left).toBeCloseTo(crop.left, 10);
    expect(insets.top).toBeCloseTo(crop.top, 10);
    expect(insets.right).toBeCloseTo(crop.right, 10);
    expect(insets.bottom).toBeCloseTo(crop.bottom, 10);
  });
});

describe('cropWindow', () => {
  const plane: Rect = { x: 0, y: 0, w: 1000, h: 500 };

  it('clamps a window dragged off the image to its edge', () => {
    const { rect: r, crop } = cropWindow(plane, { x: -300, y: -100, w: 400, h: 200 });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(crop.left).toBe(0);
    expect(crop.top).toBe(0);
  });

  it('clamps a window wider than the image', () => {
    const { rect: r, crop } = cropWindow(plane, { x: 800, y: 0, w: 900, h: 500 });
    expect(r.x + r.w).toBe(1000);
    expect(crop.right).toBe(0);
    expect(crop.left).toBeCloseTo(0.8, 10);
  });
});

describe('coverCrop', () => {
  const box: Rect = { x: 0, y: 0, w: 400, h: 200 };

  it('trims top and bottom of an image taller than the box', () => {
    // 1:1 source into a 2:1 box: half the height survives, centred.
    const crop = coverCrop({ w: 500, h: 500 }, box);
    expect(crop.left).toBe(0);
    expect(crop.right).toBe(0);
    expect(crop.top).toBeCloseTo(0.25, 10);
    expect(crop.bottom).toBeCloseTo(0.25, 10);
  });

  it('trims the sides of an image wider than the box', () => {
    // 4:1 source into a 2:1 box: half the width survives.
    const crop = coverCrop({ w: 800, h: 200 }, box);
    expect(crop.top).toBe(0);
    expect(crop.left).toBeCloseTo(0.25, 10);
    expect(crop.right).toBeCloseTo(0.25, 10);
  });

  it('trims nothing when the aspects already match', () => {
    expect(isCropped(coverCrop({ w: 1200, h: 600 }, box))).toBe(false);
  });

  it('trims nothing for an image it cannot measure', () => {
    expect(coverCrop({ w: 0, h: 0 }, box)).toEqual(NO_CROP);
  });
});
