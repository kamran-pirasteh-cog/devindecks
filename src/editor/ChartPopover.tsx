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
 *
 * Two sources, in this order: the house's own chart TEMPLATES from Admin first,
 * then the plain kinds. A template is the whole point of having Admin — a
 * revenue waterfall the house has already argued about beats a blank one — so
 * it goes above the fold, and picking one stamps provenance so the chart can
 * later be told its template moved.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SlideView } from '@/render/SlideView';
import {
  listChartTemplates,
  seedChartTemplatesIfFirstRun,
  type StoredChartTemplate,
} from '@/charts/repository';
import { stampProvenance } from '@/charts/provenance';
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
  type SlideElement,
  type StackMode,
} from '@/model';
import { compileChart } from '@/chart/compile';
import { OVERLAY_Z } from './layers';

interface ChartOption {
  id: string;
  name: string;
  kind: ChartKind;
  stack: StackMode;
  group: 'Bars' | 'Trends' | 'Combo' | 'Waterfall' | 'Composition' | 'Relationships';
  /**
   * A variant of the same KIND, differing only in its starting data. A bridge
   * that builds up and one that builds down are the same chart type and two
   * genuinely different things to say with it.
   */
  waterfall?: WaterfallDirection;
  /**
   * Combo only: which series are drawn as something other than columns. The
   * combo variants are one kind with different per-series render modes, so the
   * tile carries the map rather than there being a kind per combination.
   */
  render?: Record<string, 'column' | 'line' | 'area'>;
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

  // A combo is how a slide says "these two things are measured differently but
  // belong on the same picture" — a rate over a build, a target over actuals.
  // The columns underneath can stack or cluster, and that's a real choice about
  // what's being read, so it's a tile rather than a setting to find afterwards.
  // Area + line isn't offered: two filled bands and a stroke on one plot is
  // three things competing for the same space, and the line stops reading.
  {
    id: 'combo-stacked-line',
    name: 'Stacked + line',
    kind: 'combo',
    stack: 'stacked',
    group: 'Combo',
    render: { s2: 'line' },
  },
  {
    id: 'combo-clustered-line',
    name: 'Clustered + line',
    kind: 'combo',
    stack: 'clustered',
    group: 'Combo',
    render: { s2: 'line' },
  },

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

const GROUPS = [
  'Bars',
  'Trends',
  'Combo',
  'Waterfall',
  'Composition',
  'Relationships',
] as const;

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

  // Read once, on open: localStorage is the seam every repository here sits
  // behind, and a picker that re-read it per render would recompile the tiles.
  const [templates, setTemplates] = useState<StoredChartTemplate[]>([]);
  useEffect(() => {
    seedChartTemplatesIfFirstRun();
    setTemplates(listChartTemplates());
  }, []);

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
        if (o.render && base.kind === 'combo') {
          base.render = { ...o.render };
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

  // Templates obey the orientation toggle too. The control sits above every
  // tile in the picker, so a template drawn the other way round reads as the
  // toggle being broken rather than as the author's choice — and a template is
  // a starting point, not a fixed picture. Kinds with no side to lie on (pie,
  // scatter, bubble) are left exactly as the author built them.
  const templatePreviews = useMemo(
    () =>
      templates.map((t) => {
        const spec = supportsOrientation(t.spec.kind)
          ? setChartOrientation(t.spec, orientation)
          : t.spec;
        const frame = {
          x: Math.round(PREVIEW_SLIDE.w * 0.05),
          y: Math.round(PREVIEW_SLIDE.h * 0.05),
          w: Math.round(PREVIEW_SLIDE.w * 0.9),
          h: Math.round(PREVIEW_SLIDE.h * 0.9),
        };
        const { elements } = compileChart({ id: 'preview', groupId: 'pg', frame, spec }, ds);
        return { template: t, spec, slide: { id: `tpl-${t.id}-${orientation}`, elements } };
      }),
    [templates, ds, orientation],
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

      {templatePreviews.length ? (
        <div className="mb-3">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              House templates
            </span>
            <span className="text-[10px] text-zinc-400">
              Set up in Admin — shown the orientation you picked
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {templatePreviews.map(({ template, spec, slide }) => (
              <Tile
                key={template.id}
                ds={ds}
                slide={slide}
                name={template.name}
                title={template.description || `Insert ${template.name}`}
                onClick={() => {
                  // Stamped, so this chart can be told later that the template
                  // or the brand moved under it.
                  // The tile's spec, not the stored one — what you saw is what
                  // lands on the slide, orientation included.
                  onPick(stampProvenance(structuredClone(spec), ds, template));
                  onClose();
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {GROUPS.map((group) => (
        <div key={group} className="mb-3 last:mb-0">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {group}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {previews
              .filter((p) => p.option.group === group)
              .map(({ option, spec, slide }) => (
                <Tile
                  key={option.id}
                  ds={ds}
                  slide={slide}
                  name={option.name}
                  title={`Insert ${option.name.toLowerCase()}`}
                  onClick={() => {
                    // No template, but the brand version still gets stamped —
                    // that's what "Brand updated" later keys off.
                    onPick(stampProvenance(structuredClone(spec), ds));
                    onClose();
                  }}
                />
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

function Tile({
  ds,
  slide,
  name,
  title,
  onClick,
}: {
  ds: DesignSystem;
  slide: { id: string; elements: SlideElement[] };
  name: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="overflow-hidden rounded-md border border-zinc-200 bg-white text-left transition hover:border-indigo-400 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="border-b border-zinc-100 dark:border-zinc-800">
        <SlideView
          slide={{ ...slide, background: { kind: 'solid', color: token('surface.base') } }}
          slideSize={PREVIEW_SLIDE}
          designSystem={ds}
          width={TILE_W}
        />
      </div>
      <div className="truncate px-1.5 py-1 text-[10px] font-medium">{name}</div>
    </button>
  );
}
