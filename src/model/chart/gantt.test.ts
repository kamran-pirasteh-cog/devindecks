import { describe, expect, it } from 'vitest';
import { fromIso, toEpochDay, toIso } from '../units';
import { sheetFromSpec, specFromSheet } from '../sheetAdapter';
import { cellText, type CellValue, type SheetModel } from '../sheet';
import { convertData, dataShapeOf } from './shape';
import { defaultChartSpec } from './defaults';
import { supportsOrientation, supportsTurn } from './orientation';
import { previewDataAppliesTo } from './previewData';
import { isSupported } from '@/chart/compile';
import { isGanttSpec, type GanttSpec } from './spec';

const gantt = (): GanttSpec => {
  const s = defaultChartSpec('gantt');
  if (!isGanttSpec(s)) throw new Error('not a gantt');
  return s;
};


/**
 * The sample with a sub-row, a milestone and a right-hand column.
 *
 * The default sample is five plain top-level bars and two left columns, so the
 * cases that are ABOUT hierarchy, milestones or the right side of the chart
 * build what they need rather than leaning on a sample that is free to change.
 */
const rich = (mutate?: (s: GanttSpec) => void): GanttSpec => {
  const s = gantt();
  const d = (n: number) => toEpochDay(2026, 1, 5) + n;
  s.rows = [
    { key: 'r0', label: 'Discovery', level: 0 },
    { key: 'r1', label: 'Research', level: 1 },
    { key: 'r2', label: 'Synthesis', level: 1 },
    { key: 'r3', label: 'Build', level: 0 },
    { key: 'r4', label: 'Launch', level: 0 },
  ];
  s.items = [
    { key: 'i0', row: 'r0', from: d(0), to: d(42), shape: { form: 'summary' } },
    { key: 'i1', row: 'r1', from: d(0), to: d(21), shape: { form: 'bar' } },
    { key: 'i2', row: 'r2', from: d(21), to: d(42), shape: { form: 'bar' } },
    { key: 'i3', row: 'r3', from: d(42), to: d(126), shape: { form: 'chevron' } },
    { key: 'i4', row: 'r4', from: d(126), shape: { form: 'milestone', marker: 'diamond' } },
  ];
  s.cells = {
    r0: { 'col.owner': 'AM' },
    r1: { 'col.owner': 'AM' },
    r2: { 'col.owner': 'JR' },
    r3: { 'col.owner': 'KP' },
    r4: { 'col.owner': 'KP' },
  };
  mutate?.(s);
  return s;
};

/** The column index of a slot's field, from the materialised sheet. */
const at = (sheet: SheetModel, seriesKey: string, field: string): number =>
  sheet.columns.findIndex((c) => c.seriesKey === seriesKey && c.field === field);

const write = (sheet: SheetModel, r: number, c: number, v: CellValue): SheetModel => {
  const rows = sheet.rows.map((row) => [...row]);
  rows[r]![c] = v;
  return { ...sheet, rows };
};

describe('the kind itself', () => {
  it('has its own data shape, not a grid', () => {
    expect(dataShapeOf('gantt')).toEqual({ form: 'gantt' });
  });

  it('never turns and has no orientation', () => {
    // `supportsTurn` is permissive by default, so this is the assertion that
    // catches a Gantt being handed a rotation handle.
    expect(supportsTurn('gantt')).toBe(false);
    expect(supportsOrientation('gantt')).toBe(false);
  });

  it('takes no admin preview data — a category grid cannot drive a schedule', () => {
    expect(previewDataAppliesTo('gantt')).toBe(false);
  });

  it('builds a sample anchored to a fixed day, not to the clock', () => {
    expect(gantt()).toEqual(gantt());
    expect(toIso(gantt().items[0]!.from)).toBe('2026-01-05');
  });

  it('has no today line until something stamps one', () => {
    // The compiler is pure; a date can only enter through the store.
    expect(gantt().today).toBeUndefined();
  });
});

