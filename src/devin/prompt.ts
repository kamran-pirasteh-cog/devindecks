/**
 * "Generate Devin prompt for this chart".
 *
 * Built fresh from the live spec every time, so it can't go stale: change the
 * period, the units or the segments and the next prompt says so. Pure — no
 * clipboard, no `Date.now()`, no randomness — which makes it snapshot-testable
 * and means the same chart always produces the same brief.
 *
 * The one thing it will not do is invent a subject. If nothing in the chart or
 * the deck says who this is about, it says so in capitals rather than guessing
 * a company name, because a plausible wrong subject is the single most
 * expensive failure mode here.
 */
import { WATERFALL_ROLE_OPTIONS, sheetSchemaFor, sheetSeriesFor, type ChartSpec } from '@/model';
import { chartResultContract, type ChartResultContract } from './contract';
import {
  inferChartMeta,
  isSubjectStated,
  periodPhrase,
  type ChartMeta,
  type DeckContext,
} from './meta';
import type { ChartResearchHints } from '@/charts/research';
import {
  ASK_FIRST_RULES,
  chartClarifications,
  clarificationLines,
  type Clarification,
} from './questions';

export interface DevinPromptContext extends DeckContext {
  /** Stamped in the footer so an answer can be matched to its question. */
  generatedAt?: string;
  chartId?: string;
  templateName?: string;
  templateVersion?: number;
  /**
   * House rules for this chart's archetype, when it has one. Resolved by the
   * CALLER: this module stays pure so a prompt is reproducible from a spec, and
   * reaching into the template store from here would put `localStorage` behind
   * a snapshot test.
   */
  research?: ChartResearchHints;
}

export interface DevinPrompt {
  text: string;
  meta: ChartMeta;
  contract: ChartResultContract;
  /** What the chart couldn't say, surfaced so a caller can count or show it. */
  clarifications: Clarification[];
}

const KIND_NOUN: Record<string, string> = {
  column: 'column chart',
  bar: 'bar chart',
  line: 'line chart',
  area: 'area chart',
  combo: 'combination chart',
  pie: 'pie chart',
  donut: 'donut chart',
  scatter: 'scatter plot',
  bubble: 'bubble chart',
  waterfall: 'waterfall (bridge) chart',
  mekko: 'Mekko chart',
  dotplot: 'dot plot',
  butterfly: 'butterfly chart',
  gantt: 'Gantt chart (a project timeline)',
};

/**
 * What the author asked for, and what we filled in for them.
 *
 * The single most useful thing this prompt can carry, and the thing it had no
 * way to say before: a chart cannot distinguish a range somebody demanded from
 * a range we counted back from today, and handing the second one over as an
 * instruction is how a research brief ends up confidently answering the wrong
 * question.
 *
 * Two lists, deliberately: what a person stated is printed as fact, and what we
 * worked out is printed as a thing to confirm. Nothing appears in both.
 */
function authorSection(meta: ChartMeta): string[] {
  if (meta.askedAndSkipped) {
    return [
      '## What the author asked for',
      '',
      'Nothing. The author was asked and chose not to say, so **every label on it is a placeholder we generated** — title, rows and series alike. Read no intent into them, and treat none of the numbers as a starting point. Establish what this chart is for before looking anything up.',
      '',
    ];
  }
  if (!meta.description) return [];

  const said: string[] = [];
  const ours: string[] = [];

  if (meta.subjectSource === 'author' && meta.subject) said.push(`the subject (**${meta.subject}**)`);
  if (meta.measure) (meta.measureConfidence === 'stated' ? said : ours).push(`the metric (**${meta.measure}**)`);
  if (meta.dimension) {
    (meta.dimensionConfidence === 'stated' ? said : ours).push(`the breakdown (**by ${meta.dimension}**)`);
  }
  if (meta.unit) (meta.unitConfidence === 'stated' ? said : ours).push(`the units (**${meta.unit}**)`);
  if (meta.period) {
    const span = `**${meta.period.from}–${meta.period.to}**`;
    if (meta.periodConfidence === 'stated') said.push(`the period (${span})`);
    else ours.push(`the period (${span})`);
  }

  const lines = ['## What the author asked for', ''];
  // Verbatim, in a blockquote, never re-worded. The whole point is that these
  // are their words and not our reading of them.
  lines.push(`> ${meta.description}`);
  lines.push('');
  if (said.length) lines.push(`Stated by the author: ${said.join(', ')}.`);
  if (ours.length) {
    // The label is bold and the sentence is not: the values inside it are
    // already bold, and emphasis nested inside emphasis renders as literal
    // asterisks rather than as bold.
    const one = ours.length === 1;
    lines.push(
      `**Filled in by us, not asked for:** ${ours.join(', ')}. Confirm ${one ? 'it' : 'each of them'} before use — a figure looked up against a period or a metric the author never chose is the wrong figure, however well sourced.`,
    );
  }
  if (meta.gaps.length) {
    lines.push('');
    lines.push('The description left these open:');
    lines.push(meta.gaps.map((gap) => `- ${gap}`).join('\n'));
  }
  lines.push('');
  return lines;
}

