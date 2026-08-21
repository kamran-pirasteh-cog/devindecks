/**
 * The questions Devin has to ask before it researches anything — and only the
 * ones a person can actually answer.
 *
 * The rule here is narrow on purpose: ask about what nobody has said, and stay
 * quiet about what somebody has. A chart built in the setup step arrives with
 * its measure, its cut, its grain and its span all chosen by the author, and
 * re-asking any of them ("how do you define ACUs?", "where do the cohort
 * boundaries sit?") buries the one question that genuinely is open under four
 * that aren't — which is how a reader learns to skim the list. What the deck
 * could not tell us still gets asked; everything else is covered by the
 * standing instruction to ask rather than guess.
 *
 * Derived from the same `ChartMeta` the briefs are written from, so a question
 * can't describe a chart that has since changed.
 */
import { isSubjectStated, type ChartMeta } from './meta';

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
  '- **Ask before you research.** One message, every question, then wait — do not start with a question outstanding.',
  '- The list above is only what the deck could not tell us. **Ask anything else you need**, including what you only hit once you are into the sources — never resolve an ambiguity by picking the likelier reading.',
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
  } else if (!isSubjectStated(meta)) {
    // A title is a headline that happens to contain a name, not a statement of
    // scope — "Acme Q3 Review" could mean the group, a division or one region.
    ask(
      'Subject',
      `**Is the subject ${meta.subject}?** That is read off the ${
        meta.subjectSource === 'slide' ? 'slide' : 'deck'
      } title, not stated — confirm the entity and its scope (whole group, one segment, one geography).`,
      false,
    );
  }

  if (!meta.measure) {
    ask(
      'Metric',
      "**What is being measured?** The value axis has no title and the series names don't share one, so the metric is unstated.",
    );
  } else if (meta.measureConfidence !== 'stated') {
    // Read off the picture, so the NAME is the question. How it's defined is
    // covered by the standing "ask rather than guess" rule — printing it as its
    // own bullet on every chart is what made these lists unreadable.
    ask(
      'Metric',
      `**Is the metric "${meta.measure}"?** It is read off the chart rather than stated, so confirm it — and how it is defined, if more than one figure goes by that name.`,
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
  } else if (meta.periodConfidence !== 'stated') {
    // A range nobody asked for is the worst of these: every row underneath it
    // is the wrong row, and the chart looks entirely fine while being about the
    // wrong years.
    ask(
      'Timeframe',
      `**Was ${meta.period.from} to ${meta.period.to} meant to be the range?** It is not stated anywhere — the chart spans it because that is what got laid out. Agree the range first; if it is wrong, every figure below it is wrong too.`,
    );
  } else if (!meta.calendar) {
    ask(
      'Timeframe',
      `**Is ${meta.period.from} to ${meta.period.to} the fiscal or the calendar year?** Confirm the year-end.`,
    );
  }

  // Only when the cut was read off the series names. An author who picked the
  // breakdown in the setup step has already answered this.
  if (meta.seriesNames.length > 1 && meta.dimensionConfidence !== 'stated') {
    ask(
      'Segmentation',
      `**Are ${meta.seriesNames.join(', ')} the right split?** ${
        meta.dimension ? `They read as a breakdown by ${meta.dimension}. ` : ''
      }Confirm the boundaries, and whether they should sum to the total.`,
    );
  }

  // A plain count has no unit word worth printing — "ACUs" is the measure, not
  // a unit — so the absence of one is only a question when the author never
  // settled the units either. Picking the measure from the setup form settles
  // them, the same way picking the breakdown settles the split above.
  if (!meta.unit && meta.unitConfidence !== 'stated') {
    ask(
      'Units',
      "**What unit are these figures in?** The chart's number format doesn't say, and a unit assumed wrongly is off by orders of magnitude without looking wrong.",
    );
  } else if (meta.currency) {
    // Gated on the figures actually being MONEY. It used to fire for anything
    // that wasn't a percentage, which asked the reporting currency of a chart
    // measured in sessions, or in ACUs per merged PR — a question with no
    // answer, printed alongside the ones that matter.
    ask(
      'Units',
      `**Reporting currency?** The chart is in ${meta.currency}. If a source reports in another currency, confirm the FX rate and date to convert at — or whether to report constant-currency instead.`,
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
