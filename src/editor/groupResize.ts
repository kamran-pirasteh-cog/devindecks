import { rotatedBounds } from '@/model';

/**
 * The scale factor one axis of a group resize takes.
 *
 * Split out of `EditorCanvas` because the rule it encodes is not obvious and
 * is worth a test: the factor is measured against the group's start bounds as
 * the MODEL knows them, not against the box Moveable measures.
 *
 * Moveable reports a group height of 0 whenever the selection contains a chart
 * — a chart contributes zero-height nodes (gridlines, axis rules) and its group
 * box comes back degenerate on that axis — and a naive `live / (live - dist)`
 * turns that into a scale factor of 0. A chart grouped with one other object
 * then collapsed to a flat strip the moment a handle moved, permanently.
 *
 * So: trust the live measurement while it is positive, fall back to the delta
 * (the one number Moveable always gets right), and hold the axis still if
 * neither is usable. A resize that does nothing on one axis is recoverable; a
 * resize that flattens the selection is not.
 */
export function resizeFactor(startSize: number, live: number, dist: number): number {
  if (!(startSize > 0)) return 1;
  const next = live > 0 ? live : startSize + dist;
  return next > 0 ? next / startSize : 1;
}

/**
 * Where one object of an ungrouped multi-selection lands when ANOTHER object's
 * handle is dragged — PowerPoint's behaviour, and the thing that separates a
 * multi-selection from a group.
 *
 * A group scales as one object: its members take the group box's factors AND
 * have their offsets from its held edge scaled, so they spread apart. Several
 * ungrouped objects don't spread — each takes the same two factors about its
 * OWN anchor edge and stays where it is. Two shapes an inch apart both get 40%
 * wider and are still an inch apart.
 *
 * `dir` is Moveable's handle direction on the axis: +1 means the handle is on
 * the high edge, so the low edge is what stays put; 0 is an edge handle, which
 * has no say on its cross axis, so that axis grows about the centre — as does
 * every axis when the drag is a ⌘/Ctrl resize-from-centre.
 */
export function individualBox(
  start: { x: number; y: number; w: number; h: number },
  sx: number,
  sy: number,
  dirX: number,
  dirY: number,
  fromCenter: boolean,
): { x: number; y: number; w: number; h: number } {
  const pivot = (dir: number, lo: number, size: number) =>
    fromCenter || dir === 0 ? lo + size / 2 : dir > 0 ? lo : lo + size;
  const px = pivot(dirX, start.x, start.w);
  const py = pivot(dirY, start.y, start.h);
  return {
    // The 4px floor keeps an object grabbable; a line is 0 on its cross axis by
    // definition and must stay 0, or it comes out of the resize a rectangle.
    x: px + (start.x - px) * sx,
    y: py + (start.y - py) * sy,
    w: start.w === 0 ? 0 : Math.max(4, start.w * sx),
    h: start.h === 0 ? 0 : Math.max(4, start.h * sy),
  };
}

/**
 * The factor a GROUP's axis takes when the keyboard grows it by `delta`.
 *
 * The step is absolute (⇧ + arrow is one nudge, whatever is selected), so the
 * group's own box is what takes it, and its members take the factor that box
 * ended up with. A group that is 4" wide and one that is 1" wide therefore both
 * grow by the same step, exactly as PowerPoint's ⇧ + arrow does on a group.
 */
export function groupScaleFactor(size: number, delta: number, minSize: number): number {
  if (!(size > 0)) return 1;
  return Math.max(minSize, size + delta) / size;
}

/**
 * Where one member of a group lands when the group box scales by `sx`/`sy`
 * about `origin` — its top-left, so a keyboard resize pins the same corner an
 * individual one does.
 *
 * Both the member's SIZE and its OFFSET from the origin scale: that is the
 * difference between a group and a multi-selection. Inflating each member by
 * the step instead (what this used to do) left the offsets alone, so the parts
 * of a group grew into each other and the group's own proportions were lost.
 *
 * The offset that scales is the member's CENTRE — identical to scaling its
 * top-left while the size scales too, and the only one of the two that survives
 * rotation, which pivots about the centre. See `groupMemberBox`.
 */
export function groupMemberRect(
  origin: { x: number; y: number },
  rect: { x: number; y: number; w: number; h: number },
  sx: number,
  sy: number,
  /**
   * Scale this member's SIZE by one factor on both axes — what a picture needs
   * when the box around it takes a different factor per axis, since its source
   * is fitted to the rect and a lopsided rect stretches the face in it. The
   * smaller factor, so the member still fits the space the box left for it.
   * Its CENTRE still travels with the box's own factors, so it stays where the
   * layout put it inside the block.
   */
  keepRatio = false,
): { x: number; y: number; w: number; h: number } {
  const [kx, ky] = keepRatio ? [Math.min(sx, sy), Math.min(sx, sy)] : [sx, sy];
  // A line is 0 on its cross axis by definition and must stay 0; everything
  // else keeps at least a sliver so rounding can't erase it.
  const w = rect.w === 0 ? 0 : Math.max(1, Math.round(rect.w * kx));
  const h = rect.h === 0 ? 0 : Math.max(1, Math.round(rect.h * ky));
  const cx = origin.x + (rect.x + rect.w / 2 - origin.x) * sx;
  const cy = origin.y + (rect.y + rect.h / 2 - origin.y) * sy;
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
}

/** The union of `starts` as they appear on the slide — rotation included. */
export function groupBounds(
  starts: { x: number; y: number; w: number; h: number; rotation?: number }[],
  /** Applied to each member's size before the union — see `measurePx`. */
  floor: (size: number) => number = (n) => n,
): { x0: number; x1: number; y0: number; y1: number } | null {
  if (!starts.length) return null;
  const boxes = starts.map((s) =>
    rotatedBounds({ x: s.x, y: s.y, w: floor(s.w), h: floor(s.h) }, s.rotation ?? 0),
  );
  return {
    x0: Math.min(...boxes.map((b) => b.x)),
    x1: Math.max(...boxes.map((b) => b.x + b.w)),
    y0: Math.min(...boxes.map((b) => b.y)),
    y1: Math.max(...boxes.map((b) => b.y + b.h)),
  };
}

/**
 * Where one member of a group lands when the group box scales by `sx`/`sy`
 * about the pivot `px`/`py`.
 *
 * Both the size and the offset from the pivot scale — that is what makes a
 * group behave as one object. The offset that scales is the member's CENTRE,
 * not its top-left: a rotated member keeps its angle through a resize (as it
 * does in PowerPoint, which scales the shape's extents inside the group's frame
 * and leaves the rotation alone), and rotation pivots about the centre, so the
 * centre is the only point whose scaled position holds the member in the same
 * place relative to the group. Scaling the top-left instead drags rotated
 * members off the group's grid.
 */
export function groupMemberBox(
  start: { x: number; y: number; w: number; h: number },
  sx: number,
  sy: number,
  px: number,
  py: number,
): { x: number; y: number; w: number; h: number } {
  // The 4px floor keeps an object grabbable; a line is 0 on its cross axis by
  // definition and must stay 0, or it comes out of the resize a rectangle.
  const w = start.w === 0 ? 0 : Math.max(4, start.w * sx);
  const h = start.h === 0 ? 0 : Math.max(4, start.h * sy);
  const cx = px + (start.x + start.w / 2 - px) * sx;
  const cy = py + (start.y + start.h / 2 - py) * sy;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
