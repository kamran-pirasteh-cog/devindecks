/**
 * The gestures a Gantt has to answer, at the store layer.
 *
 * Its own file rather than more cases in `chartActions.test.ts`: what is being
 * asserted here is that a kind with ITEMS instead of point overrides still gets
 * the promotion rule that makes recolouring feel right — "recolour every bar in
 * a row and the row takes the colour, so a bar added later matches" — which is
 * the single behaviour that separates this from a paint bucket.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  elementIdFor,
  inchesToEmu,
  isGanttSpec,
  type GanttSpec,
  type Slide,
} from '@/model';
import {
  applyChartFormat,
  clearChartFormatting,
  deleteChartParts,
  insertChartInto,
  labelHomeFor,
  labelSpecAt,
  patchLabelAt,
  recompileInto,
} from './chartActions';

const DS = DEFAULT_DESIGN_SYSTEM;
const FRAME = { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(8), h: inchesToEmu(4) };
const RED = { kind: 'hex' as const, hex: '#ff0000' };

function board() {
  const slide: Slide = { id: 's1', elements: [] };
  const { id } = insertChartInto(slide, defaultChartSpec('gantt'), FRAME, DS);
  const spec = () => {
    const s = slide.charts!.find((c) => c.id === id)!.spec;
    if (!isGanttSpec(s)) throw new Error('not a gantt');
    return s;
  };
  /**
   * Delete reads the refs off the COMPILED elements, so a test that turns a
   * feature on in the spec has to recompile before it can click on it — the
   * same order the editor works in.
   */
  const del = (...ids: string[]) => {
    recompileInto(slide, id, DS);
    return deleteChartParts(slide, ids, DS);
  };

  return { slide, id, spec, del };
}

const markId = (chartId: string, row: string, item: string) =>
  elementIdFor({ chartId, part: 'mark', series: row, point: item });

const labelId = (chartId: string, row: string, item: string) =>
  elementIdFor({ chartId, part: 'label', series: row, point: item });

describe('recolouring', () => {
  it('writes to the ITEM when only some of a row is selected', () => {
    const { slide, id, spec } = board();
    // r0 holds one item, so use r3/Build with a second bar added.
    spec().items.push({
      key: 'i9',
      row: 'r3',
      from: spec().items[3]!.from,
      to: spec().items[3]!.to,
      shape: { form: 'bar' },
    });
    applyChartFormat(slide, [markId(id, 'r3', 'i3')], { fill: { kind: 'solid', color: RED } });
    expect(spec().items.find((i) => i.key === 'i3')!.format?.fill).toEqual({
      kind: 'solid',
      color: RED,
    });
    expect(spec().rows.find((r) => r.key === 'r3')!.format).toBeUndefined();
    expect(spec().items.find((i) => i.key === 'i9')!.format).toBeUndefined();
  });

  it('promotes to the ROW when every bar in it is selected', () => {
    const { slide, id, spec } = board();
    applyChartFormat(slide, [markId(id, 'r1', 'i1')], { fill: { kind: 'solid', color: RED } });
    // r1 has exactly one bar, so selecting it IS selecting the whole row.
    expect(spec().rows.find((r) => r.key === 'r1')!.format?.fill).toEqual({
      kind: 'solid',
      color: RED,
    });
  });

  it('so a bar added to that row later inherits the colour', () => {
    const { slide, id, spec } = board();
    applyChartFormat(slide, [markId(id, 'r1', 'i1')], { fill: { kind: 'solid', color: RED } });
    spec().items.push({ key: 'i9', row: 'r1', from: 0, to: 5, shape: { form: 'bar' } });
    // Nothing on the new item — it reads the row's paint. This is the whole
    // point of the promotion, and why a Gantt keeps a `format` on the row.
    expect(spec().items.find((i) => i.key === 'i9')!.format).toBeUndefined();
    expect(spec().rows.find((r) => r.key === 'r1')!.format?.fill).toEqual({
      kind: 'solid',
      color: RED,
    });
  });

  it('clears the item fills a row-wide colour would otherwise be hidden behind', () => {
    const { slide, id, spec } = board();
    const blue = { kind: 'hex' as const, hex: '#0000ff' };
    applyChartFormat(slide, [markId(id, 'r1', 'i1')], { fill: { kind: 'solid', color: blue } });
    // First write promoted to the row. Force an item fill, then re-promote.
    spec().items.find((i) => i.key === 'i1')!.format = { fill: { kind: 'solid', color: blue } };
    applyChartFormat(slide, [markId(id, 'r1', 'i1')], { fill: { kind: 'solid', color: RED } });
    expect(spec().items.find((i) => i.key === 'i1')!.format?.fill).toBeUndefined();
    expect(spec().rows.find((r) => r.key === 'r1')!.format?.fill).toEqual({
      kind: 'solid',
      color: RED,
    });
  });
});

