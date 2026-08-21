import { describe, expect, it } from 'vitest';
import { readBrief, recommendLayouts } from './intent';

/** Fixed, so "the last 8 quarters" means the same thing in every run. */
const AS_OF = '2026-08-17';
const top = (description: string, ctx = {}) =>
  recommendLayouts(description, { asOf: AS_OF, ...ctx }).suggestions[0];

describe('readBrief — subject', () => {
  it('takes the client named in the description over the deck tag', () => {
    const b = readBrief('revenue for Northwind by segment', {
      deckTags: ['Globex'],
      asOf: AS_OF,
    });
    expect(b.subject).toBe('Northwind');
    expect(b.subjectFrom).toBe('described');
  });

  it('falls back to the deck tag, which is where client names live', () => {
    const b = readBrief('quarterly revenue', { deckTags: ['Globex'], asOf: AS_OF });
    expect(b.subject).toBe('Globex');
    expect(b.subjectFrom).toBe('tag');
  });

  it('reads a name in front of what it is about', () => {
    expect(readBrief('Acme Corp revenue FY21-FY25', { asOf: AS_OF }).subject).toBe(
      'Acme Corp',
    );
  });

  it('never mistakes a breakdown for a client', () => {
    const b = readBrief('revenue for EMEA, APAC and Americas', { asOf: AS_OF });
    expect(b.subject).toBeUndefined();
    expect(b.seriesNames.length === 0 || b.categories).toBeTruthy();
    expect(b.categories).toEqual(['EMEA', 'APAC', 'Americas']);
  });

  it('never mistakes the measure or a period for a client', () => {
    expect(readBrief('Revenue mix by region for FY25', { asOf: AS_OF }).subject).toBeUndefined();
    expect(readBrief('Quarterly ARR by segment', { asOf: AS_OF }).subject).toBeUndefined();
  });

  it('does not take a deck nobody has named yet as the client', () => {
    const b = readBrief('quarterly revenue', {
      deckTitle: 'Untitled presentation',
      asOf: AS_OF,
    });
    expect(b.subject).toBeUndefined();
    expect(b.subjectFrom).toBe('unknown');
  });

  it('says so when nobody is named anywhere', () => {
    expect(readBrief('quarterly revenue', { asOf: AS_OF }).gaps.join(' ')).toMatch(
      /no client or subject/i,
    );
  });
});

describe('readBrief — measures and units', () => {
  it('puts the absolute on the axis and the rate over the top', () => {
    const b = readBrief('gross margin against revenue, quarterly', { asOf: AS_OF });
    expect(b.measure).toBe('Revenue');
    expect(b.secondaryMeasure).toBe('Gross margin');
  });

  it('does not invent a rate when only absolutes were named', () => {
    expect(readBrief('revenue and bookings by year', { asOf: AS_OF }).secondaryMeasure)
      .toBeUndefined();
  });

  it('reads a rate on its own as proportional data', () => {
    expect(readBrief('gross margin by quarter', { asOf: AS_OF }).numberFormat.style).toBe(
      'percent',
    );
  });

  it('reads currency from the measure and the scale from the words', () => {
    const b = readBrief('quarterly ARR by segment in $M', { asOf: AS_OF });
    expect(b.numberFormat.style).toBe('currency');
    expect(b.numberFormat.currency).toBe('USD');
    expect(b.unitDivisor).toBe(1e6);
    expect(b.unitNote).toBeUndefined();
  });

  it('honours a currency the author actually named', () => {
    expect(readBrief('revenue in £bn', { asOf: AS_OF }).numberFormat.currency).toBe('GBP');
    expect(readBrief('revenue in £bn', { asOf: AS_OF }).unitDivisor).toBe(1e9);
  });

  it('leaves a share-of-total chart holding currency, not proportions', () => {
    // The LABELS are percentages; the data is still revenue. Getting this the
    // other way round makes every figure in the datasheet wrong by 100×.
    expect(readBrief('revenue as a % of total by region', { asOf: AS_OF }).numberFormat.style)
      .toBe('currency');
  });

  it('says so when nothing is being measured', () => {
    expect(readBrief('show me the thing', { asOf: AS_OF }).gaps.join(' ')).toMatch(
      /being measured/i,
    );
  });
});

