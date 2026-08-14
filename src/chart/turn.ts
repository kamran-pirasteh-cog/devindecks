/**
 * Quarter-turn orientation for a whole chart.
 *
 * Charts are laid out upright and then turned, rather than being laid out in a
 * turned frame: text can't be solved at an angle (the gutter widths, the tick
 * count and the label collision pass all assume horizontal type), and a chart
 * on its side is the same chart, not a different layout.
 *
 * The turn is exact because it is always a multiple of 90°: every primitive
 * keeps its size, orbits the frame's centre, and spins by the same angle about
 * its own — which is precisely what CSS `rotate` and OOXML `rot` both do.
 */
import type { Rect, SlideElement } from '@/model';

export type QuarterTurn = 0 | 90 | 180 | 270;

/** The nearest quarter turn to any angle, normalized into [0, 360). */
export function snapQuarterTurn(deg: number): QuarterTurn {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as QuarterTurn;
}

/** The centre a rotated chart turns about — the layout frame's centre. */
const centreOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Turn a point about `c` by a quarter turn, clockwise in screen coordinates. */
function orbit(x: number, y: number, c: { x: number; y: number }, rot: QuarterTurn) {
  const dx = x - c.x;
  const dy = y - c.y;
  switch (rot) {
    case 90:
      return { x: c.x - dy, y: c.y + dx };
    case 180:
      return { x: c.x - dx, y: c.y - dy };
    case 270:
      return { x: c.x + dy, y: c.y - dx };
    default:
      return { x, y };
  }
}

/**
 * The transform a single primitive gets when its chart is turned: same size,
 * orbited centre, own angle advanced by the turn.
 *
 * Exported because the canvas paints the live rotate gesture with the same
 * maths it will be committed with — otherwise the chart would jump on mouseup.
 */
export function turnRect(
  rect: Rect,
  frame: Rect,
  rotation: number,
): { rect: Rect; spin: QuarterTurn } {
  const rot = snapQuarterTurn(rotation);
  if (!rot) return { rect: { ...rect }, spin: 0 };
  const c = orbit(rect.x + rect.w / 2, rect.y + rect.h / 2, centreOf(frame), rot);
  return {
    rect: { x: Math.round(c.x - rect.w / 2), y: Math.round(c.y - rect.h / 2), w: rect.w, h: rect.h },
    spin: rot,
  };
}

/**
 * The box a chart is SOLVED in so that turning it lands back on its own frame.
 *
 * A quarter turn swaps which way round the footprint runs: solve a 16:9 chart
 * in its own frame, turn it 90°, and you get a 9:16 picture centred on the
 * frame — taller than the box it belongs to and hanging out of both ends of
 * it. That is the whole "rotating a chart breaks it" bug: axis labels land off
 * the slide, the plot overlaps whatever sits above and below, and the backdrop
 * no longer covers what you can see.
 *
 * So at 90° and 270° the layout is solved in the TRANSPOSED frame — same
 * centre, width and height swapped — and the turn maps that footprint exactly
 * onto the real frame. Both frames share a centre, so `turnRect` gives the
 * same answer whichever one it is handed.
 */
export function layoutFrame(frame: Rect, rotation: number): Rect {
  const rot = snapQuarterTurn(rotation);
  if (rot === 0 || rot === 180) return frame;
  const c = centreOf(frame);
  return {
    x: Math.round(c.x - frame.h / 2),
    y: Math.round(c.y - frame.w / 2),
    w: frame.h,
    h: frame.w,
  };
}

/**
 * Where a part sits DURING a rotate gesture, before the chart re-solves.
 *
 * The commit re-lays the chart out in the transposed frame, which no gesture
 * can predict without running the whole layout on every mouse move. What it
 * can do is show the right picture in the right box: the parts orbit as they
 * will, and their centres are squeezed back onto the frame's aspect so the
 * chart turns inside its own box instead of swinging off the slide. Sizes are
 * left alone — type doesn't change point size when a chart turns — so this
 * settles slightly on drop rather than landing exactly.
 */
export function previewTurn(
  rect: Rect,
  frame: Rect,
  delta: number,
): { rect: Rect; spin: QuarterTurn } {
  const { rect: turned, spin } = turnRect(rect, frame, delta);
  if ((spin !== 90 && spin !== 270) || !frame.w || !frame.h) return { rect: turned, spin };
  const c = centreOf(frame);
  const cx = turned.x + turned.w / 2;
  const cy = turned.y + turned.h / 2;
  return {
    rect: {
      x: Math.round(c.x + (cx - c.x) * (frame.w / frame.h) - turned.w / 2),
      y: Math.round(c.y + (cy - c.y) * (frame.h / frame.w) - turned.h / 2),
      w: turned.w,
      h: turned.h,
    },
    spin,
  };
}

const norm360 = (d: number) => ((Math.round(d) % 360) + 360) % 360;

/**
 * Text is never left upside down.
 *
 * Turning a chart turns its labels with it, and half of those turns put the
 * type on its head — which is illegible, not stylish. Any angle that lands in
 * the upside-down half is brought back by 180°, so labels always read either
 * horizontally or down the side, the same two orientations a chart uses
 * upright.
 */
const isUpsideDown = (deg: number) => norm360(deg) > 90 && norm360(deg) < 270;

/**
 * The angle a primitive is finally drawn at — the canvas paints a live turn
 * with this so the preview matches what lands.
 */
export const readableAngle = (deg: number, isText: boolean) =>
  isText && isUpsideDown(deg) ? norm360(deg + 180) : norm360(deg);

const FLIP_ALIGN = { left: 'right', right: 'left', center: 'center', justify: 'justify' } as const;
const FLIP_ANCHOR = { top: 'bottom', bottom: 'top', middle: 'middle' } as const;

/**
 * Un-flip a label without moving the words.
 *
 * Turning the box back by 180° also swaps which end of it the text sits at, so
 * the alignment has to swap with it — otherwise a right-aligned tick label
 * stops hugging its axis and drifts to the far side of its box.
 */
function unflipText(el: SlideElement): SlideElement {
  if (el.type !== 'text' || !el.body) return el;
  return {
    ...el,
    rotation: norm360((el.rotation ?? 0) + 180) || undefined,
    body: {
      ...el.body,
      anchor: el.body.anchor ? FLIP_ANCHOR[el.body.anchor] : undefined,
      paragraphs: el.body.paragraphs.map((p) => ({
        ...p,
        align: p.align ? FLIP_ALIGN[p.align] : undefined,
      })),
    },
  };
}

/** Turn a compiled chart's primitives in place. A no-op at 0°. */
export function turnElements(
  elements: SlideElement[],
  frame: Rect,
  rotation = 0,
): SlideElement[] {
  const rot = snapQuarterTurn(rotation);
  if (!rot) return elements;
  return elements.map((el) => {
    const { rect } = turnRect(el.rect, frame, rot);
    const turned: SlideElement = { ...el, rect, rotation: norm360((el.rotation ?? 0) + rot) };
    return el.type === 'text' && isUpsideDown(turned.rotation ?? 0) ? unflipText(turned) : turned;
  });
}
