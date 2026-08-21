/**
 * "How should this number be written?", on the right-click menu.
 *
 * The full set of controls lives in the part panel (`NumberFormatRows`), where
 * there is room for a custom pattern box. This is the same three questions
 * reached WHERE the pointer already is, which is how think-cell offers them:
 * right-click a data label, pick millions, done.
 *
 * The scope follows the selection, and follows the same rule the panel uses —
 * a selection of nothing but marks and labels formats THOSE labels (through
 * `labelHomeFor`, so three bars of one series write one series node and a
 * single bar writes a point override); anything else selected, including the
 * whole chart, is the chart's own format, which the axis and every unformatted
 * label read through.
 */
import {
  DEFAULT_NUMBER_FORMAT,
  type ChartRef,
  type NumberFormat,
  type NumberScale,
  type SlideElement,
} from '@/model';
import { labelHomeFor, labelSpecAt, patchLabelAt, soleChartOf } from '@/store/chartActions';
import { useEditor } from '@/store/editorStore';
import type { MenuItem } from './ContextMenu';

const PLACES: { value: NumberScale; label: string }[] = [
  { value: 'none', label: 'Units' },
  { value: 'auto', label: 'Auto' },
  { value: 'K', label: 'Thousands (K)' },
  { value: 'M', label: 'Millions (M)' },
  { value: 'B', label: 'Billions (B)' },
  { value: 'T', label: 'Trillions (T)' },
];

const STYLES: { value: NumberFormat['style']; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
];

/** Undefined is "auto" — resolved across the whole set, not per number. */
const DECIMALS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: 'Auto' },
  { value: 0, label: 'None' },
  { value: 1, label: 'One (0.0)' },
  { value: 2, label: 'Two (0.00)' },
  { value: 3, label: 'Three (0.000)' },
];

/**
 * A tick on the setting in force. The unchosen rows are padded to the same
 * width so the words below each other line up rather than stepping in and out.
 */
const mark = (on: boolean, label: string) => `${on ? '✓ ' : '  '}${label}`;

/** True when every part selected is a datum — the test for a label-scoped edit. */
const allData = (refs: ChartRef[]): boolean =>
  refs.length > 0 && refs.every((r) => r.part === 'mark' || r.part === 'label');

/**
 * The number-format submenus for a selection, or none when it isn't one chart's
 * worth of parts.
 */
export function numberFormatMenuItems(selected: SlideElement[]): MenuItem[] {
  const store = useEditor.getState;
  const slide = store().currentSlide();
  if (!slide) return [];

  const chart = soleChartOf(
    slide,
    selected.map((el) => el.id),
  );
  if (!chart) return [];

  const refs = selected.map((el) => el.chartRef).filter(Boolean) as ChartRef[];
  const home = allData(refs) ? labelHomeFor(chart.spec, refs) : null;
  const current =
    (home ? labelSpecAt(chart.spec, home).numberFormat : undefined) ??
    chart.spec.numberFormat ??
    DEFAULT_NUMBER_FORMAT;

  const apply = (patch: Partial<NumberFormat>) => {
    const next: NumberFormat = { ...current, ...patch };
    store().patchChart(chart.id, (draft) => {
      if (home) patchLabelAt(draft, home, { numberFormat: next });
      else draft.numberFormat = next;
    });
  };

  return [
    {
      label: 'Number place',
      items: PLACES.map((p) => ({
        label: mark((current.scale ?? 'none') === p.value, p.label),
        run: () => apply({ scale: p.value }),
      })),
    },
    {
      label: 'Decimals',
      items: DECIMALS.map((d) => ({
        label: mark(current.decimals === d.value, d.label),
        run: () => apply({ decimals: d.value }),
      })),
    },
    {
      label: 'Number format',
      items: STYLES.map((s) => ({
        label: mark(current.style === s.value, s.label),
        run: () => apply({ style: s.value }),
      })),
    },
  ];
}
