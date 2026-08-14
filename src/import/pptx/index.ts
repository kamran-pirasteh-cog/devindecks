/**
 * .pptx -> our model.
 *
 * Reads the package, resolves each slide against its layout, master and theme,
 * and produces plain `Slide` objects — no store, no React. The result is a
 * PREVIEW: the dialog renders these with the same `<SlideView>` the canvas
 * uses, so what the user picks from is literally what they'll get.
 */
import { nanoid } from 'nanoid';
import {
  SLIDE_16x9,
  type DesignSystem,
  type Fill,
  type Slide,
} from '@/model';
import { insertChartInto } from '@/store/chartActions';
import { child, children, numAttr, type XmlNode } from '../xml';
import { OpcPackage } from './opc';
import {
  DEFAULT_COLOR_MAP,
  parseColorMap,
  parseTheme,
  resolveFillColor,
  toColorRef,
  type ColorMap,
  type ThemeColors,
} from './color';
import { parseChartPart } from './chart';
import {
  chartFrames,
  findFillNode,
  parseFormatScheme,
  parseShapeTree,
  toFill,
  type FormatScheme,
  type SlideContext,
} from './shapes';

export interface ImportedSlide {
  slide: Slide;
  /** 1-based position in the source file, for the picker's labels. */
  sourceIndex: number;
  /** Fidelity notes for this slide, deduped. */
  notes: string[];
}

export interface ImportedDeck {
  slideSize: { w: number; h: number };
  slides: ImportedSlide[];
  /** Package-level problems (a corrupt part, an unreadable theme). */
  notes: string[];
}

export async function parsePptx(
  buffer: ArrayBuffer,
  ds: DesignSystem,
): Promise<ImportedDeck> {
  const pkg = await OpcPackage.open(buffer);
  const deckNotes: string[] = [];

  const presPart = await pkg.presentationPart();
  const pres = await pkg.xml(presPart);
  const sldSz = child(pres, 'sldSz');
  const slideSize = {
    w: numAttr(sldSz, 'cx') ?? SLIDE_16x9.w,
    h: numAttr(sldSz, 'cy') ?? SLIDE_16x9.h,
  };
  const defaultTextStyle = child(pres, 'defaultTextStyle');

  const slideParts = await pkg.slideParts();
  const slides: ImportedSlide[] = [];

  for (let i = 0; i < slideParts.length; i++) {
    const part = slideParts[i];
    try {
      slides.push(
        await parseSlide(pkg, part, i, { ds, slideSize, defaultTextStyle }),
      );
    } catch (err) {
      deckNotes.push(
        `Slide ${i + 1} could not be read (${(err as Error).message}) and was skipped.`,
      );
    }
  }

  return { slideSize, slides, notes: deckNotes };
}

interface DeckEnv {
  ds: DesignSystem;
  slideSize: { w: number; h: number };
  defaultTextStyle: XmlNode | undefined;
}

async function parseSlide(
  pkg: OpcPackage,
  part: string,
  index: number,
  env: DeckEnv,
): Promise<ImportedSlide> {
  const slideXml = await pkg.xml(part);
  if (!slideXml) throw new Error('missing part');

  const layoutPart = await pkg.relatedByType(part, 'slideLayout');
  const layoutXml = layoutPart ? await pkg.xml(layoutPart) : undefined;
  const masterPart = layoutPart
    ? await pkg.relatedByType(layoutPart, 'slideMaster')
    : undefined;
  const masterXml = masterPart ? await pkg.xml(masterPart) : undefined;
  const themePart = masterPart ? await pkg.relatedByType(masterPart, 'theme') : undefined;
  const themeXml = themePart ? await pkg.xml(themePart) : undefined;

  const theme: ThemeColors = parseTheme(themeXml);
  const fmt: FormatScheme = parseFormatScheme(themeXml);
  const clrMap: ColorMap = masterXml
    ? parseColorMap(child(masterXml, 'clrMap'))
    : { ...DEFAULT_COLOR_MAP };

  const notes: string[] = [];
  const seen = new Set<string>();
  const warn = (m: string) => {
    if (seen.has(m)) return;
    seen.add(m);
    notes.push(m);
  };

  const spTreeOf = (root: XmlNode | undefined) =>
    child(child(root, 'cSld'), 'spTree');

  const ctx: SlideContext = {
    ds: env.ds,
    theme,
    fmt,
    clrMap,
    pkg,
    part,
    layers: [],
    slideSize: env.slideSize,
    defaultTextStyle: env.defaultTextStyle,
    masterStyles: {
      title: child(child(masterXml, 'txStyles'), 'titleStyle'),
      body: child(child(masterXml, 'txStyles'), 'bodyStyle'),
      other: child(child(masterXml, 'txStyles'), 'otherStyle'),
    },
    placeholders: {
      chain: [
        children(spTreeOf(layoutXml), 'sp'),
        children(spTreeOf(masterXml), 'sp'),
      ],
    },
    warn,
  };

  const spTree = spTreeOf(slideXml);
  if (!spTree) throw new Error('no shape tree');

  const elements = await parseShapeTree(spTree, ctx);

  const slide: Slide = {
    id: `sl_${nanoid(8)}`,
    elements,
    background: await slideBackground(slideXml, layoutXml, masterXml, ctx),
    notes: await speakerNotes(pkg, part),
  };

  // Charts last: `insertChartInto` compiles primitives onto the slide, so the
  // chart's shapes land above the static ones exactly as they did in the source
  // (a graphicFrame is drawn in tree order; this is the common case of charts
  // sitting on top of a background).
  await attachCharts(spTree, slide, ctx);

  return { slide, sourceIndex: index + 1, notes };
}

