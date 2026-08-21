/**
 * The setup step's answers, turned into a chart.
 *
 * Deliberately routed through `ChartBrief` and `specFromBrief` rather than
 * building specs from scratch: a chart assembled in fields and one assembled
 * from a typed sentence must come out the same, and two builders that agree by
 * convention stop agreeing on the first fix that only lands in one of them. So
 * this file's whole job is the translation — which answers become the
 * categories, which become the series, what the period labels are — and the
 * layout, titling, units and placeholder shaping stay where they already were.
 *
 * Three shapes need more than the brief can carry, and they say so where they're
 * handled: a flow has nodes at BOTH ends (the brief's Sankey has one source), a
 * schedule has no measure at all, and a bubble carries a third measure in its
 * sizes.
 */
import {
  fromEpochDay,
  fromIso,
  nextCell,
  type ChartOrientation,
  type ChartSpec,
  type DesignSystem,
  type EpochDay,
  type GanttSpec,
  type SankeyData,
} from '@/model';
import { specFromBrief } from './briefedSpec';
import {
  periodNoun,
  subjectFromContext,
  type BriefContext,
  type ChartBrief,
} from './intent';
import type { ChartLayout } from './layouts';
import { measureFormat, resolveMeasure } from './measures';
import { resolveSegment, type SegmentDef } from './segments';
import { formFor, shapeOf, timeQuestionFor, type ChartSetup } from './setupForm';
import {
  cellCount,
  cellLabel,
  endsOnCurrent,
  midCell,
  rangeLabels,
  snap,
} from './periodRange';

/* ------------------------------------------------------------------ */
/* Periods                                                            */
/* ------------------------------------------------------------------ */

/**
 * The labels that go on the time axis, or name the moments being compared.
 *
 * Every time question comes out of the same stored range, and the difference
 * between them is which of its cells they use: a span uses all of them, a bridge
 * only the two ends, a dot plot the ends plus a middle if it wants three, a
 * moment only the end.
 *
 * That the ends are stored is what makes a bridge honest. It used to be a grain
 * and a count of two, which could only ever bridge ADJACENT periods — so "how
 * FY24 became FY26" was not expressible at all.
 */
export function setupPeriods(layout: ChartLayout, setup: ChartSetup): string[] {
  const question = timeQuestionFor(formFor(layout), setup.axis);
  const { grain, range, fiscal } = setup;
  const label = (iso: string) => cellLabel(grain, iso, fiscal);

  if (question === 'moment') return [label(range.to)];
  if (question === 'endpoints') return [label(range.from), label(range.to)];
  if (question === 'points') {
    return setup.markers === 3
      ? [label(range.from), label(midCell(grain, range)), label(range.to)]
      : [label(range.from), label(range.to)];
  }
  return rangeLabels(grain, range, fiscal);
}

/* ------------------------------------------------------------------ */
/* The sentence                                                       */
/* ------------------------------------------------------------------ */

/**
 * The answers written back out as the sentence they amount to.
 *
 * Not decoration. `AuthorChartBrief` keeps the author's own words so a research
 * prompt can quote what was asked for rather than reverse-engineering it off the
 * axes, and an author who picked "ACUs per merged PR, by customer, quarterly,
 * last 8" stated every bit as much as one who typed it. Writing it back means
 * the provenance record says `stated` about facts that were, in fact, stated.
 */
