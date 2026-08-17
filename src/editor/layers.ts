/**
 * Stacking order for editor UI that floats over the canvas.
 *
 * react-moveable draws its selection box, lines and handles at `z-index: 3000`
 * (baked into the library's own stylesheet), so anything below that gets sliced
 * through by the selection outline of whatever is selected underneath. Every
 * popover, menu and modal in the editor therefore sits ABOVE that mark.
 */

/** react-moveable's own control box — the value we have to clear. */
export const MOVEABLE_Z = 3000;

/** Menus and popovers anchored to the canvas or toolbar. */
export const OVERLAY_Z = MOVEABLE_Z + 1000;

/** Full-screen dialogs, which must also cover the overlays. */
export const MODAL_Z = MOVEABLE_Z + 2000;

/**
 * The custom-colour panel — the topmost thing in the editor, because it opens
 * from INSIDE all of the above: a toolbar popover, a canvas panel, and the chart
 * data dialog all have a palette with a custom swatch on the end of it.
 */
export const COLOR_PANEL_Z = MODAL_Z + 100;
