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
 * Exported because the canvas needs the same maths to map a turned chart's
 * parts back into layout space before it resizes them.
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
 * The FOOTPRINT a laid-out box ends up covering on the slide.
 *
 * `turnRect` keeps a primitive's width and height and hands back a spin,
 * because the primitive itself is drawn rotated — a tick label turned on its
 * side is still the same box, tipped over. A box that will NOT be rotated needs
 * the other answer: at a quarter turn the sides swap, so the plot solved 4.5in
 * wide and 8in tall in the transposed frame covers 8in by 4.5in once the chart
 * is turned. Anything hung off the plot but drawn upright — an inside legend —
 * has to be positioned against that, or it lands where the chart isn't.
 */
export function turnBox(rect: Rect, frame: Rect, rotation: number): Rect {
  const { rect: turned, spin } = turnRect(rect, frame, rotation);
  if (spin !== 90 && spin !== 270) return turned;
  const cx = turned.x + turned.w / 2;
  const cy = turned.y + turned.h / 2;
  return {
    x: Math.round(cx - turned.h / 2),
    y: Math.round(cy - turned.w / 2),
    w: turned.h,
    h: turned.w,
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

const FLIP_ALIGN = { left: 'right', right: 'left', center: 'center', justify: 'justify' } as const;
const FLIP_ANCHOR = { top: 'bottom', bottom: 'top', middle: 'middle' } as const;

type Align = keyof typeof FLIP_ALIGN;
type Anchor = keyof typeof FLIP_ANCHOR;

/**
 * Which text reads horizontally however the chart is turned.
 *
 * The distinction is whether the words run ALONG the thing they label or sit
 * BESIDE it. An axis title runs along its axis, so it turns with the axis and
 * ends up reading up the side of a turned chart — which is where an axis title
 * belongs. A tick, a category name, a data label and a total all sit beside a
 * mark, and a number on its side is just harder to read; those stand back up.
 *
 * The chart's own title, its unit note and its legend never reach here at all:
 * they're solved against the chart's real box and left out of the turn — see
 * `compileCartesian`.
 */
function readsHorizontally(el: SlideElement): boolean {
  const ref = el.chartRef;
  if (el.type !== 'text' || !ref) return false;
  if (ref.part === 'label' || ref.part === 'total') return true;
  return ref.part === 'axis' && ref.sub === 'tick';
}

/**
 * Where each end of a text box lands after a quarter turn.
 *
 * A box's alignment is written in its own frame — "the words sit at the +x end"
 * — and standing the type back up doesn't move the plot it was hugging. So the
 * ends have to be re-labelled: after a 90° turn the +x end of the old box is
 * the +y end of the new one, which means a right-aligned tick label becomes a
 * bottom-anchored one. Get this wrong and every label drifts to the far side of
 * its own gutter, away from the axis it belongs to.
 */
const ALIGN_TO_ANCHOR = { left: 'top', right: 'bottom', center: 'middle', justify: 'middle' } as const;
const ANCHOR_TO_ALIGN = { top: 'right', bottom: 'left', middle: 'center' } as const;

function turnedEnds(align: Align, anchor: Anchor, rot: QuarterTurn) {
  switch (rot) {
    case 90:
      return { align: ANCHOR_TO_ALIGN[anchor], anchor: ALIGN_TO_ANCHOR[align] };
    case 270:
      // The mirror of 90°: both mappings run the other way round.
      return {
        align: FLIP_ALIGN[ANCHOR_TO_ALIGN[anchor]],
        anchor: FLIP_ANCHOR[ALIGN_TO_ANCHOR[align]],
      };
    case 180:
      return { align: FLIP_ALIGN[align], anchor: FLIP_ANCHOR[anchor] };
    default:
      return { align, anchor };
  }
}

/**
 * Stand a label back up.
 *
 * Only the centre moves. The box arrives already shaped the way the words will
 * want it — the placers lay a label out in its final proportions and position
 * it by the footprint it will occupy on the way there, matching the gutter
 * `solveFrame` cut under `uprightText` — so all that is left is to drop the
 * angle and re-label the ends.
 */
function standUp(el: SlideElement, rect: Rect, rot: QuarterTurn): SlideElement {
  const upright: SlideElement = { ...el, rect, rotation: undefined };
  if (upright.type !== 'text' || !upright.body) return upright;
  const anchor = upright.body.anchor ?? 'middle';
  // A chart label is one paragraph, so the box's single alignment is the one
  // that decides the new anchor; each paragraph then takes the new align.
  const align = upright.body.paragraphs[0]?.align ?? 'center';
  const ends = turnedEnds(align, anchor, rot);
  return {
    ...upright,
    body: {
      ...upright.body,
      anchor: ends.anchor,
      paragraphs: upright.body.paragraphs.map((p) => ({ ...p, align: ends.align })),
    },
  };
}

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
    if (readsHorizontally(el)) return standUp(el, rect, rot);
    const turned: SlideElement = { ...el, rect, rotation: norm360((el.rotation ?? 0) + rot) };
    return el.type === 'text' && isUpsideDown(turned.rotation ?? 0) ? unflipText(turned) : turned;
  });
}
