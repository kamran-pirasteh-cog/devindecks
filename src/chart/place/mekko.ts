/**
 * Mekko (marimekko).
 *
 * A 100% stacked column chart whose columns are ALSO width-encoded, so the
 * area of every cell is meaningful. The width axis is the whole point: it's how
 * a market-share chart shows that a 60% share of a small segment is a smaller
 * business than a 20% share of a large one.
 */
import { pointsToEmu, type MekkoSpec } from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import { weightedBands } from '../scale/band';
import type { ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { MIN_MARK_EMU, rectFromEdges } from '../mark';
import type { GridDerived } from '../derive/grid';
import { formatNumber } from '../format/number';
import type { Projector } from './cartesian';
import { textStyle } from './cartesian';

export interface MekkoInput {
  chartId: string;
  spec: MekkoSpec;
  derived: GridDerived;
  proj: Projector;
  theme: ChartTheme;
  measurer: TextMeasurer;
}

/** Column weights: explicit if given, else each column's own total. */
export function mekkoWeights(spec: MekkoSpec, derived: GridDerived): number[] {
  const width = spec.width;
  if (width.mode === 'explicit' && width.values.length) {
    return derived.categoryLabels.map((_, i) => width.values[i] ?? 0);
  }
  return derived.totals.map((t) => Math.abs(t));
}

export function mekkoCenters(spec: MekkoSpec, derived: GridDerived): number[] {
  return weightedBands(mekkoWeights(spec, derived)).map((b) => b.start + b.width / 2);
}

export function placeMekko(input: MekkoInput): Mark[] {
  const { chartId, spec, derived, proj, theme, measurer } = input;
  const bands = weightedBands(mekkoWeights(spec, derived));
  const marks: Mark[] = [];
  const labels = spec.decorations.labels;

  // Every Mekko label sits inside its own cell, so ink is per-cell.
  const labelRole = { ...theme.text.dataLabel, ...(labels.font ?? {}) };
  const labelH = lineHeightEmu(labelRole);

  for (const d of derived.data) {
    if (d.value === null) continue;
    const band = bands[d.pointIndex];
    if (!band || band.width <= 0) continue;

    const override = derived.series[d.seriesIndex]?.pointOverrides?.[d.pointKey];
    if (override?.hidden) continue;

    const x0 = proj.category(band.start);
    const x1 = proj.category(band.start + band.width);
    const y0 = proj.value(d.base);
    const y1 = proj.value(d.top);
    const rect = rectFromEdges(x0, y0, x1, y1);
    rect.h = Math.max(rect.h, MIN_MARK_EMU);

    const fill = override?.format?.fill ?? derived.series[d.seriesIndex]?.format?.fill;
    const cellColor = fill?.kind === 'solid' ? fill.color : theme.seriesColor(d.seriesIndex);
    marks.push({
      kind: 'rect',
      ref: { chartId, part: 'mark', series: d.seriesKey, point: d.pointKey },
      name: `${d.seriesName} · ${d.pointLabel}`,
      rect,
      fill:
        fill?.kind === 'solid'
          ? fill
          : { kind: 'solid', color: theme.seriesColor(d.seriesIndex) },
      outline: { color: theme.gridline, widthEmu: pointsToEmu(0.75), dash: 'solid' },
    });

    if (labels.show) {
      const share = d.share ?? 0;
      const text = formatNumber(share, { ...spec.numberFormat, style: 'percent' }, { peers: [share] })
        .text;
      const labelStyle = textStyle(
        { ...labelRole, color: labels.font?.color ?? theme.inkOn(cellColor) },
        'center',
        'middle',
      );
      const w = measurer.measure(text, labelStyle).wEmu + pointsToEmu(2);
      // A Mekko cell can be too NARROW as well as too short, since its width
      // carries meaning — check both before drawing a label into it.
      if (rect.w >= w && rect.h >= labelH) {
        marks.push({
          kind: 'text',
          ref: { chartId, part: 'label', series: d.seriesKey, point: d.pointKey },
          text,
          style: labelStyle,
          rect: {
            x: Math.round(rect.x + (rect.w - w) / 2),
            y: Math.round(rect.y + (rect.h - labelH) / 2),
            w,
            h: labelH,
          },
        });
      }
    }
  }

  return marks;
}
