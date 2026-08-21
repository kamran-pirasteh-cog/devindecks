/**
 * "How should these dates be written?", on the right-click menu.
 *
 * The sibling of `chartNumberMenu`, and for the same reason: the pointer is
 * already on the tick you want as "Jun-24" rather than "June 2024", and
 * think-cell offers the question there — a list of the forms a business chart
 * uses, plus a box for the one it doesn't.
 *
 * Only a DATED axis gets it. A category axis of product names has no periods to
 * re-write, and offering `MMM-yy` for "Public sector" would be a menu item that
 * does nothing. The grain is read off the labels themselves (`axisGrain`), so
 * the menu offers quarters to a quarterly axis and weeks to a weekly one.
 */
import {
  isButterflySpec,
  isGridSpec,
  isWaterfallSpec,
  type AxisId,
  type ChartRef,
  type ChartSpec,
  type DateGrain,
  type SlideElement,
} from '@/model';
import {
  DEFAULT_TICK_FORMAT,
  TICK_FORMAT_CHOICES,
  axisGrain,
  parseDatePattern,
  sampleTick,
} from '@/chart/format/dateAxis';
import { soleChartOf } from '@/store/chartActions';
import { useEditor } from '@/store/editorStore';
import type { MenuItem } from './ContextMenu';

/** A tick on the setting in force, padded so the words line up as in `chartNumberMenu`. */
const mark = (on: boolean, label: string) => `${on ? '✓ ' : '  '}${label}`;

/** The category labels an axis is drawn from, whatever shape the spec is. */
function categoryLabels(spec: ChartSpec): string[] {
  if (isGridSpec(spec)) return spec.data.categories.map((c) => c.label);
  if (isWaterfallSpec(spec)) return spec.data.items.map((i) => i.label);
  if (isButterflySpec(spec)) return spec.categories.map((c) => c.label);
  return [];
}

/**
 * The grain this chart's category axis is at, or null when it isn't dated —
 * the test both surfaces use to decide whether a date format is a question
 * worth asking. Shared so the menu and the part panel can't disagree about it.
 */
export const axisDateGrain = (spec: ChartSpec): DateGrain | null =>
  axisGrain(categoryLabels(spec));

/**
 * The date-format submenu for a selection, or none when the selection isn't the
 * ticks of one chart's dated category axis.
 */
export function dateFormatMenuItems(selected: SlideElement[]): MenuItem[] {
  const store = useEditor.getState;
  const slide = store().currentSlide();
  if (!slide) return [];

  const chart = soleChartOf(
    slide,
    selected.map((el) => el.id),
  );
  if (!chart) return [];

  const refs = selected.map((el) => el.chartRef).filter(Boolean) as ChartRef[];
  // The ticks, not the axis line and not the whole chart: this menu writes
  // `axes.x.dateFormat`, and it should appear on the thing that reads it.
  const axis = refs.find(
    (r): r is Extract<ChartRef, { part: 'axis' }> =>
      r.part === 'axis' && r.axis === 'x' && (r.sub === 'tick' || r.sub === 'title'),
  );
  if (!axis) return [];

  const grain = axisDateGrain(chart.spec);
  if (!grain) return [];

  const axisId: AxisId = axis.axis;
  const current = chart.spec.axes[axisId]?.dateFormat;
  const set = (dateFormat: string | undefined) =>
    store().patchChart(chart.id, (draft) => {
      const ax = draft.axes[axisId];
      if (ax) ax.dateFormat = dateFormat;
    });

  const house = DEFAULT_TICK_FORMAT[grain];
  const choices = TICK_FORMAT_CHOICES[grain];

  return [
    {
      label: 'Date format',
      items: [
        // Auto is the house form, and it is not the same as PINNING the house
        // form: an axis left on auto follows its grain when the data changes
        // from months to quarters.
        {
          label: mark(current === undefined, `Auto (${sampleTick(grain, house)})`),
          run: () => set(undefined),
        },
        ...choices
          .filter((p) => p !== house || current !== undefined)
          .map((p) => ({
            label: mark(current === p, sampleTick(grain, p)),
            run: () => set(p),
          })),
        {
          label: 'Custom',
          input: {
            value: current ?? '',
            // The spelling people arrive with. `parseDatePattern` accepts the
            // upper-cased year and day too, so this is an example and not a
            // rule they have to learn.
            placeholder: 'MMM-yy',
            valid: (raw: string) => parseDatePattern(raw) !== null,
            commit: (raw: string) => {
              const pattern = parseDatePattern(raw);
              if (pattern) set(pattern);
            },
          },
        },
      ],
    },
  ];
}
