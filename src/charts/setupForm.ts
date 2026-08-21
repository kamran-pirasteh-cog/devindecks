/**
 * What a chart needs to be ASKED, given the chart it is.
 *
 * The picker's tiles pick a picture; this decides the questions that picture
 * still needs answered before it means anything. They are not the same questions
 * for every tile, and pretending otherwise is the whole problem here: a line
 * chart wants a span of periods and one cut, a pie wants a single moment and
 * exactly one cut, a scatter wants two measures and no time axis at all, and a
 * Gantt wants no measure whatsoever. A form that asked all of it every time
 * would make an author decline three questions to answer two.
 *
 * So the layouts collapse into eight SHAPES, and a shape is what carries the
 * form. Two tiles with the same shape ask the same things — stacked and 100%
 * stacked differ in what they DRAW, not in what they need to know — and the
 * differences that matter show up as `issues`, which is where the honest
 * warnings live: a stack of averages, a pie with fourteen slices, a combo whose
 * second axis carries another absolute.
 *
 * Pure and dateless: `asOf` is passed in, so the same answers give the same
 * chart in a test as in the editor.
 */
import type { DateGrain } from '@/model';
import {
  cellCount,
  currentCell,
  rangeEndingAt,
  snap,
  type PeriodRange,
} from './periodRange';
import { additive, isRate, resolveMeasure, type MeasureDef } from './measures';
import { segmentWith } from './segments';
import type { ChartLayout } from './layouts';

/* ------------------------------------------------------------------ */
/* Shapes                                                             */
/* ------------------------------------------------------------------ */

/**
 * The eight shapes, named for the question they answer rather than for the
 * marks they draw — `gap` covers a dot plot because "how far apart are these
 * two moments, row by row" is what one is for.
 */
export type ChartShape =
  | 'trend'
  | 'categorical'
  | 'share'
  | 'bridge'
  | 'flow'
  | 'xy'
  | 'gap'
  | 'schedule';

/** How the time question gets asked, which is a different question per shape. */
export type TimeQuestion =
  /** A span: a grain and how many of them. */
  | 'range'
  /** One period the whole chart is AT. */
  | 'moment'
  /** Two: what it went from, and what it went to. */
  | 'endpoints'
  /** Two or three moments compared row by row. */
  | 'points'
  /** A calendar window the bars live inside. No measure attached. */
  | 'window';

export interface MeasureSlot {
  key: 'primary' | 'secondary' | 'size';
  label: string;
  hint: string;
  /** What kind of measure belongs here. Enforced as a note, never a block. */
  wants: 'absolute' | 'rate' | 'any';
  required: boolean;
}

export interface SegmentSlot {
  key: 'primary' | 'secondary';
  label: string;
  hint: string;
  required: boolean;
}

export interface SetupForm {
  shape: ChartShape;
  /**
   * What runs along the category axis. `either` is the one genuine choice in
   * here: a column chart of ACUs can put quarters along the bottom or customers,
   * and those are two different slides.
   */
  axis: 'time' | 'segment' | 'either' | 'none';
  time: TimeQuestion;
  measures: MeasureSlot[];
  segments: SegmentSlot[];
  /** One line saying how the finished chart will read. Shown above the form. */
  reads: string;
}

const SHAPE_BY_KIND: Record<string, ChartShape> = {
  line: 'trend',
  area: 'trend',
  combo: 'trend',
  column: 'categorical',
  bar: 'categorical',
  pie: 'share',
  donut: 'share',
  waterfall: 'bridge',
  sankey: 'flow',
  scatter: 'xy',
  bubble: 'xy',
  dotplot: 'gap',
  gantt: 'schedule',
  mekko: 'categorical',
  butterfly: 'categorical',
};

export const shapeOf = (layout: ChartLayout): ChartShape =>
  SHAPE_BY_KIND[layout.kind] ?? 'categorical';

/* ------------------------------------------------------------------ */
/* The forms                                                          */
/* ------------------------------------------------------------------ */

const MEASURE: MeasureSlot = {
  key: 'primary',
  label: 'Measure',
  hint: 'what the value axis counts',
  wants: 'any',
  required: true,
};

const SPLIT: SegmentSlot = {
  key: 'primary',
  label: 'Split by',
  hint: 'one series per member — leave as one total for a single line',
  required: false,
};