async function attachCharts(spTree: XmlNode, slide: Slide, ctx: SlideContext) {
  for (const frame of chartFrames(spTree)) {
    const chartPart = await ctx.pkg.related(ctx.part, frame.rId);
    if (!chartPart) continue;
    let chartXml: XmlNode | undefined;
    try {
      chartXml = await ctx.pkg.xml(chartPart);
    } catch {
      chartXml = undefined;
    }
    if (!chartXml) {
      ctx.warn('A chart part could not be read and was skipped.');
      continue;
    }
    const result = parseChartPart(chartXml, ctx, ctx.ds);
    if (!result) {
      ctx.warn('A chart type in this deck has no equivalent here and was skipped.');
      continue;
    }
    result.notes.forEach(ctx.warn);
    const instance = insertChartInto(slide, result.spec, frame.rect, ctx.ds);
    if (frame.rotation) {
      // Charts only live at quarter turns; anything else was never intentional.
      const snapped = (Math.round(frame.rotation / 90) * 90 + 360) % 360;
      if (snapped) instance.rotation = snapped;
    }
  }
}

/**
 * Slide background, following the same inheritance PowerPoint does:
 * slide -> layout -> master, with `bgRef` pointing into the theme.
 */
async function slideBackground(
  slideXml: XmlNode,
  layoutXml: XmlNode | undefined,
  masterXml: XmlNode | undefined,
  ctx: SlideContext,
): Promise<Fill | undefined> {
  for (const root of [slideXml, layoutXml, masterXml]) {
    const bg = child(child(root, 'cSld'), 'bg');
    if (!bg) continue;

    const bgPr = child(bg, 'bgPr');
    if (bgPr) {
      const fill = toFill(findFillNode(bgPr), ctx, ctx.ds);
      if (fill) return fill;
    }

    const bgRef = child(bg, 'bgRef');
    if (bgRef) {
      const idx = numAttr(bgRef, 'idx') ?? 0;
      const colorNode = bgRef.children.find((c) => c.name !== 'extLst');
      const phClr = colorNode ? resolveFillColor(bgRef, ctx)?.hex : undefined;
      // idx 1..999 indexes fillStyleLst; 1001+ indexes bgFillStyleLst.
      const node =
        idx >= 1001 ? ctx.fmt.bgFills[idx - 1001] : idx > 0 ? ctx.fmt.fills[idx - 1] : undefined;
      const fill = node ? toFill(node, { ...ctx, phClr }, ctx.ds) : undefined;
      if (fill) return fill;
      if (phClr) return { kind: 'solid', color: toColorRef(phClr, ctx.ds) };
    }
  }
  return undefined;
}

async function speakerNotes(pkg: OpcPackage, slidePart: string): Promise<string | undefined> {
  const notesPart = await pkg.relatedByType(slidePart, 'notesSlide');
  if (!notesPart) return undefined;
  const xml = await pkg.xml(notesPart);
  if (!xml) return undefined;
  const paragraphs: string[] = [];
  const walk = (node: XmlNode) => {
    if (node.name === 'p') {
      const text = collectText(node);
      if (text.trim()) paragraphs.push(text);
      return;
    }
    node.children.forEach(walk);
  };
  walk(xml);
  const text = paragraphs.join('\n').trim();
  return text || undefined;
}

function collectText(node: XmlNode): string {
  let out = '';
  const walk = (n: XmlNode) => {
    if (n.name === 't') out += n.text;
    if (n.name === 'br') out += '\n';
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}