export function setupSentence(layout: ChartLayout, setup: ChartSetup, periods: string[]): string {
  const form = formFor(layout);
  const question = timeQuestionFor(form, setup.axis);
  const parts: string[] = [];

  const measure = setup.measure ? resolveMeasure(setup.measure).label : undefined;
  const second = setup.secondaryMeasure ? resolveMeasure(setup.secondaryMeasure).label : undefined;
  const size = setup.sizeMeasure ? resolveMeasure(setup.sizeMeasure).label : undefined;

  if (form.shape === 'xy') {
    parts.push(`${second ?? 'value'} against ${measure ?? 'value'}`);
    if (size) parts.push(`sized by ${size}`);
  } else if (measure) {
    parts.push(measure);
    if (second) parts.push(`with ${second} over the top`);
  }

  const primary = setup.segment ? resolveSegment(setup.segment) : undefined;
  const secondary = setup.segment2 ? resolveSegment(setup.segment2) : undefined;

  if (form.shape === 'flow' && primary && secondary) {
    parts.push(`flowing from ${primary.noun} to ${secondary.noun}`);
  } else {
    // Whichever cut divides the marks is the one the sentence says "by".
    const by = form.shape === 'categorical' && setup.axis === 'segment' ? primary : (secondary ?? primary);
    if (by) parts.push(`by ${by.noun}`);
    if (form.shape === 'categorical' && setup.axis === 'segment' && secondary && primary) {
      parts.push(`split by ${secondary.noun}`);
    }
  }

  const noun = periodNoun(setup.grain);
  const span = cellCount(setup.grain, setup.range);
  if (question === 'range') {
    // Both the length and the ends: the length is what somebody asked for and
    // the ends are what they will get, and a sentence that gives only one of
    // them is the sentence nobody can check.
    parts.push(
      periods.length > 1
        ? `${periods.length} ${noun}s, ${periods[0]} to ${periods[periods.length - 1]}`
        : `${periods[0] ?? 'no periods'}`,
    );
  } else if (question === 'endpoints' && periods.length >= 2) {
    parts.push(`from ${periods[0]} to ${periods[periods.length - 1]}`);
  } else if (question === 'points' && periods.length >= 2) {
    parts.push(`comparing ${periods.join(' and ')}`);
  } else if (question === 'window') {
    parts.push(`across ${span} ${noun}s, ${cellLabel(setup.grain, setup.range.from, setup.fiscal)} on`);
  } else if (periods.length) {
    parts.push(`for ${periods[0]}`);
  }

  return parts.join(', ');
}

/* ------------------------------------------------------------------ */
/* The brief                                                          */
/* ------------------------------------------------------------------ */

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Which answers become the categories and which the series — the one decision
 * this file exists to make.
 *
 * The rule underneath every branch: the CATEGORY axis is whatever the reader
 * scans along, and the SERIES are what divides each of those marks. Time along
 * the bottom makes the cut into series; a cut along the bottom makes a second
 * cut into the series; a dot plot inverts it and puts the moments in the series,
 * which is precisely what makes it read as a gap rather than a trend.
 */
function axes(
  layout: ChartLayout,
  setup: ChartSetup,
  periods: string[],
  primary?: SegmentDef,
  secondary?: SegmentDef,
): { categories: string[]; seriesNames: string[]; dimension?: SegmentDef; noun: string } {
  const shape = shapeOf(layout);
  const grainNoun = titleCase(periodNoun(setup.grain));

  switch (shape) {
    case 'trend':
      return {
        categories: periods,
        seriesNames: primary?.members ?? [],
        dimension: primary,
        noun: grainNoun,
      };

    case 'categorical':
      if (setup.axis === 'time') {
        return {
          categories: periods,
          seriesNames: secondary?.members ?? primary?.members ?? [],
          dimension: secondary ?? primary,
          noun: grainNoun,
        };
      }
      return {
        categories: primary?.members ?? ['Category A', 'Category B', 'Category C'],
        seriesNames: secondary?.members ?? [],
        dimension: secondary ?? primary,
        noun: titleCase(primary?.noun ?? 'category'),
      };

    case 'share':
      // One series, read off the slices — see `gridFromBrief`.
      return {
        categories: primary?.members ?? [],
        seriesNames: [],
        dimension: primary,
        noun: titleCase(primary?.noun ?? 'category'),
      };

    case 'bridge':
      // The ends come off the period labels; the middle is the drivers.
      return {
        categories: periods,
        seriesNames: primary?.members ?? [],
        dimension: primary,
        noun: grainNoun,
      };

    case 'flow':
      // Both ends are rebuilt below; the series carry the right-hand nodes so
      // the brief on the chart still names the cut it flows into.
      return {
        categories: primary?.members ?? [],
        seriesNames: secondary?.members ?? [],
        dimension: secondary,
        noun: titleCase(primary?.noun ?? 'node'),
      };

    case 'xy':
      // One point per member, labelled — an unlabelled scatter is five dots.
      return {
        categories: primary?.members ?? [],
        seriesNames: primary?.members ?? [],
        dimension: primary,
        noun: titleCase(primary?.noun ?? 'item'),
      };

    case 'gap':
      // Inverted on purpose: rows are the cut, and the MOMENTS are the series.
      return {
        categories: primary?.members ?? [],
        seriesNames: periods,
        dimension: primary,
        noun: titleCase(primary?.noun ?? 'row'),
      };

    case 'schedule':
      return { categories: [], seriesNames: [], noun: grainNoun };
  }
}

