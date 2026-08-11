/**
 * Placeholder chart rendering for the editor's Charts tab. There's no real
 * charting engine yet — `buildChartElements` composes the same safe
 * primitives as everything else (rects, lines, ellipses, text) into a
 * representative preview driven by a `SlideChartConfig`, so a chart is
 * export-safe by birth and fully regeneratable from its source data.
 */
import { nanoid } from 'nanoid';
import { inchesToEmu, token } from '@/model';
import type {
  ChartOrientation,
  ChartType,
  ColorRef,
  ShapeElement,
  Slide,
  SlideChartConfig,
  SlideElement,
  TextElement,
} from '@/model';

export interface ChartTypeDef {
  id: ChartType;
  name: string;
  /** Whether this chart type has a meaningful horizontal/vertical flip. */
  orientable: boolean;
}

export const CHART_TYPES: ChartTypeDef[] = [
  { id: 'bar', name: 'Bar chart', orientable: true },
  { id: 'line', name: 'Line chart', orientable: true },
  { id: 'area', name: 'Area chart', orientable: true },
  { id: 'pie', name: 'Pie chart', orientable: false },
  { id: 'donut', name: 'Donut chart', orientable: false },
  { id: 'scatter', name: 'Scatter plot', orientable: false },
];

const eid = (p: string) => `${p}-${nanoid(6)}`;

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const DEFAULT_BOX = { w: SLIDE_W - 1.6, h: SLIDE_H - 1.6 };
const SWATCH_COLORS: ColorRef[] = [
  token('brand.accent'),
  token('ink.strong'),
  token('ink.muted'),
  token('line.default'),
  token('brand.primary'),
];

export function defaultChartConfig(type: ChartType, orientation: ChartOrientation = 'vertical'): SlideChartConfig {
  return {
    type,
    orientation,
    box: { ...DEFAULT_BOX },
    data: {
      categories: ['Category 1', 'Category 2', 'Category 3', 'Category 4', 'Category 5'],
      series: [{ name: 'Series 1', color: SWATCH_COLORS[0], values: [55, 85, 65, 100, 40] }],
    },
  };
}

/** Centers a requested box (inches) on the slide, clamped to fit. */
function centeredBox(box: { w: number; h: number }) {
  const w = Math.min(Math.max(box.w, 1), SLIDE_W - 0.4);
  const h = Math.min(Math.max(box.h, 1), SLIDE_H - 0.4);
  return { x: (SLIDE_W - w) / 2, y: (SLIDE_H - h) / 2, w, h };
}

type Box = { x: number; y: number; w: number; h: number };

function axisLine(rect: Box): SlideElement {
  return {
    id: eid('axis'),
    type: 'line',
    role: 'chart.axis',
    rect: {
      x: inchesToEmu(rect.x),
      y: inchesToEmu(rect.y),
      w: inchesToEmu(rect.w),
      h: inchesToEmu(rect.h),
    },
    outline: { color: token('line.default'), widthEmu: inchesToEmu(0.02), dash: 'solid' },
  };
}

function rectEl(x: number, y: number, w: number, h: number, color: ColorRef, role: string): ShapeElement {
  return {
    id: eid('r'),
    type: 'shape',
    preset: 'rect',
    role,
    rect: { x: inchesToEmu(x), y: inchesToEmu(y), w: inchesToEmu(Math.max(w, 0.02)), h: inchesToEmu(Math.max(h, 0.02)) },
    fill: { kind: 'solid', color },
  };
}

function ellipseEl(x: number, y: number, w: number, h: number, color: ColorRef, role: string): ShapeElement {
  return {
    id: eid('e'),
    type: 'shape',
    preset: 'ellipse',
    role,
    rect: { x: inchesToEmu(x), y: inchesToEmu(y), w: inchesToEmu(w), h: inchesToEmu(h) },
    fill: { kind: 'solid', color },
  };
}

function labelEl(
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  align: 'left' | 'center' | 'right',
  sizePt = 10,
): TextElement {
  return {
    id: eid('lbl'),
    type: 'text',
    role: 'chart.label',
    rect: { x: inchesToEmu(x), y: inchesToEmu(y), w: inchesToEmu(w), h: inchesToEmu(h) },
    body: { paragraphs: [{ runs: [{ text, font: 'Geist', sizePt, color: token('ink.muted') }], align }] },
  };
}

function categoryLabels(box: Box, orientation: ChartOrientation, categories: string[]): SlideElement[] {
  const { x, y, w, h } = box;
  const n = categories.length;
  if (orientation === 'vertical') {
    const step = n > 1 ? w / n : w;
    return categories.map((cat, i) => labelEl(cat, x + i * step, y + h + 0.1, step, 0.3, 'center'));
  }
  const step = n > 1 ? h / n : h;
  return categories.map((cat, i) => labelEl(cat, x - 1.15, y + i * step, 1.05, step, 'right'));
}

