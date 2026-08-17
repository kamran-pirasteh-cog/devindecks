/**
 * Scatter and bubble.
 *
 * The only charts here with two value axes, so they bring their own projector
 * rather than using the category one.
 */
import { pointsToEmu, type BubbleSpec, type Rect, type ScatterSpec } from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import type { LinearScale } from '../scale/linear';
import type { ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { labelRole, labelSpecFor } from './labelSpec';
import { textStyle } from './cartesian';

export type XYSpecAny = ScatterSpec | BubbleSpec;

export interface XYInput {
  chartId: string;
  spec: XYSpecAny;
  plot: Rect;
  xScale: LinearScale;
  yScale: LinearScale;
  theme: ChartTheme;
  measurer: TextMeasurer;
}

/** Default marker diameter when a series doesn't specify one. */
const DEFAULT_MARKER = pointsToEmu(7);

export function placeXY(input: XYInput): Mark[] {
  const { chartId, spec, plot, xScale, yScale, theme, measurer } = input;
  const marks: Mark[] = [];

  const px = (x: number) => plot.x + plot.w * xScale.norm(x);
  const py = (y: number) => plot.y + plot.h * (1 - yScale.norm(y));

  const sizes = spec.kind === 'bubble' ? spec.data.series.flatMap((s) => s.points.map((p) => p.size ?? 0)) : [];
  const maxSize = Math.max(1, ...sizes);

  const chartLabels = spec.decorations.labels;

  spec.data.series.forEach((s, si) => {
    const color =
      s.format?.fill?.kind === 'solid' ? s.format.fill.color : theme.seriesColor(si);
    const shape = s.format?.marker?.shape ?? 'circle';

    for (const p of s.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const override = s.pointOverrides?.[p.key];
      if (override?.hidden) continue;

      let diameter = s.format?.marker?.sizeEmu ?? DEFAULT_MARKER;
      if (spec.kind === 'bubble') {
        const value = Math.max(0, p.size ?? 0);
        // Area encoding by default: a bubble twice the VALUE should look twice
        // as big, and people read area, not radius. Diameter scaling makes a
        // 2x value look 4x, which systematically overstates large points.
        const t = maxSize > 0 ? value / maxSize : 0;
        const factor = spec.sizeScale.mode === 'area' ? Math.sqrt(t) : t;
        diameter = Math.max(pointsToEmu(2), spec.sizeScale.maxDiameterEmu * factor);
      }

      const cx = px(p.x);
      const cy = py(p.y);
      marks.push({
        kind: 'marker',
        ref: { chartId, part: 'mark', series: s.key, point: p.key },
        name: p.label ? `${s.name} · ${p.label}` : s.name,
        shape: shape === 'none' ? 'circle' : shape,
        rect: {
          x: Math.round(cx - diameter / 2),
          y: Math.round(cy - diameter / 2),
          w: Math.round(diameter),
          h: Math.round(diameter),
        },
        // Bubbles overlap by nature, so they're translucent; a scatter marker
        // is solid.
        fill: { kind: 'solid', color, ...(spec.kind === 'bubble' ? { alpha: 0.75 } : {}) },
        outline: s.format?.marker?.outline,
      });

      // Chart < series < point, so restyling one point's label on the canvas —
      // which writes a point override — reaches the mark it was aimed at.
      const label = labelSpecFor(chartLabels, s.labels, override?.label);

      if (label.show && p.label) {
        const style = textStyle(
          { ...labelRole(theme, label.font), color: label.font?.color ?? theme.text.dataLabel.color },
          'left',
          'middle',
        );
        const w = measurer.measure(p.label, style).wEmu + pointsToEmu(2);
        const h = lineHeightEmu(style);
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'label', series: s.key, point: p.key },
          text: p.label,
          style,
          rect: {
            x: Math.round(cx + diameter / 2 + theme.sizes.labelGapEmu),
            y: Math.round(cy - h / 2),
            w,
            h,
          },
        });
      }
    }
  });

  return marks;
}
