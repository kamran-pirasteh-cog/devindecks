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
import { inferChartMeta, periodPhrase, type ChartMeta, type DeckContext } from './meta';

export interface DevinPromptContext extends DeckContext {
  /** Stamped in the footer so an answer can be matched to its question. */
  generatedAt?: string;
  chartId?: string;
  templateName?: string;
  templateVersion?: number;
}

export interface DevinPrompt {
  text: string;
  meta: ChartMeta;
  contract: ChartResultContract;
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
  butterfly: 'butterfly chart',
};

export function buildDevinChartPrompt(
  spec: ChartSpec,
  ctx: DevinPromptContext = {},
): DevinPrompt {
  const meta = inferChartMeta(spec, ctx);
  const schema = sheetSchemaFor(spec);
  const series = sheetSeriesFor(spec);
  const contract = chartResultContract(schema, series.map((s) => s.key));

  const noun = KIND_NOUN[spec.kind] ?? 'chart';
  const subject = meta.subject ?? null;

  const lines: string[] = [];

  /* 1 — the task */
  lines.push('# Research task');
  lines.push('');
  // Two things can be missing — what's being measured, and who it's about —
  // and both are called out rather than papered over. A confident brief built
  // on a guessed metric or a guessed company produces confident wrong numbers,
  // which is far worse than a brief that asks one question first.
  lines.push(
    [
      `Find the data for a **${noun}**`,
      meta.measure ? ` showing **${meta.measure}**` : '',
      subject ? ` for **${subject}**` : '',
      '.',
    ].join(''),
  );
  const gaps: string[] = [];
  if (!meta.measure) {
    gaps.push(
      "**METRIC: not labelled.** The chart's value axis has no title and the series names don't share one, so what is being measured has to be confirmed before starting.",
    );
  }
  if (!subject) {
    gaps.push(
      '**SUBJECT: not specified.** The chart does not say which company, market or entity this is about.',
    );
  }
  if (gaps.length) {
    lines.push('');
    lines.push(`Ask before starting — ${gaps.length > 1 ? 'two things are' : 'this is'} unstated:`);
    lines.push('');
    lines.push(gaps.map((g) => `- ${g}`).join('\n'));
  }
  lines.push('');

  /* 2 — units */
  lines.push('## Units and precision');
  lines.push('');
  lines.push(meta.unitSentence);
  if (meta.unit) lines.push(`The unit is **${meta.unit}**.`);
  lines.push('');

  /* 3 — shape of the answer */
  lines.push('## What each row is');
  lines.push('');
  const period = periodPhrase(meta.period);
  if (period) {
    lines.push(`- ${capitalize(period)}.`);
  } else {
    lines.push(`- One row per ${schema.keyColumns[0]?.header.toLowerCase() ?? 'category'}.`);
  }
  lines.push(`- The chart currently has these ${meta.categories.length} rows, in order:`);
  lines.push('');
  lines.push(meta.categories.map((c) => `  - ${c}`).join('\n'));
  lines.push('');

  if (meta.seriesNames.length) {
    const dimension = meta.dimension ? ` (broken down by ${meta.dimension})` : '';
    lines.push(
      `- For every row, return a figure for each of these ${meta.seriesNames.length} series${dimension}:`,
    );
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
    'Keep these row and series labels unless the research shows one is wrong — if it is, use the correct label and say so in `notes`.',
  );
  lines.push('');

  /* 4 — sourcing */
  lines.push('## Sourcing rules');
  lines.push('');
  lines.push(
    [
      '- Prefer primary sources: 10-K/10-Q and equivalent filings, company IR decks, regulator and statistical-agency publications.',
      '- Give `source_url` and `source_note` (page or table reference) for **every** row.',
      '- Mark each row `reported` (stated verbatim in a source), `derived` (computed from stated figures — explain how in `notes`) or `estimated`.',
      '- If a figure genuinely is not available, return `null` and list it in `unresolved`. Do not interpolate, extrapolate or fill a gap with a plausible number.',
      '- State the currency and, if you converted anything, the FX basis and date.',
      '- If a source restates a prior period, use the restated figure and note it.',
    ].join('\n'),
  );
  lines.push('');

  /* 5 — the contract */
  lines.push('## Return format');
  lines.push('');
  lines.push('Return **only** a JSON object matching this schema:');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(contract.jsonSchema, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('Worked example of the shape:');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(contract.example, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(
    `If JSON is impractical, return CSV with exactly this header instead:\n\n\`\`\`\n${contract.csvHeader.join(',')}\n\`\`\``,
  );
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

  return { text: lines.join('\n'), meta, contract };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