function axisLabels(box: Box, cfg: SlideChartConfig): SlideElement[] {
  const els: SlideElement[] = [];
  if (cfg.xLabel) {
    els.push(labelEl(cfg.xLabel, box.x, box.y + box.h + 0.45, box.w, 0.35, 'center', 11));
  }
  if (cfg.yLabel) {
    els.push({
      id: eid('ylbl'),
      type: 'text',
      role: 'chart.axislabel',
      rotation: -90,
      rect: {
        x: inchesToEmu(box.x - 0.85 - box.h / 2 + 0.35),
        y: inchesToEmu(box.y + box.h / 2 - 0.35),
        w: inchesToEmu(box.h - 0.7),
        h: inchesToEmu(0.35),
      },
      body: {
        paragraphs: [{ runs: [{ text: cfg.yLabel, font: 'Geist', sizePt: 11, color: token('ink.muted') }], align: 'center' }],
      },
    });
  }
  return els;
}

function maxValue(cfg: SlideChartConfig): number {
  return Math.max(1, ...cfg.data.series.flatMap((s) => s.values));
}

function barChart(cfg: SlideChartConfig): SlideElement[] {
  const box = centeredBox(cfg.box);
  const { x, y, w, h } = box;
  const { categories, series } = cfg.data;
  const max = maxValue(cfg);
  const n = Math.max(categories.length, 1);
  const els: SlideElement[] = [];

  if (cfg.orientation === 'vertical') {
    els.push(axisLine({ x, y: y + h, w, h: 0 }));
    const groupGap = 0.35;
    const groupW = (w - groupGap * (n - 1)) / n;
    const barGap = 0.06;
    const barW = (groupW - barGap * (series.length - 1)) / Math.max(series.length, 1);
    categories.forEach((cat, ci) => {
      const groupX = x + ci * (groupW + groupGap);
      series.forEach((s, si) => {
        const v = s.values[ci] ?? 0;
        const barH = h * (v / max);
        els.push(rectEl(groupX + si * (barW + barGap), y + h - barH, barW, barH, s.color, 'chart.series'));
      });
    });
    els.push(...categoryLabels(box, 'vertical', categories));
  } else {
    els.push(axisLine({ x, y, w: 0, h }));
    const groupGap = 0.3;
    const groupH = (h - groupGap * (n - 1)) / n;
    const barGap = 0.05;
    const barH = (groupH - barGap * (series.length - 1)) / Math.max(series.length, 1);
    categories.forEach((cat, ci) => {
      const groupY = y + ci * (groupH + groupGap);
      series.forEach((s, si) => {
        const v = s.values[ci] ?? 0;
        const barW = w * (v / max);
        els.push(rectEl(x, groupY + si * (barH + barGap), barW, barH, s.color, 'chart.series'));
      });
    });
    els.push(...categoryLabels(box, 'horizontal', categories));
  }
  return els;
}

function seriesPoints(box: Box, orientation: ChartOrientation, values: number[], max: number) {
  const { x, y, w, h } = box;
  const n = values.length;
  if (orientation === 'vertical') {
    const step = n > 1 ? w / (n - 1) : 0;
    return values.map((v, i) => ({ x: x + i * step, y: y + h * (1 - v / max) }));
  }
  const step = n > 1 ? h / (n - 1) : 0;
  return values.map((v, i) => ({ x: x + w * (v / max), y: y + i * step }));
}

function lineAndMarkers(points: { x: number; y: number }[], color: ColorRef): SlideElement[] {
  const els: SlideElement[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    els.push({
      id: eid('seg'),
      type: 'line',
      role: 'chart.series',
      rect: {
        x: inchesToEmu(Math.min(a.x, b.x)),
        y: inchesToEmu(Math.min(a.y, b.y)),
        w: inchesToEmu(Math.abs(b.x - a.x)),
        h: inchesToEmu(Math.abs(b.y - a.y)),
      },
      flipV: a.y > b.y,
      outline: { color, widthEmu: inchesToEmu(0.03), dash: 'solid' },
    });
  }
  points.forEach((p) => els.push(ellipseEl(p.x - 0.06, p.y - 0.06, 0.12, 0.12, color, 'chart.marker')));
  return els;
}

function lineChart(cfg: SlideChartConfig): SlideElement[] {
  const box = centeredBox(cfg.box);
  const { categories, series } = cfg.data;
  const max = maxValue(cfg);
  const axes =
    cfg.orientation === 'vertical'
      ? [axisLine({ x: box.x, y: box.y + box.h, w: box.w, h: 0 })]
      : [axisLine({ x: box.x, y: box.y, w: 0, h: box.h })];
  const body = series.flatMap((s) => lineAndMarkers(seriesPoints(box, cfg.orientation, s.values, max), s.color));
  return [...axes, ...body, ...categoryLabels(box, cfg.orientation, categories)];
}

function areaFills(box: Box, orientation: ChartOrientation, points: { x: number; y: number }[]): SlideElement[] {
  const { x, y, w, h } = box;
  const fills: SlideElement[] = [];
  if (points.length < 2) return fills;

  if (orientation === 'vertical') {
    const seg = w / (points.length - 1);
    for (let i = 0; i < points.length - 1; i++) {
      const topY = Math.min(points[i].y, points[i + 1].y);
      fills.push(rectEl(x + i * seg, topY, seg, y + h - topY, token('surface.subtle'), 'chart.fill'));
    }
  } else {
    const seg = h / (points.length - 1);
    for (let i = 0; i < points.length - 1; i++) {
      const leftX = Math.min(points[i].x, points[i + 1].x);
      fills.push(rectEl(x, y + i * seg, leftX - x, seg, token('surface.subtle'), 'chart.fill'));
    }
  }
  return fills;
}

