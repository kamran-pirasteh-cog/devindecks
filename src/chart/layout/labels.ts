/**
 * Data-label collision avoidance.
 *
 * This is where most of a charting tool's perceived quality lives. A chart
 * whose labels overlap each other, straddle a segment boundary, or sit on top
 * of the bar they describe reads as broken even when every number is right.
 *
 * The solver is deliberately GREEDY and DETERMINISTIC — candidates in priority
 * order, biggest marks placed first, one local-swap pass, done. Anything
 * stochastic (annealing, jitter) would make the canvas, the SSR thumbnail and
 * the exported .pptx disagree about where a label goes, because each renders
 * the chart independently.
 */
import type { EMU, Rect } from '@/model';

export interface LabelCandidate {
  rect: Rect;
  /** Lower is better. Ties break by order. */
  cost: number;
}

export interface PlaceableLabel {
  id: string;
  /** Placed first when space is tight — a big segment's label matters more. */
  weight: number;
  candidates: LabelCandidate[];
  /** Set by a manual drag: this label is where the author put it, full stop. */
  pinned?: Rect;
  /** Regions this label must not straddle, e.g. its own segment's edges. */
  avoid?: Rect[];
}

export interface PlacedLabel {
  id: string;
  rect: Rect;
  /** True when no candidate fitted and the label should be dropped. */
  dropped: boolean;
  /** Set when the label ended up away from its anchor and needs a leader. */
  leaderFrom?: { x: EMU; y: EMU };
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** How much of `a` is covered by `b`, 0..1. */
function overlapFraction(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const area = a.w * a.h;
  return area > 0 ? (w * h) / area : 0;
}

const inside = (a: Rect, bounds: Rect): boolean =>
  a.x >= bounds.x && a.y >= bounds.y && a.x + a.w <= bounds.x + bounds.w && a.y + a.h <= bounds.y + bounds.h;

export interface SolveOptions {
  /** Labels are kept inside this, usually the chart frame. */
  bounds: Rect;
  /** Regions no label may sit on top of, e.g. the legend. */
  blockers?: Rect[];
  /** Fraction of a label that may sit over an `avoid` region before it fails. */
  straddleTolerance?: number;
}

/**
 * Place labels, in one pass, without overlaps.
 *
 * Order matters twice over: heavier labels choose first (so a 40% segment
 * keeps its natural position and a 2% sliver is the one that moves), and
 * pinned labels are placed before anything else so the solver routes around a
 * manual drag rather than fighting it.
 */
export function solveLabels(labels: PlaceableLabel[], opts: SolveOptions): PlacedLabel[] {
  const tolerance = opts.straddleTolerance ?? 0.15;
  const placed: PlacedLabel[] = [];
  const taken: Rect[] = [...(opts.blockers ?? [])];

  const pinned = labels.filter((l) => l.pinned);
  const free = labels
    .filter((l) => !l.pinned)
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

  for (const label of pinned) {
    placed.push({ id: label.id, rect: label.pinned!, dropped: false });
    taken.push(label.pinned!);
  }

  for (const label of free) {
    let chosen: Rect | null = null;
    let fallback: Rect | null = null;

    for (const candidate of [...label.candidates].sort((a, b) => a.cost - b.cost)) {
      const r = candidate.rect;
      // The first candidate is the natural position; keep it as the fallback
      // so a dropped label still has a sensible place if we later relax.
      fallback ??= r;
      if (!inside(r, opts.bounds)) continue;
      if (taken.some((t) => overlaps(r, t))) continue;
      // A label half-on and half-off its own segment reads as belonging to
      // neither; better to move it than to leave it straddling.
      if (label.avoid?.some((a) => {
        const f = overlapFraction(r, a);
        return f > tolerance && f < 1 - tolerance;
      })) {
        continue;
      }
      chosen = r;
      break;
    }

    if (chosen) {
      placed.push({ id: label.id, rect: chosen, dropped: false });
      taken.push(chosen);
    } else {
      placed.push({
        id: label.id,
        rect: fallback ?? { x: 0, y: 0, w: 0, h: 0 },
        dropped: true,
      });
    }
  }

  // Restore the caller's order, so emit produces a stable element sequence.
  const byId = new Map(placed.map((p) => [p.id, p]));
  return labels.map((l) => byId.get(l.id)!);
}

/**
 * Build the ranked candidate list for a mark's label.
 *
 * `auto` expands to the order a reader expects: just past the tip first, then
 * tucked inside the tip, then centred, then above. Explicit placements get
 * their own position first and the same list after, so an explicit choice is
 * honoured when it fits and degrades sensibly when it doesn't.
 */
export function candidatesFor(opts: {
  /** Centre of the mark along the category axis. */
  centre: EMU;
  /** Value-axis coordinates of the mark's base and tip. */
  base: EMU;
  tip: EMU;
  w: EMU;
  h: EMU;
  gap: EMU;
  horizontal: boolean;
  order: ('outsideEnd' | 'insideEnd' | 'insideCenter' | 'insideBase' | 'beyond')[];
}): LabelCandidate[] {
  const { centre, base, tip, w, h, gap, horizontal, order } = opts;
  const half = (horizontal ? w : h) / 2;
  const outward = Math.sign(tip - base) || (horizontal ? 1 : -1);

  const at = (pos: EMU): Rect =>
    horizontal
      ? { x: Math.round(pos - w / 2), y: Math.round(centre - h / 2), w, h }
      : { x: Math.round(centre - w / 2), y: Math.round(pos - h / 2), w, h };

  const position = (kind: (typeof order)[number]): EMU => {
    switch (kind) {
      case 'outsideEnd':
        return tip + outward * (half + gap);
      case 'insideEnd':
        return tip - outward * (half + gap);
      case 'insideCenter':
        return (base + tip) / 2;
      case 'insideBase':
        return base + outward * (half + gap);
      case 'beyond':
        // Well clear of the mark, for a label that will carry a leader line.
        return tip + outward * (half + gap * 4);
    }
  };

  return order.map((kind, i) => ({ rect: at(position(kind)), cost: i }));
}