describe('labels', () => {
  it('scopes a whole row to the ROW and a lone bar to the ITEM', () => {
    const { id, spec } = board();
    const s = spec();
    s.items.push({ key: 'i9', row: 'r3', from: 0, to: 5, shape: { form: 'bar' } });

    const whole = labelHomeFor(s, [
      { chartId: id, part: 'label', series: 'r3', point: 'i3' },
      { chartId: id, part: 'label', series: 'r3', point: 'i9' },
    ]);
    expect(whole).toEqual({ scope: 'series', seriesKey: 'r3' });

    const one = labelHomeFor(s, [{ chartId: id, part: 'label', series: 'r3', point: 'i3' }]);
    expect(one).toEqual({ scope: 'point', seriesKey: 'r3', points: ['i3'] });
  });

  it('writes a single bar’s label to the item, where the placer reads it', () => {
    const { id, spec } = board();
    const s = spec();
    const home = labelHomeFor(s, [{ chartId: id, part: 'label', series: 'r1', point: 'i1' }])!;
    // r1 has one item, so this promotes to the row — force the point scope.
    patchLabelAt(s, { scope: 'point', seriesKey: 'r1', points: ['i1'] }, { show: true });
    expect(s.items.find((i) => i.key === 'i1')!.labels?.show).toBe(true);
    expect(home.scope).toBe('series');
  });

  it('reads back what it wrote, so the toggle cannot show "off" for a visible label', () => {
    const { spec } = board();
    const s = spec();
    const home = { scope: 'point' as const, seriesKey: 'r1', points: ['i1'] };
    patchLabelAt(s, home, { show: true });
    expect(labelSpecAt(s, home).show).toBe(true);
  });

  it('drops the item labels a row-wide change would shadow', () => {
    const { spec } = board();
    const s = spec();
    patchLabelAt(s, { scope: 'point', seriesKey: 'r1', points: ['i1'] }, { show: true });
    patchLabelAt(s, { scope: 'series', seriesKey: 'r1' }, { show: false });
    expect(s.items.find((i) => i.key === 'i1')!.labels).toBeUndefined();
    expect(s.rows.find((r) => r.key === 'r1')!.labels?.show).toBe(false);
  });
});

describe('delete', () => {
  it('hides a bar rather than deleting its element', () => {
    const { slide, id, spec, del } = board();
    const before = slide.elements.length;
    del(markId(id, 'r1', 'i1'));
    expect(spec().items.find((i) => i.key === 'i1')!.hidden).toBe(true);
    // The spec said "don't draw this"; the elements are recompiled from it.
    expect(slide.elements.length).toBeLessThan(before);
  });

  it('turns a data label off rather than hiding its bar', () => {
    const { slide, id, spec, del } = board();
    spec().decorations.labels.show = true;
    del(labelId(id, 'r1', 'i1'));
    expect(spec().items.find((i) => i.key === 'i1')!.hidden).toBeUndefined();
    expect(spec().items.find((i) => i.key === 'i1')!.labels?.show).toBe(false);
  });

  it('switches the today line off instead of doing nothing', () => {
    const { slide, id, spec, del } = board();
    spec().today = { show: true, at: 20_000 };
    del(elementIdFor({ chartId: id, part: 'gantt.band', sub: 'today' }));
    expect(spec().today!.show).toBe(false);
  });

  it('switches weekend shading off', () => {
    const { slide, id, spec, del } = board();
    spec().shading = { weekends: { show: true } };
    del(elementIdFor({ chartId: id, part: 'gantt.band', sub: 'weekend', i: 0 }));
    expect(spec().shading!.weekends!.show).toBe(false);
  });

  it('switches row dividers off', () => {
    const { id, spec, del } = board();
    del(elementIdFor({ chartId: id, part: 'gantt.row', row: 'r1', sub: 'divider' }));
    expect(spec().ruler!.rows!.show).toBe(false);
  });

  it('REMOVES a description column, which exists only because someone added it', () => {
    const { id, spec, del } = board();
    del(elementIdFor({ chartId: id, part: 'gantt.column', column: 'col.owner', sub: 'header' }));
    expect(spec().columns.some((c) => c.key === 'col.owner')).toBe(false);
    // The rest of the table is untouched.
    expect(spec().columns.some((c) => c.key === 'col.task')).toBe(true);
  });
});

describe('clear formatting', () => {
  it('deletes the overrides rather than writing the brand’s current values', () => {
    const { slide, id, spec } = board();
    applyChartFormat(slide, [markId(id, 'r1', 'i1')], { fill: { kind: 'solid', color: RED } });
    spec().items[3]!.format = { fill: { kind: 'solid', color: RED } };
    spec().today = { show: true, at: 20_000, style: { color: RED } };

    expect(clearChartFormatting(spec())).toBe(true);
    expect(spec().rows.find((r) => r.key === 'r1')!.format).toBeUndefined();
    expect(spec().items[3]!.format).toBeUndefined();
    expect(spec().today!.style).toBeUndefined();
    // Content decisions survive a formatting reset.
    expect(spec().today!.show).toBe(true);
  });
});
