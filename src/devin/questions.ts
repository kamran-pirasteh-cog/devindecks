/**
 * The questions Devin has to ask before it researches anything.
 *
 * A chart tells you its shape but not its intent. "Revenue" over "FY23..FY25"
 * broken into "Enterprise / Mid-Market / SMB" is unambiguous to the author and
 * genuinely ambiguous to a researcher: whose revenue, on whose fiscal calendar,
 * and where are those segment boundaries drawn? Guessing any one of them
 * produces figures that are internally consistent, well-sourced, and wrong —
 * the most expensive kind of answer, because nothing about the slide looks
 * broken afterwards.
 *
 * So every gap the model can detect becomes a question in the prompt rather
 * than an assumption inside it. Derived from the same `ChartMeta` the briefs
 * are written from, so a question can't describe a chart that has since
 * changed.
 */
import type { ChartMeta } from './meta';

export interface Clarification {
  /** Short heading — "Subject", "Timeframe". Groups repeats across charts. */
  topic: string;
  question: string;
  /** Which chart is asking, when the questions from several are pooled. */
  scope?: string;
}

/**
 * The standing instruction. Listed gaps are the ones the model can see; this
 * covers the ones only the research turns up, and makes clear that asking is
 * the expected behaviour rather than an admission of being stuck.
 */
export const ASK_FIRST_RULES = [
  '- **Ask before you research.** Put every question in one message up front, and wait for answers. Do not begin the data gathering with an open question outstanding.',
  '- The list above is what the deck could not tell us. It is not exhaustive — **ask anything else you need** to be certain you are returning the exact figure that was intended, including anything you only discover once you are into the sources.',
  '- **Never resolve an ambiguity by picking the most likely reading.** If two definitions of a metric, two fiscal calendars or two entity scopes would both fit, ask which. A plausible guess is indistinguishable from a correct answer once it is on the slide.',
  "- If an answer changes the shape of the request — a different segmentation, a period that isn't reported, a metric the company doesn't disclose — say so and agree the approach before continuing.",
] as const;

/**
 * Questions a single chart raises. `scope` names the chart when the questions
 * from several are pooled together; on a single-chart brief it is omitted and
 * the questions read as being about "this chart".
 */
export function chartClarifications(meta: ChartMeta, scope?: string): Clarification[] {
  const out: Clarification[] = [];
  // The scope rides in its own field rather than inside the sentence: a chart
  // name embedded in a bold question nests emphasis inside emphasis, which
  // renders as literal asterisks.
  const ask = (topic: string, question: string, scoped = true) =>
    out.push(scoped && scope ? { topic, question, scope } : { topic, question });

  if (!meta.subject) {
    ask(
      'Subject',
      '**Which entity is this about?** Nothing in the deck names the company, market or organisation, so it has to be stated before anything can be looked up.',
      false,
    );
  } else if (meta.subjectSource !== 'tag') {
    // A title is a headline that happens to contain a name, not a statement of
    // scope — "Acme Q3 Review" could mean the group, a division or one region.
    ask(
      'Subject',
      `**Is the subject ${meta.subject}?** That is read from the ${
        meta.subjectSource === 'slide' ? 'slide' : 'deck'
      } title, not stated as the research subject. Confirm the entity — and its scope: whole group, a named segment or subsidiary, or a single geography?`,
      false,
    );
  }

  if (!meta.measure) {
    ask(
      'Metric',
      "**What is being measured?** The value axis has no title and the series names don't share one, so the metric is unstated.",
    );
  } else {
    ask(
      'Metric',
      `**How is "${meta.measure}" defined?** Confirm the exact definition to research — gross or net, reported or adjusted, including or excluding the usual carve-outs — since companies publish several figures under one name.`,
    );
  }

  if (!meta.period) {
    ask(
      'Timeframe',
      `**Which period should these figures cover?** The rows aren't dated${
        meta.categories.length
          ? ` — they read as ${meta.categories.slice(0, 3).join(', ')}${meta.categories.length > 3 ? ', …' : ''}`
          : ''
      }, so state the as-of date or reporting period each figure should be taken from.`,
    );
  } else {
    ask(
      'Timeframe',
      `**Is ${meta.period.from} to ${meta.period.to} the fiscal or the calendar year?** Confirm the year-end, and whether the range should stay as-is or roll forward to the latest reported period.`,
    );
  }

  if (meta.seriesNames.length > 1) {
    ask(
      'Segmentation',
      `**How are ${meta.seriesNames.join(', ')} defined?** ${
        meta.dimension ? `They break the measure down by ${meta.dimension}. ` : ''
      }Confirm where the boundaries sit, whether they are mutually exclusive, and whether they should sum to the total — a company's own segment reporting often doesn't match the labels a deck uses.`,
    );
  }

  if (!meta.unit) {
    ask(
      'Units',
      "**What unit are these figures in?** The chart's number format doesn't say, and a unit assumed wrongly is off by orders of magnitude without looking wrong.",
    );
  } else if (meta.unit !== '%') {
    ask(
      'Units',
      `**Reporting currency?** The chart is in ${meta.unit}. If a source reports in another currency, confirm the FX rate and date to convert at — or whether to report constant-currency instead.`,
    );
  }

  return out;
}

/**
 * Collapses repeats — one "which entity" question, not one per chart. Scoped
 * questions only merge when they're asking the same thing of the same chart,
 * since the same words about two different charts are two different questions.
 */
export function dedupeClarifications(all: Clarification[]): Clarification[] {
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${c.scope ?? ''}\u0000${c.question}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Renders as a markdown list, one line per question, topic first. */
export function clarificationLines(items: Clarification[]): string {
  return items
    .map((c) => `- **${c.topic}** — ${stripLeadingBold(c.question)}${c.scope ? ` _(${c.scope})_` : ''}`)
    .join('\n');
}

// The topic already carries the heading, so the question's own bold lead-in
// would read as a stutter: "Subject — **Which entity is this about?**".
const stripLeadingBold = (q: string) => q.replace(/^\*\*(.+?)\*\*/, '$1');
