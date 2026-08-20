import { describe, expect, it } from 'vitest';
import {
  defaultChartSpec,
  isGridSpec,
  type ChartRef,
  type ChartSpec,
  type ColumnBarSpec,
  type LineSpec,
  type WaterfallSpec,
} from '@/model';
import { DEFAULT_DESIGN_SYSTEM } from '@/model';
import { findTextDeco, partFontOf, resolvedType } from './partFont';

const column = (mutate: (s: ColumnBarSpec) => void = () => {}): ColumnBarSpec => {
  const spec = defaultChartSpec('column', 'stacked') as ColumnBarSpec;
  mutate(spec);
  return spec;
};

/** Apply a patch the way both surfaces do, and hand back the mutated spec. */
const patched = (spec: ChartSpec, refs: ChartRef[], patch: Parameters<
  NonNullable<ReturnType<typeof partFontOf>>['apply']
>[1]): ChartSpec => {
  const target = partFontOf(spec, refs);
  if (!target) throw new Error('no font target');
  const draft = structuredClone(spec);
  target.apply(draft, patch);
  return draft;
};

const seriesOf = (spec: ChartSpec, key: string) =>
  isGridSpec(spec) ? spec.data.series.find((s) => s.key === key) : undefined;

describe('partFontOf — which node a type edit lands on', () => {
  it('files a whole series’ labels on the series, and clears the point overrides it would shadow', () => {
    const spec = column((s) => {
      s.decorations.labels = { ...s.decorations.labels, show: true };
      s.data.series[0].pointOverrides = {
        [s.data.categories[0].key]: { label: { ...s.decorations.labels, show: true } },
      };
    });
    const key = spec.data.series[0].key;
    const refs: ChartRef[] = spec.data.categories.map((c) => ({
      chartId: 'c1',
      part: 'label',
      series: key,
      point: c.key,
    }));

    const out = patched(spec, refs, { sizePt: 14 });
    expect(seriesOf(out, key)?.labels?.font?.sizePt).toBe(14);
    expect(seriesOf(out, key)?.pointOverrides?.[spec.data.categories[0].key]?.label).toBeUndefined();
  });

  it('files one selected label on that point alone', () => {
    const spec = column((s) => {
      s.decorations.labels = { ...s.decorations.labels, show: true };
    });
    const key = spec.data.series[0].key;
    const point = spec.data.categories[1].key;
    const out = patched(spec, [{ chartId: 'c1', part: 'label', series: key, point }], {
      bold: true,
    });
    expect(seriesOf(out, key)?.pointOverrides?.[point]?.label?.font?.bold).toBe(true);
    expect(seriesOf(out, key)?.labels?.font).toBeUndefined();
  });

  it('refuses a selection spanning two series — there is no single node to write', () => {
    const spec = column((s) => {
      s.decorations.labels = { ...s.decorations.labels, show: true };
    });
    const point = spec.data.categories[0].key;
    expect(
      partFontOf(spec, [
        { chartId: 'c1', part: 'label', series: spec.data.series[0].key, point },
        { chartId: 'c1', part: 'label', series: spec.data.series[1].key, point },
      ]),
    ).toBeNull();
  });

  it('offers nothing for a bar whose labels are off — the control would move nothing', () => {
    const spec = column((s) => {
      s.decorations.labels = { ...s.decorations.labels, show: false };
    });
    expect(
      partFontOf(spec, [
        {
          chartId: 'c1',
          part: 'mark',
          series: spec.data.series[0].key,
          point: spec.data.categories[0].key,
        },
      ]),
    ).toBeNull();
  });

  it('sends a line’s end label to the series, since `pointOverrides.end` is read by nobody', () => {
    const spec = defaultChartSpec('line') as LineSpec;
    spec.endLabels = true;
    const key = spec.data.series[0].key;
    const out = patched(spec, [{ chartId: 'c1', part: 'label', series: key, point: 'end' }], {
      sizePt: 12,
    });
    expect(seriesOf(out, key)?.labels?.font?.sizePt).toBe(12);
    expect(seriesOf(out, key)?.pointOverrides?.end).toBeUndefined();
  });

  it('offers a line’s end label even with per-point labels off, because that flag isn’t what draws it', () => {
    const spec = defaultChartSpec('line') as LineSpec;
    spec.endLabels = true;
    spec.decorations.labels = { ...spec.decorations.labels, show: false };
    const target = partFontOf(spec, [
      {
        chartId: 'c1',
        part: 'mark',
        series: spec.data.series[0].key,
        point: spec.data.categories[0].key,
      },
    ]);
    expect(target?.name).toBe('Series name');
  });

  it('routes the axis numbers, the legend and the title to their own nodes', () => {
    const spec = column();
    const axis = patched(spec, [{ chartId: 'c1', part: 'axis', axis: 'y', sub: 'tick' }], {
      sizePt: 9,
    });
    expect(axis.axes.y?.font?.sizePt).toBe(9);

    const legend = patched(spec, [{ chartId: 'c1', part: 'legend.box' }], { bold: true });
    expect(legend.legend.font?.bold).toBe(true);

    const title = patched(spec, [{ chartId: 'c1', part: 'title' }], { sizePt: 18 });
    expect(title.titleFont?.sizePt).toBe(18);
  });

  it('gives the axis rule and the gridlines no type at all', () => {
    const spec = column();
    expect(partFontOf(spec, [{ chartId: 'c1', part: 'axis', axis: 'y', sub: 'line' }])).toBeNull();
    expect(partFontOf(spec, [{ chartId: 'c1', part: 'axis', axis: 'y', sub: 'grid' }])).toBeNull();
    expect(partFontOf(spec, [{ chartId: 'c1', part: 'plot' }])).toBeNull();
  });

  it('finds a bracket’s arm and a callout’s leader back to the node they belong to', () => {
    const spec = column((s) => {
      s.decorations.annotations = [
        {
          id: 'a1',
          anchor: { at: 'point', series: s.data.series[0].key, point: s.data.categories[0].key },
          text: 'Peak',
          offset: { dx: 0, dy: 0 },
        },
      ];
      s.decorations.differences = [
        {
          id: 'd1',
          from: { at: 'point', series: s.data.series[0].key, point: s.data.categories[0].key },
          to: { at: 'point', series: s.data.series[0].key, point: s.data.categories[1].key },
          mode: 'absolute',
          bracket: true,
        },
      ];
    });
    expect(findTextDeco(spec, 'a1-lead')?.kind).toBe('annotation');
    expect(findTextDeco(spec, 'd1-l')?.kind).toBe('difference');

    const out = patched(spec, [{ chartId: 'c1', part: 'decoration', decoId: 'd1-t' }], {
      sizePt: 16,
    });
    expect(out.decorations.differences[0].font?.sizePt).toBe(16);
  });

  it('merges onto the font already there rather than replacing it', () => {
    const spec = column();
    const once = patched(spec, [{ chartId: 'c1', part: 'title' }], { sizePt: 18 });
    const twice = patched(once, [{ chartId: 'c1', part: 'title' }], { bold: true });
    expect(twice.titleFont).toMatchObject({ sizePt: 18, bold: true });
  });

  it('files a waterfall label on its ITEM, since a waterfall has no series to hang it on', () => {
    // The kind in the screenshot that started this: a waterfall's label had no
    // type controls at all, because a series lookup came back empty.
    const spec = defaultChartSpec('waterfall') as WaterfallSpec;
    const first = spec.data.items[0].key;
    const target = partFontOf(spec, [
      { chartId: 'c1', part: 'label', series: 's0', point: first },
    ]);
    expect(target?.name).toBe('Data label');

    const out = patched(spec, [{ chartId: 'c1', part: 'label', series: 's0', point: first }], {
      sizePt: 16,
      bold: true,
    }) as WaterfallSpec;
    expect(out.data.items[0].labels?.font).toMatchObject({ sizePt: 16, bold: true });
    // The one bar the user clicked, not all five.
    expect(out.data.items[1].labels?.font).toBeUndefined();
    expect(out.decorations.labels.font).toBeUndefined();
  });

  it('reads a waterfall item’s own type back, so the bar shows what is on screen', () => {
    const spec = defaultChartSpec('waterfall') as WaterfallSpec;
    const key = spec.data.items[2].key;
    spec.data.items[2].labels = { ...spec.decorations.labels, font: { sizePt: 11 } };
    expect(
      partFontOf(spec, [{ chartId: 'c1', part: 'label', series: 's0', point: key }])?.font,
    ).toEqual({ sizePt: 11 });
  });

  it('reports the face and size a part is actually drawn in, not the word "inherited"', () => {
    // The roles differ per part — the ticks are mono, the legend is sans — so a
    // panel showing "Brand" for an unset override answers nothing.
    const spec = column((s) => {
      s.decorations.labels = { ...s.decorations.labels, show: true };
    });
    const tick = partFontOf(spec, [{ chartId: 'c1', part: 'axis', axis: 'y', sub: 'tick' }])!;
    const legend = partFontOf(spec, [{ chartId: 'c1', part: 'legend.box' }])!;
    expect(tick.font).toBeUndefined();
    expect(resolvedType(spec, DEFAULT_DESIGN_SYSTEM, tick)).toMatchObject({ font: 'Geist Mono' });
    expect(resolvedType(spec, DEFAULT_DESIGN_SYSTEM, legend)).toMatchObject({ font: 'Geist' });
  });

  it('lets an override win over the role it falls through to', () => {
    const spec = column();
    const withFace = patched(spec, [{ chartId: 'c1', part: 'title' }], {
      font: 'Source Serif 4',
      sizePt: 18,
    });
    const target = partFontOf(withFace, [{ chartId: 'c1', part: 'title' }])!;
    expect(resolvedType(withFace, DEFAULT_DESIGN_SYSTEM, target)).toMatchObject({
      font: 'Source Serif 4',
      sizePt: 18,
    });
  });

  it('resolves italic, so the toolbar can show it pressed', () => {
    // No override and no italic in the brand's role: the button reads as off,
    // rather than as undefined — which a `ToggleButton` would render as off
    // anyway, but only by accident.
    const spec = column((s) => {
      s.decorations.labels = { ...s.decorations.labels, show: true };
    });
    const plain = partFontOf(spec, [{ chartId: 'c1', part: 'title' }])!;
    expect(resolvedType(spec, DEFAULT_DESIGN_SYSTEM, plain).italic).toBe(false);

    const italicised = patched(spec, [{ chartId: 'c1', part: 'title' }], { italic: true });
    const target = partFontOf(italicised, [{ chartId: 'c1', part: 'title' }])!;
    expect(resolvedType(italicised, DEFAULT_DESIGN_SYSTEM, target).italic).toBe(true);
  });

  it('resolves bold and italic independently', () => {
    const spec = column();
    const both = patched(spec, [{ chartId: 'c1', part: 'title' }], { bold: true, italic: true });
    const target = partFontOf(both, [{ chartId: 'c1', part: 'title' }])!;
    expect(resolvedType(both, DEFAULT_DESIGN_SYSTEM, target)).toMatchObject({
      bold: true,
      italic: true,
    });
  });

  it('has nothing to say about an empty selection — the whole chart, not a part', () => {
    expect(partFontOf(column(), [])).toBeNull();
  });
});
