import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultChartSpec,
  inchesToEmu,
  type ColumnBarSpec,
  type Deck,
  type Slide,
} from '@/model';
import { loadDeck, useEditor } from '@/store/editorStore';
import { dateFormatMenuItems } from './chartDateMenu';
import type { MenuItem } from './ContextMenu';

const slide = (id: string): Slide => ({ id, elements: [] });

function deck(): Deck {
  return {
    id: 'd1',
    title: 'T',
    slideSize: { w: 12_192_000, h: 6_858_000 },
    slides: [slide('s1')],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const s = () => useEditor.getState();

/** A column chart on the slide, with the category labels a test wants. */
function chartWith(labels: string[]): void {
  const spec = defaultChartSpec('column', 'clustered') as ColumnBarSpec;
  spec.data.categories = labels.map((label, i) => ({ key: `c${i}`, label }));
  spec.data.series = [
    { key: 's0', name: 'Revenue', values: labels.map((_, i) => i + 1) },
  ];
  s().insertChart(spec, {
    x: inchesToEmu(1),
    y: inchesToEmu(1),
    w: inchesToEmu(6),
    h: inchesToEmu(3),
  });
}

/** The elements of the chart's x-axis ticks — what a right-click lands on. */
const tickIds = (): string[] => {
  const sl = s().currentSlide()!;
  return sl.elements
    .filter(
      (el) =>
        el.chartRef?.part === 'axis' && el.chartRef.axis === 'x' && el.chartRef.sub === 'tick',
    )
    .map((el) => el.id);
};

const selectedEls = (ids: string[]) =>
  s().currentSlide()!.elements.filter((el) => ids.includes(el.id));

const menu = (ids: string[]) => dateFormatMenuItems(selectedEls(ids));
const childLabels = (items: MenuItem[]) => items[0]?.items?.map((i) => i.label) ?? [];
const axisFormat = () => s().currentSlide()!.charts![0].spec.axes.x.dateFormat;

describe('date format menu', () => {
  beforeEach(() => {
    loadDeck(deck());
  });

  it('offers the forms for the axis grain, house form first and ticked', () => {
    chartWith(['Q1 2025', 'Q2 2025', 'Q3 2025']);
    const items = menu(tickIds());
    expect(items.map((i) => i.label)).toEqual(['Date format']);
    expect(childLabels(items)).toEqual([
      '✓ Auto (2Q25)',
      "  Q2 '25",
      '  Q2 2025',
      'Custom',
    ]);
  });

  it('writes the pattern the author picks, and takes it back off', () => {
    chartWith(['Q1 2025', 'Q2 2025', 'Q3 2025']);
    const pick = (label: string) =>
      menu(tickIds())[0].items!.find((i) => i.label.trim() === label)!.run!();

    pick('Q2 2025');
    expect(axisFormat()).toBe("'Q'Q yyyy");
    // The ticks are re-drawn from the new pattern, not just recorded.
    const drawn = selectedEls(tickIds()).map(
      (el) => (el as { body: { paragraphs: { runs: { text: string }[] }[] } }).body
        .paragraphs[0].runs[0].text,
    );
    expect(drawn).toEqual(['Q1 2025', 'Q2 2025', 'Q3 2025']);

    pick('Auto (2Q25)');
    expect(axisFormat()).toBeUndefined();
  });

  it('takes a custom pattern in the spelling people type it', () => {
    chartWith(['Jan 2025', 'Feb 2025', 'Mar 2025']);
    const custom = menu(tickIds())[0].items!.find((i) => i.label === 'Custom')!;
    expect(custom.input!.valid!('MMM-YY')).toBe(true);
    expect(custom.input!.valid!('Week')).toBe(false);
    custom.input!.commit('MMM-YY');
    expect(axisFormat()).toBe('MMM-yy');
  });

  it('stays away from an axis that isn\'t dated, and from parts that aren\'t ticks', () => {
    chartWith(['North', 'South', 'East']);
    expect(menu(tickIds())).toEqual([]);

    loadDeck(deck());
    chartWith(['Q1 2025', 'Q2 2025', 'Q3 2025']);
    const bars = s()
      .currentSlide()!
      .elements.filter((el) => el.chartRef?.part === 'mark')
      .map((el) => el.id);
    expect(menu(bars)).toEqual([]);
  });
});