/**
 * The form for a layout.
 *
 * Written per shape, with the two per-LAYOUT departures spelled out: a combo
 * asks for the rate that rides over the top, and a stack has to be divided by
 * something or it is a column chart with extra steps.
 */
export function formFor(layout: ChartLayout): SetupForm {
  const shape = shapeOf(layout);
  const stacking = layout.stack === 'stacked' || layout.stack === 'stacked100';

  switch (shape) {
    case 'trend':
      return {
        shape,
        axis: 'time',
        time: 'range',
        measures:
          layout.kind === 'combo'
            ? [
                { ...MEASURE, label: 'Columns', hint: 'the absolute the columns count' },
                {
                  key: 'secondary',
                  label: 'Line over the top',
                  hint: 'a rate or a ratio, on its own axis down the right',
                  wants: 'rate',
                  required: true,
                },
              ]
            : [MEASURE],
        segments: [
          {
            ...SPLIT,
            hint: stacking
              ? 'the parts each period is built from'
              : 'one line per member — leave as one total for a single line',
            required: stacking,
          },
        ],
        reads:
          layout.kind === 'combo'
            ? 'Periods along the bottom, the columns on the left axis, the rate on the right.'
            : 'Periods along the bottom, one line per member of the split.',
      };

    case 'categorical':
      return {
        shape,
        axis: 'either',
        // The time question depends on the axis answer, so both are offered and
        // `timeQuestionFor` picks between them once the author has chosen.
        time: 'range',
        measures: [MEASURE],
        segments: [
          {
            key: 'primary',
            label: 'Across the bottom',
            hint: 'one column per member',
            required: false,
          },
          {
            key: 'secondary',
            label: stacking ? 'Stack each column by' : 'Split each column by',
            hint: stacking
              ? 'the parts each column is built from'
              : 'a second cut, drawn as columns side by side',
            required: stacking,
          },
        ],
        reads: stacking
          ? 'One column per category, divided into the parts it is made of.'
          : 'One column per category, a group of columns where a second cut is set.',
      };

    case 'share':
      return {
        shape,
        axis: 'segment',
        time: 'moment',
        measures: [MEASURE],
        segments: [
          { ...SPLIT, label: 'Slices', hint: 'one slice per member', required: true },
        ],
        reads: 'One moment, divided into shares of a whole.',
      };

    case 'bridge':
      return {
        shape,
        axis: 'none',
        time: 'endpoints',
        measures: [MEASURE],
        segments: [
          {
            ...SPLIT,
            label: 'Drivers',
            hint: 'the steps between the two totals — rename them on the chart',
            required: false,
          },
        ],
        reads: 'A starting total, a step per driver, and the total it lands on.',
      };

    case 'flow':
      return {
        shape,
        axis: 'none',
        time: 'moment',
        measures: [MEASURE],
        segments: [
          { key: 'primary', label: 'Flows from', hint: 'the left-hand nodes', required: true },
          { key: 'secondary', label: 'Flows to', hint: 'the right-hand nodes', required: true },
        ],
        reads: 'One band per pairing, its width the quantity that moved.',
      };

    case 'xy':
      return {
        shape,
        axis: 'none',
        time: 'moment',
        measures: [
          { ...MEASURE, label: 'Across (x)', hint: 'the horizontal axis' },
          {
            key: 'secondary',
            label: 'Up (y)',
            hint: 'the vertical axis',
            wants: 'any',
            required: true,
          },
          ...(layout.kind === 'bubble'
            ? [
                {
                  key: 'size' as const,
                  label: 'Bubble size',
                  hint: 'a third measure, carried in the area',
                  wants: 'any' as const,
                  required: false,
                },
              ]
            : []),
        ],
        segments: [
          { ...SPLIT, label: 'One dot per', hint: 'what a single point is', required: true },
        ],
        reads: 'One dot per member, placed by two measures at a single moment.',
      };

    case 'gap':
      return {
        shape,
        axis: 'segment',
        time: 'points',
        measures: [MEASURE],
        segments: [
          { ...SPLIT, label: 'Rows', hint: 'one row per member', required: true },
        ],
        reads: 'One row per member, a marker per moment, the gap between them the point.',
      };

    case 'schedule':
      return {
        shape,
        axis: 'none',
        time: 'window',
        // A schedule has no value axis and nothing to break down: its rows are
        // workstreams the author names, and asking "what are we measuring"
        // about a plan is a question with no answer.
        measures: [],
        segments: [],
        reads: 'A calendar window; the rows and bars are named on the chart.',
      };
  }
}

