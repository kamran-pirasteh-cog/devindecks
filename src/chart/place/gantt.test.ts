import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  isGanttSpec,
  toEpochDay,
  type ChartInstance,
  type GanttSpec,
  type SlideElement,
} from '@/model';
import { metricMeasurer } from '@/render/measureText';
import { compileChart } from '../compile';
import { partsInReadingOrder } from '@/editor/chart/partOrder';

const spec = (): GanttSpec => {
  const s = defaultChartSpec('gantt');
  if (!isGanttSpec(s)) throw new Error('not a gantt');
  return s;
};

const chart = (mutate?: (s: GanttSpec) => void): ChartInstance => {
  const s = spec();
  mutate?.(s);
  return {
    id: 'ch1',
    groupId: 'g1',
    frame: { x: 914_400, y: 914_400, w: 7_315_200, h: 3_657_600 },
    spec: s,
  };
};


/**
 * The sample with every shape on it, and the chrome turned on.
 *
 * The DEFAULT sample is five plain bars and no rules, deliberately: a first
 * insert should look like the chart people came for rather than like a
 * catalogue of silhouettes. So the tests that are about the vocabulary build
 * one explicitly here instead of leaning on the sample to carry one of
 * everything — which is what tied them to a sample that was free to change.
 */
const rich = (mutate?: (s: GanttSpec) => void): ChartInstance =>
  chart((s) => {
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
      { key: 'i1', row: 'r1', from: d(0), to: d(21), shape: { form: 'bar' }, progress: 1 },
      { key: 'i2', row: 'r2', from: d(21), to: d(42), shape: { form: 'bar' }, progress: 0.4 },
      { key: 'i3', row: 'r3', from: d(42), to: d(126), shape: { form: 'chevron' } },
      { key: 'i4', row: 'r4', from: d(126), shape: { form: 'milestone', marker: 'diamond' } },
    ];
    s.columns = [
      { key: 'col.task', header: 'Workstream', side: 'left', order: 0, source: 'label' },
      { key: 'col.owner', header: 'Owner', side: 'left', order: 1, source: 'text' },
      { key: 'col.end', header: 'Due', side: 'right', order: 0, source: 'end', dateFormat: 'd MMM' },
    ];
    s.cells = {
      r0: { 'col.owner': 'AM' },
      r1: { 'col.owner': 'AM' },
      r2: { 'col.owner': 'JR' },
      r3: { 'col.owner': 'KP' },
      r4: { 'col.owner': 'KP' },
    };
    s.ruler = { rows: { show: true }, bands: { show: true } };
    mutate?.(s);
  });

const compile = (c: ChartInstance) => compileChart(c, DEFAULT_DESIGN_SYSTEM, metricMeasurer());
const els = (c: ChartInstance) => compile(c).elements;
const of = (e: SlideElement[], part: string) => e.filter((x) => x.chartRef?.part === part);

/** The string a text element actually renders. */
const said = (e: SlideElement | undefined): string =>
  e?.type === 'text' ? (e.body.paragraphs[0]?.runs[0]?.text ?? '') : '';

describe('the contract every chart keeps', () => {
  it('mints unique element ids', () => {
    // The assertion that catches the timescale tier collision: two header bands
    // both number their cells from zero, and `reconcileChartElements` diffs on
    // ids, so a collision would silently drop a whole band.
    const ids = els(chart()).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mints unique ids with two timescale bands and two lanes', () => {
    const ids = els(
      rich((s) => {
        s.items.push({
          key: 'x1',
          row: 'r3',
          from: toEpochDay(2026, 2, 20),
          to: toEpochDay(2026, 4, 1),
          shape: { form: 'bar' },
        });
        s.shading = { weekends: { show: true } };
        s.banding = { show: true };
      }),
    ).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is deterministic — no clock reaches the compiler', () => {
    // The today line is the one date a Gantt carries, and it is stamped by the
    // store. A `Date.now()` anywhere in this path would fail here.
    const c = chart((s) => (s.today = { show: true, at: toEpochDay(2026, 3, 2) }));
    expect(compile(c).elements).toEqual(compile(c).elements);
  });

  it('keeps everything inside the chart frame', () => {
    const c = chart();
    for (const e of els(c)) {
      expect(e.rect.x).toBeGreaterThanOrEqual(c.frame.x - 1);
      expect(e.rect.x + e.rect.w).toBeLessThanOrEqual(c.frame.x + c.frame.w + 1);
    }
  });

  it('tags every element with a chartRef so nothing is unaddressable', () => {
    expect(els(chart()).every((e) => !!e.chartRef)).toBe(true);
  });
});

