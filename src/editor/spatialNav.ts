/**
 * Arrow-key selection, PowerPoint style.
 *
 * ⌥ + arrow walks the selection to the next object in that direction. The walk
 * is SPATIAL, not z-order: what you get is the thing your eye would jump to,
 * which is why a candidate is scored by how far it is along the pressed axis
 * plus a penalty for how far it strays off it.
 *
 * Groups are one object here, as everywhere else selection is concerned — the
 * unit's box is the union of its members, and landing on it selects them all.
 */
import { outerGroupId, unionRect, type Rect, type SlideElement } from '@/model';

export type NavDirection = 'left' | 'right' | 'up' | 'down';

export const NAV_KEYS: Record<string, NavDirection | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

interface Unit {
  ids: string[];
  rect: Rect;
}

/** Every selectable thing on the slide: each top-level group once, plus loose elements. */
function units(elements: SlideElement[]): Unit[] {
  const out: Unit[] = [];
  const seenGroups = new Set<string>();
  for (const el of elements) {
    const gid = outerGroupId(el);
    if (!gid) {
      out.push({ ids: [el.id], rect: el.rect });
      continue;
    }
    if (seenGroups.has(gid)) continue;
    seenGroups.add(gid);
    const ids = elements.filter((e) => e.groupIds?.includes(gid)).map((e) => e.id);
    const rect = unionRect(elements, ids);
    if (rect) out.push({ ids, rect });
  }
  return out;
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * How far off-axis a press tolerates. Objects drifting sideways still count —
 * a slide is rarely a grid — they just lose to anything squarely ahead.
 */
const OFF_AXIS_PENALTY = 2;

/**
 * A card behind its own label sits "below" that label by its centre, so it
 * would win every press made from the text on top of it and the walk would
 * never leave the card. Something wrapped around where you already are isn't
 * in any direction — it's still reachable from the objects around it.
 */
const encloses = (outer: Rect, inner: Rect) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.w >= inner.x + inner.w &&
  outer.y + outer.h >= inner.y + inner.h;

/**
 * The unit `dir` moves to from the current selection, or null when there is
 * nothing that way (the selection then stays put rather than wrapping).
 *
 * With nothing selected the first press picks the top-left-most object, so ⌥→
 * from a bare slide starts the walk instead of doing nothing.
 */
export function nextInDirection(
  elements: SlideElement[],
  selectedIds: string[],
  dir: NavDirection,
): string[] | null {
  const all = units(elements);
  if (all.length === 0) return null;

  const current = all.find((u) => u.ids.some((id) => selectedIds.includes(id)));
  if (!current) {
    const first = all.reduce((a, b) =>
      a.rect.y + a.rect.x <= b.rect.y + b.rect.x ? a : b,
    );
    return first.ids;
  }

  const from = centre(current.rect);
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'left' || dir === 'up' ? -1 : 1;

  let best: Unit | null = null;
  let bestScore = Infinity;
  for (const u of all) {
    if (u === current || encloses(u.rect, current.rect)) continue;
    const to = centre(u.rect);
    const along = (horizontal ? to.x - from.x : to.y - from.y) * sign;
    // Ties on the pressed axis (a perfect column under ⌥→) are broken by the
    // off-axis distance below, so only a strictly backwards centre is skipped.
    if (along <= 0) continue;
    const off = Math.abs(horizontal ? to.y - from.y : to.x - from.x);
    const score = along + off * OFF_AXIS_PENALTY;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best ? best.ids : null;
}
