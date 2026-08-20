/**
 * The drag image for a multi-slide drag: the thumbnail you grabbed, with the
 * rest of the selection fanned out behind it as a stack and a count badge on
 * top — PowerPoint's cue that the whole group is coming along, rather than the
 * single ghosted thumbnail the browser hands out by default.
 *
 * The node has to be in the document when `setDragImage` snapshots it, so it's
 * parked off-screen and the caller drops it on the next frame.
 */
const MAX_LAYERS = 3;
const OFFSET = 5;

export function makeSlideDragImage(source: HTMLElement, count: number): HTMLElement {
  const rect = source.getBoundingClientRect();
  const layers = Math.min(count, MAX_LAYERS);
  const spread = (layers - 1) * OFFSET;

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;top:-10000px;left:-10000px;pointer-events:none;width:${
    rect.width + spread
  }px;height:${rect.height + spread}px;`;

  // Back to front, so the grabbed thumbnail ends up on top with the stack
  // stepping down and to the right behind it.
  for (let i = layers - 1; i >= 0; i--) {
    const layer = document.createElement('div');
    const inset = i * OFFSET;
    layer.style.cssText = `position:absolute;top:${inset}px;left:${inset}px;width:${rect.width}px;height:${rect.height}px;border-radius:4px;overflow:hidden;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);outline:1px solid rgba(99,102,241,.9);`;
    // Only the front layer carries the picture; the ones behind read as paper.
    if (i === 0) {
      const clone = source.cloneNode(true) as HTMLElement;
      clone.style.cssText = `width:${rect.width}px;height:${rect.height}px;opacity:1;`;
      layer.appendChild(clone);
    }
    host.appendChild(layer);
  }

  const badge = document.createElement('div');
  badge.textContent = String(count);
  badge.style.cssText =
    'position:absolute;top:4px;left:4px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#6366f1;color:#fff;font:600 11px/20px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.3);';
  host.appendChild(badge);

  document.body.appendChild(host);
  return host;
}