/**
 * The time question a `categorical` form is actually asking, which depends on
 * whether the author put time along the bottom. Every other shape has one
 * answer, and returns it unchanged.
 */
export const timeQuestionFor = (form: SetupForm, axis: 'time' | 'segment'): TimeQuestion =>
  form.axis === 'either' ? (axis === 'time' ? 'range' : 'moment') : form.time;

/* ------------------------------------------------------------------ */
/* The answers                                                        */
/* ------------------------------------------------------------------ */

export interface ChartSetup {
  /** Measure ids, or `free:<label>` for one the author typed. */
  measure?: string;
  secondaryMeasure?: string;
  sizeMeasure?: string;
  /** Segment ids, likewise. */
  segment?: string;
  segment2?: string;
  /**
   * The author's answer to "which departments?" for each cut, in their own
   * words.
   *
   * A cut names a KIND of thing; it doesn't say which ones, and "by department"
   * is three departments or eleven depending on facts only the author has. Read
   * two ways, both of them wanted — see `namedMembers`: a comma-separated list
   * becomes the chart's actual labels, and anything else ("only the ones over
   * 100 ACUs") stays prose and rides into the Devin prompt as the scope of that
   * cut. Either way the placeholder members stop being the last word.
   */
  which?: string;
  which2?: string;
  grain: DateGrain;
  /**
   * The periods covered, as their two ends rather than as a count.
   *
   * "Last 8 quarters" is a question about today and quietly means something
   * different next month; "Q3'24 to Q2'26" is what the axis actually shows. The
   * presets still exist — they set this — but what is STORED is the answer, not
   * the shortcut that produced it. See `src/charts/periodRange.ts`.
   */
  range: PeriodRange;
  /**
   * How many markers a `points` question puts on each row — two or three.
   *
   * Its own field rather than a length, because a dot plot's markers are not a
   * span: "was and now" and "was, halfway and now" cover the same range and are
   * two different charts. Ignored by every other question.
   */
  markers: 2 | 3;
  /** Only meaningful when the form's axis is `either`. */
  axis: 'time' | 'segment';
  /** Label the years FY25 rather than 2025. */
  fiscal: boolean;
  /**
   * Anything else the research needs to know, in the author's own words. Never
   * read by anything here — it isn't a fact about the chart, it's an
   * instruction about filling it, and it rides through to the Devin prompt
   * verbatim.
   */
  notes?: string;
}

/** How many periods a set of answers covers, at the grain they are held in. */
export const setupCount = (setup: ChartSetup): number => cellCount(setup.grain, setup.range);

/**
 * Grains offered per question. A bridge names two ends, and naming them by the
 * day is a level of precision nobody bridges at; a schedule ticks by week, so
 * "year" as a Gantt grain would draw one cell.
 */
export const GRAINS_FOR: Record<TimeQuestion, DateGrain[]> = {
  range: ['day', 'week', 'month', 'quarter', 'year'],
  moment: ['month', 'quarter', 'year'],
  endpoints: ['quarter', 'year'],
  points: ['quarter', 'year'],
  window: ['week', 'month', 'quarter'],
};

/**
 * Spans worth one click, per grain — they set the range's start, counting back
 * from whatever end is showing. The range itself is what gets stored; these are
 * a shortcut to a common one, not a second way of saying it.
 *
 * Weeks go up in fours because a four-week block is the unit anybody comparing
 * them uses — the axis lands on the same weekday of the month each time, and
 * four blocks is a year's worth of thirteen-week quarters only by coincidence.
 * 13 and 26 were quarters and halves counted in weeks, which is a different
 * question asked in the wrong unit: someone who wants quarters picks quarters.
 */
export const SPAN_PRESETS: Record<DateGrain, number[]> = {
  day: [7, 14, 30, 90],
  week: [4, 8, 12, 16],
  month: [3, 6, 12, 18],
  quarter: [4, 6, 8, 12],
  half: [4, 6, 8],
  year: [3, 5, 10],
};

