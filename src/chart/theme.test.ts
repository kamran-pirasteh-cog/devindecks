import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  resolveColor,
  type ColorToken,
  type DesignSystem,
} from '@/model';
import { inchesToEmu } from '@/model';
import { metricMeasurer } from '@/render/measureText';
import { compileChart } from './compile';
import { paletteColor, resolvePalette } from './theme';
import { isTooPale } from './color';

const FRAME = { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(8), h: inchesToEmu(4.5) };

const spec = () => defaultChartSpec('column', 'stacked');

const dsWith = (colors: ColorToken[]): DesignSystem => ({
  ...DEFAULT_DESIGN_SYSTEM,
  colors,
});

const hexes = (ds: DesignSystem) => resolvePalette(spec(), ds).map((r) => resolveColor(r, ds));

describe('resolvePalette', () => {
  it("lets the spec's own palette win", () => {
    const s = { ...spec(), palette: [{ kind: 'hex' as const, hex: '#ABCDEF' }] };
    expect(resolvePalette(s, DEFAULT_DESIGN_SYSTEM)).toHaveLength(1);
  });

  it('leads with the accent', () => {
    expect(hexes(DEFAULT_DESIGN_SYSTEM)[0]).toBe('#4F46E5');
  });

  it('builds a ramp from the accent rather than scavenging other tokens', () => {
    // The old resolver ranked the design system's own tokens and handed series
    // three and four the muted grey and the hairline border. A ramp keeps
    // every series a deliberate colour.
    const out = hexes(DEFAULT_DESIGN_SYSTEM);
    expect(out).not.toContain('#6B7280');
    expect(out).not.toContain('#E5E7EB');
  });

  it('never picks a near-white that would vanish into the slide', () => {
    for (const c of hexes(DEFAULT_DESIGN_SYSTEM)) expect(isTooPale(c)).toBe(false);
  });

  it('follows the brand accent when it changes', () => {
    const red = dsWith(
      DEFAULT_DESIGN_SYSTEM.colors.map((c) =>
        c.id === 'brand.accent' ? { ...c, hex: '#B91C1C' } : c,
      ),
    );
    expect(hexes(red)[0]).toBe('#B91C1C');
  });

  it('prefers the brand palette when Admin has set one', () => {
    const branded: DesignSystem = {
      ...DEFAULT_DESIGN_SYSTEM,
      chart: { ...DEFAULT_DESIGN_SYSTEM.chart, paletteTokenIds: ['brand.primary', 'brand.accent'] },
    };
    expect(hexes(branded)).toEqual(['#111111', '#4F46E5']);
  });

  it('drops an unusable colour even when Admin picked it', () => {
    // A near-white token chosen by hand is still invisible on a white slide.
    const branded: DesignSystem = {
      ...DEFAULT_DESIGN_SYSTEM,
      chart: {
        ...DEFAULT_DESIGN_SYSTEM.chart,
        paletteTokenIds: ['brand.accent', 'surface.base', 'brand.primary'],
      },
    };
    expect(hexes(branded)).toEqual(['#4F46E5', '#111111']);
  });

  it('drops a brand colour that duplicates one already in the palette', () => {
    const branded: DesignSystem = {
      ...DEFAULT_DESIGN_SYSTEM,
      // #111111 and #0A0A0A are different tokens with the same appearance; a
      // chart using both renders two series the reader cannot tell apart.
      chart: {
        ...DEFAULT_DESIGN_SYSTEM.chart,
        paletteTokenIds: ['brand.primary', 'ink.strong', 'brand.accent'],
      },
    };
    expect(hexes(branded)).toEqual(['#111111', '#4F46E5']);
  });

  it('yields visually distinct colors throughout', () => {
    const out = hexes(DEFAULT_DESIGN_SYSTEM);
    expect(new Set(out).size).toBe(out.length);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('falls back rather than returning nothing when every token is unusable', () => {
    const ds = dsWith([{ id: 'surface.base', name: 'S', hex: '#FFFFFF' }]);
    expect(resolvePalette(spec(), ds).length).toBeGreaterThan(0);
  });
});

describe('paletteColor', () => {
  it('cycles rather than running off the end', () => {
    const p = resolvePalette(spec(), DEFAULT_DESIGN_SYSTEM);
    expect(paletteColor(p, p.length)).toEqual(p[0]);
    expect(paletteColor(p, p.length + 1)).toEqual(p[1]);
  });

  it('survives a negative index', () => {
    const p = resolvePalette(spec(), DEFAULT_DESIGN_SYSTEM);
    expect(paletteColor(p, -1)).toBeDefined();
  });
});

describe('brand gridline rule', () => {
  const withGridlines = (horizontal: 'none' | 'major' | 'major+minor'): DesignSystem => ({
    ...DEFAULT_DESIGN_SYSTEM,
    chart: {
      ...DEFAULT_DESIGN_SYSTEM.chart,
      gridlines: { ...DEFAULT_DESIGN_SYSTEM.chart.gridlines, horizontal },
    },
  });

  const gridlineCount = (ds: DesignSystem, s = spec()) =>
    compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: s },
      ds,
      metricMeasurer(),
    ).elements.filter((e) => e.role === 'chart.gridline').length;

  it('reaches a chart that never asked for gridlines either way', () => {
    // The promise of putting chart style on the design system: editing the
    // brand reflows charts nobody has touched since.
    expect(gridlineCount(withGridlines('major'))).toBeGreaterThan(0);
    expect(gridlineCount(withGridlines('none'))).toBe(0);
  });

  it("does not override a chart that stated its own preference", () => {
    const on = spec();
    on.decorations.gridlines = { major: { show: true } };
    expect(gridlineCount(withGridlines('none'), on)).toBeGreaterThan(0);

    const off = spec();
    off.decorations.gridlines = { major: { show: false } };
    expect(gridlineCount(withGridlines('major'), off)).toBe(0);
  });

  it('carries the brand dash style onto the gridlines', () => {
    const ds: DesignSystem = {
      ...DEFAULT_DESIGN_SYSTEM,
      chart: {
        ...DEFAULT_DESIGN_SYSTEM.chart,
        gridlines: { ...DEFAULT_DESIGN_SYSTEM.chart.gridlines, dash: 'dash' },
      },
    };
    const grid = compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: spec() },
      ds,
      metricMeasurer(),
    ).elements.filter((e) => e.role === 'chart.gridline');
    expect(grid.every((e) => e.type === 'line' && e.outline.dash === 'dash')).toBe(true);
  });

  it('uses the brand palette order when one is set', () => {
    const ds: DesignSystem = {
      ...DEFAULT_DESIGN_SYSTEM,
      chart: { ...DEFAULT_DESIGN_SYSTEM.chart, paletteTokenIds: ['ink.muted', 'brand.accent'] },
    };
    expect(resolvePalette(spec(), ds).map((r) => resolveColor(r, ds))).toEqual([
      '#6B7280',
      '#4F46E5',
    ]);
  });
});

