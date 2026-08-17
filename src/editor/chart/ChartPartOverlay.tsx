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
 * the painted box disagree in the first place.
 */
import type { ChartInstance, Slide, SlideElement } from '@/model';
import { MOVEABLE_Z } from '../layers';

/** Legend edges, in the order they read around a chart. */
export type LegendSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * The side of a chart a point is nearest, in the legend's own terms.
 *
 * Normalised by the frame's own half-width and half-height before comparing, so
 * "nearest side" means nearest in PROPORTION. Raw pixels get this wrong on any
 * chart that isn't square: on a wide chart the top and bottom edges are a long
 * way from the centre in absolute terms, so a legend dropped just above the
 * middle would snap to the left.
 *
 * Both arguments are in the same space — canvas px — which is why this takes a
 * scaled frame rather than the EMU one and can be tested without a browser.
 */
export function nearestLegendSide(
  frame: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
): LegendSide {
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

function boxOf(el: SlideElement, scale: number) {
  const w = el.rect.w * scale;
  const h = el.rect.h * scale;
  const padX = Math.max(0, (MIN_PX - w) / 2);
  const padY = Math.max(0, (MIN_PX - h) / 2);
  return {
    left: 0,
    top: 0,
    width: w + padX * 2,
    height: h + padY * 2,
    transform: `translate(${el.rect.x * scale - padX}px, ${el.rect.y * scale - padY}px)${
      el.rotation ? ` rotate(${el.rotation}deg)` : ''
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
          style={boxOf(hovered, scale)}
        />
      ) : null}
      {selected.map((el) => (
        <div
          key={el.id}
          className="absolute rounded-[2px] ring-2 ring-indigo-500"
          style={boxOf(el, scale)}
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
 * The legend's position is one of four sides, so dragging it is a SNAP, not a
 * free move — showing four targets and lighting the nearest is the honest
 * picture of that, and it's what PowerPoint's own legend drag settles into.
 * Drawn against the chart's frame rather than the slide: the sides belong to
 * the chart.
 */
export function LegendDropZones({
  chart,
  active,
  scale,
}: {
  chart: ChartInstance;
  active: LegendSide;
  scale: number;
}) {
  const f = chart.frame;
  const x = f.x * scale;
  const y = f.y * scale;
  const w = f.w * scale;
  const h = f.h * scale;
  // A band deep enough to aim at on a small chart, never deeper than a third of
  // the chart — past that the four zones meet in the middle and the nearest-side
  // test is deciding between overlapping targets.
  const band = Math.max(18, Math.min(w, h) / 5);

  const zones: { side: LegendSide; style: React.CSSProperties }[] = [
    { side: 'top', style: { left: x, top: y, width: w, height: band } },
    { side: 'bottom', style: { left: x, top: y + h - band, width: w, height: band } },
    { side: 'left', style: { left: x, top: y, width: band, height: h } },
    { side: 'right', style: { left: x + w - band, top: y, width: band, height: h } },
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
