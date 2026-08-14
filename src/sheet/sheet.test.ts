import { describe, expect, it } from 'vitest';
import {
  cellText,
  defaultChartSpec,
  sheetFromSpec,
  sheetSchemaFor,
  specFromSheet,
  parseGrain,
  type ChartSpec,
  type ColumnBarSpec,
  type ScatterSpec,
  type SheetModel,
  type WaterfallSpec,
} from '@/model';
import { coerceCell, editText, formatCell, parseNumber } from './sheetCoerce';
import { looksLikeHeaderRow, parseClipboardTable, serializeTable } from './sheetClipboard';
import {
  addSeries,
  deleteRows,
  deleteSeries,
  fillRange,
  insertRow,
  insertSeries,
  moveRow,
  moveSeries,
  pasteTable,
  renameSeries,
  setCell,
} from './sheetOps';

/* ------------------------------------------------------------------ */

describe('parseNumber', () => {
  it('reads plain numbers', () => {
    expect(parseNumber('1240')).toBe(1240);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('-3')).toBe(-3);
  });

  it('strips grouping separators and currency', () => {
    expect(parseNumber('1,234,567')).toBe(1234567);
    expect(parseNumber('$1,240')).toBe(1240);
    expect(parseNumber('€99')).toBe(99);
  });

  it('reads accounting negatives', () => {
    expect(parseNumber('(1,234)')).toBe(-1234);
    expect(parseNumber('(88)')).toBe(-88);
  });

  it('treats unicode dashes as minus', () => {
    expect(parseNumber('−5')).toBe(-5);
    expect(parseNumber('–5')).toBe(-5);
  });

  it('refuses text and malformed grouping rather than guessing', () => {
    expect(parseNumber('Enterprise')).toBeNull();
    expect(parseNumber('1,23')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('12abc')).toBeNull();
  });
});

describe('coerceCell', () => {
  it('divides a typed percentage into a fraction', () => {
    expect(coerceCell('42.7%', 'number').value).toEqual({ kind: 'number', n: 0.427 });
  });

  it('keeps unparseable input verbatim instead of zeroing it', () => {
    expect(coerceCell('about 40', 'number').value).toEqual({
      kind: 'invalid',
      raw: 'about 40',
      expected: 'number',
    });
  });

  it('warns on an ambiguous decimal separator rather than inferring a locale', () => {
    const r = coerceCell('1.234', 'number');
    expect(r.value).toEqual({ kind: 'number', n: 1.234 });
    expect(r.warning?.code).toBe('ambiguous-decimal-separator');
  });

  it("keeps a date column's own wording", () => {
    expect(coerceCell('FY25', 'date').value).toEqual({ kind: 'text', text: 'FY25' });
    expect(coerceCell('not a date', 'date').value).toMatchObject({ kind: 'invalid' });
  });

  it('treats blank as empty, not zero', () => {
    expect(coerceCell('   ', 'number').value).toEqual({ kind: 'empty' });
  });
});

describe('formatCell / editText', () => {
  it('shows raw figures when editing, however they display', () => {
    const v = { kind: 'number' as const, n: 1240 };
    expect(formatCell(v, { style: 'number', thousands: true })).toBe('1,240');
    expect(editText(v)).toBe('1240');
  });

  it('does not leak floating-point noise into the editor', () => {
    expect(editText({ kind: 'number', n: 0.1 + 0.2 })).toBe('0.3');
  });
});

/* ------------------------------------------------------------------ */

