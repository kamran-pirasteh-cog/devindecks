import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  elementIdFor,
  inchesToEmu,
  type ColumnBarSpec,
  type Deck,
  type SlideElement,
} from '@/model';
import { loadDeck, useEditor } from '@/store/editorStore';
import { recompileInto } from '@/store/chartActions';
import { numberFormatMenuItems } from './chartNumberMenu';
import type { MenuItem } from './ContextMenu';

const CHART = 'ch1';

function chartDeck(): Deck {
  const spec = defaultChartSpec('column', 'clustered') as ColumnBarSpec;
  spec.data.categories = [
    { key: 'c0', label: 'FY24' },
    { key: 'c1', label: 'FY25' },
  ];
  spec.data.series = [{ key: 's0', name: 'Revenue', values: [1_200_000, 1_400_000] }];
  spec.decorations.labels.show = true;

  const slide = {
    id: 's1',
    elements: [] as SlideElement[],
    charts: [
      {
        id: CHART,
        groupId: 'g1',
        frame: { x: 0, y: 0, w: inchesToEmu(6), h: inchesToEmu(4) },
        spec,
      },
    ],
  };
  // Compile so the slide carries the label and axis elements the menu reads.
  recompileInto(slide, CHART, DEFAULT_DESIGN_SYSTEM);

  return {
    id: 'd1',
    title: 'T',
    slideSize: { w: 12_192_000, h: 6_858_000 },
    slides: [slide],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  } as Deck;
}

const s = () => useEditor.getState();
const slide = () => s().deck.slides[0]!;
const spec = () => slide().charts![0]!.spec as ColumnBarSpec;
const els = (ids: string[]) => slide().elements.filter((e) => ids.includes(e.id));

const labelEl = (point: string) =>
  els([elementIdFor({ chartId: CHART, part: 'label', series: 's0', point })]);
const everything = () => slide().elements.filter((e) => e.chartRef?.chartId === CHART);

/** Run the child whose label ends in `word` under the submenu `parent`. */
function pick(items: MenuItem[], parent: string, word: string) {
  const menu = items.find((i) => i.label === parent);
  if (!menu?.items) throw new Error(`no submenu ${parent}`);
  const child = menu.items.find((i) => i.label.includes(word));
  if (!child?.run) throw new Error(`no item ${word} under ${parent}`);
  child.run();
}

describe('chart number-format menu', () => {
  beforeEach(() => loadDeck(chartDeck(), DEFAULT_DESIGN_SYSTEM));

  it('offers nothing for a selection that isn\'t a chart', () => {
    expect(numberFormatMenuItems([])).toEqual([]);
  });

  it('offers the three questions over a chart part', () => {
    expect(numberFormatMenuItems(labelEl('c0')).map((i) => i.label)).toEqual([
      'Number place',
      'Decimals',
      'Number format',
    ]);
  });

  it('writes ONE label when one label is selected', () => {
    pick(numberFormatMenuItems(labelEl('c0')), 'Number place', 'Millions');
    pick(numberFormatMenuItems(labelEl('c0')), 'Decimals', 'One');

    const overrides = spec().data.series[0]!.pointOverrides!;
    expect(overrides.c0!.label!.numberFormat).toMatchObject({ scale: 'M', decimals: 1 });
    // The neighbour and the chart are untouched — that is the whole point of
    // formatting one label.
    expect(overrides.c1).toBeUndefined();
    expect(spec().numberFormat.scale ?? 'none').toBe('none');
  });

  it('writes the chart when the whole chart is selected', () => {
    pick(numberFormatMenuItems(everything()), 'Number format', 'Currency');

    expect(spec().numberFormat.style).toBe('currency');
    expect(spec().data.series[0]!.pointOverrides).toBeUndefined();
  });

  it('ticks the setting in force, read from the label its own node', () => {
    pick(numberFormatMenuItems(labelEl('c0')), 'Number place', 'Millions');

    const place = numberFormatMenuItems(labelEl('c0')).find((i) => i.label === 'Number place');
    expect(place!.items!.find((i) => i.label.startsWith('✓'))!.label).toContain('Millions');
    // …and its neighbour still reads the chart's.
    const other = numberFormatMenuItems(labelEl('c1')).find((i) => i.label === 'Number place');
    expect(other!.items!.find((i) => i.label.startsWith('✓'))!.label).toContain('Units');
  });
});
