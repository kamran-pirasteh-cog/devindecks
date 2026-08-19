/**
 * Keyboard rotation, PowerPoint style: ⌥ + ←/→ turns the selection one step.
 *
 * The step lands on the 22.5° grid rather than adding 22.5° to whatever angle
 * an object was dragged to, so a run of presses walks 0 · 22.5 · 45 … and the
 * useful angles are all reachable from the keyboard. An object already sitting
 * off the grid (dragged to 37°) snaps ONTO it in the direction pressed — the
 * first press tidies, and every press after it steps.
 */

/** Degrees between two keyboard rotation stops. */
export const ROTATE_STEP = 22.5;

/**
 * Any angle read as its place in one turn, [0, 360). Unrounded, so the 22.5°
 * grid survives it — the canvas has its own rounding version for drag angles,
 * which arrive as arbitrary floats.
 */
export const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360;

const norm = normalizeDeg;

/** Floating-point slack, so an angle written as 45.000000001 counts as on-grid. */
const EPSILON = 1e-6;

/**
 * The angle one step clockwise (`dir` 1) or anticlockwise (`dir` -1) from
 * `current`, normalized to [0, 360).
 */
export function nextRotation(current: number, dir: 1 | -1): number {
  const from = norm(current);
  const steps = from / ROTATE_STEP;
  const onGrid = Math.abs(steps - Math.round(steps)) < EPSILON;
  const target = onGrid
    ? Math.round(steps) + dir
    : dir === 1
      ? Math.ceil(steps)
      : Math.floor(steps);
  return norm(target * ROTATE_STEP);
}
