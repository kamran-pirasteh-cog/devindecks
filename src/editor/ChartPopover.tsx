'use client';

/**
 * The chart picker, anchored to the toolbar's Charts button.
 *
 * Charts belong next to the other insert actions, not in a drawer tab: adding
 * a chart is the same kind of act as adding a shape or a text box, and burying
 * it behind a panel made it feel like a separate mode.
 *
 * It opens on the tiles: the chart TYPE is the question, and the answers about
 * the data — measure, period, cuts — are asked afterwards by the setup step,
 * where they can be asked in the terms the picked chart actually has. Asking
 * for a free-text description first put the same questions in a place that
 * couldn't show what they'd do to the picture.
 *
 * Every tile is drawn by the real compiler rather than an icon, so a tile can't
 * promise something the chart doesn't deliver. They're memoised per design
 * system — compiling fourteen charts is cheap, but not on every render.
 *
 * Manual picks are the brand's styled variants first, then the plain layouts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SlideView } from '@/render/SlideView';
import { stampProvenance } from '@/charts/provenance';
import {
  chartStyleForVariant,
  defaultVariantIdFor,
  dsForChartVariant,
} from '@/charts/style';
import { CHART_KIND_LABELS } from '@/charts/kinds';
import {
  CHART_LAYOUTS,
  LAYOUT_GROUPS,
  layoutForKind,
  type ChartLayout,
} from '@/charts/layouts';
import { carrySetup, defaultSetup, formFor, type ChartSetup } from '@/charts/setupForm';
import { specFromSetup } from '@/charts/setupSpec';
import { ChartSetupStep } from './chart/ChartSetupStep';
import {
  defaultChartSpec,
  sampleWaterfallData,
  setChartOrientation,
  supportsOrientation,
  type ChartOrientation,
  token,
  type ChartSpec,
  type DesignSystem,
  type SlideElement,
  type ChartStyleVariant,
} from '@/model';
import { compileChart } from '@/chart/compile';
import { OVERLAY_Z } from './layers';

/**
 * Tile size, in pixels, and the tile BOX is exactly this wide.
 *
 * `SlideView` takes a pixel width and derives its height from the slide's own
 * dimensions, so a thumbnail is always the deck's aspect ratio — 16:9 — and the
 * job here is to stop the box around it being some other shape. The tiles used
 * to sit in a four-column grid that stretched them, which drew a 16:9 chart in
 * a 2.5:1 frame with the difference in white. So they lay out as a wrapping row
 * of fixed-width tiles instead: the frame is the thumbnail, and a narrow dialog
 * reflows rather than distorting.
 */
const TILE_W = 200;
const ORIENTATION_KEY = 'devindesign.chart.orientation';
const PREVIEW_SLIDE = { w: 12_192_000, h: 6_858_000 };

const PREVIEW_FRAME = {
  x: Math.round(PREVIEW_SLIDE.w * 0.05),
  y: Math.round(PREVIEW_SLIDE.h * 0.05),
  w: Math.round(PREVIEW_SLIDE.w * 0.9),
  h: Math.round(PREVIEW_SLIDE.h * 0.9),
};

const compilePreview = (spec: ChartSpec, ds: DesignSystem): SlideElement[] =>
  compileChart({ id: 'preview', groupId: 'pg', frame: PREVIEW_FRAME, spec }, ds).elements;

/** What the picker knows about the deck it's inserting into. */
export interface ChartPickerContext {
  deckTitle?: string;
  deckTags?: string[];
  slideTitle?: string;
}

type Phase = 'browse' | 'setup';

/**
 * A tile that has been picked but not yet inserted, and the answers gathered
 * for it so far. The variant rides along so a brand-styled pick keeps its style
 * through the setup step — the tile and the inserted chart have to agree.
 */
interface Chosen {
  layout: ChartLayout;
  variantId?: string;
  setup: ChartSetup;
  /** The sample spec, for "insert blank instead" — the old behaviour. */
  blank: ChartSpec;
}