/**
 * The answers as a `ChartBrief` — everything downstream (titles, axis titles,
 * units, provenance, placeholder shaping) then works exactly as it does for a
 * typed description.
 *
 * `gaps` comes out empty, and that is the point: a gap is something the sentence
 * failed to say, and a form that was filled in didn't fail to say it. The
 * blockers that stop an incomplete form reaching here live in `setupIssues`.
 */
export function briefFromSetup(
  layout: ChartLayout,
  setup: ChartSetup,
  ctx: BriefContext & { asOf: string },
): ChartBrief {
  const form = formFor(layout);
  const periods = setupPeriods(layout, setup);

  const primary = setup.segment ? resolveSegment(setup.segment) : undefined;
  const secondary = setup.segment2 ? resolveSegment(setup.segment2) : undefined;
  const { categories, seriesNames, dimension, noun } = axes(layout, setup, periods, primary, secondary);

  const measure = setup.measure ? resolveMeasure(setup.measure) : undefined;
  const second = setup.secondaryMeasure ? resolveMeasure(setup.secondaryMeasure) : undefined;
  const size = setup.sizeMeasure ? resolveMeasure(setup.sizeMeasure) : undefined;
  const fmt = measure ? measureFormat(measure) : undefined;

  // On an x/y plot the FIRST measure is the horizontal axis and the second the
  // vertical, which is the order `specFromBrief` reads `measures` in.
  const measures = [measure, second, size].filter((m) => !!m).map((m) => m!.label);

  const { subject, subjectFrom } = subjectFromContext(ctx);

  return {
    description: setupSentence(layout, setup, periods),
    subject,
    subjectFrom,
    measure: form.shape === 'xy' ? (second?.label ?? measure?.label) : measure?.label,
    secondaryMeasure: form.shape === 'xy' ? undefined : second?.label,
    measures,
    dimension: dimension?.noun,
    seriesNames,
    categoryNoun: noun,
    categories,
    // `stated` unconditionally: every one of these periods was chosen in the
    // form, which is as much a statement as typing it. `fiscal` likewise — the
    // form shows the choice, so whichever way it sits is the author's.
    period: periods.length
      ? {
          grain: setup.grain,
          labels: periods,
          stated: true,
          fiscal: setup.fiscal,
          // Derived, not answered: with the ends stored, whether the newest one
          // is still running is a fact about the range — and it stays a fact
          // next month, when the same chart is no longer up to date.
          includeCurrent: endsOnCurrent(setup.grain, setup.range, ctx.asOf),
        }
      : undefined,
    numberFormat: fmt?.numberFormat ?? { style: 'number', thousands: true, negative: 'minus' },
    unitDivisor: fmt?.unitDivisor,
    unitNote: fmt?.unitNote,
    // The author picked the measure from a list that carries its units, so the
    // units were stated as surely as if they had been typed.
    unitStated: !!fmt,
    magnitude: fmt?.magnitude,
    notes: setup.notes,
    gaps: [],
  };
}

/* ------------------------------------------------------------------ */
/* The spec                                                           */
/* ------------------------------------------------------------------ */

/**
 * The chart the setup step inserts.
 *
 * `ds` is the design system the chart will be DRAWN with — pass the variant's
 * one for a brand-styled pick, so the tile and the inserted chart agree.
 */
export function specFromSetup(
  layout: ChartLayout,
  setup: ChartSetup,
  ds: DesignSystem,
  opts: { orientation: ChartOrientation; asOf: string } & BriefContext,
): ChartSpec {
  const brief = briefFromSetup(layout, setup, { ...opts, asOf: opts.asOf });
  const spec = specFromBrief(
    brief,
    { layout, orientation: opts.orientation, score: 0, why: 'chosen by hand' },
    ds,
    { asOf: opts.asOf },
  );

  if (spec.kind === 'sankey') {
    return { ...spec, data: flowData(setup, brief) };
  }
  if (spec.kind === 'gantt') {
    return retimed(spec, setup, opts.asOf);
  }
  return spec;
}

/* ------------------------------------------------------------------ */
/* Flow                                                               */
/* ------------------------------------------------------------------ */

/**
 * A Sankey with nodes at both ends.
 *
 * `sankeyFromBrief` builds the common case — one source fanning out — because
 * a typed sentence rarely names both ends. The setup step always does: "from
 * customer to use case" is two cuts, and drawing it as one source with the
 * targets hanging off it throws away the half the author asked for.
 *
 * Every left node links to every right node, which is the honest placeholder:
 * the author is about to put the real figures in, and a sparse guess about which
 * pairings exist is a claim we have no basis for.
 */
