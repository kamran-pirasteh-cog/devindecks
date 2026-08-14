/**
 * Migrating the old single-chart-per-slide config into chart instances.
 *
 * `Slide.chart` was a whole-slide affair: the chart owned every element, and
 * editing it replaced them all. A `ChartInstance` owns only the elements
 * stamped with its group id, which is what makes two charts on one slide
 * possible.
 *
 * A legacy config is only taken over once the engine can actually draw that
 * kind; anything else keeps its `chart` field and its existing primitives, so a
 * stored deck never renders blank while a placer is still being built. Every
 * kind the old model could express is now covered.
 */
import { nanoid } from 'nanoid';
import { inchesToEmu } from '../units';
import type { Deck, Slide, SlideElement } from '../types';
import { defaultChartSpec } from './defaults';
import type { ChartInstance } from './instance';
import type { ChartKind, ChartSpec, GridSeries } from './spec';
import { isGridSpec } from './spec';
import type { SlideChartConfig } from './legacy';
import { chartIdOfElementId, partKey, type ChartRef } from './ref';

/** Bumped whenever a migration is added. Stamped on `Deck.schemaVersion`. */
export const DECK_SCHEMA_VERSION = 2;

/** The legacy slide geometry these configs were laid out against. */
const LEGACY_SLIDE = { w: 13.333, h: 7.5 };

export const newChartId = () => `chart-${nanoid(8)}`;
export const newChartGroupId = () => `cg-${nanoid(8)}`;

/**
 * Every legacy kind now has a placer, so every stored chart migrates. The set
 * is kept explicit rather than collapsed to `true`: it's the record of which
 * kinds the engine can actually draw, and a future legacy type would have to
 * be added here deliberately.
 */
const MIGRATABLE = new Set<SlideChartConfig['type']>([
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
]);

export const canMigrateLegacy = (cfg: SlideChartConfig): boolean => MIGRATABLE.has(cfg.type);

/**
 * The legacy centering maths, reproduced exactly so a migrated chart lands
 * where the author last saw it rather than jumping on first load.
 */
function legacyFrame(box: { w: number; h: number }) {
  const w = Math.min(Math.max(box.w, 1), LEGACY_SLIDE.w - 0.4);
  const h = Math.min(Math.max(box.h, 1), LEGACY_SLIDE.h - 0.4);
  return {
    x: inchesToEmu((LEGACY_SLIDE.w - w) / 2),
    y: inchesToEmu((LEGACY_SLIDE.h - h) / 2),
    w: inchesToEmu(w),
    h: inchesToEmu(h),
  };
}

/** Legacy type + orientation -> the kind the engine draws. */
function legacyKind(cfg: SlideChartConfig): ChartKind {
  switch (cfg.type) {
    case 'bar':
      // The old model called every column chart a "bar"; orientation is what
      // actually distinguished them.
      return cfg.orientation === 'horizontal' ? 'bar' : 'column';
    case 'line':
      return 'line';
    case 'area':
      return 'area';
    case 'pie':
      return 'pie';
    case 'donut':
      return 'donut';
    case 'scatter':
      return 'scatter';
  }
}

export function upgradeLegacyConfig(cfg: SlideChartConfig): ChartSpec {
  const kind = legacyKind(cfg);
  const spec = defaultChartSpec(kind, 'clustered');

  const categories = cfg.data.categories.map((label, i) => ({ key: `c${i}`, label }));
  const series = cfg.data.series.map(
    (s, i): GridSeries => ({
      key: `s${i}`,
      name: s.name,
      values: [...s.values],
      // The old model carried one color per series and nothing else.
      format: { fill: { kind: 'solid', color: s.color } },
    }),
  );

  if (spec.kind === 'scatter') {
    // The old scatter had no x column at all — it plotted a value series
    // against the category index, so that's the only honest x to carry over.
    spec.data = {
      series: cfg.data.series.map((s, i) => ({
        key: `s${i}`,
        name: s.name,
        points: s.values.map((v, j) => ({
          key: `p${j}`,
          x: j,
          y: v,
          label: cfg.data.categories[j],
        })),
      })),
    };
  } else if (isGridSpec(spec)) {
    spec.data = { categories, series };
  }

  spec.axes.x.title = cfg.xLabel;
  spec.axes.y.title = cfg.yLabel;
  return spec;
}

