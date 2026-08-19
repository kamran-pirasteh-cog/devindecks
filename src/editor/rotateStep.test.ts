import { describe, expect, it } from 'vitest';
import { nextRotation } from './rotateStep';

describe('nextRotation', () => {
  it('steps one stop clockwise from upright', () => {
    expect(nextRotation(0, 1)).toBe(22.5);
  });

  it('wraps below zero going anticlockwise', () => {
    expect(nextRotation(0, -1)).toBe(337.5);
  });

  it('wraps past a full turn going clockwise', () => {
    expect(nextRotation(337.5, 1)).toBe(0);
  });

  it('snaps an off-grid angle onto the grid in the direction pressed', () => {
    expect(nextRotation(37, 1)).toBe(45);
    expect(nextRotation(37, -1)).toBe(22.5);
  });

  it('treats an angle outside [0, 360) as its normalized self', () => {
    // -22.5 is 337.5, and one step on from there is a full turn — so, upright.
    expect(nextRotation(-22.5, 1)).toBe(0);
    expect(nextRotation(382.5, 1)).toBe(45);
  });

  it('walks a full turn in 16 presses', () => {
    let deg = 0;
    const seen: number[] = [];
    for (let i = 0; i < 16; i++) {
      deg = nextRotation(deg, 1);
      seen.push(deg);
    }
    expect(seen[15]).toBe(0);
    expect(new Set(seen).size).toBe(16);
  });
});
