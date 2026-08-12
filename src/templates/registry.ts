/**
 * Deck template registry. For now these are built-in starter decks; in Phase 2
 * the Admin view will let Kamran author/version these (and full named decks like
 * QBR / BVA / Power User) against the real Cognition brand. Each template only
 * uses safe primitives, so anything created from one is export-safe by birth.
 */
import { nanoid } from 'nanoid';
import { DEFAULT_DESIGN_SYSTEM, inchesToEmu, SLIDE_16x9, token } from '@/model';
import type { LineElement, ShapeElement, Slide, TextElement } from '@/model';
import { ingestSlides, type RawSlide } from '@/model/ingest';
import bvaPitchSlides from './data/bva-pitch.json';
import waveOneExecReadoutSlides from './data/wave-one-exec-readout.json';

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  category: 'Blank' | 'Business Review' | 'Value' | 'Enablement';
  /** Lower sorts first; built-ins without an order fall to the end, alphabetically. */
  order?: number;
  buildSlides: () => Slide[];
}

const sid = () => `s-${nanoid(8)}`;
const eid = (p: string) => `${p}-${nanoid(6)}`;

const surface = { kind: 'solid', color: token('surface.base') } as const;

function titleSlide(title: string, subtitle: string): Slide {
  const bar: ShapeElement = {
    id: eid('bar'),
    type: 'shape',
    preset: 'rect',
    role: 'decoration',
    rect: { x: inchesToEmu(0.9), y: inchesToEmu(2.45), w: inchesToEmu(1.2), h: inchesToEmu(0.09) },
    fill: { kind: 'solid', color: token('brand.accent') },
  };
  const t: TextElement = {
    id: eid('title'),
    type: 'text',
    role: 'title',
    rect: { x: inchesToEmu(0.9), y: inchesToEmu(2.7), w: inchesToEmu(9), h: inchesToEmu(1.4) },
    body: { paragraphs: [{ runs: [{ text: title, font: 'Geist', sizePt: 44, bold: true, color: token('ink.strong') }] }] },
  };
  const s: TextElement = {
    id: eid('sub'),
    type: 'text',
    role: 'subtitle',
    rect: { x: inchesToEmu(0.92), y: inchesToEmu(4.1), w: inchesToEmu(9), h: inchesToEmu(0.6) },
    body: { paragraphs: [{ runs: [{ text: subtitle, font: 'Geist', sizePt: 18, color: token('ink.muted') }] }] },
  };
  return { id: sid(), background: surface, elements: [bar, t, s] };
}

function sectionSlide(heading: string): Slide {
  const rule: LineElement = {
    id: eid('rule'),
    type: 'line',
    role: 'decoration',
    rect: { x: inchesToEmu(0.9), y: inchesToEmu(1.45), w: inchesToEmu(11.5), h: 0 },
    outline: { color: token('line.default'), widthEmu: inchesToEmu(0.02), dash: 'solid' },
  };
  const h: TextElement = {
    id: eid('h'),
    type: 'text',
    role: 'heading',
    rect: { x: inchesToEmu(0.9), y: inchesToEmu(0.6), w: inchesToEmu(10), h: inchesToEmu(0.8) },
    body: { paragraphs: [{ runs: [{ text: heading, font: 'Geist', sizePt: 30, bold: true, color: token('ink.strong') }] }] },
  };
  return { id: sid(), background: surface, elements: [h, rule] };
}

function kpiSlide(): Slide {
  const base = sectionSlide('Where things stand');
  const cards: (ShapeElement | TextElement)[] = [];
  const data = [
    ['142%', 'Net revenue retention'],
    ['3.2M', 'Lines of code shipped'],
    ['18', 'Active power users'],
  ];
  data.forEach(([value, label], i) => {
    const x = inchesToEmu(0.9 + i * 3.9);
    const w = inchesToEmu(3.6);
    cards.push(
      {
        id: eid('card'),
        type: 'shape',
        preset: 'roundRect',
        role: 'kpi.card',
        rect: { x, y: inchesToEmu(2.0), w, h: inchesToEmu(2.4) },
        fill: { kind: 'solid', color: token('surface.subtle') },
      },
      {
        id: eid('kpi'),
        type: 'text',
        role: 'kpi.value',
        rect: { x: x + inchesToEmu(0.3), y: inchesToEmu(2.45), w: w - inchesToEmu(0.6), h: inchesToEmu(1.1) },
        body: { paragraphs: [{ runs: [{ text: value, font: 'Geist', sizePt: 46, bold: true, color: token('brand.accent') }] }] },
      },
      {
        id: eid('lbl'),
        type: 'text',
        role: 'kpi.label',
        rect: { x: x + inchesToEmu(0.3), y: inchesToEmu(3.55), w: w - inchesToEmu(0.6), h: inchesToEmu(0.7) },
        body: { paragraphs: [{ runs: [{ text: label, font: 'Geist', sizePt: 15, color: token('ink.muted') }] }] },
      },
    );
  });
  return { ...base, elements: [...base.elements, ...cards] };
}

