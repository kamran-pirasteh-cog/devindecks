'use client';

/**
 * A live chart preview, compiled by the real engine.
 *
 * Shared by the conventions panel and the variant editor so the two can never
 * disagree about what a style does. The style being previewed is whatever sits
 * on `ds.chart` — callers previewing a variant pass a design system with the
 * resolved style already merged in, which is what `dsForChartKind` returns.
 */
import { useMemo } from 'react';
import { FitSlideView } from '@/render/FitSlideView';
import {
  applyPreviewData,
  defaultChartSpec,
  inchesToEmu,
  SLIDE_16x9,
  token,
  type ChartKind,
  type DesignSystem,
  type StackMode,
} from '@/model';
import { compileChart } from '@/chart/compile';

export interface PreviewChart {
  kind: ChartKind;
  stack?: StackMode;
  title?: string;
}

export function ChartStylePreview({
  ds,
  charts,
  className = '',
}: {
  ds: DesignSystem;
  charts: PreviewChart[];
  className?: string;
}) {
  const slide = useMemo(() => {
    const size = { w: SLIDE_16x9.w, h: SLIDE_16x9.h };
    const n = Math.max(1, charts.length);
    const margin = inchesToEmu(0.4);
    const gutter = inchesToEmu(0.2);
    const width = Math.round((size.w - margin * 2 - gutter * (n - 1)) / n);

    return {
      id: 'chart-style-preview',
      background: { kind: 'solid' as const, color: token('surface.base') },
      elements: charts.flatMap((c, i) => {
        // Built from the style being edited, not from the house defaults:
        // legend, data labels, gaps and number format are pinned onto a spec at
        // creation and beat the design system afterwards, so a preview built
        // without them can't show what those four controls do.
        //
        // The brand's own dummy data, where it has any — a style is judged
        // against the shape of data it will actually carry, and three years by
        // three segments is the wrong shape for a brand that charts quarters.
        const spec = applyPreviewData(
          defaultChartSpec(c.kind, c.stack ?? 'clustered', ds.chart),
          ds.previewData,
        );
        if (c.title) spec.title = c.title;
        return compileChart(
          {
            id: `p-${c.kind}-${i}`,
            groupId: `pg-${c.kind}-${i}`,
            frame: {
              x: margin + i * (width + gutter),
              y: inchesToEmu(0.5),
              w: width,
              h: size.h - inchesToEmu(1),
            },
            spec,
          },
          ds,
        ).elements;
      }),
    };
  }, [ds, charts]);

  return (
    <div className={`overflow-hidden rounded-md ring-1 ring-black/10 ${className}`}>
      <FitSlideView
        slide={slide}
        slideSize={{ w: SLIDE_16x9.w, h: SLIDE_16x9.h }}
        designSystem={ds}
      />
    </div>
  );
}
