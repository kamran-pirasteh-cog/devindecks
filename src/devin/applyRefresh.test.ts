import { describe, expect, it } from 'vitest';
import {
  EMU_PER_INCH,
  defaultChartSpec,
  type ChartInstance,
  type ColumnBarSpec,
  type Deck,
  type Slide,
} from '@/model';
import { buildDeckRefreshPrompt, collectDeckNumbers } from './refresh';
import { formatLikeToken, parseRefreshCsv, planRefresh, writeToSpec } from './applyRefresh';

const rect = { x: 0, y: 0, w: EMU_PER_INCH, h: EMU_PER_INCH };

const text = (id: string, runs: { text: string; bold?: boolean }[], role?: string): Slide['elements'][number] => ({
  id,
  type: 'text',
  role,
  rect,
  body: { paragraphs: [{ runs }] },
});

const columnSpec = (): ColumnBarSpec => {
  const spec = defaultChartSpec('column', 'clustered') as ColumnBarSpec;
  spec.title = 'Revenue';
  spec.data.categories = [
    { key: 'c0', label: 'FY24' },
    { key: 'c1', label: 'FY25' },
  ];
  spec.data.series = [{ key: 's0', name: 'Revenue', values: [100, 120] }];
  return spec;
};

const chart = (id: string, spec = columnSpec()): ChartInstance => ({ id, groupId: `${id}_g`, frame: rect, spec });

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

const csv = (...rows: string[]) =>
  ['ref,page,label,current_value,new_value,unit,as_of,source_url,source_note,confidence,notes', ...rows].join('\n');

/* ------------------------------------------------------------------ */