export function ChartPopover({
  ds,
  context,
  onPick,
  onClose,
}: {
  ds: DesignSystem;
  context?: ChartPickerContext;
  onPick: (spec: ChartSpec, variantId?: string) => void;
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

  const [phase, setPhase] = useState<Phase>('browse');
  const [chosen, setChosen] = useState<Chosen | null>(null);

  /**
   * The day relative periods are counted back from. Read once per open rather
   * than per render: the same picker session must not lay out one range in the
   * preview and a different one on insert if it happens to straddle midnight.
   */
  const [asOf] = useState(() => new Date().toISOString().slice(0, 10));

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
      CHART_LAYOUTS.map((o) => {
        // The brand's chart style reaches a chart at the moment it's created,
        // so the tile shows what you'll actually get rather than the house
        // default the design system has since overridden.
        //
        // Including this kind's DEFAULT variant, which is what "a column
        // chart" means once a brand has defined one. That's also why the
        // "Brand styles" row below lists only the alternates: the default
        // isn't a separate thing to pick, it's what these tiles already are.
        const variantId = defaultVariantIdFor(ds, o.kind);
        const base = defaultChartSpec(o.kind, o.stack, chartStyleForVariant(ds, variantId));
        if (o.waterfall && base.kind === 'waterfall') {
          base.data = sampleWaterfallData(o.waterfall);
        }
        if (o.render && base.kind === 'combo') {
          base.render = { ...o.render };
        }
        const spec = supportsOrientation(o.kind)
          ? setChartOrientation(base, orientation)
          : base;
        return {
          option: o,
          spec,
          variantId,
          slide: {
            id: `${o.id}-${orientation}`,
            elements: compilePreview(spec, dsForChartVariant(ds, variantId)),
          },
        };
      }),
    [ds, orientation],
  );

  /**
   * The brand's own styled types — "our gridless column", "our thin line".
   *
   * Formatting only, no data and no archetype: dropping one is dropping a
   * blank chart of that kind drawn the house way. They keep tracking the
   * variant afterwards (the instance stores an id, not a copy).
   */
  const variantPreviews = useMemo(
    () =>
      (ds.chartVariants ?? [])
        // The defaults are already the plain tiles below; listing them here too
        // would offer the same chart twice under two names.
        .filter((v) => defaultVariantIdFor(ds, v.kind) !== v.id)
        .map((v) => {
        const styled = dsForChartVariant(ds, v.id);
        const base = defaultChartSpec(v.kind, 'clustered', styled.chart);
        const spec = supportsOrientation(v.kind)
          ? setChartOrientation(base, orientation)
          : base;
        return {
          variant: v,
          spec,
          slide: {
            id: `var-${v.id}-${orientation}`,
            elements: compilePreview(spec, styled),
          },
        };
      }),
    [ds, orientation],
  );

  /**
   * The chart the setup answers make right now, drawn by the real compiler in
   * the variant's own style. Same object the Insert button hands over, so the
   * preview can't promise a chart the slide won't get.
   */
  // The context's FIELDS, not the object: the toolbar builds a fresh one every
  // render, and depending on it would recompile the chart on each keystroke
  // elsewhere in the editor.
  const { deckTitle, deckTags, slideTitle } = context ?? {};
  const configured = useMemo(() => {
    // Gated on the phase as well as the choice: the choice OUTLIVES a trip back
    // to the grid, so that changing your mind about the picture keeps the
    // answers — and compiling a chart nobody is looking at is wasted work.
    if (!chosen || phase !== 'setup') return null;
    const styled = chosen.variantId ? dsForChartVariant(ds, chosen.variantId) : ds;
    const spec = specFromSetup(chosen.layout, chosen.setup, styled, {
      orientation,
      asOf,
      deckTitle,
      deckTags,
      slideTitle,
    });
    return { spec, elements: compilePreview(spec, styled) };
  }, [chosen, phase, ds, orientation, asOf, deckTitle, deckTags, slideTitle]);

  /** Hand a finished spec to the slide. One path, so provenance can't be missed. */
  const insert = (spec: ChartSpec, variantId?: string) => {
    onPick(stampProvenance(structuredClone(spec), ds), variantId);
    onClose();
  };

  return (
    // A centred dialog rather than a dropdown hanging off the toolbar button.
    // Inserting a chart is a decision with a form and a preview in it, and 36rem
    // of popover pinned to the top-right corner is what forced the preview to
    // compete with the fields for the same three hundred pixels.
    <div
      style={{ zIndex: OVERLAY_Z }}
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        ref={ref}
        className="dd-format-bar flex max-h-[85vh] w-full max-w-4xl flex-col overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
      {phase === 'setup' && chosen && configured ? (
        <ChartSetupStep
          ds={ds}
          layout={chosen.layout}
          setup={chosen.setup}
          elements={configured.elements}
          asOf={asOf}
          onChange={(setup) => setChosen({ ...chosen, setup })}
          onInsert={() => insert(configured.spec, chosen.variantId)}
          onBlank={() => insert(chosen.blank, chosen.variantId)}
          // Back to the grid, and the answers stay put — `onChoose` carries
          // them onto whatever gets picked next.
          onBack={() => setPhase('browse')}
        />
      ) : (
        <ManualGrid
          ds={ds}
          orientation={orientation}
          onOrientation={setOrientation}
          previews={previews}
          variantPreviews={variantPreviews}
          onChoose={(layout, blank, variantId) => {
            setChosen((prev) => ({
              layout,
              variantId,
              blank,
              // Everything the new chart still has a home for is kept — the
              // timeframe above all, which is the answer nobody wants to give
              // twice.
              setup: prev
                ? carrySetup(prev.setup, layout, asOf)
                : defaultSetup(formFor(layout), asOf),
            }));
            setPhase('setup');
          }}
        />
      )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Manual                                                             */
/* ------------------------------------------------------------------ */

function OrientationToggle({
  value,
  onChange,
}: {
  value: ChartOrientation;
  onChange: (o: ChartOrientation) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-zinc-200 dark:border-zinc-700">
      {(['vertical', 'horizontal'] as const).map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          title={o === 'vertical' ? 'Columns run upward' : 'Bars run across'}
          className={`px-2 py-0.5 text-[11px] font-medium capitalize transition ${
            value === o
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

interface LayoutPreview {
  option: ChartLayout;
  spec: ChartSpec;
  /** This kind's default brand style, if it has one — stamped on insert. */
  variantId?: string;
  slide: { id: string; elements: SlideElement[] };
}

interface VariantPreview {
  variant: ChartStyleVariant;
  spec: ChartSpec;
  slide: { id: string; elements: SlideElement[] };
}

function ManualGrid({
  ds,
  orientation,
  onOrientation,
  previews,
  variantPreviews,
  onChoose,
}: {
  ds: DesignSystem;
  orientation: ChartOrientation;
  onOrientation: (o: ChartOrientation) => void;
  previews: LayoutPreview[];
  variantPreviews: VariantPreview[];
  /**
   * A tile picks a chart to SET UP, not one to insert. The sample spec comes
   * along so the setup step's "insert blank instead" can drop exactly what this
   * tile used to drop, unchanged.
   */
  onChoose: (layout: ChartLayout, blank: ChartSpec, variantId?: string) => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Orientation
        </span>
        <OrientationToggle value={orientation} onChange={onOrientation} />
      </div>

      {variantPreviews.length ? (
        <div className="mb-3">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Brand styles
            </span>
            <span className="text-[10px] text-zinc-400">
              Blank charts drawn the house way — they follow Admin as it changes
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {variantPreviews.map(({ variant, spec, slide }) => (
              <Tile
                key={variant.id}
                ds={ds}
                slide={slide}
                name={`${CHART_KIND_LABELS[variant.kind]} · ${variant.name}`}
                title={`Insert a ${variant.name} ${CHART_KIND_LABELS[
                  variant.kind
                ].toLowerCase()} chart`}
                // A variant names a kind, not an archetype — the plain layout
                // of that kind is what its questions are asked about.
                onClick={() => {
                  const layout = layoutForKind(variant.kind);
                  if (layout) onChoose(layout, spec, variant.id);
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {LAYOUT_GROUPS.map((group) => (
        <div key={group} className="mb-3 last:mb-0">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {group}
          </div>
          <div className="flex flex-wrap gap-2">
            {previews
              .filter((p) => p.option.group === group)
              .map(({ option, spec, slide, variantId }) => (
                <Tile
                  key={option.id}
                  ds={ds}
                  slide={slide}
                  name={option.name}
                  title={`Insert ${option.name.toLowerCase()} — ${option.purpose}`}
                  // No template, but the brand version still gets stamped —
                  // that's what "Brand updated" later keys off.
                  onClick={() => onChoose(option, spec, variantId)}
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
    </>
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
      // Exactly the thumbnail's width, so the frame can't be a different shape
      // from the slide inside it.
      style={{ width: TILE_W }}
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
