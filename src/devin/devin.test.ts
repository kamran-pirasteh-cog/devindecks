import { describe, expect, it } from 'vitest';
import {
  cellText,
  defaultChartSpec,
  sheetSchemaFor,
  sheetSeriesFor,
  type AuthorChartBrief,
  type ColumnBarSpec,
  type WaterfallSpec,
} from '@/model';
import { inferChartMeta, periodPhrase } from './meta';
import { chartResultContract } from './contract';
import { buildDevinChartPrompt } from './prompt';
import { parseDevinChartResult } from './parseResult';

const column = () => defaultChartSpec('column', 'stacked') as ColumnBarSpec;

const contractFor = (spec = column()) =>
  chartResultContract(
    sheetSchemaFor(spec),
    sheetSeriesFor(spec).map((s) => s.key),
  );

/* ------------------------------------------------------------------ */

describe('inferChartMeta', () => {
  it('reads the period and grain off the category labels', () => {
    const meta = inferChartMeta(column());
    expect(meta.period).toMatchObject({ grain: 'year', from: 'FY23', to: 'FY25', count: 3 });
  });

  it('does not invent a period from segment names', () => {
    const spec = column();
    spec.data.categories = [
      { key: 'c0', label: 'Enterprise' },
      { key: 'c1', label: 'SMB' },
    ];
    expect(inferChartMeta(spec).period).toBeUndefined();
  });

  it('takes the measure from the value-axis title when there is one', () => {
    const spec = column();
    spec.axes.y.title = 'Net revenue';
    expect(inferChartMeta(spec).measure).toBe('Net revenue');
  });

  it('falls back to a shared word across series names', () => {
    const spec = column();
    spec.axes.y.title = undefined;
    spec.data.series = [
      { key: 's0', name: 'EMEA revenue', values: [1] },
      { key: 's1', name: 'APAC revenue', values: [2] },
    ];
    expect(inferChartMeta(spec).measure).toBe('revenue');
  });

  it('states the currency and precision in the unit sentence', () => {
    const spec = column();
    spec.numberFormat = { style: 'currency', currency: 'USD', decimals: 1, thousands: true };
    const s = inferChartMeta(spec).unitSentence;
    expect(s).toContain('USD');
    expect(s).toContain('1 decimal place');
  });

  it('says the data is in FULL units when the axis divides for display', () => {
    // The failure this prevents: format says millions, answer comes back in
    // units, and every figure on the slide is wrong by 1000x.
    const spec = column();
    spec.axes.y.unitDivisor = 1_000_000;
    const s = inferChartMeta(spec).unitSentence;
    expect(s).toContain('full units');
    expect(s).toContain('1,000,000');
  });

  it('describes a percentage axis as decimals, not percents', () => {
    const spec = column();
    spec.numberFormat = { style: 'percent' };
    expect(inferChartMeta(spec).unitSentence).toContain('0.427 means 42.7%');
  });

  it('prefers a deck tag as the subject, since tags hold client names', () => {
    const meta = inferChartMeta(column(), {
      deckTitle: 'Q3 Review',
      deckTags: ['Acme Corp'],
      slideTitle: 'Revenue by segment',
    });
    expect(meta.subject).toBe('Acme Corp');
  });

  it('falls back through slide title to deck title', () => {
    expect(inferChartMeta(column(), { deckTitle: 'D', slideTitle: 'S' }).subject).toBe('S');
    expect(inferChartMeta(column(), { deckTitle: 'D' }).subject).toBe('D');
    expect(inferChartMeta(column()).subject).toBeUndefined();
  });

  it('never reports a placeholder title as the measure', () => {
    const spec = column();
    spec.axes.y.title = undefined;
    spec.data.series = [{ key: 's0', name: 'Series 1', values: [1] }];
    for (const title of ['Chart Title', 'chart title', 'Untitled chart']) {
      spec.title = title;
      expect(inferChartMeta(spec).measure).toBeUndefined();
    }
    // A real title is still worth a guess — it just isn't a stated metric.
    spec.title = 'Revenue bridge';
    expect(inferChartMeta(spec)).toMatchObject({
      measure: 'Revenue bridge',
      measureConfidence: 'inferred',
    });
  });
});

