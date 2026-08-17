'use client';

/**
 * What the pointer is about to hit, and what it already hit.
 *
 * A chart's parts are compiled rectangles with no chrome of their own, so
 * without this a chart is a picture: you can click a segment, but nothing on
 * screen says a segment is a thing that can BE clicked, and after the click
 * Moveable draws a control box with every handle disabled — which reads as a
 * broken selection rather than as "this part is selected, and its geometry
 * belongs to the compiler".
 *
 * So two marks, and they must not look alike:
 *
 * - **hover** — a thin tint under the pointer, the affordance. It appears while
 *   the chart is the current selection context and never while a gesture is in
 *   flight (a highlight chasing the cursor mid-drag is noise).
 * - **selection** — a solid ring plus corner ticks, the state.
 *
 * Both are drawn from the ELEMENTS' own rects with the elements' own transform,
 * so a turned chart's marks stay framed; see `visualRect` for why the rect and
 * the painted box disagree in the first place. An axis is the exception: it is
 * framed as the whole band, because that is what a click on it takes.
 */
import type { ChartInstance, LegendPosition, Slide, SlideElement } from '@/model';
import { MOVEABLE_Z } from '../layers';
import { axisBandFor } from './previewHitTest';

/** Every place a legend can be dropped — the four edges, plus the two corners
 * inside the chart body. */
export type LegendSide = LegendPosition;

type Box = { x: number; y: number; w: number; h: number };

/**
 * How deep an edge band is.
 *
 * Deep enough to aim at on a small chart, never deeper than a fifth of the
 * chart — past that the four bands meet in the middle and there is no inside
 * left to drop a legend into.
 */
const bandOf = (f: Box) => Math.max(18, Math.min(f.w, f.h) / 5);

/**
 * The two inside targets: the top-left and top-right quarters of what's left of
 * the chart once the edge bands are taken off it.
 *
 * Only the TOP half of the inside is a target. An inside legend is top-aligned
 * with the value axis by definition, so a zone in the lower half would light up
 * a target nowhere near where the legend would land — and the lower half is
 * exactly where a drag heading for the bottom edge passes through.
 *
 * Empty on a chart too small to have an inside at all, which is what keeps a
 * zero-sized frame from producing negative boxes.
 */
function insideZones(f: Box): { side: LegendSide; box: Box }[] {
  const band = bandOf(f);
  const w = f.w - band * 2;
  const h = f.h - band * 2;
  if (w <= 0 || h <= 0) return [];
  return [
    { side: 'insideTopLeft', box: { x: f.x + band, y: f.y + band, w: w / 2, h: h / 2 } },
    {
      side: 'insideTopRight',
      box: { x: f.x + band + w / 2, y: f.y + band, w: w / 2, h: h / 2 },
    },
  ];
}

const contains = (b: Box, x: number, y: number) =>
  x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;

/**
 * Where a point would drop the legend, in the legend's own terms.
 *
 * Inside first, because the inside zones sit within the edge test's reach and a
 * point in one of them is unambiguous — the user aimed at the chart body, not
 * past it. Everything else falls through to the nearest edge.
 *
 * That edge is measured in PROPORTION: normalised by the frame's own half-width
 * and half-height before comparing. Raw pixels get it wrong on any chart that
 * isn't square — on a wide chart the top and bottom edges are a long way from
 * the centre in absolute terms, so a legend dropped just above the middle would
 * snap to the left.
 *
 * Both arguments are in the same space — canvas px — which is why this takes a
 * scaled frame rather than the EMU one and can be tested without a browser.
 */
export function nearestLegendSide(frame: Box, x: number, y: number): LegendSide {
  const inside = insideZones(frame).find((z) => contains(z.box, x, y));
  if (inside) return inside.side;
  const nx = (x - (frame.x + frame.w / 2)) / Math.max(1, frame.w / 2);
  const ny = (y - (frame.y + frame.h / 2)) / Math.max(1, frame.h / 2);
  // Ties go to the vertical edges: a legend is a wide, short thing, and top or
  // bottom is where it costs the plot least.
  if (Math.abs(nx) > Math.abs(ny)) return nx > 0 ? 'right' : 'left';
  return ny >= 0 ? 'bottom' : 'top';
}

/**
 * A hairline is a real part and an invisible target.
 *
 * An axis rule is zero-thickness and a gridline barely more, so a ring drawn on
 * the rect itself is a ring around nothing. Every box is grown to something a
 * person can see — which is also roughly the slop `hitTestChart` already gives
 * these parts, so the mark matches what actually gets clicked.
 */
const MIN_PX = 8;