/**
 * Where an axis stops being able to label its own ticks. A note rather than a
 * limit — `MAX_CELLS` in `periodRange.ts` is the actual bound.
 */
export const MAX_SPAN = 24;

const DEFAULT_GRAIN: Record<TimeQuestion, DateGrain> = {
  range: 'quarter',
  moment: 'quarter',
  endpoints: 'year',
  points: 'year',
  window: 'month',
};

/**
 * What the form opens with.
 *
 * Nothing is pre-filled that would be a guess about the author's intent — no
 * measure, no cut — but everything that is only a DEFAULT gets one, because a
 * form that opens with a sensible range selected is answered by pressing Insert.
 *
 * The range ENDS on the period in progress. That end is the one an author has to
 * change least often, and the alternative — quietly stopping a period short —
 * is a chart that looks a week out of date to everyone who didn't set it.
 */
export function defaultSetup(form: SetupForm, asOf: string): ChartSetup {
  const axis: 'time' | 'segment' = form.axis === 'segment' ? 'segment' : 'time';
  const question = timeQuestionFor(form, axis);
  const grain = DEFAULT_GRAIN[question];
  return {
    grain,
    range: defaultRange(question, grain, asOf),
    markers: 2,
    axis,
    fiscal: false,
  };
}

/**
 * The span each question opens on.
 *
 * A bridge and a dot plot open WIDE rather than on adjacent periods: they exist
 * to show a change, and last year to this year is the change anybody means. A
 * moment is a single cell, and both its ends are that cell.
 */
function defaultRange(question: TimeQuestion, grain: DateGrain, asOf: string): PeriodRange {
  const to = currentCell(grain, asOf);
  if (question === 'moment') return { from: to, to };
  if (question === 'endpoints' || question === 'points') return rangeEndingAt(grain, to, 2);
  return rangeEndingAt(grain, to, SPAN_PRESETS[grain][2] ?? SPAN_PRESETS[grain][0]);
}

/**
 * The same answers, moved to a different chart.
 *
 * Changing your mind about the picture should not cost you the timeframe. Every
 * answer that the new form still has a home for is kept — the grain, the range,
 * the calendar, the measures, the cuts, the notes — and only the ones it has
 * nowhere to put are dropped.
 *
 * The one that needs translating rather than copying is the grain, which not
 * every question offers: a bridge doesn't bridge by the day. When it moves, the
 * range moves with it — its ends are re-snapped to the new grain's cells, so
 * eight weeks becomes the two quarters that contain them rather than eight
 * quarters, which is a different chart entirely.
 */
export function carrySetup(from: ChartSetup, to: ChartLayout, asOf: string): ChartSetup {
  const form = formFor(to);
  const base = defaultSetup(form, asOf);
  const axis = form.axis === 'either' ? from.axis : base.axis;
  const question = timeQuestionFor(form, axis);
  const grain = nearestGrain(from.grain, GRAINS_FOR[question]);

  const slots = new Set(form.measures.map((m) => m.key));
  const cuts = new Set(form.segments.map((sg) => sg.key));

  return {
    grain,
    range: carriedRange(from, grain, question, base),
    markers: from.markers,
    axis,
    fiscal: from.fiscal,
    notes: from.notes,
    ...(slots.has('primary') ? { measure: from.measure } : {}),
    ...(slots.has('secondary') ? { secondaryMeasure: from.secondaryMeasure } : {}),
    ...(slots.has('size') ? { sizeMeasure: from.sizeMeasure } : {}),
    ...(cuts.has('primary') ? { segment: from.segment, which: from.which } : {}),
    ...(cuts.has('secondary') ? { segment2: from.segment2, which2: from.which2 } : {}),
  };
}

/**
 * The range, moved to the new chart.
 *
 * A moment has one cell, so a span carried onto it collapses to its end — and
 * the end, not the start, because that is the period the chart is AT.
 *
 * Coming back the other way, that collapsed range would leave a trend with one
 * period on its axis, which is a blocker rather than a chart. A chart that only
 * ever held one period genuinely forgot the span, so the default span is
 * re-applied — anchored to the end that DID survive, which is the answer the
 * author is most likely to have cared about.
 */