function areaChart(cfg: SlideChartConfig): SlideElement[] {
  const box = centeredBox(cfg.box);
  const { categories, series } = cfg.data;
  const max = maxValue(cfg);
  const primaryPoints = series[0] ? seriesPoints(box, cfg.orientation, series[0].values, max) : [];
  const axes =
    cfg.orientation === 'vertical'
      ? [axisLine({ x: box.x, y: box.y + box.h, w: box.w, h: 0 })]
      : [axisLine({ x: box.x, y: box.y, w: 0, h: box.h })];
  const fills = areaFills(box, cfg.orientation, primaryPoints);
  const body = series.flatMap((s) => lineAndMarkers(seriesPoints(box, cfg.orientation, s.values, max), s.color));
  return [...axes, ...fills, ...body, ...categoryLabels(box, cfg.orientation, categories)];
}

function legendSwatch(i: number, label: string, color: ColorRef, cx: number, top: number): SlideElement[] {
  return [
    {
      id: eid('sw'),
      type: 'shape',
      preset: 'rect',
      role: 'chart.legend',
      rect: { x: inchesToEmu(cx), y: inchesToEmu(top + i * 0.4), w: inchesToEmu(0.2), h: inchesToEmu(0.2) },
      fill: { kind: 'solid', color },
    },
    {
      id: eid('lgl'),
      type: 'text',
      role: 'chart.legend.label',
      rect: { x: inchesToEmu(cx + 0.32), y: inchesToEmu(top + i * 0.4 - 0.07), w: inchesToEmu(2.6), h: inchesToEmu(0.35) },
      body: { paragraphs: [{ runs: [{ text: label, font: 'Geist', sizePt: 12, color: token('ink.muted') }] }] },
    },
  ];
}

function pieChart(cfg: SlideChartConfig, donut: boolean): SlideElement[] {
  const box = centeredBox(cfg.box);
  const { x, y, w, h } = box;
  const { categories, series } = cfg.data;
  const values = series[0]?.values ?? [];
  const d = Math.min(w, h) * 0.72;
  const cx = x + d / 2 + 0.3;
  const cy = y + h / 2;
  const els: SlideElement[] = [ellipseEl(cx - d / 2, cy - d / 2, d, d, series[0]?.color ?? SWATCH_COLORS[0], 'chart.series')];
  if (donut) {
    const inner = d * 0.5;
    els.push(ellipseEl(cx - inner / 2, cy - inner / 2, inner, inner, token('surface.base'), 'chart.series'));
  }
  const legendX = cx + d / 2 + 0.6;
  const legendTop = cy - (Math.max(categories.length, 1) * 0.4) / 2;
  categories.forEach((cat, i) => {
    const v = values[i];
    const label = v !== undefined ? `${cat} · ${v}` : cat;
    els.push(...legendSwatch(i, label, SWATCH_COLORS[i % SWATCH_COLORS.length], legendX, legendTop));
  });
  return els;
}

function scatterChart(cfg: SlideChartConfig): SlideElement[] {
  const box = centeredBox(cfg.box);
  const { x, y, w, h } = box;
  const { categories, series } = cfg.data;
  const max = maxValue(cfg);
  const n = Math.max(categories.length, 1);
  const els: SlideElement[] = [axisLine({ x, y: y + h, w, h: 0 }), axisLine({ x, y, w: 0, h })];
  series.forEach((s) => {
    s.values.forEach((v, i) => {
      const px = n > 1 ? x + (i / (n - 1)) * w : x + w / 2;
      const py = y + h - h * (v / max);
      els.push(ellipseEl(px - 0.07, py - 0.07, 0.14, 0.14, s.color, 'chart.marker'));
    });
  });
  return [...els, ...categoryLabels(box, 'vertical', categories)];
}

export function buildChartElements(cfg: SlideChartConfig): SlideElement[] {
  const box = centeredBox(cfg.box);
  let body: SlideElement[];
  switch (cfg.type) {
    case 'bar':
      body = barChart(cfg);
      break;
    case 'line':
      body = lineChart(cfg);
      break;
    case 'area':
      body = areaChart(cfg);
      break;
    case 'pie':
      body = pieChart(cfg, false);
      break;
    case 'donut':
      body = pieChart(cfg, true);
      break;
    case 'scatter':
      body = scatterChart(cfg);
      break;
  }
  const labels = cfg.type === 'pie' || cfg.type === 'donut' ? [] : axisLabels(box, cfg);
  return [...body, ...labels];
}

export function buildChartSlide(config: SlideChartConfig): Slide {
  return {
    id: `s-${nanoid(8)}`,
    background: { kind: 'solid', color: token('surface.base') },
    elements: buildChartElements(config),
    chart: config,
  };
}
