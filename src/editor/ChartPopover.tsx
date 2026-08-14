'use client';

/**
 * The chart picker, anchored to the toolbar's Charts button.
 *
 * Charts belong next to the other insert actions, not in a drawer tab: adding
 * a chart is the same kind of act as adding a shape or a text box, and burying
 * it behind a panel made it feel like a separate mode.
 *
 * Every tile is drawn by the real compiler rather than an icon, so a tile can't
 * promise something the chart doesn't deliver. They're memoised per design
 * system — compiling fourteen charts is cheap, but not on every render.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SlideView } from '@/render/SlideView';
import {
  defaultChartSpec,
  sampleWaterfallData,
  type WaterfallDirection,
  setChartOrientation,
  supportsOrientation,
  withChartStyleDefaults,
  type ChartOrientation,
  token,
  type ChartKind,
  type ChartSpec,
  type DesignSystem,
  type StackMode,
} from '@/model';
import { compileChart } from '@/chart/compile';
import { OVERLAY_Z } from './layers';

interface ChartOption {
  id: string;
  name: string;
  kind: ChartKind;
  stack: StackMode;
  group: 'Bars' | 'Trends' | 'Waterfall' | 'Composition' | 'Relationships';
  /**
   * A variant of the same KIND, differing only in its starting data. A bridge
   * that builds up and one that builds down are the same chart type and two
   * genuinely different things to say with it.
   */
  waterfall?: WaterfallDirection;
}

/**
 * Nine tiles, not fifteen.
 *
 * The six column/bar tiles collapsed to three: vertical and horizontal are the
 * same three charts seen from a different side, and orientation is a control
 * here rather than a doubling of the grid. Donut is an option ON a pie and
 * area an option on a line, for the same reason — a tile each bought two
 * near-identical pictures and hid the fact that they're one chart with a
 * switch. Mekko and butterfly are gone from the picker; the engine still draws
 * a stored one, so no existing deck loses a chart.
 */
const OPTIONS: ChartOption[] = [
  { id: 'clustered', name: 'Clustered', kind: 'column', stack: 'clustered', group: 'Bars' },
  { id: 'stacked', name: 'Stacked', kind: 'column', stack: 'stacked', group: 'Bars' },
  { id: 'stacked100', name: '100% stacked', kind: 'column', stack: 'stacked100', group: 'Bars' },

  { id: 'line', name: 'Line', kind: 'line', stack: 'clustered', group: 'Trends' },
  { id: 'combo', name: 'Column + line', kind: 'combo', stack: 'stacked', group: 'Trends' },

  {
    id: 'waterfall-up',
    name: 'Build up',
    kind: 'waterfall',
    stack: 'clustered',
    group: 'Waterfall',
    waterfall: 'up',
  },
  {
    id: 'waterfall-down',
    name: 'Build down',
    kind: 'waterfall',
    stack: 'clustered',
    group: 'Waterfall',
    waterfall: 'down',
  },

  { id: 'pie', name: 'Pie', kind: 'pie', stack: 'clustered', group: 'Composition' },
  { id: 'sankey', name: 'Sankey', kind: 'sankey', stack: 'clustered', group: 'Composition' },

  { id: 'scatter', name: 'Scatter', kind: 'scatter', stack: 'clustered', group: 'Relationships' },
  { id: 'bubble', name: 'Bubble', kind: 'bubble', stack: 'clustered', group: 'Relationships' },
];

const GROUPS = ['Bars', 'Trends', 'Waterfall', 'Composition', 'Relationships'] as const;

/** Tile size. Big enough to tell a stacked column from a 100% stacked one. */
const TILE_W = 132;
const ORIENTATION_KEY = 'devindesign.chart.orientation';
const PREVIEW_SLIDE = { w: 12_192_000, h: 6_858_000 };