describe('sheetFromSpec', () => {
  const spec = rich();
  const sheet = sheetFromSpec(spec);

  it('gives one row per task, not one per bar', () => {
    expect(sheet.rows).toHaveLength(spec.rows.length);
    expect(sheet.rows.map((r) => cellText(r[0]))).toEqual([
      'Discovery',
      'Research',
      'Synthesis',
      'Build',
      'Launch',
    ]);
  });

  it('repeats a slot per bar on the busiest row, named so the header reads', () => {
    expect(sheet.series.map((s) => s.name)).toEqual(['Bar 1']);
    expect(sheet.columns.map((c) => c.header)).toEqual([
      'Task',
      'Owner',
      'Bar 1 Type',
      'Bar 1 Start',
      'Bar 1 End',
      'Bar 1 Label',
    ]);
  });

  it('puts left description columns before the slots and right ones after', () => {
    const spread = rich();
    spread.columns.push({
      key: 'col.status',
      header: 'Status',
      side: 'right',
      order: 0,
      source: 'text',
    });
    const headers = sheetFromSpec(spread).columns.map((c) => c.header);
    expect(headers.indexOf('Owner')).toBeLessThan(headers.indexOf('Bar 1 Type'));
    expect(headers.indexOf('Status')).toBeGreaterThan(headers.indexOf('Bar 1 Label'));
  });

  it('offers only authored columns — a derived one cannot be typed into', () => {
    // A derived column is computed from the bars, so printing it beside the End
    // cell it was computed from would be the same fact twice, one copy of which
    // cannot be edited.
    const withDerived = rich((g) => {
      g.columns.push({
        key: 'col.due',
        header: 'Due',
        side: 'right',
        order: 0,
        source: 'end',
      });
    });
    expect(sheetFromSpec(withDerived).columns.some((c) => c.key === 'desc.col.due')).toBe(false);
    // Nor the row's own name, which the Task column already is.
    expect(sheet.columns.some((c) => c.key === 'desc.col.task')).toBe(false);
  });

  it('shows the end date INCLUSIVE though the spec stores it half-open', () => {
    const item = spec.items.find((i) => i.key === 'i1')!;
    const r = spec.rows.findIndex((x) => x.key === item.row);
    expect(cellText(sheet.rows[r]![at(sheet, 'i0', 'end')]!)).toBe(toIso(item.to! - 1));
  });

  it('leaves a milestone with no end', () => {
    const r = spec.rows.findIndex((x) => x.key === 'r4');
    expect(sheet.rows[r]![at(sheet, 'i0', 'end')]).toEqual({ kind: 'empty' });
    expect(cellText(sheet.rows[r]![at(sheet, 'i0', 'form')]!)).toBe('milestone');
  });

  it('carries the indent beside the name rather than in a column', () => {
    expect(sheet.rowIndent).toEqual([undefined, 1, 1, undefined, undefined]);
    expect(sheet.columns.some((c) => c.key === 'level')).toBe(false);
  });

  it('carries authored cells', () => {
    const owner = sheet.columns.findIndex((c) => c.key === 'desc.col.owner');
    expect(sheet.rows.map((r) => cellText(r[owner]!))).toEqual(['AM', 'AM', 'JR', 'KP', 'KP']);
  });
});

describe('round trip', () => {
  it('is the identity on the sample', () => {
    const spec = gantt();
    const { spec: back, diagnostics } = specFromSheet(sheetFromSpec(spec), spec);
    expect(diagnostics).toEqual([]);
    expect(back).toEqual(spec);
  });

  it('is the identity on a row carrying two bars', () => {
    const spec = rich();
    spec.items.push({
      key: 'i5',
      row: 'r3',
      from: toEpochDay(2026, 5, 4),
      to: toEpochDay(2026, 6, 1),
      shape: { form: 'bar' },
      label: 'Hardening',
    });
    const sheet = sheetFromSpec(spec);
    expect(sheet.series).toHaveLength(2);
    const { spec: back, diagnostics } = specFromSheet(sheet, spec);
    expect(diagnostics).toEqual([]);
    // Items come back grouped by row rather than in their original order, so
    // compare as a set of the fields the sheet owns.
    const shrink = (s: GanttSpec) =>
      [...s.items]
        .map((i) => ({ key: i.key, row: i.row, from: i.from, to: i.to, form: i.shape.form }))
        .sort((a, b) => a.key.localeCompare(b.key));
    expect(shrink(back as GanttSpec)).toEqual(shrink(spec));
  });

  it('keeps item keys when a task is renamed, so formatting survives', () => {
    const spec = rich();
    const sheet = write(sheetFromSpec(spec), 3, 0, { kind: 'text', text: 'Delivery' });
    const back = specFromSheet(sheet, spec).spec as GanttSpec;
    expect(back.rows[3]!.label).toBe('Delivery');
    expect(back.rows[3]!.key).toBe('r3');
    expect(back.items.map((i) => i.key)).toEqual(spec.items.map((i) => i.key));
  });
});

