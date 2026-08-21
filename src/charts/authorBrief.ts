/**
 * The brief, narrowed down to what is worth keeping on the chart.
 *
 * `readBrief` reads a sentence and works out enough to build a chart from it.
 * Most of that lands in the spec as labels and is then readable off the chart
 * forever. Two things aren't, and they are exactly the two a research prompt
 * needs most:
 *
 * 1. The sentence itself. A chart shows what it plots, not what was meant by
 *    it, and "quarterly ARR by segment, in $M" says things no axis title can.
 * 2. WHICH of the chart's facts the author actually stated. Once a value is a
 *    label, a guessed range and a demanded one look identical — and the guessed
 *    one being handed to research as an instruction is the failure this whole
 *    record exists to prevent.
 *
 * So this keeps the sentence and a per-field origin, and deliberately keeps
 * nothing that is already on the spec. Categories, series names and the number
 * format live there; a second copy here would be a second source of truth that
 * disagrees with the chart the moment anyone opens the datasheet.
 */
import type { AuthorChartBrief, BriefFieldSource } from '@/model';
import type { ChartBrief } from './intent';

/**
 * Did the author actually type this word?
 *
 * The parser matches its own vocabulary against the text and hands back its own
 * spelling — "arr" comes out as "ARR". That is a restatement, not a finding, so
 * the check is case-insensitive: an author who typed "arr" stated ARR.
 */
const saidIt = (description: string, value: string): boolean =>
  new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(description);

/**
 * Where a value the parser found in the text came from.
 *
 * Never 'inferred': the measure and dimension vocabularies only ever match
 * words that are present, so a miss leaves the field `undefined` rather than
 * filled with a guess. 'derived' catches the case where the label we print
 * isn't literally what was typed.
 */
const fromText = (description: string, value: string | undefined): BriefFieldSource =>
  value && saidIt(description, value) ? 'stated' : 'derived';

/**
 * Keep the brief on the chart.
 *
 * `asOf` matters more than it looks: without it, an inferred range is a span
 * with no explanation, and the prompt can only say "this was not asked for"
 * rather than "this is eight quarters counted back from the 20th".
 */
export function authorBriefFrom(
  brief: ChartBrief,
  opts: { asOf?: string } = {},
): AuthorChartBrief {
  const labels = brief.period?.labels ?? [];

  return {
    v: 1,
    description: brief.description,
    asOf: opts.asOf,

    subject: brief.subject,
    subjectFrom: brief.subjectFrom,

    measure: brief.measure,
    measureFrom: fromText(brief.description, brief.measure),
    secondaryMeasure: brief.secondaryMeasure,
    measures: brief.measures,

    dimension: brief.dimension,
    dimensionFrom: fromText(brief.description, brief.dimension),

    // Endpoints, not the labels themselves — see the field's comment. A period
    // is only ever recorded when there is one; the count comes off the labels
    // because that is what was actually laid out.
    period: brief.period
      ? {
          grain: brief.period.grain,
          from: labels[0],
          to: labels[labels.length - 1],
          count: labels.length,
        }
      : undefined,
    // The one line this whole file is for. `stated` is false when the sentence
    // named a grain but no span, so a default count was invented and counted
    // back from today — a range nobody asked for, which research must confirm
    // before a single figure is looked up.
    periodFrom: !brief.period ? 'inferred' : brief.period.stated ? 'derived' : 'inferred',

    unitNote: brief.unitNote,
    // A currency read off the measure name ("revenue" implies dollars) is a
    // house convention rather than a statement, and reporting in the wrong
    // currency is a whole-chart error.
    unitFrom: brief.unitStated ? 'stated' : 'inferred',

    gaps: brief.gaps,
  };
}

/**
 * The brief for a chart whose author was asked and said nothing.
 *
 * Not the same as no brief at all, and the difference is load-bearing: an older
 * chart's labels may have been typed by hand and are worth reading, while these
 * are placeholders we chose. Recording the refusal is what lets the prompt say
 * so instead of quietly mining a placeholder title for a measure.
 */
export function skippedAuthorBrief(): AuthorChartBrief {
  return {
    v: 1,
    description: '',
    subjectFrom: 'unknown',
    measureFrom: 'inferred',
    measures: [],
    dimensionFrom: 'inferred',
    periodFrom: 'inferred',
    unitFrom: 'inferred',
    gaps: [],
    askedAndSkipped: true,
  };
}