function carriedRange(
  from: ChartSetup,
  grain: DateGrain,
  question: TimeQuestion,
  base: ChartSetup,
): PeriodRange {
  const to = snap(grain, from.range.to);
  if (question === 'moment') return { from: to, to };

  const kept = { from: snap(grain, from.range.from), to };
  if (cellCount(grain, kept) > 1) return kept;
  return rangeEndingAt(grain, to, cellCount(grain, base.range));
}

/**
 * The closest grain the new question will accept, measured on the coarseness
 * ladder rather than by list position — asked for weeks on a chart that only
 * bridges by quarter or year, quarter is the honest answer and year is not.
 */
const LADDER: DateGrain[] = ['day', 'week', 'month', 'quarter', 'half', 'year'];

function nearestGrain(want: DateGrain, offered: DateGrain[]): DateGrain {
  if (offered.includes(want)) return want;
  const at = LADDER.indexOf(want);
  return [...offered].sort(
    (a, b) => Math.abs(LADDER.indexOf(a) - at) - Math.abs(LADDER.indexOf(b) - at),
  )[0];
}

/**
 * Changing the grain re-snaps the range to the new grain's cells and keeps the
 * span it had, in the new unit, where the old one is meaningless — sixteen weeks
 * asked for in months is not sixteen months.
 */
export function withGrain(setup: ChartSetup, grain: DateGrain, question: TimeQuestion): ChartSetup {
  if (grain === setup.grain) return setup;
  const to = snap(grain, setup.range.to);
  if (question === 'moment') return { ...setup, grain, range: { from: to, to } };

  const held = cellCount(setup.grain, setup.range);
  const snapped = { from: snap(grain, setup.range.from), to };
  // Keep the DATES when they still cover more than one cell of the new grain —
  // the author picked a real span and it survives a change of unit. Only when
  // they collapse into a single cell is a fresh default the better answer.
  return {
    ...setup,
    grain,
    range:
      cellCount(grain, snapped) > 1
        ? snapped
        : rangeEndingAt(grain, to, Math.min(held, SPAN_PRESETS[grain][2] ?? 4)),
  };
}

/* ------------------------------------------------------------------ */
/* Issues                                                             */
/* ------------------------------------------------------------------ */

export interface SetupIssue {
  /** A blocker is a chart that would state something untrue. A note is taste. */
  level: 'blocker' | 'note';
  text: string;
  /** A layout without this problem, when there is an obvious one to offer. */
  insteadId?: string;
}

/** How a non-additive measure gets described in a warning. */
const notSummable = (m: MeasureDef): string =>
  m.unit === 'percent' ? 'a rate' : 'an average';

/**
 * Everything wrong with these answers on this layout, worst first.
 *
 * The blockers all have the same root: a chart that draws a TOTAL out of parts
 * that don't sum to one. Stacking averages, pieing a rate, flowing a ratio down
 * a Sankey — each of them prints a number that exists nowhere in the data, and
 * it looks entirely fine on the slide, which is why this is a block rather than
 * a note.
 */