describe('inferChartMeta, reading the author brief', () => {
  /** A chart built from "Acme's ARR by segment, last 8 quarters, in $M". */
  const briefed = (over: Partial<AuthorChartBrief> = {}): ColumnBarSpec => {
    const spec = column();
    spec.axes.y.title = undefined;
    spec.axes.x.title = undefined;
    spec.data.categories = [
      { key: 'c0', label: "Q1'26" },
      { key: 'c1', label: "Q2'26" },
    ];
    spec.authorBrief = {
      v: 1,
      description: "Acme's ARR by segment, last 8 quarters, in $M",
      subject: 'Acme',
      subjectFrom: 'described',
      measure: 'ARR',
      measureFrom: 'stated',
      measures: ['ARR'],
      dimension: 'segment',
      dimensionFrom: 'stated',
      period: { grain: 'quarter', from: "Q1'26", to: "Q2'26", count: 2 },
      periodFrom: 'derived',
      unitNote: 'in $M',
      unitFrom: 'stated',
      gaps: [],
      ...over,
    };
    return spec;
  };

  it('takes the author over anything read off the deck', () => {
    const meta = inferChartMeta(briefed(), { deckTags: ['Globex'], deckTitle: 'BVA Pitch (2)' });
    expect(meta).toMatchObject({ subject: 'Acme', subjectSource: 'author' });
  });

  it('supplies the measure and breakdown the chart cannot show', () => {
    const meta = inferChartMeta(briefed());
    expect(meta).toMatchObject({
      measure: 'ARR',
      measureConfidence: 'stated',
      dimension: 'segment',
      dimensionConfidence: 'stated',
    });
  });

  it('drops to inferred when the author has since retitled the axis', () => {
    const spec = briefed();
    spec.axes.y.title = 'Bookings';
    const meta = inferChartMeta(spec);
    // The chart wins on the value; the brief no longer vouches for it.
    expect(meta).toMatchObject({ measure: 'Bookings', measureConfidence: 'inferred' });
  });

  it('drops to inferred when the axis no longer spans what was asked for', () => {
    const spec = briefed();
    spec.data.categories = [
      { key: 'c0', label: "Q3'24" },
      { key: 'c1', label: "Q4'24" },
    ];
    const meta = inferChartMeta(spec);
    expect(meta.period).toMatchObject({ from: "Q3'24", to: "Q4'24" });
    expect(meta.periodConfidence).toBe('inferred');
  });

  it('calls an invented span inferred even while the chart matches it', () => {
    expect(inferChartMeta(briefed({ periodFrom: 'inferred' })).periodConfidence).toBe('inferred');
  });

  it('reads nothing off a brief the author declined to give', () => {
    const spec = briefed({ askedAndSkipped: true });
    const meta = inferChartMeta(spec, { deckTags: ['Globex'] });
    expect(meta.askedAndSkipped).toBe(true);
    expect(meta.description).toBeUndefined();
    // The refusal doesn't promote the deck tag out of the way, either.
    expect(meta).toMatchObject({ subject: 'Globex', subjectSource: 'tag' });
    expect(meta.measureConfidence).toBe('inferred');
  });

  it('reports everything as inferred on a chart with no brief', () => {
    expect(inferChartMeta(column())).toMatchObject({
      measureConfidence: 'inferred',
      dimensionConfidence: 'inferred',
      periodConfidence: 'inferred',
      unitConfidence: 'inferred',
    });
  });
});

describe('periodPhrase', () => {
  it('reads as an instruction', () => {
    expect(periodPhrase(inferChartMeta(column()).period)).toBe(
      'one row per year, from FY23 to FY25 (3 periods)',
    );
  });
});

/* ------------------------------------------------------------------ */

