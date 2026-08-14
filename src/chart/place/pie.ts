/**
 * Pie and donut.
 *
 * Slices are `path` elements built from cubic arcs. A pie has no axes, so it
 * doesn't use the cartesian projector at all — it gets the whole plot rect and
 * centres itself in it.
 */
import { pointsToEmu, type PieSpec, type Rect } from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import type { ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { slicePath } from '../geom/path';
import { formatNumber } from '../format/number';
import { textStyle } from './cartesian';
import type { GridDerived } from '../derive/grid';

export interface PieInput {
  chartId: string;
  spec: PieSpec;
  derived: GridDerived;
  plot: Rect;
  theme: ChartTheme;
  measurer: TextMeasurer;
}

const TAU = Math.PI * 2;

/** Labels sit at this fraction of the radius when placed inside a slice. */
const INSIDE_R = 0.68;

export function placePie(input: PieInput): Mark[] {
  const { chartId, spec, derived, plot, theme, measurer } = input;
  const marks: Mark[] = [];

  // Only the first series has anywhere to go on a pie; the schema caps it at
  // one, and this is the belt to that braces.
  const values = derived.data
    .filter((d) => d.seriesIndex === 0)
    .sort((a, b) => a.pointIndex - b.pointIndex);
  const total = values.reduce((sum, d) => sum + Math.abs(d.value ?? 0), 0);
  if (total <= 0) return marks;

  const diameter = Math.min(plot.w, plot.h);
  const outerR = diameter / 2;
  const innerR = spec.kind === 'donut' ? outerR * ((spec.innerRadiusPct ?? 55) / 100) : 0;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const start = ((spec.startAngleDeg ?? 0) / 360) * TAU;

  const labels = spec.decorations.labels;
  // A slice label always sits ON its slice, so its ink is decided per slice
  // rather than once for the chart. The role without a colour is the shared
  // part; the colour is picked inside the loop.
  const labelRole = { ...theme.text.dataLabel, ...(labels.font ?? {}) };
  const labelH = lineHeightEmu(labelRole);
  const peers = values.map((d) => d.value ?? 0);

  let angle = start;
  for (const d of values) {
    const magnitude = Math.abs(d.value ?? 0);
    if (!magnitude) continue;
    const sweep = (magnitude / total) * TAU;
    const mid = angle + sweep / 2;

    // An exploded slice slides outward along its own bisector.
    const explode = spec.explode?.[d.pointKey] ?? 0;
    const offset = explode * outerR;
    const ox = cx + offset * Math.sin(mid);
    const oy = cy - offset * Math.cos(mid);

    const override = derived.series[0]?.pointOverrides?.[d.pointKey];
    const fill = override?.format?.fill;
    const color = fill?.kind === 'solid' ? fill.color : theme.seriesColor(d.pointIndex);

    if (!override?.hidden) {
      const path = slicePath(ox, oy, outerR, innerR, angle, angle + sweep);
      marks.push({
        kind: 'path',
        ref: { chartId, part: 'mark', series: d.seriesKey, point: d.pointKey },
        name: `${d.pointLabel}`,
        rect: path.box,
        d: path.d,
        fill: { kind: 'solid', color },
        outline: override?.format?.outline ?? derived.series[0]?.format?.outline,
      });
    }

    if (labels.show && !override?.hidden) {
      const share = magnitude / total;
      const text =
        labels.content.kind === 'percent'
          ? formatNumber(share, { ...spec.numberFormat, style: 'percent' }, { peers: [share] }).text
          : labels.content.kind === 'category'
            ? d.pointLabel
            : formatNumber(d.value ?? 0, spec.numberFormat, { peers }).text;

      const labelStyle = textStyle(
        { ...labelRole, color: labels.font?.color ?? theme.inkOn(color) },
        'center',
        'middle',
      );
      const w = measurer.measure(text, labelStyle).wEmu + pointsToEmu(2);
      // Ring segments centre their label in the ring; a wedge sits it out at
      // two thirds of the radius, where the slice is widest.
      const labelR = innerR > 0 ? (innerR + outerR) / 2 : outerR * INSIDE_R;
      const lx = ox + labelR * Math.sin(mid);
      const ly = oy - labelR * Math.cos(mid);

      // A sliver has no room for a number; suppressing it beats overlapping.
      const chord = 2 * labelR * Math.sin(sweep / 2);
      if (chord >= Math.max(w, labels.hideWhenSmaller ?? 0) || sweep > Math.PI / 6) {
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'label', series: d.seriesKey, point: d.pointKey },
          text,
          style: labelStyle,
          rect: { x: Math.round(lx - w / 2), y: Math.round(ly - labelH / 2), w, h: labelH },
        });
      }
    }

    angle += sweep;
  }

  return marks;
}