export function setupIssues(layout: ChartLayout, setup: ChartSetup): SetupIssue[] {
  const form = formFor(layout);
  const out: SetupIssue[] = [];
  const shape = form.shape;
  const question = timeQuestionFor(form, setup.axis);
  const measure = setup.measure ? resolveMeasure(setup.measure) : undefined;

  const stacking = layout.stack === 'stacked' || layout.stack === 'stacked100';
  const totalsParts = stacking || shape === 'share' || shape === 'flow';

  /** The cut that divides the total, which differs by shape. */
  const dividesOnSecond = shape === 'categorical' || shape === 'flow';
  const dividerId = dividesOnSecond ? setup.segment2 : setup.segment;
  const dividerWhich = dividesOnSecond ? setup.which2 : setup.which;

  for (const slot of form.measures) {
    const id =
      slot.key === 'primary'
        ? setup.measure
        : slot.key === 'secondary'
          ? setup.secondaryMeasure
          : setup.sizeMeasure;
    if (slot.required && !id) {
      out.push({ level: 'blocker', text: `${slot.label} isn’t set — ${slot.hint}.` });
    }
  }

  for (const slot of form.segments) {
    const id = slot.key === 'primary' ? setup.segment : setup.segment2;
    if (slot.required && !id) {
      out.push({ level: 'blocker', text: `${slot.label} isn’t set — ${slot.hint}.` });
    }
  }

  if (measure && totalsParts && !additive(measure)) {
    out.push({
      level: 'blocker',
      text:
        `${measure.label} is ${notSummable(measure)}, so its parts don’t sum to a total — ` +
        `${shape === 'share' ? 'a pie of it' : shape === 'flow' ? 'a flow of it' : 'stacking it'} ` +
        'draws a figure that exists nowhere in the data.',
      insteadId: shape === 'trend' ? 'line' : 'clustered',
    });
  }

  if (shape === 'xy') {
    if (setup.measure && setup.measure === setup.secondaryMeasure) {
      out.push({
        level: 'blocker',
        text: 'Both axes are the same measure, which plots a straight diagonal and says nothing.',
      });
    }
    if (layout.kind === 'bubble' && !setup.sizeMeasure) {
      out.push({
        level: 'note',
        text: 'No size measure, so every bubble is drawn the same — which is a scatter.',
        insteadId: 'scatter',
      });
    }
  }

  if (layout.kind === 'combo' && setup.secondaryMeasure) {
    const second = resolveMeasure(setup.secondaryMeasure);
    if (!isRate(second)) {
      out.push({
        level: 'note',
        text:
          `${second.label} is an absolute, and two absolutes belong on one axis — ` +
          'a second scale down the right is what a rate needs.',
        insteadId: 'clustered',
      });
    }
  }

  const cells = cellCount(setup.grain, setup.range);

  if (cells === 0) {
    out.push({
      level: 'blocker',
      text: 'The range starts after it ends — check the two dates.',
    });
  } else if (question === 'range' && cells < 2) {
    out.push({
      level: 'blocker',
      text: `One ${setup.grain} is a moment, not a trend — a ${shape === 'trend' ? 'line' : 'time axis'} needs at least two.`,
    });
  } else if ((question === 'range' || question === 'window') && cells > MAX_SPAN) {
    // Reachable now that the ends are picked rather than chosen from a preset:
    // two dates eighteen months apart at day grain is five hundred ticks.
    out.push({
      level: 'note',
      text: `${cells} ${setup.grain}s is more ticks than an axis can label — a coarser grain says the same thing legibly.`,
    });
  }

  if (question === 'points' && cells < setup.markers) {
    out.push({
      level: 'blocker',
      text: `${setup.markers} markers need at least ${setup.markers} ${setup.grain}s between the two ends.`,
    });
  }

  if (dividerId) {
    const members = segmentWith(dividerId, dividerWhich).members.length;
    if (shape === 'share' && members > 7) {
      out.push({
        level: 'note',
        text: `${members} slices is past where a pie reads; a ranked bar chart names them all.`,
        insteadId: 'clustered',
      });
    }
    if (shape === 'trend' && members > 6) {
      out.push({
        level: 'note',
        text: `${members} lines on one plot is about two too many — the rest read as noise.`,
      });
    }
  }

  if (shape === 'categorical' && setup.axis === 'segment' && setup.segment && setup.segment2) {
    const bars =
      segmentWith(setup.segment, setup.which).members.length *
      segmentWith(setup.segment2, setup.which2).members.length;
    // Twenty is where a clustered chart genuinely stops being readable. No pair
    // on today's menu can reach it — the widest cross it offers is four use
    // cases by three of anything — so this guard is for typed cuts and for
    // whatever gets added to `SEGMENTS` next. Deleting it because the current
    // list can't trip it is how a guard turns out never to have existed.
    if (!stacking && bars > 20) {
      out.push({
        level: 'note',
        text: `Two cuts crossed is ${bars} columns — stack them, or put one of the cuts on a second chart.`,
        insteadId: 'stacked',
      });
    }
  }

  if (shape === 'flow' && setup.segment && setup.segment === setup.segment2) {
    out.push({
      level: 'blocker',
      text: 'A flow from a cut to itself has nowhere to go — pick a different cut for one end.',
    });
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'blocker' ? -1 : 1));
}

export const isReady = (layout: ChartLayout, setup: ChartSetup): boolean =>
  !setupIssues(layout, setup).some((i) => i.level === 'blocker');
