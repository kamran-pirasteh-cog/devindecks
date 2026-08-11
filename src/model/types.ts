/**
 * The canonical deck model — a CONSTRAINED SUBSET OF OOXML.
 *
 * Every construct here maps to exactly one native primitive that BOTH
 * PowerPoint and Google Slides render identically. If something can't be
 * expressed here, authors can't create it — that's how we guarantee
 * zero-breakage export. The editor is a faithful preview of this model.
 */

import type { EMU } from './units';
import type { ColorRef } from './tokens';
import type { FontFamily } from './fonts';
import type { SlideChartConfig } from './chart';

/* ------------------------------------------------------------------ */
/* Geometry                                                           */
/* ------------------------------------------------------------------ */

export interface Rect {
  x: EMU;
  y: EMU;
  w: EMU;
  h: EMU;
}

/* ------------------------------------------------------------------ */
/* Fills, lines, outlines                                             */
/* ------------------------------------------------------------------ */

export type Fill =
  | { kind: 'none' }
  | { kind: 'solid'; color: ColorRef };

export type DashStyle = 'solid' | 'dash' | 'dot';

export interface Outline {
  color: ColorRef;
  widthEmu: EMU;
  dash: DashStyle;
}

/* ------------------------------------------------------------------ */
/* Text                                                               */
/* ------------------------------------------------------------------ */

export interface TextRun {
  text: string;
  font?: FontFamily;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: ColorRef;
}

export type ParaAlign = 'left' | 'center' | 'right' | 'justify';
export type BulletKind = 'none' | 'bullet' | 'number';

export interface Paragraph {
  runs: TextRun[];
  align?: ParaAlign;
  /** Indent level 0..4, drives bullet style + spacing. */
  level?: number;
  bullet?: BulletKind;
  /** Line spacing as a percentage, 100 = single. */
  lineSpacingPct?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
}

export type VerticalAnchor = 'top' | 'middle' | 'bottom';

/**
 * Autofit MUST be explicit and constrained — this is the #1 source of
 * PowerPoint/Slides layout divergence. 'none' = fixed box, text may clip;
 * 'shrink' = shrink text to fit (PowerPoint normAutofit); 'resize' = box grows
 * to text (spAutoFit). We measure text the PowerPoint way, not the browser way.
 */
export type Autofit = 'none' | 'shrink' | 'resize';

export interface Insets {
  l: EMU;
  t: EMU;
  r: EMU;
  b: EMU;
}

export interface TextBody {
  paragraphs: Paragraph[];
  anchor?: VerticalAnchor;
  autofit?: Autofit;
  wrap?: boolean;
  insets?: Insets;
}

/* ------------------------------------------------------------------ */
/* Elements                                                           */
/* ------------------------------------------------------------------ */

/**
 * Curated set of preset autoshape geometries known to render identically in
 * both engines. Kept intentionally small; grow only after fidelity-checking a
 * new preset against real PowerPoint + Google Slides.
 */
export type ShapePreset =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'rightArrow'
  | 'chevron'
  | 'pill';

export type ElementType = 'text' | 'shape' | 'line' | 'picture';

interface BaseElement {
  id: string;
  type: ElementType;
  /**
   * Semantic role — the magic that makes apply-brand, reformat-to-template, and
   * Devin edits the SAME mechanism. e.g. 'title', 'subtitle', 'kpi.value'.
   */
  role?: string;
  name?: string;
  rect: Rect;
  /** Clockwise degrees. */
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  locked?: boolean;
}

export interface TextElement extends BaseElement {
  type: 'text';
  body: TextBody;
  fill?: Fill;
  outline?: Outline;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  preset: ShapePreset;
  fill?: Fill;
  outline?: Outline;
  /** Shapes may carry text (rendered centered by default). */
  body?: TextBody;
}

export interface LineElement extends BaseElement {
  type: 'line';
  outline: Outline;
  startArrow?: boolean;
  endArrow?: boolean;
}

export interface PictureElement extends BaseElement {
  type: 'picture';
  /** Asset ref or data URL; resolved via the asset store. */
  src: string;
  outline?: Outline;
}

export type SlideElement =
  | TextElement
  | ShapeElement
  | LineElement
  | PictureElement;

/* ------------------------------------------------------------------ */
/* Slide + Deck                                                       */
/* ------------------------------------------------------------------ */

export interface Slide {
  id: string;
  elements: SlideElement[];
  background?: Fill;
  /** Slide template this slide was instantiated from, if any. */
  layoutId?: string;
  notes?: string;
  /** Source config for this slide's chart, if its elements were generated from one. */
  chart?: SlideChartConfig;
}

export interface Deck {
  id: string;
  title: string;
  slideSize: { w: EMU; h: EMU };
  slides: Slide[];
  /** Provenance: which brand + template version this was built on. */
  designSystemId: string;
  designSystemVersion: number;
  deckTemplateId?: string;
  createdAt: string;
  updatedAt: string;
  /** Free-text labels (e.g. client names) for organizing/filtering documents. */
  tags?: string[];
}

/* ------------------------------------------------------------------ */
/* Type guards                                                        */
/* ------------------------------------------------------------------ */

export const isText = (e: SlideElement): e is TextElement => e.type === 'text';
export const isShape = (e: SlideElement): e is ShapeElement => e.type === 'shape';
export const isLine = (e: SlideElement): e is LineElement => e.type === 'line';
export const isPicture = (e: SlideElement): e is PictureElement =>
  e.type === 'picture';
