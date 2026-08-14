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
import type { ChartInstance, ChartRef, SlideChartConfig } from './chart';

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

/**
 * Presets whose corners can be rounded or squared. Only the rectangular family
 * qualifies — an ellipse has no corners, and a chevron's are structural.
 */
export const ROUNDABLE_PRESETS: ShapePreset[] = ['rect', 'roundRect', 'pill'];

/** Whether a shape currently reads as round-cornered. */
export function isRoundedPreset(preset: ShapePreset) {
  return preset === 'roundRect' || preset === 'pill';
}

export type ElementType = 'text' | 'shape' | 'line' | 'picture' | 'path';

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
  /**
   * Set when this primitive was compiled from a chart: which spec node it came
   * from. Editor-only provenance — exporters ignore it exactly as they ignore
   * `role`. It's what lets a click on a bar edit the SERIES rather than the
   * rectangle, so the change survives the next recompile.
   */
  chartRef?: ChartRef;
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

/**
 * A freeform outline. Pie and donut slices, true stacked areas, Mekko cells and
 * waterfall connectors cannot be expressed as rect/ellipse/line, and this is the
 * one primitive that covers all of them.
 *
 * Two constraints keep it export-safe:
 *
 * - **Coordinates are NORMALIZED to the element's box (0..1 on both axes)**, so
 *   a path scales under `setRect`, group resize, `matchSize` and
 *   `fitToMargins` exactly like every other element, with no special cases
 *   anywhere.
 * - **Cubics only, no arcs.** This maps to OOXML `<a:custGeom>` with
 *   `moveTo`/`lnTo`/`cubicBezTo`/`close`, which both PowerPoint and Google
 *   Slides import reliably. `arcTo` is where Slides' custGeom support is least
 *   trustworthy, so circular geometry is approximated with <=90 degree cubic
 *   segments instead.
 *
 * Authors never create one directly — only the chart compiler emits paths.
 */
export interface PathElement extends BaseElement {
  type: 'path';
  d: PathOp[];
  fill?: Fill;
  outline?: Outline;
}

export type PathOp =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

/**
 * How much of the SOURCE image is thrown away on each side, as a fraction of
 * the source's own width/height — OOXML `<a:srcRect>`, exactly.
 *
 * The surviving window is stretched to fill the element's rect, so a crop never
 * moves or resizes the picture on the slide; the editor shrinks the rect and
 * re-derives the insets together (see `cropWindow` in `crop.ts`) when the user
 * drags a crop handle, which is what makes cropping feel like trimming rather
 * than zooming.
 */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PictureElement extends BaseElement {
  type: 'picture';
  /** Asset ref or data URL; resolved via the asset store. */
  src: string;
  /**
   * Absent means "no crop" — and an uncropped picture is COVER-fit into its
   * rect (centred, aspect kept, overflow trimmed), which is the one thing a
   * `Crop` can't express without knowing the source's pixel size. Entering crop
   * mode is what turns that implicit cover trim into explicit insets.
   */
  crop?: Crop;
  outline?: Outline;
}

export type SlideElement =
  | TextElement
  | ShapeElement
  | LineElement
  | PictureElement
  | PathElement;

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
  /**
   * Charts living on this slide. Each one owns the elements stamped with its
   * `groupId`; everything else on the slide is untouched by a recompile, which
   * is what makes more than one chart per slide possible.
   */
  charts?: ChartInstance[];
  /**
   * @deprecated The pre-engine single-chart-per-slide config. Migrated into
   * `charts` on load (`model/chart/migrate.ts`) and then cleared.
   */
  chart?: SlideChartConfig;
}

export interface Deck {
  id: string;
  title: string;
  /**
   * Model version this deck was last written at. Migrations run on load and
   * are idempotent, but the stamp makes "has this been through migration N?"
   * answerable without re-scanning every slide. Absent = pre-versioning.
   */
  schemaVersion?: number;
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
export const isPath = (e: SlideElement): e is PathElement => e.type === 'path';
