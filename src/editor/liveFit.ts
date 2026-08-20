/**
 * The box a text element takes WHILE IT IS BEING TYPED INTO — the rule behind
 * the selection hugging its text in real time instead of only when the edit
 * ends.
 *
 * Height only. Width is the author's decision (it's what the paragraphs wrap
 * at), so it never moves here; growing it would rewrap the text under the caret
 * mid-word, and shrinking it would rewrap it twice.
 *
 * Which way the height is allowed to move depends on the body's own autofit:
 *
 * - 'resize' — the box IS the text's size, so it follows the text both ways.
 * - 'shrink' — the TEXT is what gives; the box is fixed by definition, so this
 *   rule declines to touch it.
 * - 'none' / unset — grow only. A box the author sized (a title band, a
 *   template's body placeholder) keeps its size while the text fits in it, and
 *   grows to contain the text once it doesn't, which is the case where the
 *   selection rectangle used to cut through the words it was around.
 *
 * The edge that stays put is the one the text is anchored to, so the type
 * doesn't slide out from under the caret: a top-anchored box grows downwards, a
 * bottom-anchored one upwards, a middle-anchored one from both edges at once.
 * Rotation is applied to that offset rather than to the finished rect, for the
 * same reason as in `stickyGrowth` — the growth is along the box's OWN downward
 * axis, which is not the slide's once the box is turned.
 */
import type { Autofit, EMU, Rect, VerticalAnchor } from '@/model';

const centreOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** An offset from the box's centre, turned into the box's own frame. */
const rotateOffset = (dx: number, dy: number, deg: number) => {
  if (!deg) return { dx, dy };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
};

export function liveFitRect(
  rect: Rect,
  /** What the text needs, insets included — the open editor's own height. */
  contentH: EMU,
  opts: {
    anchor?: VerticalAnchor;
    autofit?: Autofit;
    rotation?: number;
    /**
     * Movement below this is noise, not a new line: measuring type at a given
     * zoom lands a fraction of a pixel either side of the height the model
     * round-trips to, and writing that back on every keystroke would churn the
     * deck (and the undo burst) for no visible change.
     */
    tolerance?: EMU;
  } = {},
): Rect | null {
  const { anchor = 'top', autofit, rotation = 0, tolerance = 0 } = opts;
  if (autofit === 'shrink') return null;
  if (!(contentH > 0)) return null;

  const wanted = Math.round(autofit === 'resize' ? contentH : Math.max(rect.h, contentH));
  if (Math.abs(wanted - rect.h) <= tolerance) return null;

  // How far the centre travels: half the growth for a pinned top or bottom
  // edge, none at all when the text is anchored to the middle.
  const shift = anchor === 'middle' ? 0 : ((wanted - rect.h) / 2) * (anchor === 'bottom' ? -1 : 1);
  const c = centreOf(rect);
  const { dx, dy } = rotateOffset(0, shift, rotation);
  return {
    x: Math.round(c.x + dx - rect.w / 2),
    y: Math.round(c.y + dy - wanted / 2),
    w: rect.w,
    h: wanted,
  };
}