export function ChartPopover({
  ds,
  onPick,
  onClose,
}: {
  ds: DesignSystem;
  onPick: (spec: ChartSpec) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Orientation is part of choosing the chart, not something to go hunting for
  // afterwards — and it's remembered, because a deck that wants horizontal
  // bars usually wants them more than once.
  const [orientation, setOrientation] = useState<ChartOrientation>(() => {
    if (typeof window === 'undefined') return 'vertical';
    return window.localStorage.getItem(ORIENTATION_KEY) === 'horizontal'
      ? 'horizontal'
      : 'vertical';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(ORIENTATION_KEY, orientation);
    } catch {
      // A blocked localStorage must not take the picker down with it.
    }
  }, [orientation]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Deferred: the click that opened this would otherwise close it again.
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      clearTimeout(t);
    };
  }, [onClose]);

  const previews = useMemo(
    () =>
      OPTIONS.map((o) => {
        // The brand's chart style reaches a chart at the moment it's created,
        // so the tile shows what you'll actually get rather than the house
        // default the design system has since overridden.
        const base = defaultChartSpec(o.kind, o.stack, withChartStyleDefaults(ds.chart));
        if (o.waterfall && base.kind === 'waterfall') {
          base.data = sampleWaterfallData(o.waterfall);
        }
        const spec = supportsOrientation(o.kind)
          ? setChartOrientation(base, orientation)
          : base;
        const frame = {
          x: Math.round(PREVIEW_SLIDE.w * 0.05),
          y: Math.round(PREVIEW_SLIDE.h * 0.05),
          w: Math.round(PREVIEW_SLIDE.w * 0.9),
          h: Math.round(PREVIEW_SLIDE.h * 0.9),
        };
        const { elements } = compileChart({ id: 'preview', groupId: 'pg', frame, spec }, ds);
        return { option: o, spec, slide: { id: `${o.id}-${orientation}`, elements } };
      }),
    [ds, orientation],
  );

  return (
    <div
      ref={ref}
      style={{ zIndex: OVERLAY_Z }}
      className="dd-format-bar absolute right-0 top-9 max-h-[70vh] w-[36rem] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Orientation
        </span>
        <div className="flex overflow-hidden rounded border border-zinc-200 dark:border-zinc-700">
          {(['vertical', 'horizontal'] as const).map((o) => (
            <button
              key={o}
              onClick={() => setOrientation(o)}
              title={o === 'vertical' ? 'Columns run upward' : 'Bars run across'}
              className={`px-2 py-0.5 text-[11px] font-medium capitalize transition ${
                orientation === o
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {o}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-zinc-400">
          Pies and scatters ignore this
        </span>
      </div>

      {GROUPS.map((group) => (
        <div key={group} className="mb-3 last:mb-0">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {group}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {previews
              .filter((p) => p.option.group === group)
              .map(({ option, spec, slide }) => (
                <button
                  key={option.id}
                  onClick={() => {
                    onPick(structuredClone(spec));
                    onClose();
                  }}
                  title={`Insert ${option.name.toLowerCase()}`}
                  className="overflow-hidden rounded-md border border-zinc-200 bg-white text-left transition hover:border-indigo-400 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="border-b border-zinc-100 dark:border-zinc-800">
                    <SlideView
                      slide={{
                        ...slide,
                        background: { kind: 'solid', color: token('surface.base') },
                      }}
                      slideSize={PREVIEW_SLIDE}
                      designSystem={ds}
                      width={TILE_W}
                    />
                  </div>
                  <div className="truncate px-1.5 py-1 text-[10px] font-medium">{option.name}</div>
                </button>
              ))}
          </div>
        </div>
      ))}

      <p className="mt-2 border-t border-zinc-100 pt-2 text-[10px] leading-relaxed text-zinc-400 dark:border-zinc-800">
        A chart lands on the current slide as an object — move it, resize it,
        and put more than one on a slide. Select it and press{' '}
        <span className="font-medium">Data</span> to edit the numbers.
      </p>
    </div>
  );
}
