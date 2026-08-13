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
  /**
   * `alpha` is opacity, 0..1, and absent means fully opaque. Stored as opacity
   * rather than PowerPoint's transparency percentage because that's what both
   * render targets want (CSS rgba, OOXML `<a:alpha>`); the UI does the one
   * subtraction it takes to show it as "40% transparent".
   */
  | { kind: 'solid'; color: ColorRef; alpha?: number };

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
  /**
   * Numeric weight, when the run wants a face between regular and bold (e.g.
   * Medium 500). Must be one of the family's `weights` — anything else has no
   * real face to render. `bold` stays the canonical on/off for the 700 face
   * because that's the only weight distinction OOXML itself carries; on export
   * a weight of 600+ becomes bold and Medium falls back to regular.
   */
  weight?: number;
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
  /**
   * Groups this element belongs to, outermost first. Flat membership rather
   * than a nested container element — see `model/group.ts` for why.
   */
  groupIds?: string[];
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
  /**
   * Whether this deck shows page numbers. One flag, not per-slide text: the
   * numbers are drawn from each slide's live index at render time, so they
   * renumber themselves as slides are added, deleted or reordered. Style comes
   * from the design system (see `model/pageNumbers.ts`).
   */
  pageNumbers?: boolean;
  /** Free-text labels (e.g. client names) for organizing/filtering documents. */
  tags?: string[];
  /** Who owns this document (free text until there's real auth). */
  owner?: string;
  /**
   * Which dashboard folder this document filed under, or unset for "Unfiled".
   * A document lives in at most one folder — folders are the single-home
   * hierarchy; tags stay the many-to-many axis.
   */
  folderId?: string;
  /**
   * When this was moved to Deleted items. Set means deleted-but-recoverable:
   * hidden from the dashboard, still on disk until it's purged from there.
   */
  deletedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Type guards                                                        */
/* ------------------------------------------------------------------ */

export const isText = (e: SlideElement): e is TextElement => e.type === 'text';
export const isShape = (e: SlideElement): e is ShapeElement => e.type === 'shape';
export const isLine = (e: SlideElement): e is LineElement => e.type === 'line';
export const isPicture = (e: SlideElement): e is PictureElement =>
  e.type === 'picture';
