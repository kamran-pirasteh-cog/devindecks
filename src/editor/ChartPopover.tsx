'use client';

/**
 * The chart picker, anchored to the toolbar's Charts button.
 *
 * Charts belong next to the other insert actions, not in a drawer tab: adding
 * a chart is the same kind of act as adding a shape or a text box, and burying
 * it behind a panel made it feel like a separate mode.
 *
 * It opens by ASKING rather than by presenting a grid. "What data do you want
 * to show?" is the question an author can answer without knowing the difference
 * between a stacked and a 100% stacked column — which is most authors, most of
 * the time. The description picks the layout, names the client, sets the period
 * and the units, and then the tiles are still there for anyone who'd rather
 * choose one themselves. The recommendation always shows its reasoning next to
 * the runners-up, because a suggestion you can't argue with is one you can't
 * correct.
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
  recommendLayouts,
  type ChartRecommendation,
  type LayoutSuggestion,
} from '@/charts/intent';
import { specFromBrief } from '@/charts/briefedSpec';
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
/** The recommendation gets a bigger picture — it's a decision, not a thumbnail. */
const HERO_W = 420;
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

/**
 * The stages the insert actually goes through, named for what each one does.
 * Nothing here is a fake progress bar: each label is the step that runs while
 * it's shown, and the last one is what the chart is being built out of.
 */
const STEPS = ['Reading the brief', 'Laying out the chart', 'Compiling'] as const;
/**
 * Long enough that each label can actually be read — a stage nobody can read
 * is just a flicker — and short enough that inserting a chart still feels like
 * inserting a chart.
 */
const STEP_MS = 550;

type Phase = 'browse' | 'thinking' | 'review' | 'setup' | 'loading';

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

  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>('browse');
  const [rec, setRec] = useState<ChartRecommendation | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [step, setStep] = useState(0);

  /**
   * The day relative periods are counted back from. Read once per open rather
   * than per render: the same picker session must not lay out one range in the
   * preview and a different one on insert if it happens to straddle midnight.
   */
  const [asOf] = useState(() => new Date().toISOString().slice(0, 10));

  // Held in a ref, not in the staged-insert effect's deps: the toolbar passes
  // fresh closures on every render, and a dependency on them would restart the
  // timer each time and the insert would never land.
  const handoff = useRef({ onPick, onClose });
  useEffect(() => {
    handoff.current = { onPick, onClose };
  }, [onPick, onClose]);

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

  const recommended: LayoutSuggestion | null = useMemo(() => {
    if (!rec) return null;
    return (
      rec.suggestions.find((s) => s.layout.id === chosenId) ?? rec.suggestions[0] ?? null
    );
  }, [rec, chosenId]);

  /**
   * The chart the recommendation would insert, built from the brief and drawn
   * by the real compiler. Same object the Insert button hands over, so the
   * preview can't promise a chart the slide won't get.
   */
  const briefed = useMemo(() => {
    if (!rec || !recommended) return null;
    const spec = specFromBrief(rec.brief, { ...recommended, orientation }, ds);
    return { spec, elements: compilePreview(spec, ds) };
  }, [rec, recommended, orientation, ds]);

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

  const recommend = () => {
    if (!description.trim()) return;
    setPhase('thinking');
  };

  // The reading itself is instant; the beat exists so the panel doesn't swap
  // out from under the hands that just pressed the button.
  useEffect(() => {
    if (phase !== 'thinking') return;
    const t = setTimeout(() => {
      const next = recommendLayouts(description, {
        deckTitle: context?.deckTitle,
        deckTags: context?.deckTags,
        slideTitle: context?.slideTitle,
        asOf: new Date().toISOString().slice(0, 10),
      });
      setRec(next);
      setChosenId(next.suggestions[0]?.layout.id ?? null);
      // The recommendation has an opinion about which way the bars run; it
      // seeds the control rather than fighting it.
      if (next.suggestions[0]) setOrientation(next.suggestions[0].orientation);
      setPhase('review');
    }, 260);
    return () => clearTimeout(t);
  }, [phase, description, context]);

  // The staged insert. Each tick is one of `STEPS`; the last one hands the
  // finished spec over, which is when the chart appears on the slide.
  useEffect(() => {
    if (phase !== 'loading' || !briefed) return;
    if (step >= STEPS.length) {
      handoff.current.onPick(stampProvenance(structuredClone(briefed.spec), ds));
      handoff.current.onClose();
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [phase, step, briefed, ds]);

  const insertBriefed = () => {
    setStep(0);
    setPhase('loading');
  };


  const reset = () => {
    setRec(null);
    setChosenId(null);
    setChosen(null);
    setPhase('browse');
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
      {phase === 'loading' && briefed ? (
        <LoadingPanel
          ds={ds}
          step={step}
          subject={rec?.brief.subject}
          layoutName={recommended?.layout.name ?? 'chart'}
          elements={step >= STEPS.length - 1 ? briefed.elements : null}
        />
      ) : (
        <>
          <AskBox
            value={description}
            busy={phase === 'thinking'}
            hint={phase === 'review' ? 'edit this and it will re-read it' : undefined}
            onChange={(v) => {
              setDescription(v);
              // Editing the sentence invalidates the answer to the old one.
              if (rec) reset();
            }}
            onSubmit={recommend}
          />

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
          ) : phase === 'review' && rec && recommended && briefed ? (
            <ReviewPanel
              ds={ds}
              rec={rec}
              chosen={recommended}
              elements={briefed.elements}
              orientation={orientation}
              onOrientation={setOrientation}
              onChoose={setChosenId}
              onInsert={insertBriefed}
              onBrowse={reset}
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
                  // timeframe above all, which is the answer nobody wants to
                  // give twice.
                  setup: prev
                    ? carrySetup(prev.setup, layout, asOf)
                    : defaultSetup(formFor(layout), asOf),
                }));
                setPhase('setup');
              }}
            />
          )}
        </>
      )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The question                                                       */
