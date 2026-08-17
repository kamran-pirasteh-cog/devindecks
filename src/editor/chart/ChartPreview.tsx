'use client';

/**
 * The click-to-format chart preview, shared by the datasheet and Admin.
 *
 * Formatting a chart part by clicking the part is the whole interaction — a
 * dropdown listing "y2 axis" makes you find the axis in a list you can't see.
 * So the preview compiles through the real engine, hit-tests the compiled
 * primitives, and hands whatever was clicked back as a `ChartRef`.
 *
 * It lives here rather than inside `ChartDatasheetPanel` because the chart
 * TEMPLATE editor needs exactly the same surface. A template authored through
 * a parallel admin-only form drifts from what it produces, and the drift is
 * invisible until someone inserts one.
 */
import { useCallback, useMemo, useRef } from 'react';
import { compileChart } from '@/chart/compile';
import { FitSlideView } from '@/render/FitSlideView';
import {
  chartOrientation,
  setChartOrientation,
  supportsOrientation,
  type ChartRef,
  type ChartSpec,
  type DesignSystem,
  type Fill,
} from '@/model';
import { hitTestChart, rectOfPart } from './previewHitTest';
import type { ChartPatch } from './ChartPartOptions';

export function ChartPreview({
  spec,
  ds,
  size,
  rotation,
  background,
  part,
  onPart,
  patch,
  className,
}: {
  spec: ChartSpec;
  ds: DesignSystem;
  /** The chart's own frame, in EMU. Compiled at this size, then scaled to fit. */
  size: { w: number; h: number };
  rotation?: number;
  background?: Fill;
  part: ChartRef | null;
  onPart: (part: ChartRef | null) => void;
  patch: ChartPatch;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Compiled at the origin rather than at the chart's place on the slide —
  // placers lay out relative to the frame, so the geometry is identical and
  // the preview has no slide margins to crop.
  const slide = useMemo(() => {
    const { elements } = compileChart(
      {
        id: 'chart-preview',
        groupId: 'chart-preview-g',
        frame: { x: 0, y: 0, w: size.w, h: size.h },
        spec,
        ...(rotation === undefined ? {} : { rotation }),
      },
      ds,
    );
    return { id: 'chart-preview', elements, background };
  }, [spec, ds, size.w, size.h, rotation, background]);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.width < 1) return;
      // Screen px back to the EMU the elements are laid out in — the preview is
      // one uniform scale, so this is a single divide.
      const perPx = size.w / box.width;
      const x = (e.clientX - box.left) * perPx;
      const y = (e.clientY - box.top) * perPx;
      // A few px of slop, in EMU: a tick label is a hairline tall and a click
      // that has to be exact reads as a broken control.
      onPart(hitTestChart(slide.elements, x, y, 4 * perPx));
    },
    [onPart, size.w, slide.elements],
  );

  /** The ring drawn over whatever is selected, in fractions of the preview. */
  const partBox = useMemo(() => {
    if (!part) return null;
    const rect = rectOfPart(slide.elements, part);
    if (!rect) return null;
    return {
      left: `${(rect.x / size.w) * 100}%`,
      top: `${(rect.y / size.h) * 100}%`,
      width: `${(rect.w / size.w) * 100}%`,
      height: `${(rect.h / size.h) * 100}%`,
    };
  }, [part, size.h, size.w, slide.elements]);

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`relative cursor-pointer overflow-hidden bg-white dark:bg-zinc-900 ${className ?? ''}`}
    >
      <FitSlideView slide={slide} slideSize={size} designSystem={ds} />
      {partBox ? (
        <span
          // Purely an indicator: it must never eat the next click, which is
          // usually on a neighbouring part.
          className="pointer-events-none absolute rounded-sm ring-2 ring-indigo-500/70"
          style={partBox}
        />
      ) : null}
      <OrientationArrows spec={spec} patch={patch} />
    </div>
  );
}

/**
 * Orientation, on the preview instead of in a dropdown.
 *
 * Turning bars on their side is a change you judge by looking at the chart, so
 * the control belongs on the chart: two arrows pointing the way the bars will
 * run. Absent entirely for the kinds that have no orientation to speak of — a
 * pie doesn't lie down.
 */
function OrientationArrows({ spec, patch }: { spec: ChartSpec; patch: ChartPatch }) {
  if (!supportsOrientation(spec.kind)) return null;

  const current = chartOrientation(spec);
  const options: { value: 'vertical' | 'horizontal'; glyph: string; title: string }[] = [
    { value: 'vertical', glyph: '↑', title: 'Bars run up' },
    { value: 'horizontal', glyph: '→', title: 'Bars run across' },
  ];

  return (
    <div className="absolute right-1.5 top-1.5 flex overflow-hidden rounded border border-black/10 bg-white/85 shadow-sm backdrop-blur dark:border-white/15 dark:bg-zinc-900/85">
      {options.map((o) => (
        <button
          key={o.value}
          // The click must not also land on the preview and re-hit-test to
          // whatever is now under the cursor.
          onClick={(e) => {
            e.stopPropagation();
            patch((s) => Object.assign(s, setChartOrientation(s, o.value)));
          }}
          title={o.title}
          aria-pressed={current === o.value}
          className={`flex h-6 w-6 items-center justify-center text-[13px] leading-none ${
            current === o.value
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
              : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          {o.glyph}
        </button>
      ))}
    </div>
  );
}
