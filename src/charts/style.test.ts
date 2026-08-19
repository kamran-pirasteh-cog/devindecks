import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHART_STYLE,
  DEFAULT_DESIGN_SYSTEM,
  isGridSpec,
  withChartStyleDefaults,
  type ChartStyle,
} from '@/model';
import { CHART_TEMPLATES } from './registry';
import { chartStyleFor, dsForChartTemplate } from './style';

const brand = (over: Partial<ChartStyle>): ChartStyle => ({ ...DEFAULT_CHART_STYLE, ...over });

describe('built-in chart templates', () => {
  it('build from the brand style rather than the house defaults', () => {
    // The four controls Admin labels "defaults for new charts" are pinned onto
    // a spec the moment it's built, and pinned values beat the design system
    // at compile time — so building without the brand is what made those
    // controls look inert on the template grid.
    const style = brand({
      legend: { show: true, position: 'top' },
      gaps: { categoryGapPct: 120, seriesOverlapPct: 40 },
      numberFormats: {
        ...DEFAULT_CHART_STYLE.numberFormats,
        value: { style: 'percent', thousands: false, scale: 'none', negative: 'parens' },
      },
    });

    for (const t of CHART_TEMPLATES) {
      const spec = t.buildSpec(style);
      // Templates that deliberately hide their legend keep doing so; the point
      // is that the ones which don't take the brand's position.
      if (spec.legend.show) expect(spec.legend.position).toBe('top');
      if (isGridSpec(spec) && 'gapWidthPct' in spec) {
        expect(spec.gapWidthPct).toBe(120);
      }
    }
  });

  it('leave a template that sets its own number format alone', () => {
    const spec = CHART_TEMPLATES.find((t) => t.id === 'chart.revenue-waterfall')!.buildSpec(
      brand({ numberFormats: { ...DEFAULT_CHART_STYLE.numberFormats, value: { style: 'percent' } } }),
    );
    expect(spec.numberFormat.style).toBe('currency');
  });

  it('take the brand series palette rather than hardcoding one', () => {
    for (const t of CHART_TEMPLATES) {
      expect(t.buildSpec(DEFAULT_CHART_STYLE).palette).toBeUndefined();
    }
  });
});

describe('dsForChartTemplate', () => {
  it('layers a template override over the brand', () => {
    const ds = {
      ...DEFAULT_DESIGN_SYSTEM,
      chart: brand({ gridlines: { ...DEFAULT_CHART_STYLE.gridlines, horizontal: 'major' } }),
    };
    const layered = dsForChartTemplate(ds, { gridlines: { horizontal: 'none' } });
    expect(layered.chart.gridlines.horizontal).toBe('none');
    // Deep, not shallow: the colour beside it survives.
    expect(layered.chart.gridlines.tokenId).toBe(ds.chart.gridlines.tokenId);
  });

  it('returns the design system untouched when there is nothing to override', () => {
    expect(dsForChartTemplate(DEFAULT_DESIGN_SYSTEM)).toBe(DEFAULT_DESIGN_SYSTEM);
  });

  it('backfills a stored style before layering', () => {
    const stale = { ...DEFAULT_DESIGN_SYSTEM, chart: {} as ChartStyle };
    expect(chartStyleFor(stale).axis.showX).toBe(
      withChartStyleDefaults({} as ChartStyle).axis.showX,
    );
  });
});