function flowData(setup: ChartSetup, brief: ChartBrief): SankeyData {
  const from = setup.segment ? resolveSegment(setup.segment).members : brief.categories;
  const to = setup.segment2 ? resolveSegment(setup.segment2).members : brief.seriesNames;
  const magnitude = brief.magnitude ?? 1_000;
  // Deterministic, and deliberately not `seeded` from this file: the weights
  // only have to differ from each other, and a stable ramp does that without a
  // second PRNG whose output nobody can predict from the brief.
  const weight = (i: number, j: number) => Math.round((magnitude / (from.length * to.length)) * (1 + ((i * 3 + j * 2) % 5) * 0.18));

  return {
    nodes: [
      ...from.map((label, i) => ({ key: `a${i}`, label, layer: 0 })),
      ...to.map((label, j) => ({ key: `b${j}`, label, layer: 1 })),
    ],
    links: from.flatMap((_, i) =>
      to.map((__, j) => ({ key: `l${i}-${j}`, from: `a${i}`, to: `b${j}`, value: weight(i, j) })),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Schedule                                                           */
/* ------------------------------------------------------------------ */

/**
 * The window a schedule covers: `count` whole calendar cells of the chosen
 * grain, starting with the one today falls in.
 *
 * Stepped cell by cell rather than multiplied by an average length. "Three
 * months" has to end three months later — the first version used 30-day months
 * and landed a quarter-long plan two days inside October, which is the sort of
 * off-by-a-bit that an author fixes by hand on every single chart.
 */
function windowFor(setup: ChartSetup): { min: EpochDay; max: EpochDay } | null {
  const from = fromIso(snap(setup.grain, setup.range.from));
  const lastCell = fromIso(snap(setup.grain, setup.range.to));
  if (from === null || lastCell === null || lastCell < from) return null;
  // The window runs to the END of the last cell, not to its start: a plan
  // through December has to include December.
  return { min: from, max: nextCell(setup.grain, lastCell) };
}

/**
 * The sample plan, moved into the window the author asked for.
 *
 * A Gantt has no measure and nothing to break down, so the only thing the setup
 * step can honestly set is WHEN — and a plan whose bars sit in 2024 when the
 * author asked for the next two quarters is a plan they have to re-date by hand,
 * task by task. The bars keep their relative positions and durations, scaled to
 * the window: the shape of the sample plan is the useful part of it.
 */
function retimed(spec: GanttSpec, setup: ChartSetup, asOf: string): GanttSpec {
  const today = fromIso(asOf);
  const win = windowFor(setup);
  if (today === null || !win || !spec.items.length) return spec;

  const { min, max } = win;
  const span = max - min;

  const starts = spec.items.map((i) => i.from);
  const ends = spec.items.map((i) => i.to ?? i.from + 1);
  const from0 = Math.min(...starts);
  const to0 = Math.max(...ends);
  const scale = to0 > from0 ? span / (to0 - from0) : 1;

  const move = (day: number): number => min + Math.round((day - from0) * scale);

  return {
    ...spec,
    items: spec.items.map((item) => {
      const start = move(item.from);
      return {
        ...item,
        from: start,
        // A point in time stays a point; a bar keeps at least one day of length
        // so a short task in a long window doesn't scale down to nothing.
        to: item.to === undefined ? undefined : Math.max(start + 1, move(item.to)),
      };
    }),
    timescale: {
      ...spec.timescale,
      min,
      max,
      // Two header rows, one coarser than the chosen grain — a month axis with
      // no year over it reads "Jan" with no idea which one.
      bands: bandsFor(setup.grain),
    },
    // The deck's own date, which the store would otherwise stamp for us. Set
    // here too so the window and the today line can't disagree.
    today: { show: true, at: today, ...(spec.today?.label ? { label: spec.today.label } : {}) },
  };
}

const bandsFor = (grain: ChartSetup['grain']): GanttSpec['timescale']['bands'] =>
  grain === 'week'
    ? [{ grain: 'month' as const }, { grain: 'week' as const }]
    : grain === 'month'
      ? [{ grain: 'quarter' as const }, { grain: 'month' as const }]
      : [{ grain: 'year' as const }, { grain: 'quarter' as const }];

/** Exported for the panel's summary line: the window a schedule will cover. */
export function scheduleWindow(setup: ChartSetup): { from: string; to: string } | null {
  const win = windowFor(setup);
  if (!win) return null;
  const label = (day: EpochDay) => {
    const c = fromEpochDay(day);
    return `${MONTHS[c.m - 1]} ${c.y}`;
  };
  return { from: label(win.min), to: label(win.max) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