describe('parseClipboardTable', () => {
  it('reads TSV, which is what Excel and Sheets put on the clipboard', () => {
    expect(parseClipboardTable('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('reads CSV when there are no tabs', () => {
    expect(parseClipboardTable('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('honours quoted fields containing the delimiter', () => {
    expect(parseClipboardTable('"Acme, Inc.",100')).toEqual([['Acme, Inc.', '100']]);
  });

  it('honours doubled quotes and embedded newlines', () => {
    expect(parseClipboardTable('"say ""hi""",1')).toEqual([['say "hi"', '1']]);
    expect(parseClipboardTable('"line1\nline2",2')).toEqual([['line1\nline2', '2']]);
  });

  it('handles CRLF without producing empty rows', () => {
    expect(parseClipboardTable('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('survives empty input', () => {
    expect(parseClipboardTable('')).toEqual([]);
  });
});

describe('serializeTable', () => {
  it('round-trips through the parser', () => {
    const rows = [
      ['Acme, Inc.', '1,240'],
      ['B "quoted"', '2'],
    ];
    expect(parseClipboardTable(serializeTable(rows).text)).toEqual(rows);
  });

  it('emits an HTML table so pasting into Excel keeps its shape', () => {
    expect(serializeTable([['a', 'b']]).html).toContain('<td>a</td>');
  });
});

describe('looksLikeHeaderRow', () => {
  it('spots a text header over numeric data', () => {
    expect(
      looksLikeHeaderRow([
        ['', 'Enterprise', 'SMB'],
        ['FY24', '100', '50'],
        ['FY25', '120', '60'],
      ]),
    ).toBe(true);
  });

  it('does not mistake data for a header', () => {
    expect(
      looksLikeHeaderRow([
        ['FY24', '100', '50'],
        ['FY25', '120', '60'],
      ]),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

const column = () => defaultChartSpec('column', 'stacked') as ColumnBarSpec;

describe('sheetSchemaFor', () => {
  it('gives a category grid one value column per series', () => {
    const spec = column();
    spec.data.categories = [
      { key: 'c0', label: 'Enterprise' },
      { key: 'c1', label: 'SMB' },
    ];
    const s = sheetSchemaFor(spec);
    expect(s.keyColumns.map((c) => c.header)).toEqual(['Category']);
    expect(s.perSeries.map((c) => c.key)).toEqual(['value']);
    expect(s.caps.addSeries).toBe(true);
  });

  it('reads the default FY labels as periods, so the key column is a date', () => {
    expect(sheetSchemaFor(column()).keyColumns[0].header).toBe('Date');
  });

  it('gives a scatter X and Y, and a bubble Size too', () => {
    expect(sheetSchemaFor(defaultChartSpec('scatter')).perSeries.map((c) => c.key)).toEqual(['x', 'y']);
    expect(sheetSchemaFor(defaultChartSpec('bubble')).perSeries.map((c) => c.key)).toEqual([
      'x',
      'y',
      'size',
    ]);
  });

  it('gives a waterfall a Kind dropdown and only one series', () => {
    const s = sheetSchemaFor(defaultChartSpec('waterfall'));
    expect(s.extraColumns[0].type).toBe('enum');
    expect(s.caps.addSeries).toBe(false);
    expect(s.caps.maxSeries).toBe(1);
  });

  it('gives a Mekko a column-width band', () => {
    expect(sheetSchemaFor(defaultChartSpec('mekko')).bands.map((b) => b.key)).toEqual(['width']);
  });

  it('caps a pie at one series — a second ring has nowhere to go', () => {
    expect(sheetSchemaFor(defaultChartSpec('pie')).caps.maxSeries).toBe(1);
  });

  it('switches the key column to a date when the categories look like periods', () => {
    const spec = column();
    spec.data.categories = [
      { key: 'c0', label: '2024-01' },
      { key: 'c1', label: '2024-02' },
    ];
    expect(sheetSchemaFor(spec).keyColumns[0].type).toBe('date');
  });
});

describe('datasheetSchemaFor — time runs across, not down', () => {
  it('turns a category grid on its side: a row is a series, a column a period', () => {
    const sheet = sheetFromSpec(column());
    expect(sheet.schema.layout).toBe('seriesDown');
    expect(sheet.schema.keyColumns.map((c) => c.header)).toEqual(['Series']);
    // FY23-25 across the headers, Enterprise/Mid-Market/SMB down the rows.
    expect(sheet.series.map((s) => s.name)).toEqual(['FY23', 'FY24', 'FY25']);
    expect(sheet.rows.map((r) => cellText(r[0]))).toEqual(['Enterprise', 'Mid-Market', 'SMB']);
    expect(sheet.rows[0].slice(1).map(cellText)).toEqual(['420', '512', '640']);
  });

  it('swaps the caps over with the axes', () => {
    const caps = sheetFromSpec(defaultChartSpec('pie')).schema.caps;
    // Slices can be added without limit; a second ring cannot.
    expect(caps.addSeries).toBe(true);
    expect(caps.maxSeries).toBeUndefined();
    expect(caps.addRows).toBe(false);
    expect(caps.maxRows).toBe(1);
  });

  it('leaves the shapes that have no category axis alone', () => {
    for (const kind of ['scatter', 'bubble', 'waterfall', 'sankey', 'butterfly'] as const) {
      expect(sheetFromSpec(defaultChartSpec(kind)).schema.layout).toBe('recordsDown');
    }
  });

  it('leaves a Mekko alone, because its width band is indexed by row', () => {
    const sheet = sheetFromSpec(defaultChartSpec('mekko'));
    expect(sheet.schema.layout).toBe('recordsDown');
    expect(sheet.bandValues.width).toHaveLength(3);
  });

  it("does not turn Devin's contract on its side with it", () => {
    // The research contract is one record per period — the shape a source
    // table comes in — however the datasheet chooses to draw it.
    const schema = sheetSchemaFor(column());
    expect(schema.layout).toBe('recordsDown');
    expect(schema.keyColumns[0].header).toBe('Date');
  });
});

describe('parseGrain', () => {
  it.each([
    ['2024', 'year'],
    ['FY25', 'year'],
    ["Q3'24", 'quarter'],
    ['2024 Q3', 'quarter'],
    ['Jan 2024', 'month'],
    ['Jan-24', 'month'],
    ['2024-03', 'month'],
    ['2024-03-15', 'day'],
  ])('reads %s as %s', (label, grain) => {
    expect(parseGrain(label)?.grain).toBe(grain);
  });

  it('refuses things that are not periods', () => {
    expect(parseGrain('Enterprise')).toBeNull();
    expect(parseGrain('Mid-Market')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

const roundTrip = (spec: ChartSpec) => specFromSheet(sheetFromSpec(spec), spec).spec;

describe('sheetFromSpec / specFromSheet', () => {
  it('round-trips a category grid', () => {
    const spec = column();
    expect(roundTrip(spec)).toEqual(spec);
  });

  it('round-trips every chart family', () => {
    for (const kind of ['column', 'bar', 'line', 'area', 'pie', 'scatter', 'bubble', 'waterfall', 'mekko'] as const) {
      const spec = defaultChartSpec(kind);
      expect(sheetFromSpec(roundTrip(spec))).toEqual(sheetFromSpec(spec));
    }
  });

  it('keeps styling and axes when only the data changed', () => {
    const spec = column();
    spec.axes.y.title = 'Revenue';
    spec.data.series[0].format = { fill: { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } } };
    const sheet = sheetFromSpec(spec);
    const edited = setCell(sheet, 0, 1, { kind: 'number', n: 999 });
    const out = specFromSheet(edited, spec).spec as ColumnBarSpec;

    expect(out.axes.y.title).toBe('Revenue');
    expect(out.data.series[0].format?.fill).toEqual(spec.data.series[0].format?.fill);
    expect(out.data.series[0].values[0]).toBe(999);
  });

  it('reports an uncoercible cell without dropping the row', () => {
    const spec = column();
    const sheet = sheetFromSpec(spec);
    const bad = setCell(sheet, 0, 1, { kind: 'invalid', raw: 'about 40', expected: 'number' });
    const { spec: out, diagnostics } = specFromSheet(bad, spec);

    expect(diagnostics[0].code).toBe('cell-not-a-number');
    expect((out as ColumnBarSpec).data.categories).toHaveLength(3);
    expect((out as ColumnBarSpec).data.series[0].values[0]).toBeNull();
  });

  it('keeps category keys stable across a rename, so overrides survive', () => {
    const spec = column();
    spec.data.series[0].pointOverrides = { c1: { hidden: true } };
    // A category is a COLUMN here, so renaming one is a header rename.
    const renamed = renameSeries(sheetFromSpec(spec), 'c1', 'Renamed');
    const out = specFromSheet(renamed, spec).spec as ColumnBarSpec;

    expect(out.data.categories[1]).toMatchObject({ key: 'c1', label: 'Renamed' });
    expect(out.data.series[0].pointOverrides?.c1).toEqual({ hidden: true });
  });

  it('renames a series from its row label', () => {
    const spec = column();
    const renamed = setCell(sheetFromSpec(spec), 0, 0, { kind: 'text', text: 'EMEA' });
    const out = specFromSheet(renamed, spec).spec as ColumnBarSpec;
    expect(out.data.series[0]).toMatchObject({ key: 's0', name: 'EMEA' });
    expect(out.data.series[0].values).toEqual(spec.data.series[0].values);
  });

  it('prunes overrides whose point was deleted', () => {
    const spec = column();
    spec.data.series[0].pointOverrides = { c2: { hidden: true } };
    const sheet = deleteSeries(sheetFromSpec(spec), 'c2');
    const out = specFromSheet(sheet, spec).spec as ColumnBarSpec;
    expect(out.data.series[0].pointOverrides).toBeUndefined();
  });

  it('reads a waterfall Kind column, defaulting sensibly', () => {
    const spec = defaultChartSpec('waterfall') as WaterfallSpec;
    const sheet = sheetFromSpec(spec);
    const out = specFromSheet(sheet, spec).spec as WaterfallSpec;
    expect(out.data.items.map((i) => i.role)).toEqual(['start', 'delta', 'delta', 'delta', 'total']);
  });

  it('flags a scatter point missing its Y', () => {
    const spec = defaultChartSpec('scatter') as ScatterSpec;
    const sheet = sheetFromSpec(spec);
    const blanked = setCell(sheet, 0, 2, { kind: 'empty' });
    expect(specFromSheet(blanked, spec).diagnostics.map((d) => d.code)).toContain('incomplete-point');
  });
});

/* ------------------------------------------------------------------ */

const sheetOf = (spec = column() as ChartSpec) => sheetFromSpec(spec);
const at = (s: SheetModel, r: number, c: number) => cellText(s.rows[r][c]);

describe('sheetOps — rows', () => {
  it('inserts and deletes rows', () => {
    const s = sheetOf();
    expect(insertRow(s, 1).rows).toHaveLength(4);
    expect(deleteRows(s, 1).rows).toHaveLength(2);
  });

  it('refuses to delete below the minimum', () => {
    const s = deleteRows(deleteRows(sheetOf(), 0), 0);
    expect(deleteRows(s, 0)).toBe(s);
  });

  it('moves a row and its band value together', () => {
    const s = sheetOf(defaultChartSpec('mekko'));
    const moved = moveRow(s, 0, 2);
    expect(at(moved, 2, 0)).toBe('FY23');
    expect(moved.bandValues.width).toHaveLength(3);
  });
});

describe('sheetOps — series', () => {
  it('adds a series with matching columns', () => {
    const s = addSeries(sheetOf());
    expect(s.series).toHaveLength(4);
    expect(s.rows[0]).toHaveLength(s.columns.length);
  });

  it('deletes a series and its column', () => {
    const s = deleteSeries(sheetOf(), 'c1');
    expect(s.series.map((x) => x.key)).toEqual(['c0', 'c2']);
    expect(s.rows[0]).toHaveLength(s.columns.length);
  });

  it('inserts a column at a position and carries the neighbours across', () => {
    const s = sheetOf();
    const before = at(s, 0, 1);
    const inserted = insertSeries(s, 1);
    expect(inserted.series).toHaveLength(4);
    // The first series stays put; the second is now the new blank one.
    expect(at(inserted, 0, 1)).toBe(before);
    expect(at(inserted, 0, 2)).toBe('');
    expect(inserted.rows[0]).toHaveLength(inserted.columns.length);
  });

  it('inserting past the end is the same as appending', () => {
    const s = sheetOf();
    expect(insertSeries(s, 99).series).toHaveLength(4);
  });

  it('refuses to insert past the cap', () => {
    const s = sheetOf(defaultChartSpec('waterfall'));
    expect(insertSeries(s, 0)).toBe(s);
    expect(addSeries(s)).toBe(s);
  });

  it('refuses to add a row past the cap', () => {
    // One ring, one row: the pie's series cap is a ROW cap once transposed.
    const s = sheetOf(defaultChartSpec('pie'));
    expect(s.rows).toHaveLength(1);
    expect(insertRow(s, 1)).toBe(s);
  });

  it('names a new column group after what a column means here', () => {
    // Transposed, a column is a period — not a fourth "Series".
    expect(addSeries(sheetOf()).series[3].name).toBe('Category 4');
    const points = sheetOf(defaultChartSpec('scatter'));
    expect(addSeries(points).series[1].name).toBe('Series 2');
  });

  it('renames a series in the header', () => {
    expect(renameSeries(sheetOf(), 'c0', 'FY26').columns[1].header).toBe('FY26');
  });

  it('carries the data with a reordered series rather than shifting values', () => {
    const s = sheetOf();
    const before = at(s, 0, 1);
    const moved = moveSeries(s, 0, 2);
    expect(moved.series.map((x) => x.key)).toEqual(['c1', 'c2', 'c0']);
    // FY23's column of values follows FY23 to its new position.
    expect(at(moved, 0, 3)).toBe(before);
  });
});

describe('sheetOps — fill and clear', () => {
  it('fills down from the top of the selection', () => {
    const s = sheetOf();
    const filled = fillRange(s, { anchor: { r: 0, c: 1 }, focus: { r: 2, c: 1 } }, 'down');
    expect(at(filled, 2, 1)).toBe(at(s, 0, 1));
  });

  it('fills right from the left of the selection', () => {
    const s = sheetOf();
    const filled = fillRange(s, { anchor: { r: 0, c: 1 }, focus: { r: 0, c: 3 } }, 'right');
    expect(at(filled, 0, 3)).toBe(at(s, 0, 1));
  });
});

describe('sheetOps — paste', () => {
  it('overwrites from the anchor', () => {
    const r = pasteTable(sheetOf(), { r: 0, c: 1 }, [['10'], ['20']]);
    expect(at(r.sheet, 0, 1)).toBe('10');
    expect(at(r.sheet, 1, 1)).toBe('20');
  });

  it('grows rows to fit the block', () => {
    const r = pasteTable(sheetOf(), { r: 0, c: 0 }, [['a'], ['b'], ['c'], ['d'], ['e']]);
    expect(r.sheet.rows).toHaveLength(5);
    expect(r.grewRows).toBe(2);
  });

  it('grows series to fit extra columns', () => {
    const r = pasteTable(sheetOf(), { r: 0, c: 0 }, [['A', '1', '2', '3', '4']]);
    expect(r.sheet.series).toHaveLength(4);
    expect(r.grewSeries).toBe(1);
  });

  it('uses a detected header row for series names', () => {
    const r = pasteTable(sheetOf(), { r: 0, c: 0 }, [
      ['Year', 'EMEA', 'AMER', 'APAC'],
      ['FY24', '1', '2', '3'],
      ['FY25', '4', '5', '6'],
    ]);
    expect(r.usedHeaderRow).toBe(true);
    expect(r.sheet.series.map((s) => s.name)).toEqual(['EMEA', 'AMER', 'APAC']);
    expect(at(r.sheet, 0, 0)).toBe('FY24');
  });

  it('can be told not to treat the first row as a header', () => {
    const r = pasteTable(
      sheetOf(),
      { r: 0, c: 0 },
      [
        ['Year', 'EMEA'],
        ['FY24', '1'],
      ],
      undefined,
      { useHeaderRow: false },
    );
    expect(r.usedHeaderRow).toBe(false);
    expect(at(r.sheet, 0, 0)).toBe('Year');
  });

  it('fills a selection from a single pasted cell, as Excel does', () => {
    const r = pasteTable(sheetOf(), { r: 0, c: 1 }, [['7']], {
      anchor: { r: 0, c: 1 },
      focus: { r: 2, c: 2 },
    });
    expect(at(r.sheet, 2, 2)).toBe('7');
    expect(at(r.sheet, 0, 1)).toBe('7');
  });

  it('reports rather than silently dropping columns past the cap', () => {
    const r = pasteTable(sheetOf(defaultChartSpec('butterfly')), { r: 0, c: 0 }, [
      ['A', '1', '2', '3'],
    ]);
    expect(r.warnings.map((w) => w.code)).toContain('series-capped');
  });

  it('reports rather than silently dropping rows past the cap', () => {
    // A pie has one ring, which under the transposed layout is one row.
    const r = pasteTable(sheetOf(defaultChartSpec('pie')), { r: 0, c: 0 }, [
      ['Slices', '1', '2'],
      ['Extra', '3', '4'],
    ]);
    expect(r.warnings.map((w) => w.code)).toContain('rows-capped');
    expect(r.sheet.rows).toHaveLength(1);
  });

  it('surfaces an ambiguous separator warning once, not per cell', () => {
    const r = pasteTable(sheetOf(), { r: 0, c: 1 }, [['1.234'], ['5.678']]);
    expect(r.warnings.filter((w) => w.code === 'ambiguous-decimal-separator')).toHaveLength(1);
  });

  it('survives an empty paste', () => {
    const s = sheetOf();
    expect(pasteTable(s, { r: 0, c: 0 }, []).sheet).toBe(s);
  });
});