describe('chart typography', () => {
  const serifEverywhere: DesignSystem = {
    ...DEFAULT_DESIGN_SYSTEM,
    type: Object.fromEntries(
      Object.entries(DEFAULT_DESIGN_SYSTEM.type).map(([k, v]) => [
        k,
        { ...v, font: 'Source Serif 4' as const },
      ]),
    ) as DesignSystem['type'],
  };

  it('keeps the serif out of a chart, whatever the type roles say', () => {
    // A serif body role is a good call for prose and a bad one for a column of
    // 9pt axis numbers. Charts use the sans for titles and legends and the mono
    // for everything annotating the data.
    const els = compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: spec() },
      serifEverywhere,
      metricMeasurer(),
    ).elements;
    const fonts = new Set(
      els.flatMap((e) =>
        e.type === 'text' ? e.body.paragraphs.flatMap((p) => p.runs.map((r) => r.font)) : [],
      ),
    );
    expect([...fonts].sort()).toEqual(['Geist', 'Geist Mono']);
  });

  it('sets ticks, categories and data labels in mono, uppercase and muted', () => {
    const els = compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: spec() },
      serifEverywhere,
      metricMeasurer(),
    ).elements;
    const runs = els.flatMap((e) =>
      e.type === 'text' && (e.chartRef?.part === 'label' || e.chartRef?.part === 'axis')
        ? e.body.paragraphs.flatMap((p) => p.runs.map((r) => ({ ...r, part: e.chartRef!.part })))
        : [],
    );
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.font).toBe('Geist Mono');
      // Emitted uppercase, not left to a renderer to transform.
      expect(r.text).toBe(r.text.toUpperCase());
    }
    // Muted for the axis furniture. A data label INSIDE a mark still takes
    // whatever ink is legible on that fill — a grey number on a saturated bar
    // is the one thing worse than an off-palette one.
    for (const r of runs.filter((x) => x.part === 'axis')) {
      expect(r.color).toEqual({ kind: 'token', token: 'ink.muted' });
    }
  });

  it('still takes its sizes and colours from the design system', () => {
    const big: DesignSystem = {
      ...DEFAULT_DESIGN_SYSTEM,
      chart: {
        ...DEFAULT_DESIGN_SYSTEM.chart,
        fonts: {
          ...DEFAULT_DESIGN_SYSTEM.chart.fonts,
          axis: { role: 'caption', sizePt: 14 },
        },
      },
    };
    // The value axis is hidden by default, so ask for it — otherwise the only
    // 'chart.tick' element on the slide is a category label, which carries its
    // own slightly larger size.
    const withAxis = spec();
    withAxis.axes.y.show = true;
    const els = compileChart(
      { id: 'c1', groupId: 'g1', frame: FRAME, spec: withAxis },
      big,
      metricMeasurer(),
    ).elements;
    const tick = els.find(
      (e) => e.chartRef?.part === 'axis' && e.chartRef.axis === 'y' && e.chartRef.sub === 'tick',
    );
    expect(tick?.type === 'text' && tick.body.paragraphs[0].runs[0].sizePt).toBe(14);
  });
});