describe('chartResultContract', () => {
  it('derives its columns from the sheet schema, so a paste always fits', () => {
    const spec = column();
    const contract = contractFor(spec);
    const schema = sheetSchemaFor(spec);
    const expected =
      schema.keyColumns.length + sheetSeriesFor(spec).length * schema.perSeries.length;
    expect(contract.columns).toHaveLength(expected);
  });

  it('names per-series columns after the series', () => {
    expect(contractFor().columns).toEqual(['label', 's0_value', 's1_value', 's2_value']);
  });

  it('drops the prefix when there is exactly one series and one field', () => {
    expect(contractFor(defaultChartSpec('pie') as ColumnBarSpec).columns).toEqual(['label', 'value']);
  });

  it("asks for a dot plot's captions as text, not as figures", () => {
    const c = contractFor(defaultChartSpec('dotplot') as unknown as ColumnBarSpec);
    expect(c.columns).toContain('s0_note');
    const schema = c.jsonSchema as {
      properties: { rows: { items: { properties: Record<string, { type?: string[] }> } } };
    };
    // A caption typed `number` would have the schema reject the date the prompt
    // just asked for.
    expect(schema.properties.rows.items.properties.s0_note.type).toEqual(['string', 'null']);
    expect(schema.properties.rows.items.properties.s0_value.type).toEqual(['number', 'null']);
  });

  it('carries the waterfall Kind through as a closed enum', () => {
    const c = contractFor(defaultChartSpec('waterfall') as unknown as ColumnBarSpec);
    expect(c.columns).toContain('role');
    const schema = c.jsonSchema as {
      properties: { rows: { items: { properties: Record<string, { enum?: string[] }> } } };
    };
    expect(schema.properties.rows.items.properties.role.enum).toEqual([
      'start',
      'delta',
      'subtotal',
      'total',
      'spacer',
    ]);
  });

  it('makes every value nullable, so "not available" is expressible', () => {
    const schema = contractFor().jsonSchema as {
      properties: { rows: { items: { properties: Record<string, { type?: string[] }> } } };
    };
    const props = schema.properties.rows.items.properties;
    expect(props.s0_value.type).toEqual(['number', 'null']);
  });

  it('always asks for a source and a confidence', () => {
    expect(contractFor().csvHeader).toEqual(
      expect.arrayContaining(['source_url', 'source_note', 'confidence']),
    );
  });

  it('produces an example that satisfies its own required columns', () => {
    const c = contractFor(defaultChartSpec('scatter') as unknown as ColumnBarSpec);
    const schema = c.jsonSchema as {
      properties: { rows: { items: { required: string[] } } };
    };
    const row = (c.example.rows as Record<string, unknown>[])[0];
    for (const key of schema.properties.rows.items.required) {
      expect(row[key]).toBeDefined();
    }
    expect(c.example.contractId).toBe(c.contractId);
  });
});

/* ------------------------------------------------------------------ */