/* ------------------------------------------------------------------ */

const EXAMPLES = [
  'ARR by segment over the last 8 quarters',
  'Revenue mix by region for FY25',
  'How FY24 revenue bridged to FY25',
  'Gross margin against revenue, quarterly',
];

function AskBox({
  value,
  busy,
  hint,
  onChange,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  /** What sits below the box right now — the copy has to match. */
  hint?: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const [example, setExample] = useState(0);
  return (
    <div className="mb-3 border-b border-zinc-100 pb-3 dark:border-zinc-800">
      <label
        htmlFor="dd-chart-brief"
        className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-200"
      >
        What data do you want to show?
      </label>
      <textarea
        id="dd-chart-brief"
        autoFocus
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter is a newline, as it is everywhere else.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="e.g. quarterly ARR by segment for the last 8 quarters, in $M"
        className="w-full resize-none rounded-md border border-zinc-200 bg-transparent p-2 text-xs leading-relaxed outline-none placeholder:text-zinc-400 focus:border-indigo-400 dark:border-zinc-700"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={onSubmit}
          disabled={!value.trim() || busy}
          className="rounded bg-black px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40 hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {busy ? 'Reading…' : 'Recommend a layout'}
        </button>
        {hint ? <span className="text-[10px] text-zinc-400">{hint}</span> : null}
        <span className="flex-1" />
        <button
          onClick={() => {
            onChange(EXAMPLES[example % EXAMPLES.length]);
            setExample((i) => i + 1);
          }}
          title="Fill in an example description"
          className="text-[10px] text-zinc-400 underline decoration-dotted hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          example
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The recommendation                                                 */
/* ------------------------------------------------------------------ */

const SUBJECT_SOURCE: Record<string, string> = {
  described: 'from your description',
  tag: "from the deck's tag",
  slide: 'from the slide title',
  deck: 'from the deck title',
};

function ReviewPanel({
  ds,
  rec,
  chosen,
  elements,
  orientation,
  onOrientation,
  onChoose,
  onInsert,
  onBrowse,
}: {
  ds: DesignSystem;
  rec: ChartRecommendation;
  chosen: LayoutSuggestion;
  elements: SlideElement[];
  orientation: ChartOrientation;
  onOrientation: (o: ChartOrientation) => void;
  onChoose: (id: string) => void;
  onInsert: () => void;
  onBrowse: () => void;
}) {
  const { brief } = rec;
  const alternatives = rec.suggestions.filter((s) => s.layout.id !== chosen.layout.id);
  const labels = brief.period?.labels ?? [];
  // With one named period the members are the bars, so the breakdown chip has
  // to read them off the categories rather than off the (empty) series.
  const members = brief.seriesNames.length
    ? brief.seriesNames
    : brief.dimension
      ? brief.categories
      : [];

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          {rec.confidence === 'low' ? 'Best guess' : 'Recommended'}
        </span>
        <span className="text-xs font-medium">{chosen.layout.name}</span>
        <span className="flex-1" />
        {supportsOrientation(chosen.layout.kind) ? (
          <OrientationToggle value={orientation} onChange={onOrientation} />
        ) : null}
      </div>

      <div className="flex gap-3">
        <div className="shrink-0 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
          <SlideView
            slide={{
              id: `rec-${chosen.layout.id}-${orientation}`,
              elements,
              background: { kind: 'solid', color: token('surface.base') },
            }}
            slideSize={PREVIEW_SLIDE}
            designSystem={ds}
            width={HERO_W}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            A <span className="font-medium">{chosen.layout.name.toLowerCase()}</span> because{' '}
            {chosen.why}. It {chosen.layout.purpose}.
          </p>

          <div className="mt-2 flex flex-wrap gap-1">
            {brief.subject ? (
              <Chip
                label={brief.subject}
                hint={SUBJECT_SOURCE[brief.subjectFrom] ?? 'subject'}
              />
            ) : null}
            {brief.measure ? <Chip label={brief.measure} hint="measure" /> : null}
            {labels.length ? (
              <Chip
                label={
                  labels.length > 1
                    ? `${labels[0]}–${labels[labels.length - 1]}`
                    : labels[0]
                }
                hint={
                  labels.length > 1
                    ? `${labels.length} ${brief.categoryNoun.toLowerCase()}s`
                    : 'one period'
                }
              />
            ) : null}
            {brief.dimension && members.length ? (
              <Chip label={`by ${brief.dimension}`} hint={members.join(', ')} />
            ) : null}
            {brief.unitNote ? <Chip label={brief.unitNote} hint="units" /> : null}
          </div>

          {brief.gaps.length ? (
            <ul className="mt-2 space-y-0.5">
              {brief.gaps.map((g) => (
                <li key={g} className="text-[10px] leading-snug text-amber-600">
                  {g}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {alternatives.length ? (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Or one of these
          </div>
          <div className="flex flex-wrap gap-1.5">
            {alternatives.map((s) => (
              <button
                key={s.layout.id}
                onClick={() => onChoose(s.layout.id)}
                title={s.why}
                className="rounded border border-zinc-200 px-2 py-1 text-left text-[11px] hover:border-indigo-400 dark:border-zinc-700"
              >
                <span className="font-medium">{s.layout.name}</span>
                <span className="ml-1.5 text-[10px] text-zinc-400">{s.layout.purpose}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={onInsert}
            className="whitespace-nowrap rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Insert this chart
          </button>
          <button
            onClick={onBrowse}
            className="whitespace-nowrap rounded px-2 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Browse all layouts
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">
          Labels come from your description; the figures are placeholders. Select the
          chart and press <span className="font-medium">Data</span> to fill them in, or
          use the Devin prompt to go and research them.
        </p>
      </div>
    </div>
  );
}

function Chip({ label, hint }: { label: string; hint: string }) {
  return (
    <span
      title={hint}
      className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
    >
      {label}
      <span className="ml-1 font-normal text-zinc-400">{hint}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The staged insert                                                  */
/* ------------------------------------------------------------------ */

function LoadingPanel({
  ds,
  step,
  subject,
  layoutName,
  elements,
}: {
  ds: DesignSystem;
  step: number;
  subject?: string;
  layoutName: string;
  elements: SlideElement[] | null;
}) {
  return (
    <div className="flex min-h-[13rem] flex-col items-center justify-center gap-3 py-4">
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500" />
        <span className="text-xs font-medium">
          {STEPS[Math.min(step, STEPS.length - 1)]}
          <span className="ml-1 text-zinc-400">
            {subject ? `· ${subject}` : `· ${layoutName.toLowerCase()}`}
          </span>
        </span>
      </div>

      <div className="flex gap-1">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-1 w-10 rounded-full transition-colors ${
              i <= step ? 'bg-indigo-500' : 'bg-zinc-200 dark:bg-zinc-700'
            }`}
          />
        ))}
      </div>

      {/* The chart fades in as it finishes compiling, so the last step shows
          the thing it just built rather than an empty box. */}
      <div
        className={`overflow-hidden rounded-md border border-zinc-200 transition-opacity duration-300 dark:border-zinc-700 ${
          elements ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <SlideView
          slide={{
            id: 'loading-preview',
            elements: elements ?? [],
            background: { kind: 'solid', color: token('surface.base') },
          }}
          slideSize={PREVIEW_SLIDE}
          designSystem={ds}
          width={HERO_W}
        />
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