/**
 * Migrate one slide. Returns the slide unchanged when there is nothing to do,
 * so this is safe to run on every load — the caller can't tell a migrated deck
 * from a fresh one.
 *
 * The compiled elements are supplied by the caller rather than computed here:
 * `model/` must not depend on the chart engine, and the caller already has the
 * design system and a measurer to hand.
 */
export function migrateSlideChart(
  slide: Slide,
  compile: (chart: ChartInstance) => SlideElement[],
): Slide {
  if (!slide.chart) return slide;
  if (!canMigrateLegacy(slide.chart)) return slide;

  const instance: ChartInstance = {
    id: newChartId(),
    groupId: newChartGroupId(),
    frame: legacyFrame(slide.chart.box),
    spec: upgradeLegacyConfig(slide.chart),
  };

  const { chart: _legacy, ...rest } = slide;
  return {
    ...rest,
    charts: [...(slide.charts ?? []), instance],
    // The legacy chart owned the whole slide by construction, so replacing the
    // element list wholesale is correct here — and only here, exactly once.
    elements: compile(instance),
  };
}

export function migrateDeck(
  deck: Deck,
  compile: (chart: ChartInstance) => SlideElement[],
): Deck {
  if (deck.schemaVersion === DECK_SCHEMA_VERSION) return deck;
  const slides = deck.slides.map((s) => migrateSlideChart(s, compile));
  const changed = slides.some((s, i) => s !== deck.slides[i]);
  return changed || deck.schemaVersion !== DECK_SCHEMA_VERSION
    ? { ...deck, slides, schemaVersion: DECK_SCHEMA_VERSION }
    : deck;
}

/* ------------------------------------------------------------------ */
/* Re-identification, for copies                                      */
/* ------------------------------------------------------------------ */

/**
 * Give every chart on a slide a fresh identity.
 *
 * Copy paths (`duplicateDoc`, `duplicateSlide`) re-key element ids to keep them
 * unique. A chart's element ids aren't free-form — they encode which chart and
 * which part they are — so they have to be regenerated FROM the new chart id,
 * not randomized. Randomizing them silently severs every element from its
 * chart, and the copy then renders fine right up until someone edits it.
 */
export function reidentifyCharts(slide: Slide): Slide {
  if (!slide.charts?.length) return slide;

  const idMap = new Map<string, { chartId: string; groupId: string }>();
  const charts = slide.charts.map((c) => {
    const next = { chartId: newChartId(), groupId: newChartGroupId() };
    idMap.set(c.id, next);
    return { ...c, id: next.chartId, groupId: next.groupId };
  });

  const elements = slide.elements.map((el) => {
    const oldChartId = chartIdOfElementId(el.id);
    const next = oldChartId ? idMap.get(oldChartId) : undefined;
    if (!next || !el.chartRef) return el;

    const ref = { ...el.chartRef, chartId: next.chartId } as ChartRef;
    return {
      ...el,
      id: `${next.chartId}::${partKey(ref)}`,
      chartRef: ref,
      groupIds: el.groupIds?.map((g) => (g === idMap.get(oldChartId!)?.groupId ? g : g)) ?? undefined,
    };
  });

  // Group ids are rewritten in a second pass: a member may belong to an outer
  // group the author added around the chart, which must be left alone.
  const groupMap = new Map(
    slide.charts.map((c) => [c.groupId, idMap.get(c.id)!.groupId] as const),
  );
  const regrouped = elements.map((el) =>
    el.groupIds?.some((g) => groupMap.has(g))
      ? { ...el, groupIds: el.groupIds.map((g) => groupMap.get(g) ?? g) }
      : el,
  );

  return { ...slide, charts, elements: regrouped };
}

/** True when this element belongs to any chart — i.e. don't re-key its id. */
export const isChartOwnedElement = (el: SlideElement): boolean => !!el.chartRef;