describe('parseRefreshCsv', () => {
  it('reads a fenced block out of a chatty answer', () => {
    const { rows, problems } = parseRefreshCsv(
      ['Here you go:', '', '```csv', csv('p1/c:ch_1/s0/c0,1,"Revenue — FY24",100,140,USD,,,,reported,'), '```'].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([expect.objectContaining({ ref: 'p1/c:ch_1/s0/c0', newValue: 140 })]);
  });

  it('keeps a quoted comma inside its field', () => {
    const { rows } = parseRefreshCsv(csv('p1/t:t1/n0,1,"Revenue, restated",100,140,USD,,,,reported,'));
    expect(rows[0].newValue).toBe(140);
  });

  it('refuses a percentage rather than guessing which way it scales', () => {
    const { rows } = parseRefreshCsv(csv('p1/c:ch_1/s0/c0,1,x,0.34,42%,,,,,reported,'));
    expect(rows[0].newValue).toBeNull();
    expect(rows[0].unreadable).toContain('percent sign');
  });

  it('scales a comma or a suffix, and says that it did', () => {
    const { rows } = parseRefreshCsv(
      csv('p1/c:ch_1/s0/c0,1,x,100,"1,240",,,,,reported,', 'p1/c:ch_1/s0/c1,1,x,120,4.9M,,,,,reported,'),
    );
    expect(rows[0].newValue).toBe(1240);
    expect(rows[1].newValue).toBe(4_900_000);
    expect(rows[1].note).toContain('4.9M');
  });

  it('reads an empty new_value as "not available", not as zero', () => {
    const { rows } = parseRefreshCsv(csv('p1/c:ch_1/s0/c0,1,x,100,,,,,,,not disclosed'));
    expect(rows[0].newValue).toBeNull();
  });

  it('names a duplicate ref rather than letting one silently win', () => {
    const { problems } = parseRefreshCsv(
      csv('p1/c:ch_1/s0/c0,1,x,100,140,,,,,,', 'p1/c:ch_1/s0/c0,1,x,100,150,,,,,,'),
    );
    expect(problems[0]).toContain('appears twice');
  });

  it('says what is missing when the header is wrong', () => {
    expect(parseRefreshCsv('a,b,c\n1,2,3').problems[0]).toContain('No header row');
  });
});

/* ------------------------------------------------------------------ */

describe('planRefresh', () => {
  const deck = () =>
    deckOf([
      {
        id: 'sl_1',
        elements: [text('t1', [{ text: 'ARR reached ' }, { text: '$4.2M', bold: true }, { text: ' this year' }], 'kpi.value')],
        charts: [chart('ch_1')],
      },
    ]);

  it('plans a chart figure against the ref the prompt handed out', () => {
    const { entries } = planRefresh(deck(), parseRefreshCsv(csv('p1/c:ch_1/s0/c0,1,x,100,140,,,,,reported,')).rows);
    expect(entries[0]).toMatchObject({ status: 'change', current: 100, next: 140, origin: 'chart' });
  });

  it('rewrites a text figure in the shape it was already written in', () => {
    const { entries } = planRefresh(deck(), parseRefreshCsv(csv('p1/t:t1/n0,1,x,4200000,4900000,USD,,,,reported,')).rows);
    expect(entries[0]).toMatchObject({ status: 'change', display: '$4.2M', nextDisplay: '$4.9M' });
  });

  it('calls a figure that already matches unchanged rather than rewriting it', () => {
    const { entries } = planRefresh(deck(), parseRefreshCsv(csv('p1/c:ch_1/s0/c0,1,x,100,100,,,,,reported,')).rows);
    expect(entries[0].status).toBe('unchanged');
  });

  it('refuses a ref the deck no longer has instead of writing it somewhere', () => {
    const { entries } = planRefresh(deck(), parseRefreshCsv(csv('p9/c:ch_9/s0/c0,9,x,1,2,,,,,reported,')).rows);
    expect(entries[0].status).toBe('unmatched');
  });

  it('blocks a percentage sent unscaled to a chart that stores decimals', () => {
    const spec = columnSpec();
    spec.numberFormat = { style: 'percent', decimals: 1 };
    spec.data.series = [{ key: 's0', name: 'Margin', values: [0.34, 0.36] }];
    const d = deckOf([{ id: 'sl_1', elements: [], charts: [chart('ch_1', spec)] }]);
    const { entries } = planRefresh(d, parseRefreshCsv(csv('p1/c:ch_1/s0/c0,1,x,0.34,42.7,,,,,reported,')).rows);
    expect(entries[0].status).toBe('blocked');
    expect(entries[0].reason).toContain('decimal fraction');
  });

  it('flags a move big enough to be a units mistake', () => {
    const { entries } = planRefresh(deck(), parseRefreshCsv(csv('p1/c:ch_1/s0/c0,1,x,100,140000,,,,,reported,')).rows);
    expect(entries[0].warnings.join(' ')).toContain('check the units match');
  });

  it('will not write a number split across two differently-styled runs', () => {
    const split = deckOf([
      {
        id: 'sl_1',
        elements: [text('t1', [{ text: 'ARR $4.2', bold: true }, { text: 'M today' }])],
      },
    ]);
    const { entries } = planRefresh(split, parseRefreshCsv(csv('p1/t:t1/n0,1,x,4200000,4900000,,,,,reported,')).rows);
    expect(entries[0].status).toBe('blocked');
    expect(entries[0].reason).toContain('differently-styled');
  });

  it('will not put a negative where the slide writes no sign', () => {
    const { entries } = planRefresh(deck(), parseRefreshCsv(csv('p1/t:t1/n0,1,x,4200000,-100000,,,,,reported,')).rows);
    expect(entries[0].status).toBe('blocked');
    expect(entries[0].reason).toContain('without a sign');
  });

  it('reports the figures the CSV never mentioned as unchecked', () => {
    const plan = planRefresh(deck(), parseRefreshCsv(csv('p1/c:ch_1/s0/c0,1,x,100,140,,,,,reported,')).rows);
    expect(plan.unchecked.map((n) => n.ref)).toEqual(['p1/c:ch_1/s0/c1', 'p1/t:t1/n0']);
  });

  it('every ref the prompt hands out resolves back to a number in the deck', () => {
    const d = deck();
    const refs = collectDeckNumbers(d).flatMap((p) => [
      ...p.textNumbers.map((n) => n.ref),
      ...p.charts.flatMap((c) => c.numbers.map((n) => n.ref)),
    ]);
    expect(buildDeckRefreshPrompt(d).numberCount).toBe(refs.length);
    const { entries } = planRefresh(d, parseRefreshCsv(csv(...refs.map((r) => `${r},1,x,1,1,,,,,reported,`))).rows);
    expect(entries.every((e) => e.status !== 'unmatched')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe('formatLikeToken', () => {
  it.each([
    ['$4.2M', 4_900_000, '$4.9M'],
    ['34%', 0.412, '41%'],
    ['1,240', 1310, '1,310'],
    ['$1.2B', 1_450_000_000, '$1.5B'],
    ['42.7%', 0.5, '50.0%'],
    ['150bps', 210, '210bps'],
    ['2.4x', 3.1, '3.1x'],
  ])('writes %s as %s', (display, value, expected) => {
    expect(formatLikeToken(display, value)).toBe(expected);
  });

  it('keeps the thousands separator only when the original had one', () => {
    expect(formatLikeToken('1240', 4500)).toBe('4500');
    expect(formatLikeToken('1,240', 4500)).toBe('4,500');
  });

  it('refuses a negative, since the token has nowhere to put the sign', () => {
    expect(formatLikeToken('$4.2M', -1)).toBeNull();
  });
});

describe('writeToSpec', () => {
  it('writes into the series and category the ref names', () => {
    const spec = columnSpec();
    expect(writeToSpec(spec, ['s0', 'c1'], 999)).toBe(true);
    expect(spec.data.series[0].values).toEqual([100, 999]);
  });

  it('reports a miss rather than writing into the wrong row', () => {
    const spec = columnSpec();
    expect(writeToSpec(spec, ['s0', 'c9'], 999)).toBe(false);
    expect(spec.data.series[0].values).toEqual([100, 120]);
  });
});