describe('specFromSheet', () => {
  const spec = rich();

  it('reads a typed date in any of the shapes people write', () => {
    for (const [typed, iso] of [
      ['2026-03-14', '2026-03-14'],
      ['3/14/2026', '2026-03-14'],
      ['14 Mar 2026', '2026-03-14'],
      ['Mar 14, 2026', '2026-03-14'],
      // Over 12 can only be a day, whichever country wrote it.
      ['14/3/2026', '2026-03-14'],
      // A period is a fair thing to type; it means its first day.
      ['Q3 2026', '2026-07-01'],
    ] as const) {
      const sheet = write(sheetFromSpec(spec), 1, at(sheetFromSpec(spec), 'i0', 'start'), {
        kind: 'text',
        text: typed,
      });
      const back = specFromSheet(sheet, spec).spec as GanttSpec;
      expect(toIso(back.items.find((i) => i.row === 'r1')!.from)).toBe(iso);
    }
  });

  it('reports an unparseable date rather than dropping it', () => {
    const sheet0 = sheetFromSpec(spec);
    const sheet = write(sheet0, 1, at(sheet0, 'i0', 'start'), { kind: 'text', text: 'soonish' });
    const { diagnostics } = specFromSheet(sheet, spec);
    expect(diagnostics.map((d) => d.code)).toContain('cell-not-a-date');
  });

  it('warns rather than silently ignoring an End typed against a milestone', () => {
    const sheet0 = sheetFromSpec(spec);
    const r = spec.rows.findIndex((x) => x.key === 'r4');
    const sheet = write(sheet0, r, at(sheet0, 'i0', 'end'), { kind: 'date', iso: '2026-06-01' });
    const { spec: back, diagnostics } = specFromSheet(sheet, spec);
    expect(diagnostics.map((d) => d.code)).toContain('milestone-has-end');
    expect((back as GanttSpec).items.find((i) => i.row === 'r4')!.to).toBeUndefined();
  });

  it('never builds a zero-width bar out of an empty slot', () => {
    const sheet0 = sheetFromSpec(spec);
    let sheet = sheet0;
    const r = spec.rows.findIndex((x) => x.key === 'r2');
    for (const f of ['form', 'start', 'end', 'text']) {
      sheet = write(sheet, r, at(sheet0, 'i0', f), { kind: 'empty' });
    }
    const back = specFromSheet(sheet, spec).spec as GanttSpec;
    expect(back.items.some((i) => i.row === 'r2')).toBe(false);
  });

  it('treats a blank Type as a bar rather than demanding the word', () => {
    const sheet0 = sheetFromSpec(spec);
    const sheet = write(sheet0, 1, at(sheet0, 'i0', 'form'), { kind: 'empty' });
    const back = specFromSheet(sheet, spec).spec as GanttSpec;
    expect(back.items.find((i) => i.row === 'r1')!.shape.form).toBe('bar');
  });

  it('warns on a type it does not know, and falls back to a bar', () => {
    const sheet0 = sheetFromSpec(spec);
    const sheet = write(sheet0, 1, at(sheet0, 'i0', 'form'), { kind: 'text', text: 'gizmo' });
    const { spec: back, diagnostics } = specFromSheet(sheet, spec);
    expect(diagnostics.map((d) => d.code)).toContain('unknown-item-type');
    expect((back as GanttSpec).items.find((i) => i.row === 'r1')!.shape.form).toBe('bar');
  });

  it('clamps an inverted span to zero width and says so', () => {
    const sheet0 = sheetFromSpec(spec);
    const sheet = write(sheet0, 1, at(sheet0, 'i0', 'end'), { kind: 'date', iso: '2025-01-01' });
    const { spec: back, diagnostics } = specFromSheet(sheet, spec);
    expect(diagnostics.map((d) => d.code)).toContain('end-before-start');
    const item = (back as GanttSpec).items.find((i) => i.row === 'r1')!;
    expect(item.to).toBe(item.from);
  });

  it('writes authored cells back under the column key, not the sheet key', () => {
    const sheet0 = sheetFromSpec(spec);
    const owner = sheet0.columns.findIndex((c) => c.key === 'desc.col.owner');
    const sheet = write(sheet0, 0, owner, { kind: 'text', text: 'RS' });
    const back = specFromSheet(sheet, spec).spec as GanttSpec;
    expect(back.cells?.r0?.['col.owner']).toBe('RS');
  });
});