/**
 * The author's notes, verbatim.
 *
 * Its own block, above the sourcing rules and clearly the author's words: these
 * are INSTRUCTIONS, and the two failure modes are opposite. Buried among the
 * facts they get skimmed past; mixed into the sourcing floor they read as
 * qualifying rules that are not negotiable. So they sit here, quoted, with one
 * line on what to do when a note and a rule disagree — which is to ask, not to
 * pick.
 */
function notesSection(meta: ChartMeta): string[] {
  if (!meta.notes?.trim()) return [];
  return [
    '### Notes from the author',
    '',
    // Every line quoted, so a multi-line note doesn't break out of the block
    // and read as our own prose.
    meta.notes
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
    '',
    'These are instructions, not context — follow them. If one conflicts with the sourcing rules below, or you cannot follow it, say so rather than choosing between them.',
    '',
  ];
}

export function buildDevinChartPrompt(
  spec: ChartSpec,
  ctx: DevinPromptContext = {},
): DevinPrompt {
  const meta = inferChartMeta(spec, ctx);
  const schema = sheetSchemaFor(spec);
  const series = sheetSeriesFor(spec);
  const contract = chartResultContract(schema, series);

  const noun = KIND_NOUN[spec.kind] ?? 'chart';
  const subject = meta.subject ?? null;

  const lines: string[] = [];

  /* 1 — the task */
  lines.push('# Research task');
  lines.push('');
  // A subject read out of a title is marked as provisional right here, in the
  // one sentence that gets skimmed. A confident brief built on a guessed
  // company produces confident wrong numbers, which is far worse than a brief
  // that asks one question first.
  lines.push(
    [
      `Find the data for a **${noun}**`,
      meta.measure ? ` showing **${meta.measure}**` : '',
      subject ? ` for **${subject}**` : '',
      subject && !isSubjectStated(meta) ? ' _(assumed — confirm below)_' : '',
      '.',
    ].join(''),
  );
  lines.push('');

  /* 1a — the author's own words, and which parts are ours */
  lines.push(...authorSection(meta));
  // Pushed here rather than inside `authorSection`, which returns early for a
  // chart that carries no description: a note is worth printing even then.
  lines.push(...notesSection(meta));

  /* 1b — the questions, before any research happens. Printed only when there
     ARE questions: a chart set up in the form has answered most of them, and a
     section of questions nobody needs to ask is what teaches a reader to skim
     the one that matters. */
  const clarifications = chartClarifications(meta);
  if (clarifications.length) {
    lines.push('## Ask first');
    lines.push('');
    lines.push('Confirm these before looking anything up:');
    lines.push('');
    lines.push(clarificationLines(clarifications));
    lines.push('');
    lines.push(ASK_FIRST_RULES.join('\n'));
    lines.push('');
  } else {
    lines.push(
      'Everything the brief needed is stated above. If something is still ambiguous once you are into the sources — how the metric is defined, the scope of the entity, where a segment boundary sits — **ask rather than picking the likelier reading**.',
    );
    lines.push('');
  }

  /* 2 — units and the shape of the answer, under one heading: they are one
     question ("what goes in a cell, and what is a row?") and were two. */
  lines.push('## What to return');
  lines.push('');
  lines.push(meta.unit ? `${meta.unitSentence} The unit is **${meta.unit}**.` : meta.unitSentence);
  lines.push('');
  const period = periodPhrase(meta.period, meta.calendar);
  if (period) {
    lines.push(`- ${capitalize(period)}.`);
    // Said plainly, because the alternative reading of the same axis is "this
    // chart is a week out of date", and acting on that reading puts a partial
    // period next to complete ones — a dip at the right-hand edge that reads as
    // a collapse.
    // Both halves matter, and they are opposite failures. An axis that stops
    // short reads as out of date, and the helpful thing to do with that reading
    // is add the partial period back. An axis that ends ON the current period
    // has a partial figure in it that looks exactly like a complete one.
    if (meta.currentPeriod === 'excluded') {
      lines.push(
        `- The ${meta.period!.grain} in progress is deliberately **excluded** — the range ends on the last complete one. Do not add a partial period, and do not roll the range forward without asking.`,
      );
    } else if (meta.currentPeriod === 'included') {
      lines.push(
        `- The last row is the **${meta.period!.grain} in progress**, so its figure is partial. Return it to-date, say in \`notes\` what date it is measured through, and mark it \`estimated\` if the source itself is a running total.`,
      );
    }
  } else {
    lines.push(`- One row per ${schema.keyColumns[0]?.header.toLowerCase() ?? 'category'}.`);
  }
  lines.push(`- These ${meta.categories.length} rows, in order:`);
  lines.push('');
  lines.push(meta.categories.map((c) => `  - ${c}`).join('\n'));
  lines.push('');

  if (meta.seriesNames.length) {
    const dimension = meta.dimension ? ` (broken down by ${meta.dimension})` : '';
    lines.push(`- A figure per row for each of these ${meta.seriesNames.length} series${dimension}:`);
    lines.push('');
    lines.push(meta.seriesNames.map((s) => `  - ${s}`).join('\n'));
    lines.push('');
  }

  if (schema.perSeries.length > 1) {
    lines.push(
      `- Each series needs ${schema.perSeries.map((c) => `**${c.header}**`).join(' and ')}.`,
    );
    lines.push('');
  }

  // The caption column asks for prose, not a figure, so it needs saying what
  // for: without this the note comes back as a repeat of the number, or as a
  // sentence too long to print under a dot.
  if (schema.perSeries.some((c) => c.key === 'note')) {
    lines.push(
      '- **Note** is a short caption printed beside that figure on the chart — the date or period it is measured at ("Jan 2024", "Q2 FY26", "FY27 target"). A few words at most, and leave it blank rather than guessing at one.',
    );
    lines.push('');
  }

  if (spec.kind === 'waterfall') {
    lines.push('- Each row also needs a **Kind**:');
    lines.push('');
    lines.push(
      WATERFALL_ROLE_OPTIONS.map((o) => `  - \`${o.value}\` — ${o.hint}`).join('\n'),
    );
    lines.push('');
  }

  if (spec.kind === 'mekko') {
    lines.push(
      '- Also return a column width per row (the total the column represents), since a Mekko sizes its columns by weight.',
    );
    lines.push('');
  }

  lines.push(
    'Keep these row and series labels unless the research shows one is wrong — if it is, use the correct label and say so.',
  );
  lines.push('');

  /* 4 — sourcing */
  lines.push('## Sourcing rules');
  lines.push('');
  lines.push(
    [
      '- Prefer primary sources: 10-K/10-Q and equivalent filings, company IR decks, regulator and statistical-agency publications. Use a restated figure over the original, and say so.',
      '- Every row needs `source_url`, `source_note` (page or table) and `confidence`: `reported` (verbatim in a source), `derived` (computed — show the arithmetic) or `estimated`.',
      '- Leave a figure you cannot source **blank**, and say which. Do not interpolate, extrapolate or fill a gap with a plausible number.',
      '- If you converted a currency, state the FX basis and date.',
    ].join('\n'),
  );
  // House rules go AFTER the floor above, never mixed into it. A chart-specific
  // instruction that appeared alongside the general ones could be read as
  // qualifying them, and none of them are negotiable.
  if (ctx.research?.guidance) {
    lines.push('');
    lines.push(`**For this kind of chart specifically:** ${ctx.research.guidance}`);
  }
  if (ctx.research?.preferredSources?.length) {
    lines.push('');
    lines.push(
      `- Start with ${ctx.research.preferredSources.map((src) => `**${src}**`).join(', ')}. The rules above apply to each of them unchanged.`,
    );
  }
  lines.push('');

  /* 5 — the contract. CSV first, because that is what an answer to a chart of
     eight rows actually looks like, and because the JSON Schema this used to
     print in full was longer than the rest of the brief put together. JSON is
     still parsed on the way back in, so an answer that arrives as JSON works. */
  lines.push('## Format');
  lines.push('');
  lines.push(`CSV, with exactly this header:\n\n\`\`\`\n${contract.csvHeader.join(',')}\n\`\`\``);
  lines.push('');
  // The legend, because the column names say nothing about which series is
  // which, and an answer that fills them in the wrong order parses, pastes, and
  // is wrong on the slide with nothing to show for it.
  lines.push('| Column | Holds | Type | Required |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(
    contract.legend
      .map((c) => `| \`${c.name}\` | ${c.means} | ${c.type} | ${c.required ? 'yes' : 'no'} |`)
      .join('\n'),
  );
  lines.push(
    `| \`source_url\`, \`source_note\`, \`confidence\` | Where the figure came from | text | yes |`,
  );
  lines.push('');
  lines.push(
    '**Column order is not the contract — the names are.** Match each figure to the column named for its series, and never shift a value into a neighbouring column to make a row fit.',
  );
  lines.push('');
  lines.push('Anything the figures need caveating with goes in prose after the CSV.');
  lines.push('');

  /* 6 — provenance */
  lines.push('---');
  lines.push('');
  lines.push(
    [
      `Contract: \`${contract.contractId}\``,
      ctx.chartId ? `Chart: \`${ctx.chartId}\`` : null,
      ctx.templateName
        ? `Template: ${ctx.templateName}${ctx.templateVersion ? ` v${ctx.templateVersion}` : ''}`
        : null,
      ctx.deckTitle ? `Deck: ${ctx.deckTitle}` : null,
      ctx.generatedAt ? `Generated: ${ctx.generatedAt}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );

  return { text: lines.join('\n'), meta, contract, clarifications };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
