/**
 * Build-time feature flags. Plain consts, not env lookups: flipping one is a
 * code change that goes through review, and dead-code elimination drops the
 * disabled path from the bundle.
 */

/**
 * The toolbar's "fit content inside margin guides" button. The action itself
 * (`fitToMargins`) stays wired up and reachable from the command layer — this
 * only hides the trigger while the layout rules are still being settled.
 */
export const FIT_TO_MARGINS_BUTTON = false;