describe('convertData', () => {
  it('flattens a Gantt to durations in days, milestones as gaps', () => {
    const grid = convertData(rich(), 'column');
    expect(grid.kind).toBe('column');
    if (!('data' in grid) || !('categories' in grid.data)) throw new Error('not a grid');
    expect(grid.data.series[0]!.name).toBe('Days');
    expect(grid.data.series[0]!.values).toEqual([42, 21, 21, 84, null]);
    expect(grid.data.categories[0]!.label).toBe('Discovery');
  });

  it('reads a dated category axis as a real schedule', () => {
    const column = defaultChartSpec('column');
    if (!('data' in column) || !('categories' in column.data)) throw new Error('not a grid');
    column.data.categories = [
      { key: 'c0', label: '2026-01' },
      { key: 'c1', label: '2026-02' },
      { key: 'c2', label: '2026-03' },
    ];
    const g = convertData(column, 'gantt') as GanttSpec;
    expect(g.items).toHaveLength(3);
    expect(toIso(g.items[0]!.from)).toBe('2026-01-01');
    // The next category closes the span, so the bars abut rather than overlap.
    expect(g.items[0]!.to).toBe(fromIso('2026-02-01'));
    expect(g.items[2]!.to).toBe(fromIso('2026-04-01'));
  });

  const undated = () => {
    const column = defaultChartSpec('column');
    if (!('data' in column) || !('categories' in column.data)) throw new Error('not a grid');
    column.data.categories = [
      { key: 'c0', label: 'Enterprise' },
      { key: 'c1', label: 'Mid-Market' },
      { key: 'c2', label: 'SMB' },
    ];
    return column;
  };

  it('reads a fiscal-year axis as dates too', () => {
    // The sample's own FY23/FY24/FY25 is a dated axis, and treating it as one
    // is the whole point of preferring the dated reading.
    const g = convertData(defaultChartSpec('column'), 'gantt') as GanttSpec;
    expect(toIso(g.items[0]!.from)).toBe('2023-01-01');
    expect(g.items[0]!.to).toBe(fromIso('2024-01-01'));
  });

  it('starts every task together when the categories are not dates', () => {
    const g = convertData(undated(), 'gantt') as GanttSpec;
    const starts = new Set(g.items.map((i) => i.from));
    expect(starts.size).toBe(1);
    // Durations, not an invented cascade: nothing in the data says when
    // anything starts, and a fabricated sequence reads as a real plan.
    expect(g.items.map((i) => i.to! - i.from)).toEqual([420, 512, 640]);
  });

  it('is deterministic — no clock anywhere in the conversion', () => {
    expect(convertData(undated(), 'gantt')).toEqual(convertData(undated(), 'gantt'));
  });

  it('carries the task names across', () => {
    const g = convertData(undated(), 'gantt') as GanttSpec;
    expect(g.rows.map((r) => r.label)).toEqual(['Enterprise', 'Mid-Market', 'SMB']);
  });
});

describe('the placer', () => {
  it('draws the sample rather than reporting an unsupported kind', () => {
    // This asserted the opposite while the kind shipped model-only, which is
    // how `butterfly` still ships. `place/gantt.test.ts` covers what it draws.
    expect(isSupported(gantt())).toBe(true);
  });
});