/**
 * A deck imported element-by-element (text boxes, shapes, lines, pictures) from a
 * reference .pptx, so every run and rect is directly editable — not a flattened
 * screenshot. Fresh ids are assigned per build so re-inserting never collides.
 *
 * Everything from outside the app goes through `ingestSlides`, which resolves
 * inherited run styling to explicit values and reports fidelity risks. Run
 * `npm run validate:decks` to see the diagnostics for the bundled decks; here we
 * only surface errors, and only in dev, since a template build is a hot path.
 *
 * Normalization resolves against DEFAULT_DESIGN_SYSTEM, not the *active* one, on
 * purpose: an imported deck should look the way it was imported, so a later
 * brand edit must not retroactively resize runs whose size the source file
 * omitted. It also keeps this path identical to `npm run validate:decks`.
 */
export function importedDeckSlides(raw: RawSlide[]): Slide[] {
  const { slides, diagnostics } = ingestSlides(raw, {
    designSystem: DEFAULT_DESIGN_SYSTEM,
    slideSize: SLIDE_16x9,
    slideId: sid,
    elementId: eid,
  });

  if (process.env.NODE_ENV !== 'production') {
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      console.warn(
        `[ingest] ${errors.length} error(s) in imported deck:\n` +
          errors.map((d) => `  slide ${d.slide}: ${d.code} — ${d.message}`).join('\n'),
      );
    }
  }

  return slides;
}

export type SlideLayoutCategory = 'Title' | 'Section' | 'KPI' | 'Blank';

export const SLIDE_LAYOUT_CATEGORIES: SlideLayoutCategory[] = ['Title', 'Section', 'KPI', 'Blank'];

export interface SlideLayoutDef {
  id: string;
  name: string;
  layout: SlideLayoutCategory;
  buildSlide: () => Slide;
}

/** Single-slide layouts for the editor's template drawer, bucketed by layout. */
export const SLIDE_LAYOUTS: SlideLayoutDef[] = [
  {
    id: 'layout-title',
    name: 'Title',
    layout: 'Title',
    buildSlide: () => titleSlide('Slide title', 'Subtitle goes here'),
  },
  {
    id: 'layout-section',
    name: 'Section header',
    layout: 'Section',
    buildSlide: () => sectionSlide('Section heading'),
  },
  {
    id: 'layout-kpi',
    name: 'KPI overview',
    layout: 'KPI',
    buildSlide: () => kpiSlide(),
  },
  {
    id: 'layout-blank',
    name: 'Blank',
    layout: 'Blank',
    buildSlide: () => ({ id: sid(), background: surface, elements: [] }),
  },
];

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Start from an empty slide.',
    category: 'Blank',
    buildSlides: () => [{ id: sid(), background: surface, elements: [] }],
  },
  {
    id: 'wave-one-exec-readout',
    name: 'Wave One Exec Readout',
    description: 'Imported reference deck: exec readout on the first wave of a Devin engagement. Every text box and shape is directly editable.',
    category: 'Business Review',
    order: 0,
    buildSlides: () => importedDeckSlides(waveOneExecReadoutSlides as RawSlide[]),
  },
  {
    id: 'bva-pitch',
    name: 'BVA Pitch',
    description: 'Imported reference deck: business value analysis pitch. Every text box and shape is directly editable.',
    category: 'Value',
    order: 1,
    buildSlides: () => importedDeckSlides(bvaPitchSlides as RawSlide[]),
  },
  {
    id: 'qbr',
    name: 'Quarterly Business Review',
    description: 'Title, agenda and a KPI overview to open a QBR.',
    category: 'Business Review',
    buildSlides: () => [
      titleSlide('Quarterly Business Review', 'Acme Corp  ·  Q3 2026  ·  Prepared by Cognition'),
      sectionSlide('Agenda'),
      kpiSlide(),
    ],
  },
  {
    id: 'bva',
    name: 'Business Value Assessment',
    description: 'Frame the value story with a title and impact section.',
    category: 'Value',
    buildSlides: () => [
      titleSlide('Business Value Assessment', 'Acme Corp  ·  Prepared by Cognition'),
      sectionSlide('The opportunity'),
    ],
  },
  {
    id: 'power-user',
    name: 'Power User Deck',
    description: 'Enablement-style opener for power users.',
    category: 'Enablement',
    buildSlides: () => [
      titleSlide('Getting the most out of Devin', 'A guide for power users'),
      sectionSlide('What great looks like'),
    ],
  },
];

export const getTemplate = (id: string): TemplateDef | undefined =>
  TEMPLATES.find((t) => t.id === id);
