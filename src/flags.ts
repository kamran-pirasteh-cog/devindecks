/**
 * Build-time feature flags.
 *
 * A flag here is a switch on a feature that exists in the tree but isn't ready
 * to ship — the code stays in place, wired up and tested, and the UI that
 * reaches it is skipped. Flipping one back to `true` is the whole re-enable.
 *
 * These are constants rather than runtime state on purpose: gating with a plain
 * `if (!FLAGS.x) return null` keeps the disabled paths obvious in a diff, and
 * lets a bundler drop the dead branch.
 */
export const FLAGS = {
  /**
   * Comment threads: the panel, the canvas pins, the toolbar toggle, the
   * filmstrip badges and the ⌘⌥M chord. Off until the feature is finished —
   * `src/comments/*` and `src/store/commentStore.ts` are untouched, and
   * existing threads stay on disk, so turning this on brings them all back.
   */
  comments: false,
} as const;