describe('readBrief — periods', () => {
  it('counts back from today when asked for the last N', () => {
    const b = readBrief('ARR for the last 8 quarters', { asOf: AS_OF });
    expect(b.period?.grain).toBe('quarter');
    expect(b.period?.labels).toEqual([
      "Q4'24",
      "Q1'25",
      "Q2'25",
      "Q3'25",
      "Q4'25",
      "Q1'26",
      "Q2'26",
      "Q3'26",
    ]);
  });

  it('uses a stated range rather than today', () => {
    expect(readBrief('Acme revenue FY21-FY25', { asOf: AS_OF }).period?.labels).toEqual([
      'FY21',
      'FY22',
      'FY23',
      'FY24',
      'FY25',
    ]);
  });

  it('spans two periods named without a range word', () => {
    expect(readBrief('how FY24 revenue bridged to FY25', { asOf: AS_OF }).period?.labels)
      .toEqual(['FY24', 'FY25']);
  });

  it('treats one named period as a moment, so the members become the bars', () => {
    const b = readBrief('revenue mix by region for FY25', { asOf: AS_OF });
    expect(b.period?.labels).toEqual(['FY25']);
    expect(b.categories).toEqual(['Americas', 'EMEA', 'APAC']);
    expect(b.seriesNames).toEqual([]);
  });

  it('puts the periods on the categories and the breakdown on the series', () => {
    const b = readBrief('revenue by segment over the last 3 years', { asOf: AS_OF });
    expect(b.categories).toEqual(['2024', '2025', '2026']);
    expect(b.seriesNames).toEqual(['Enterprise', 'Mid-Market', 'SMB']);
  });

  it('reads no period at all out of a sentence with no time in it', () => {
    expect(readBrief('revenue by segment', { asOf: AS_OF }).period).toBeUndefined();
  });

  it('honours a count the author stated', () => {
    expect(readBrief('revenue over the last 10 quarters', { asOf: AS_OF }).period?.labels)
      .toHaveLength(10);
  });
});

describe('readBrief — breakdowns', () => {
  it('prefers members the author listed over the conventional set', () => {
    const b = readBrief('revenue by segment (Platform, Services) over the last 3 years', {
      asOf: AS_OF,
    });
    expect(b.seriesNames).toEqual(['Platform', 'Services']);
  });

  it('honours a stated ranking count', () => {
    expect(readBrief('top 10 countries by revenue', { asOf: AS_OF }).categories).toHaveLength(
      10,
    );
  });
});

describe('recommendLayouts', () => {
  it('reads a bridge, however it was phrased', () => {
    expect(top('how FY24 revenue bridged to FY25').layout.id).toBe('waterfall-up');
    expect(top('drivers of the change in revenue from FY24 to FY25').layout.id).toBe(
      'waterfall-up',
    );
  });

  it('sends a funnel down rather than up', () => {
    expect(top('pipeline conversion funnel').layout.id).toBe('waterfall-down');
  });

  it('reads a flow as a Sankey', () => {
    expect(top('where our cloud spend flows across teams').layout.id).toBe('sankey');
  });

  it('reads a mix at one date as a pie, and over time as a stack', () => {
    expect(top('revenue mix by region for FY25').layout.id).toBe('pie');
    expect(top('how the revenue mix by region shifted over the last 3 years').layout.id).toBe(
      'stacked100',
    );
  });

  it('puts a rate over an absolute on a combo', () => {
    expect(top('gross margin against revenue, quarterly').layout.id).toBe(
      'combo-clustered-line',
    );
  });

  it('reads two measures as a scatter, and three as a bubble', () => {
    expect(top('relationship between headcount and revenue').layout.id).toBe('scatter');
    expect(
      top('relationship between headcount and revenue, sized by ARR').layout.id,
    ).toBe('bubble');
  });

  it('reads many periods as a trend', () => {
    expect(top('monthly active users over time').layout.id).toBe('line');
  });

  it('lays a ranking on its side and leaves a timeline upright', () => {
    expect(top('top 10 countries by revenue').orientation).toBe('horizontal');
    expect(top('revenue by segment over the last 8 quarters').orientation).toBe('vertical');
  });

  it('does what it is told when the author names a chart type', () => {
    expect(top('a pie chart of revenue by region for FY25').layout.id).toBe('pie');
    expect(top('100% stacked columns of revenue by region for FY25').layout.id).toBe(
      'stacked100',
    );
  });

  it('always returns somewhere to start, and admits when it is guessing', () => {
    const r = recommendLayouts('show me the thing', { asOf: AS_OF });
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.confidence).toBe('low');
    expect(r.suggestions[0].why).toMatch(/nothing in the description/i);
  });

  it('is deterministic — the same sentence always ranks the same way', () => {
    const a = recommendLayouts('revenue by segment over the last 3 years', { asOf: AS_OF });
    const b = recommendLayouts('revenue by segment over the last 3 years', { asOf: AS_OF });
    expect(a.suggestions.map((s) => s.layout.id)).toEqual(b.suggestions.map((s) => s.layout.id));
  });

  it('carries a reason on every suggestion', () => {
    const r = recommendLayouts('quarterly ARR by segment for the last 8 quarters', {
      asOf: AS_OF,
    });
    expect(r.suggestions.every((s) => s.why.length > 10)).toBe(true);
  });
});

describe('readBrief — units', () => {
  it('reads a currency scale written as a symbol', () => {
    // "$B" has no word boundary before the "$", which the old pattern required
    // — so this came out unscaled, a 1000x error that looked fine on the slide.
    expect(readBrief('revenue in $B', { asOf: AS_OF }).unitDivisor).toBe(1e9);
    expect(readBrief('revenue in $K', { asOf: AS_OF }).unitDivisor).toBe(1e3);
    expect(readBrief('revenue in $M', { asOf: AS_OF }).unitDivisor).toBe(1e6);
  });
});