describe('buildDevinChartPrompt', () => {
  const prompt = (spec = column(), ctx = { deckTags: ['Acme Corp'] }) =>
    buildDevinChartPrompt(spec, ctx).text;

  it('is deterministic — the same chart always yields the same brief', () => {
    expect(prompt()).toBe(prompt());
  });

  it('names the subject, the measure and the chart type', () => {
    const spec = column();
    spec.axes.y.title = 'Net revenue';
    const t = prompt(spec);
    expect(t).toContain('Acme Corp');
    expect(t).toContain('Net revenue');
    expect(t).toContain('column chart');
  });

  it('lists the actual categories and series rather than describing them', () => {
    const t = prompt();
    for (const label of ['FY23', 'FY24', 'FY25', 'Enterprise', 'Mid-Market', 'SMB']) {
      expect(t).toContain(label);
    }
  });

  it('follows the chart when the data changes', () => {
    const spec = column();
    spec.data.categories = [
      { key: 'c0', label: "Q1'26" },
      { key: 'c1', label: "Q2'26" },
    ];
    spec.data.series = [{ key: 's0', name: 'ARR', values: [1, 2] }];
    const t = prompt(spec);
    expect(t).toContain("Q1'26");
    expect(t).toContain('fiscal quarter');
    expect(t).not.toContain('Enterprise');
  });

  it('follows the number format', () => {
    const spec = column();
    spec.numberFormat = { style: 'currency', currency: 'EUR', decimals: 2 };
    const t = prompt(spec);
    expect(t).toContain('EUR');
    expect(t).toContain('2 decimal places');
  });

  it('asks which entity rather than guessing one', () => {
    const t = buildDevinChartPrompt(column(), {}).text;
    expect(t).toContain('Which entity is this about?');
  });

  it('treats a subject read out of a title as an assumption to confirm', () => {
    const t = buildDevinChartPrompt(column(), { deckTitle: 'Q3 Board Review' }).text;
    expect(t).toContain('_(assumed — confirm below)_');
    expect(t).toContain('Is the subject Q3 Board Review?');
  });

  it('takes a deck tag as stated, with nothing to confirm', () => {
    const t = buildDevinChartPrompt(column(), { deckTags: ['Acme Corp'], deckTitle: 'Q3' }).text;
    expect(t).not.toContain('assumed — confirm below');
    expect(t).not.toContain('Is the subject');
  });

  it("prints the author's own sentence, unedited", () => {
    const spec = column();
    spec.authorBrief = {
      v: 1,
      description: "Acme's ARR by segment, last 8 quarters, in $M",
      subject: 'Acme',
      subjectFrom: 'described',
      measure: 'ARR',
      measureFrom: 'stated',
      measures: ['ARR'],
      dimension: 'segment',
      dimensionFrom: 'stated',
      periodFrom: 'inferred',
      unitFrom: 'stated',
      gaps: [],
    };
    const t = prompt(spec);
    expect(t).toContain("> Acme's ARR by segment, last 8 quarters, in $M");
    expect(t).toContain('Stated by the author');
    // The author named the entity, so it is not re-asked as an assumption.
    expect(t).not.toContain('assumed — confirm below');
    expect(t).not.toContain('Is the subject');
  });

  it('prints a range nobody asked for as a question, never as an instruction', () => {
    const spec = column();
    spec.authorBrief = {
      v: 1,
      description: 'quarterly ARR',
      subjectFrom: 'unknown',
      measure: 'ARR',
      measureFrom: 'stated',
      measures: ['ARR'],
      // The chart spans FY23–FY25 by default; the author never said so.
      period: { grain: 'year', from: 'FY23', to: 'FY25', count: 3 },
      periodFrom: 'inferred',
      dimensionFrom: 'inferred',
      unitFrom: 'inferred',
      gaps: [],
    };
    const t = prompt(spec);
    expect(t).toContain('Filled in by us, not asked for');
    expect(t).toContain('Was FY23 to FY25 meant to be the range?');
    // The stated-range question is the wrong one here and must not appear.
    expect(t).not.toContain('Is FY23 to FY25 the fiscal or the calendar year?');
  });

  it('says plainly when the author was asked and declined', () => {
    const spec = column();
    spec.title = 'Chart Title';
    spec.axes.y.title = undefined;
    spec.authorBrief = {
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
    const t = prompt(spec);
    expect(t).toContain('chose not to say');
    // And the placeholder title is not mined for a metric.
    expect(t).not.toContain('showing **Chart Title**');
    expect(t).toContain('What is being measured?');
  });

  it('appends house guidance after the sourcing floor, never inside it', () => {
    const t = buildDevinChartPrompt(column(), {
      research: {
        guidance: 'Shares must total 100% per period; state the denominator.',
        preferredSources: ['company IR decks'],
      },
    }).text;
    expect(t).toContain('**For this kind of chart specifically:** Shares must total 100%');
    expect(t).toContain('Start with **company IR decks**');
    expect(t.indexOf('Do not interpolate')).toBeLessThan(t.indexOf('For this kind of chart'));
  });

  it('asks what the metric is rather than writing a placeholder', () => {
    const spec = column();
    spec.axes.y.title = undefined;
    const t = prompt(spec);
    expect(t).toContain('What is being measured');
    expect(t).not.toContain('the metric shown');
  });

  it('will not start with a question outstanding', () => {
    expect(prompt()).toContain('Ask before you research');
    expect(prompt()).toContain('ask anything else you need');
  });

  it('does not read "Mid-Market" as the dimension "market"', () => {
    // Substring matching used to turn a segment name into a confident and
    // wrong statement about what the series represent.
    expect(prompt()).not.toContain('broken down by market');
  });

  it('states a dimension when a series name genuinely is one', () => {
    const spec = column();
    spec.data.series = [
      { key: 's0', name: 'EMEA region', values: [1, 2, 3] },
      { key: 's1', name: 'APAC region', values: [1, 2, 3] },
    ];
    expect(prompt(spec)).toContain('broken down by region');
  });

  it('forbids interpolating a missing figure', () => {
    const t = prompt();
    expect(t).toContain('Do not interpolate');
    expect(t).toContain('`null`');
  });

  it('demands a source per row', () => {
    expect(prompt()).toContain('`source_url`');
  });

  it('embeds the JSON schema and a worked example', () => {
    const t = prompt();
    expect(t).toContain('"$schema"');
    expect(t).toContain('source_note');
  });

  it('explains every waterfall Kind, so the roles are not guesswork', () => {
    const t = prompt(defaultChartSpec('waterfall') as WaterfallSpec as unknown as ColumnBarSpec);
    expect(t).toContain('`subtotal`');
    expect(t).toContain('running total');
  });

  it('stamps provenance so an answer can be matched to its question', () => {
    const t = buildDevinChartPrompt(column(), {
      chartId: 'chart-abc',
      generatedAt: '2026-08-13T00:00:00.000Z',
    }).text;
    expect(t).toContain('chart-abc');
    expect(t).toContain('2026-08-13');
  });
});

/* ------------------------------------------------------------------ */

describe('parseDevinChartResult', () => {
  const spec = column();
  const good = {
    contractId: 'grid@1',
    rows: [
      { label: 'FY23', s0_value: 1, s1_value: 2, s2_value: 3, source_url: 'https://x', confidence: 'reported' },
      { label: 'FY24', s0_value: 4, s1_value: 5, s2_value: 6, source_url: 'https://y', confidence: 'reported' },
    ],
    notes: 'Restated FY23.',
    unresolved: [],
  };

  it('reads plain JSON', () => {
    const r = parseDevinChartResult(JSON.stringify(good), spec);
    expect(r.sheet?.rows).toHaveLength(2);
    expect(cellText(r.sheet!.rows[0][1])).toBe('1');
    expect(r.notes).toBe('Restated FY23.');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('reads JSON inside a fence, which is how agents usually answer', () => {
    const r = parseDevinChartResult('Here you go:\n```json\n' + JSON.stringify(good) + '\n```', spec);
    expect(r.sheet?.rows).toHaveLength(2);
  });

  it('reads the CSV fallback', () => {
    const csv = [
      'label,s0_value,s1_value,s2_value,source_url,source_note,confidence',
      'FY23,1,2,3,https://x,p1,reported',
    ].join('\n');
    const r = parseDevinChartResult(csv, spec);
    expect(r.sheet?.rows).toHaveLength(1);
    expect(cellText(r.sheet!.rows[0][0])).toBe('FY23');
  });

  it('warns but still parses when the contract id has moved on', () => {
    const r = parseDevinChartResult(JSON.stringify({ ...good, contractId: 'waterfall@1' }), spec);
    expect(r.diagnostics.map((d) => d.code)).toContain('contract-mismatch');
    expect(r.sheet?.rows).toHaveLength(2);
  });

  it('treats null as "not available" rather than zero', () => {
    const r = parseDevinChartResult(
      JSON.stringify({ ...good, rows: [{ ...good.rows[0], s0_value: null }] }),
      spec,
    );
    expect(r.diagnostics.map((d) => d.code)).toContain('null-value');
    expect(r.sheet!.rows[0][1].kind).toBe('empty');
  });

  it('flags a value that is not a number', () => {
    const r = parseDevinChartResult(
      JSON.stringify({ ...good, rows: [{ ...good.rows[0], s0_value: 'about 40' }] }),
      spec,
    );
    expect(r.diagnostics.map((d) => d.code)).toContain('value-not-a-number');
  });

  it('flags an unsourced row', () => {
    const r = parseDevinChartResult(
      JSON.stringify({ ...good, rows: [{ label: 'FY23', s0_value: 1 }] }),
      spec,
    );
    expect(r.diagnostics.map((d) => d.code)).toContain('unsourced-row');
  });

  it('reports unexpected fields instead of silently ignoring them', () => {
    const r = parseDevinChartResult(
      JSON.stringify({ ...good, rows: [{ ...good.rows[0], revenue_growth: 5 }] }),
      spec,
    );
    expect(r.diagnostics.map((d) => d.code)).toContain('unknown-column');
  });

  it('fails loudly on unreadable input rather than producing an empty chart', () => {
    const r = parseDevinChartResult('I could not find this data.', spec);
    expect(r.sheet).toBeNull();
    expect(r.diagnostics[0].code).toBe('unreadable');
  });

  it('round-trips its own example', () => {
    const contract = contractFor(spec);
    const r = parseDevinChartResult(JSON.stringify(contract.example), spec);
    expect(r.sheet).not.toBeNull();
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('carries sources through for later citation', () => {
    const r = parseDevinChartResult(JSON.stringify(good), spec);
    expect(r.sources[0]).toMatchObject({ url: 'https://x', confidence: 'reported' });
  });
});