function boxOf(el: SlideElement, scale: number, parts: SlideElement[]) {
  // An axis is framed as the strip a reader points at rather than as the one
  // tick the pointer happened to be nearest — the same band `hitTestChart`
  // takes the click in, so the mark shows what a click there would select. The
  // band is already in painted space, so the rotation is not applied twice.
  const band = el.chartRef ? axisBandFor(parts, el.chartRef) : null;
  const rect = band ?? el.rect;
  const w = rect.w * scale;
  const h = rect.h * scale;
  const padX = Math.max(0, (MIN_PX - w) / 2);
  const padY = Math.max(0, (MIN_PX - h) / 2);
  return {
    left: 0,
    top: 0,
    width: w + padX * 2,
    height: h + padY * 2,
    transform: `translate(${rect.x * scale - padX}px, ${rect.y * scale - padY}px)${
      !band && el.rotation ? ` rotate(${el.rotation}deg)` : ''
    }`,
    transformOrigin: 'center center',
  } satisfies React.CSSProperties;
}

export function ChartPartHighlights({
  slide,
  chartId,
  selectedIds,
  hoverId,
  /** Selected parts get their ring only once the user is INSIDE the chart. */
  showSelection,
  scale,
}: {
  slide: Slide;
  chartId: string;
  selectedIds: string[];
  hoverId: string | null;
  showSelection: boolean;
  scale: number;
}) {
  const mine = slide.elements.filter((e) => e.chartRef?.chartId === chartId);
  const selected = showSelection ? mine.filter((e) => selectedIds.includes(e.id)) : [];
  // Never both marks on one part: the hover tint under a selection ring just
  // muddies the ring's colour.
  const hovered =
    hoverId && !selected.some((e) => e.id === hoverId)
      ? (mine.find((e) => e.id === hoverId) ?? null)
      : null;

  if (!hovered && !selected.length) return null;

  return (
    // Purely an indicator: it sits over the marks and must never take the next
    // click, which is nearly always on a neighbouring part.
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: MOVEABLE_Z + 1 }}>
      {hovered ? (
        <div
          className="absolute rounded-[2px] bg-indigo-500/10 ring-1 ring-indigo-400/70"
          style={boxOf(hovered, scale, mine)}
        />
      ) : null}
      {selected.map((el) => (
        <div
          key={el.id}
          className="absolute rounded-[2px] ring-2 ring-indigo-500"
          style={boxOf(el, scale, mine)}
        >
          {/* Corner ticks, so a ring around a segment reads as a selection
              rather than as a border somebody set on the bar. */}
          {(['-top-[3px] -left-[3px]', '-top-[3px] -right-[3px]', '-bottom-[3px] -left-[3px]', '-bottom-[3px] -right-[3px]'] as const).map(
            (pos) => (
              <span
                key={pos}
                className={`absolute h-1.5 w-1.5 rounded-[1px] bg-white ring-1 ring-indigo-500 ${pos}`}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Where the legend would land if you dropped it now.
 *
 * The legend's position is one of six snaps — four edges and two corners inside
 * the chart body — so dragging it is a SNAP, not a free move. Showing the
 * targets and lighting the nearest is the honest picture of that, and it's what
 * PowerPoint's own legend drag settles into. Drawn against the chart's frame
 * rather than the slide: the targets belong to the chart.
 *
 * The zones are the same ones `nearestLegendSide` decides with, so what lights
 * up is what lands.
 */
export function LegendDropZones({
  chart,
  active,
  inside,
  scale,
}: {
  chart: ChartInstance;
  active: LegendSide;
  /**
   * The box an inside legend would really occupy, in EMU — the compiler's own
   * answer, passed in because only the store can run it. Without it the inside
   * targets fall back to the region you aim at, which is a quarter of the chart
   * and lands nowhere near the legend's actual corner of the plot.
   */
  inside?: Partial<Record<LegendSide, { x: number; y: number; w: number; h: number }>>;
  scale: number;
}) {
  const f = chart.frame;
  const x = f.x * scale;
  const y = f.y * scale;
  const w = f.w * scale;
  const h = f.h * scale;
  const band = bandOf({ x, y, w, h });

  const zones: { side: LegendSide; style: React.CSSProperties }[] = [
    { side: 'top', style: { left: x, top: y, width: w, height: band } },
    { side: 'bottom', style: { left: x, top: y + h - band, width: w, height: band } },
    { side: 'left', style: { left: x, top: y, width: band, height: h } },
    { side: 'right', style: { left: x + w - band, top: y, width: band, height: h } },
    ...insideZones({ x, y, w, h }).map((z) => {
      // The landing box when we know it, the catch region when we don't.
      const real = inside?.[z.side];
      const b = real
        ? { x: real.x * scale, y: real.y * scale, w: real.w * scale, h: real.h * scale }
        : z.box;
      return { side: z.side, style: { left: b.x, top: b.y, width: b.w, height: b.h } };
    }),
  ];

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: MOVEABLE_Z + 1 }}>
      {zones.map((z) => (
        <div
          key={z.side}
          className={`absolute rounded-sm border border-dashed transition-colors ${
            z.side === active
              ? 'border-indigo-500 bg-indigo-500/20'
              : 'border-indigo-400/40 bg-indigo-400/5'
          }`}
          style={z.style}
        />
      ))}
    </div>
  );
}
