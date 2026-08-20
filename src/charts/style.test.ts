import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHART_STYLE,
  DEFAULT_DESIGN_SYSTEM,
  diffChartStyle,
  isGridSpec,
  resolveChartStyle,
  variantOverridesCount,
  withChartStyleDefaults,
  withDefaultVariant,
  type ChartStyle,
  type ChartStyleVariant,
} from '@/model';
import { CHART_TEMPLATES } from './registry';
import {
  chartStyleFor,
  chartStyleForVariant,
  defaultVariantIdFor,
  dsForChartTemplate,
} from './style';

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

describe('per-kind style variants', () => {
  const variants: ChartStyleVariant[] = [
    {
      id: 'v.col.default',
      kind: 'column',
      name: 'Default',
      isDefault: true,
      overrides: { gaps: { categoryGapPct: 20 } },
    },
    {
      id: 'v.col.gridless',
      kind: 'column',
      name: 'Gridless',
      overrides: { gridlines: { horizontal: 'none' }, gaps: { categoryGapPct: 60 } },
    },
    { id: 'v.line.thick', kind: 'line', name: 'Thick', overrides: { gaps: { categoryGapPct: 5 } } },
  ];
  const ds = { ...DEFAULT_DESIGN_SYSTEM, chartVariants: variants };

  it('uses the named variant when one is asked for', () => {
    expect(chartStyleForVariant(ds, 'v.col.gridless').gaps.categoryGapPct).toBe(60);
  });

  it('names the variant a bare insert of a kind should be stamped with', () => {
    expect(defaultVariantIdFor(ds, 'column')).toBe('v.col.default');
    // No flag anywhere for this kind — the first one stands in.
    expect(defaultVariantIdFor(ds, 'line')).toBe('v.line.thick');
    expect(defaultVariantIdFor(ds, 'pie')).toBeUndefined();
  });

  it('resolves an unstamped chart to the conventions, NOT to the default', () => {
    // Otherwise adding a first variant to a kind restyles every chart of that
    // kind ever made, including ones deliberately left on the plain look.
    expect(chartStyleForVariant(ds).gaps.categoryGapPct).toBe(
      DEFAULT_CHART_STYLE.gaps.categoryGapPct,
    );
  });

  it('degrades rather than breaks when a variant id no longer exists', () => {
    // Deleting a variant must not break the decks that referenced it.
    expect(chartStyleForVariant(ds, 'v.col.deleted').gaps.categoryGapPct).toBe(
      DEFAULT_CHART_STYLE.gaps.categoryGapPct,
    );
  });

  it('merges deeply against the conventions rather than replacing them', () => {
    // The variant sets only `gridlines.horizontal`; the brand's gridline colour
    // has to survive.
    const s = chartStyleForVariant(ds, 'v.col.gridless');
    expect(s.gridlines.horizontal).toBe('none');
    expect(s.gridlines.tokenId).toBe(DEFAULT_CHART_STYLE.gridlines.tokenId);
  });

  it('lets a template override win over the variant', () => {
    const s = chartStyleForVariant(ds, 'v.col.gridless', {
      gaps: { categoryGapPct: 99 },
    });
    expect(s.gaps.categoryGapPct).toBe(99);
    // …without wiping the rest of what the variant said.
    expect(s.gridlines.horizontal).toBe('none');
  });

  it('keeps one default per kind when the flag moves', () => {
    const next = withDefaultVariant(variants, 'v.col.gridless');
    expect(next.filter((v) => v.kind === 'column' && v.isDefault)).toHaveLength(1);
    expect(next.find((v) => v.id === 'v.col.gridless')?.isDefault).toBe(true);
    // A different kind is untouched.
    expect(next.find((v) => v.id === 'v.line.thick')?.isDefault).toBeUndefined();
  });
});

describe('diffChartStyle', () => {
  it('round-trips through resolve', () => {
    const edited: ChartStyle = {
      ...DEFAULT_CHART_STYLE,
      gridlines: { ...DEFAULT_CHART_STYLE.gridlines, horizontal: 'major' },
      legend: { show: false, position: 'right' },
    };
    const d = diffChartStyle(DEFAULT_CHART_STYLE, edited);
    expect(resolveChartStyle(DEFAULT_CHART_STYLE, d)).toEqual(edited);
  });

  it('stores only what actually differs', () => {
    const edited: ChartStyle = {
      ...DEFAULT_CHART_STYLE,
      gridlines: { ...DEFAULT_CHART_STYLE.gridlines, horizontal: 'major' },
    };
    // Not the whole gridlines block — just the one field.
    expect(diffChartStyle(DEFAULT_CHART_STYLE, edited)).toEqual({
      gridlines: { horizontal: 'major' },
    });
  });

  it('is empty for an untouched copy', () => {
    expect(diffChartStyle(DEFAULT_CHART_STYLE, { ...DEFAULT_CHART_STYLE })).toEqual({});
  });

  it('replaces a palette wholesale rather than merging it', () => {
    const edited: ChartStyle = { ...DEFAULT_CHART_STYLE, paletteTokenIds: ['brand.accent'] };
    expect(diffChartStyle(DEFAULT_CHART_STYLE, edited)).toEqual({
      paletteTokenIds: ['brand.accent'],
    });
  });

  it('counts what a variant overrides', () => {
    expect(variantOverridesCount({})).toBe(0);
    expect(variantOverridesCount({ gridlines: { horizontal: 'major' } })).toBe(1);
    expect(variantOverridesCount({ legend: { show: false, position: 'right' } })).toBe(2);
  });
});