describe('rows and bars', () => {
  it('draws one mark per item', () => {
    expect(of(els(chart()), 'mark')).toHaveLength(spec().items.length);
  });

  it('addresses a bar by row and item, so a row IS its series', () => {
    const mark = of(els(chart()), 'mark')[0]!;
    expect(mark.chartRef).toMatchObject({ part: 'mark', series: 'r0', point: 'i0' });
  });

  it('emits row-major, so a shift-range across two rows does not scramble', () => {
    // Load-bearing: `partsInReadingOrder` ranks a mark by the first-appearance
    // index of its point key, so emission order IS reading order.
    const parts = els(chart()).map((e) => ({ id: e.id, chartRef: e.chartRef }));
    const order = partsInReadingOrder(parts, 'mark');
    expect(order).toEqual([
      'ch1::mark.r0.i0',
      'ch1::mark.r1.i1',
      'ch1::mark.r2.i2',
      'ch1::mark.r3.i3',
      'ch1::mark.r4.i4',
    ]);
  });

  it('runs time left to right', () => {
    const marks = of(els(chart()), 'mark');
    const research = marks.find((m) => m.chartRef?.part === 'mark' && m.chartRef.point === 'i1')!;
    const build = marks.find((m) => m.chartRef?.part === 'mark' && m.chartRef.point === 'i3')!;
    expect(research.rect.x).toBeLessThan(build.rect.x);
  });

  it('stacks rows downward in spec order', () => {
    const marks = of(els(chart()), 'mark');
    const ys = marks.map((m) => m.rect.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
});

describe('the shape vocabulary', () => {
  const byPoint = (key: string) =>
    of(els(rich()), 'mark').find((m) => m.chartRef?.part === 'mark' && m.chartRef.point === key)!;

  it('draws a plain bar as a rect, so PowerPoint gets an autoshape', () => {
    expect(byPoint('i1').type).toBe('shape');
  });

  it('draws a chevron and a summary as paths — no new primitive needed', () => {
    expect(byPoint('i3').type).toBe('path');
    expect(byPoint('i0').type).toBe('path');
  });

  it('draws a milestone as a marker with no width to speak of', () => {
    const m = byPoint('i4');
    expect(m.type).toBe('shape');
    expect(m.rect.w).toBe(m.rect.h);
  });

  it('draws a bracket as a stroked path that can still be clicked', () => {
    const c = chart((s) => {
      s.items = [
        {
          key: 'b1',
          row: 'r0',
          from: toEpochDay(2026, 1, 5),
          to: toEpochDay(2026, 3, 1),
          shape: { form: 'bracket' },
        },
      ];
    });
    const m = of(els(c), 'mark')[0]!;
    expect(m.type).toBe('path');
    // A transparent fill, so the canvas has something to hit-test — an unfilled
    // path is a click-through.
    expect(m.type === 'path' && m.fill?.kind === 'solid' && m.fill.alpha).toBe(0);
  });

  it('draws a progress fill only when it says something', () => {
    const progress = (p: number | undefined) =>
      els(rich((s) => (s.items[1]!.progress = p))).filter((e) =>
        e.id.includes('progress.i1'),
      ).length;
    expect(progress(0.4)).toBe(1);
    // 0 has no progress to show, and 1 is already a full bar.
    expect(progress(0)).toBe(0);
    expect(progress(1)).toBe(0);
    expect(progress(undefined)).toBe(0);
  });

  it('rolls a summary up from its children when it names no span', () => {
    const c = rich((s) => {
      s.items[0] = { key: 'i0', row: 'r0', from: 0, shape: { form: 'summary' } };
    });
    const roll = of(els(c), 'mark').find(
      (m) => m.chartRef?.part === 'mark' && m.chartRef.point === 'i0',
    )!;
    const kids = of(els(c), 'mark').filter(
      (m) => m.chartRef?.part === 'mark' && ['i1', 'i2'].includes(m.chartRef.point),
    );
    const lo = Math.min(...kids.map((k) => k.rect.x));
    const hi = Math.max(...kids.map((k) => k.rect.x + k.rect.w));
    expect(roll.rect.x).toBeCloseTo(lo, -3);
    expect(roll.rect.x + roll.rect.w).toBeCloseTo(hi, -3);
  });
});

describe('the timescale', () => {
  it('stacks header bands and tags each with its tier', () => {
    const ticks = of(els(chart()), 'axis').filter(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.sub === 'tick',
    );
    const tiers = new Set(
      ticks.map((t) => (t.chartRef?.part === 'axis' ? t.chartRef.tier : undefined)),
    );
    expect(tiers.size).toBeGreaterThan(1);
    expect(tiers.has(0)).toBe(true);
  });

  it('drops a label that would overhang its neighbour rather than overlapping', () => {
    const wide = of(els(chart()), 'axis').length;
    const narrow = of(
      els({ ...chart(), frame: { x: 0, y: 0, w: 1_400_000, h: 3_000_000 } }),
      'axis',
    ).length;
    expect(narrow).toBeLessThan(wide);
  });

  it('never draws a today line off the end of the scale', () => {
    const away = chart((s) => (s.today = { show: true, at: toEpochDay(2035, 1, 1) }));
    // `deriveGantt` pulls a shown today line into the extent, so it is on the
    // axis rather than clipped off it — an invisible today line is a bug.
    const band = els(away).filter((e) => e.chartRef?.part === 'gantt.band');
    expect(band.length).toBeGreaterThan(0);
  });
});

describe('the description table', () => {
  it('draws a heading and a cell per visible row', () => {
    const cells = els(rich()).filter(
      (e) => e.chartRef?.part === 'gantt.column' && e.chartRef.sub === 'cell',
    );
    const heads = els(rich()).filter(
      (e) => e.chartRef?.part === 'gantt.column' && e.chartRef.sub === 'header',
    );
    expect(heads).toHaveLength(3);
    // Owner has a value on all five rows; the label column likewise.
    expect(cells.length).toBeGreaterThanOrEqual(10);
  });

  it('puts left columns before the plot and right columns after it', () => {
    const e = els(rich());
    const at = (key: string) =>
      e.find((x) => x.chartRef?.part === 'gantt.column' && x.chartRef.column === key)!.rect.x;
    const bar = of(e, 'mark')[0]!.rect.x;
    expect(at('col.task')).toBeLessThan(bar);
    expect(at('col.owner')).toBeLessThan(bar);
    expect(at('col.end')).toBeGreaterThan(bar);
  });

  it('indents a sub-row by an x offset, never by a text prefix', () => {
    const e = els(rich());
    const cell = (row: string) =>
      e.find(
        (x) =>
          x.chartRef?.part === 'gantt.column' &&
          x.chartRef.column === 'col.task' &&
          x.chartRef.row === row,
      )!;
    expect(cell('r1').rect.x).toBeGreaterThan(cell('r0').rect.x);
    expect(said(cell('r1'))).toBe('Research');
  });

  it('computes a derived column from the bars rather than from authored text', () => {
    const e = els(rich((s) => (s.items[3]!.to = toEpochDay(2026, 9, 30))));
    const due = e.find(
      (x) =>
        x.chartRef?.part === 'gantt.column' &&
        x.chartRef.column === 'col.end' &&
        x.chartRef.row === 'r3',
    )!;
    // Inclusive, as the sheet shows it: a task running to 30 Sep exclusive is
    // one an author calls "ends 29 Sep". The pattern is the column's own.
    expect(said(due)).toBe('29 Sep');
  });
});

describe('chrome', () => {
  it('draws weekend shading as runs, not as days', () => {
    const c = chart((s) => {
      s.shading = { weekends: { show: true } };
      s.timescale.min = toEpochDay(2026, 1, 5);
      s.timescale.max = toEpochDay(2026, 2, 2);
    });
    const bands = els(c).filter(
      (e) => e.chartRef?.part === 'gantt.band' && e.chartRef.sub === 'weekend',
    );
    // Four weekends in four weeks — one stripe each, not eight.
    expect(bands).toHaveLength(4);
  });

  it('runs a row divider across the table as well as the plot', () => {
    const e = els(rich());
    const divider = e.find(
      (x) => x.chartRef?.part === 'gantt.row' && x.chartRef.sub === 'divider',
    )!;
    const firstCol = e.find(
      (x) => x.chartRef?.part === 'gantt.column' && x.chartRef.column === 'col.task',
    )!;
    expect(divider.rect.x).toBeLessThanOrEqual(firstCol.rect.x);
  });

  it('draws no divider under the last row — that is a border', () => {
    const dividers = els(rich()).filter(
      (e) => e.chartRef?.part === 'gantt.row' && e.chartRef.sub === 'divider',
    );
    expect(dividers).toHaveLength(4);
  });

  it('draws dependency links with an arrowhead on the far end', () => {
    const c = rich((s) => (s.links = [{ id: 'l1', from: 'i1', to: 'i2' }]));
    const segs = els(c).filter((e) => e.id.includes('link.l1'));
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.some((seg) => seg.type === 'line' && seg.endArrow)).toBe(true);
  });
});

describe('collapse and hiding', () => {
  it('hides a collapsed group’s children but keeps the group', () => {
    const open = els(rich());
    const shut = els(rich((s) => (s.rows[0]!.collapsed = true)));
    expect(of(shut, 'mark').length).toBe(of(open, 'mark').length - 2);
    expect(
      of(shut, 'mark').some((m) => m.chartRef?.part === 'mark' && m.chartRef.series === 'r0'),
    ).toBe(true);
  });

  it('keeps a rolled-up summary spanning its children even when collapsed', () => {
    const c = rich((s) => {
      s.items[0] = { key: 'i0', row: 'r0', from: 0, shape: { form: 'summary' } };
      s.rows[0]!.collapsed = true;
    });
    const roll = of(els(c), 'mark').find(
      (m) => m.chartRef?.part === 'mark' && m.chartRef.point === 'i0',
    )!;
    // Read from the AUTHORED rows, so folding a group doesn't shrink the bar
    // that stands for it.
    expect(roll.rect.w).toBeGreaterThan(0);
  });

  it('draws nothing for a hidden item', () => {
    const c = chart((s) => (s.items[1]!.hidden = true));
    expect(of(els(c), 'mark')).toHaveLength(spec().items.length - 1);
  });
});

describe('colour', () => {
  it('takes an item’s own fill first, then its row’s, then the palette', () => {
    const fill = (c: ChartInstance, point: string) => {
      const m = of(els(c), 'mark').find(
        (x) => x.chartRef?.part === 'mark' && x.chartRef.point === point,
      )!;
      return m.type === 'shape' && m.fill?.kind === 'solid' ? m.fill.color : undefined;
    };
    const red = { kind: 'hex' as const, hex: '#ff0000' };
    const blue = { kind: 'hex' as const, hex: '#0000ff' };

    const rowOnly = chart((s) => (s.rows[1]!.format = { fill: { kind: 'solid', color: red } }));
    expect(fill(rowOnly, 'i1')).toEqual(red);

    const itemWins = chart((s) => {
      s.rows[1]!.format = { fill: { kind: 'solid', color: red } };
      s.items[1]!.format = { fill: { kind: 'solid', color: blue } };
    });
    expect(fill(itemWins, 'i1')).toEqual(blue);
  });
});

describe('labels', () => {
  const labelled = (mutate?: (s: GanttSpec) => void) =>
    els(
      rich((s) => {
        s.decorations.labels = {
          ...s.decorations.labels,
          show: true,
          content: { kind: 'seriesName' },
          placement: 'auto',
        };
        mutate?.(s);
      }),
    ).filter((e) => e.chartRef?.part === 'label');

  const said = (e: SlideElement | undefined): string =>
    e?.type === 'text' ? (e.body.paragraphs[0]?.runs[0]?.text ?? '') : '';

  it('does not shout a task name, whatever the brand does to data labels', () => {
    const l = labelled().find((e) => e.chartRef?.part === 'label' && e.chartRef.point === 'i1');
    expect(said(l)).toBe('Research');
  });

  it('keeps the brand’s setting for a duration, which is a number', () => {
    const l = labelled((s) => (s.decorations.labels.content = { kind: 'value' })).find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.point === 'i1',
    );
    expect(said(l)).toBe('21D');
  });

  it('puts a milestone’s label clear of its own diamond', () => {
    const l = labelled().find((e) => e.chartRef?.part === 'label' && e.chartRef.point === 'i4')!;
    const m = of(els(rich()), 'mark').find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.point === 'i4',
    )!;
    expect(l.rect.x).toBeGreaterThanOrEqual(m.rect.x + m.rect.w);
  });

  it('puts a label inside a wide bar and beside a narrow one', () => {
    const inside = labelled().find(
      (e) => e.chartRef?.part === 'label' && e.chartRef.point === 'i3',
    )!;
    const bar = of(els(rich()), 'mark').find(
      (e) => e.chartRef?.part === 'mark' && e.chartRef.point === 'i3',
    )!;
    // A label wider than its own bar is how a Gantt turns to soup, so `auto`
    // decides rather than obeying.
    expect(inside.rect.x).toBeGreaterThanOrEqual(bar.rect.x);
    expect(inside.rect.x + inside.rect.w).toBeLessThanOrEqual(bar.rect.x + bar.rect.w + 1);
  });
});
