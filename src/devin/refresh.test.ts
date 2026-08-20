import { describe, expect, it } from 'vitest';
import { EMU_PER_INCH, defaultChartSpec, type ChartInstance, type ColumnBarSpec, type Deck, type Slide, type WaterfallSpec } from '@/model';
import { buildDeckRefreshPrompt, collectDeckNumbers, REFRESH_CSV_HEADER } from './refresh';

const rect = { x: 0, y: 0, w: EMU_PER_INCH, h: EMU_PER_INCH };

const text = (id: string, body: string, role?: string): Slide['elements'][number] => ({
  id,
  type: 'text',
  role,
  rect,
  body: { paragraphs: [{ runs: [{ text: body }] }] },
});

const chart = (id: string, spec = defaultChartSpec('column', 'clustered')): ChartInstance => ({
  id,
  groupId: `${id}_g`,
  frame: rect,
  spec,
});

const deckOf = (slides: Slide[], over: Partial<Deck> = {}): Deck => ({
  id: 'deck_1',
  title: 'Q3 Business Review',
  slideSize: { w: EMU_PER_INCH * 13.333, h: EMU_PER_INCH * 7.5 },
  slides,
  designSystemId: 'ds',
  designSystemVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/* ------------------------------------------------------------------ */

describe('collectDeckNumbers', () => {
  it('inventories one number per series × category, addressed by key', () => {
    const spec = defaultChartSpec('column', 'clustered') as ColumnBarSpec;
    spec.data.categories = [
      { key: 'c0', label: 'FY24' },
      { key: 'c1', label: 'FY25' },
    ];
    spec.data.series = [{ key: 's0', name: 'Revenue', values: [100, 120] }];
    const pages = collectDeckNumbers(deckOf([{ id: 'sl_1', elements: [], charts: [chart('ch_1', spec)] }]));

    expect(pages[0].charts[0].numbers).toEqual([
      expect.objectContaining({ ref: 'p1/c:ch_1/s0/c0', value: 100, categoryLabel: 'FY24' }),
      expect.objectContaining({ ref: 'p1/c:ch_1/s0/c1', value: 120, categoryLabel: 'FY25' }),
    ]);
  });

  it('numbers pages from 1, in slide order', () => {
    const pages = collectDeckNumbers(
      deckOf([
        { id: 'sl_1', elements: [] },
        { id: 'sl_2', elements: [text('t1', 'ARR is $4.2M today')] },
      ]),
    );
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[1].textNumbers[0].ref).toBe('p2/t:t1/n0');
  });

  it('keeps a gap as a gap rather than turning it into zero', () => {
    const spec = defaultChartSpec('column', 'clustered') as ColumnBarSpec;
    spec.data.series = [{ key: 's0', name: 'Revenue', values: [null, 5, 7] }];
    const pages = collectDeckNumbers(deckOf([{ id: 'sl_1', elements: [], charts: [chart('ch_1', spec)] }]));
    expect(pages[0].charts[0].numbers[0].value).toBeNull();
  });

  it('reads numbers out of the words on a slide, with their units applied', () => {
    const pages = collectDeckNumbers(
      deckOf([{ id: 'sl_1', elements: [text('t1', 'ARR $4.2M, up 34% on 1,240 customers', 'kpi.value')] }]),
    );
    expect(pages[0].textNumbers.map((n) => [n.display, n.value])).toEqual([
      ['$4.2M', 4_200_000],
      ['34%', 0.34],
      ['1,240', 1240],
    ]);
  });

  it('does not read a bare year in a date line as a figure', () => {
    const pages = collectDeckNumbers(
      deckOf([{ id: 'sl_1', elements: [text('t1', 'Acme Corp · Q3 2026 · Prepared by Cognition')] }]),
    );
    expect(pages[0].textNumbers).toEqual([]);
  });

  it('reads a thousands-separated figure whole, not as its first group', () => {
    const pages = collectDeckNumbers(
      deckOf([{ id: 'sl_1', elements: [text('t1', '1,240 customers and 2026 seats')] }]),
    );
    expect(pages[0].textNumbers.map((n) => n.value)).toEqual([1240]);
  });

  it('does not read FY25, Q3 or H1 as the numbers 25, 3 and 1', () => {
    const pages = collectDeckNumbers(
      deckOf([{ id: 'sl_1', elements: [text('t1', 'FY25 Q3 H1 plan')] }]),
    );
    expect(pages[0].textNumbers).toEqual([]);
  });

  it('skips text a chart compiled, so a figure is never asked for twice', () => {
    const el = text('t1', '120');
    const pages = collectDeckNumbers(
      deckOf([
        {
          id: 'sl_1',
          elements: [
            { ...el, chartRef: { chartId: 'ch_1', part: 'label', series: 's0', point: 'c0' } },
          ],
        },
      ]),
    );
    expect(pages[0].textNumbers).toEqual([]);
  });

  it('does not ask for a waterfall subtotal that the chart computes itself', () => {
    const spec = defaultChartSpec('waterfall') as WaterfallSpec;
    spec.data.items = [
      { key: 'i0', label: 'FY24', role: 'start', value: 100 },
      { key: 'i1', label: 'New', role: 'delta', value: 20 },
      { key: 'i2', label: 'FY25', role: 'total', value: null },
    ];
    const pages = collectDeckNumbers(deckOf([{ id: 'sl_1', elements: [], charts: [chart('ch_1', spec)] }]));
    expect(pages[0].charts[0].numbers.map((n) => n.ref)).toEqual([
      'p1/c:ch_1/i0',
      'p1/c:ch_1/i1',
    ]);
  });

  it('takes the page title from the slide', () => {
    const pages = collectDeckNumbers(
      deckOf([{ id: 'sl_1', elements: [text('t1', 'Growth is accelerating', 'title')] }]),
    );
    expect(pages[0].title).toBe('Growth is accelerating');
  });
});

describe('buildDeckRefreshPrompt', () => {
  const deck = () =>
    deckOf(
      [
        {
          id: 'sl_1',
          elements: [text('t1', 'Growth is accelerating', 'title'), text('t2', 'ARR $4.2M', 'kpi.value')],
          charts: [chart('ch_1')],
        },
        { id: 'sl_2', elements: [] },
      ],
      { tags: ['Northwind'] },
    );

  it('is deterministic — the same deck always yields the same brief', () => {
    expect(buildDeckRefreshPrompt(deck()).text).toBe(buildDeckRefreshPrompt(deck()).text);
  });

  it('counts every number it lists', () => {
    const p = buildDeckRefreshPrompt(deck());
    const listed = p.pages.reduce(
      (n, pg) => n + pg.textNumbers.length + pg.charts.reduce((m, c) => m + c.numbers.length, 0),
      0,
    );
    expect(p.numberCount).toBe(listed);
    expect(p.numberCount).toBeGreaterThan(0);
  });

  it('names the deck and its subject', () => {
    const t = buildDeckRefreshPrompt(deck()).text;
    expect(t).toContain('Q3 Business Review');
    expect(t).toContain('Northwind');
  });

  it('sections the inventory by page', () => {
    const t = buildDeckRefreshPrompt(deck()).text;
    expect(t).toContain('### Page 1 — Growth is accelerating');
    expect(t).toContain('### Page 2');
  });

  it('says a page with no figures has nothing to refresh', () => {
    expect(buildDeckRefreshPrompt(deck()).text).toContain('nothing to refresh');
  });

  it('lists every ref, so nothing is left implicit', () => {
    const p = buildDeckRefreshPrompt(deck());
    for (const pg of p.pages) {
      for (const n of [...pg.textNumbers, ...pg.charts.flatMap((c) => c.numbers)]) {
        expect(p.text).toContain(n.ref);
      }
    }
  });

  it('asks for the CSV it exports, header for header', () => {
    const p = buildDeckRefreshPrompt(deck());
    expect(p.csvHeader).toEqual([...REFRESH_CSV_HEADER]);
    expect(p.text).toContain(REFRESH_CSV_HEADER.join(','));
  });

  it('carries each chart unit sentence, so nothing comes back rescaled', () => {
    const spec = defaultChartSpec('column', 'clustered') as ColumnBarSpec;
    spec.numberFormat = { style: 'currency', currency: 'USD', decimals: 1, thousands: true };
    spec.axes.y.unitDivisor = 1e6;
    const t = buildDeckRefreshPrompt(
      deckOf([{ id: 'sl_1', elements: [], charts: [chart('ch_1', spec)] }]),
    ).text;
    expect(t).toContain('USD');
    expect(t).toContain('full units');
  });

  it('forbids inventing a figure and demands a source per row', () => {
    const t = buildDeckRefreshPrompt(deck()).text;
    expect(t).toContain('Never invent a number');
    expect(t).toContain('source_url');
  });

  it('insists the ref comes back untouched, since it is what applies the row', () => {
    expect(buildDeckRefreshPrompt(deck()).text).toContain('character for character');
  });

  it('states the as-of date when one is given', () => {
    expect(buildDeckRefreshPrompt(deck(), { asOf: '2026-06-30' }).text).toContain('2026-06-30');
  });

  it('stamps provenance so an answer can be matched to its question', () => {
    const t = buildDeckRefreshPrompt(deck(), { generatedAt: '2026-08-19T12:00:00Z' }).text;
    expect(t).toContain('deck_1');
    expect(t).toContain('2026-08-19T12:00:00Z');
  });
});
