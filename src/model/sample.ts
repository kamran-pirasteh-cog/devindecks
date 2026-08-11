/**
 * A hand-built sample deck used to exercise the renderer before templates
 * exist. Two slides: a title and a KPI/agenda layout. Everything here uses only
 * safe primitives and token colors.
 */
import { inchesToEmu, SLIDE_16x9 } from './units';
import { token } from './tokens';
import type { Deck, ShapeElement, TextElement, LineElement } from './types';

const now = '2026-08-11T00:00:00.000Z';

const title: TextElement = {
  id: 'e-title',
  type: 'text',
  role: 'title',
  rect: { x: inchesToEmu(0.9), y: inchesToEmu(2.7), w: inchesToEmu(9), h: inchesToEmu(1.4) },
  body: {
    anchor: 'top',
    paragraphs: [
      {
        runs: [
          { text: 'Quarterly Business Review', font: 'Geist', sizePt: 44, bold: true, color: token('ink.strong') },
        ],
      },
    ],
  },
};

const subtitle: TextElement = {
  id: 'e-sub',
  type: 'text',
  role: 'subtitle',
  rect: { x: inchesToEmu(0.92), y: inchesToEmu(4.1), w: inchesToEmu(9), h: inchesToEmu(0.6) },
  body: {
    paragraphs: [
      {
        runs: [
          { text: 'Acme Corp  ·  Q3 2026  ·  Prepared by Cognition', font: 'Geist', sizePt: 18, color: token('ink.muted') },
        ],
      },
    ],
  },
};

const accentBar: ShapeElement = {
  id: 'e-bar',
  type: 'shape',
  preset: 'rect',
  role: 'decoration',
  rect: { x: inchesToEmu(0.9), y: inchesToEmu(2.45), w: inchesToEmu(1.2), h: inchesToEmu(0.09) },
  fill: { kind: 'solid', color: token('brand.accent') },
};

const titleSlide = {
  id: 's-title',
  background: { kind: 'solid', color: token('surface.base') } as const,
  elements: [accentBar, title, subtitle],
};

// --- KPI slide ---------------------------------------------------------

const heading: TextElement = {
  id: 'e-h2',
  type: 'text',
  role: 'heading',
  rect: { x: inchesToEmu(0.9), y: inchesToEmu(0.6), w: inchesToEmu(8), h: inchesToEmu(0.8) },
  body: {
    paragraphs: [
      { runs: [{ text: 'Where things stand', font: 'Geist', sizePt: 30, bold: true, color: token('ink.strong') }] },
    ],
  },
};

const rule: LineElement = {
  id: 'e-rule',
  type: 'line',
  role: 'decoration',
  rect: { x: inchesToEmu(0.9), y: inchesToEmu(1.45), w: inchesToEmu(11.5), h: 0 },
  outline: { color: token('line.default'), widthEmu: inchesToEmu(0.02), dash: 'solid' },
};

function kpiCard(i: number, value: string, label: string): (ShapeElement | TextElement)[] {
  const x = inchesToEmu(0.9 + i * 3.9);
  const w = inchesToEmu(3.6);
  const card: ShapeElement = {
    id: `e-card-${i}`,
    type: 'shape',
    preset: 'roundRect',
    role: 'kpi.card',
    rect: { x, y: inchesToEmu(2.0), w, h: inchesToEmu(2.4) },
    fill: { kind: 'solid', color: token('surface.subtle') },
  };
  const valueEl: TextElement = {
    id: `e-kpi-${i}`,
    type: 'text',
    role: 'kpi.value',
    rect: { x: x + inchesToEmu(0.3), y: inchesToEmu(2.45), w: w - inchesToEmu(0.6), h: inchesToEmu(1.1) },
    body: {
      paragraphs: [{ runs: [{ text: value, font: 'Geist', sizePt: 46, bold: true, color: token('brand.accent') }] }],
    },
  };
  const labelEl: TextElement = {
    id: `e-lbl-${i}`,
    type: 'text',
    role: 'kpi.label',
    rect: { x: x + inchesToEmu(0.3), y: inchesToEmu(3.55), w: w - inchesToEmu(0.6), h: inchesToEmu(0.7) },
    body: {
      paragraphs: [{ runs: [{ text: label, font: 'Geist', sizePt: 15, color: token('ink.muted') }] }],
    },
  };
  return [card, valueEl, labelEl];
}

const kpiSlide = {
  id: 's-kpi',
  background: { kind: 'solid', color: token('surface.base') } as const,
  elements: [
    heading,
    rule,
    ...kpiCard(0, '142%', 'Net revenue retention'),
    ...kpiCard(1, '3.2M', 'Lines of code shipped'),
    ...kpiCard(2, '18', 'Active power users'),
  ],
};

export const SAMPLE_DECK: Deck = {
  id: 'deck-sample',
  title: 'Sample QBR',
  slideSize: { w: SLIDE_16x9.w, h: SLIDE_16x9.h },
  slides: [titleSlide, kpiSlide],
  designSystemId: 'ds.default',
  designSystemVersion: 1,
  createdAt: now,
  updatedAt: now,
};
