/**
 * The shape tree: `<p:spTree>` -> `SlideElement[]`.
 *
 * Three things here are where fidelity is won or lost:
 *
 * 1. **Placeholder inheritance.** A title on a slide usually carries no
 *    geometry and no text style at all — both live on the layout, and the
 *    layout's on the master. `inheritedPlaceholder` walks that chain.
 * 2. **Style references.** A shape inserted in PowerPoint has no explicit fill
 *    either; it has `<p:style><a:fillRef idx="1">`, which points into the
 *    theme's format scheme. Resolving those is what stops every imported shape
 *    from arriving unfilled.
 * 3. **Group transforms.** A group declares a child coordinate space
 *    (`chOff`/`chExt`) that is mapped onto its own box, and the mapping
 *    composes through nesting. We flatten groups into the model's flat
 *    `groupIds` membership, so the transform has to be applied, not deferred.
 */
import { nanoid } from 'nanoid';
import {
  isCropped,
  type Crop,
  type DesignSystem,
  type EMU,
  type Fill,
  type Outline,
  type Rect,
  type ShapeElement,
  type SlideElement,
  type TextElement,
} from '@/model';
import { attr, boolAttr, child, children, numAttr, type XmlNode } from '../xml';
import type { OpcPackage } from './opc';
import {
  resolveColorNode,
  resolveFillColor,
  toColorRef,
  type ColorContext,
  type ThemeColors,
} from './color';
import {
  custGeomToPath,
  LINE_PRESETS,
  parseAdjustments,
  presetToPath,
  presetToShape,
} from './geometry';
import { parseTextBody, type TextContext } from './text';

/** The theme's format scheme — what `fillRef`/`lnRef` index into. */
export interface FormatScheme {
  fills: XmlNode[];
  lines: XmlNode[];
  bgFills: XmlNode[];
}

export interface SlideContext extends TextContext {
  ds: DesignSystem;
  theme: ThemeColors;
  fmt: FormatScheme;
  pkg: OpcPackage;
  /** Part name of the slide, for resolving its own r:ids (images, charts). */
  part: string;
  /** Placeholder lookup into layout then master. */
  placeholders: PlaceholderIndex;
  slideSize: { w: EMU; h: EMU };
  /** Master text styles, keyed by placeholder family. */
  masterStyles: { title?: XmlNode; body?: XmlNode; other?: XmlNode };
  /** Deck-level default text style from presentation.xml. */
  defaultTextStyle?: XmlNode;
  /** Warnings surfaced to the user rather than swallowed. */
  warn: (message: string) => void;
}

export interface PlaceholderIndex {
  /** Shapes from the layout, then the master, most specific first. */
  chain: XmlNode[][];
}

export function parseFormatScheme(themeXml: XmlNode | undefined): FormatScheme {
  const fmt = child(child(themeXml, 'themeElements'), 'fmtScheme');
  return {
    fills: child(fmt, 'fillStyleLst')?.children ?? [],
    lines: child(fmt, 'lnStyleLst')?.children ?? [],
    bgFills: child(fmt, 'bgFillStyleLst')?.children ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Transforms                                                          */
/* ------------------------------------------------------------------ */

/** A group's child-space -> parent-space mapping, composed through nesting. */
export interface Transform {
  apply: (r: Rect) => Rect;
  /** Extra rotation contributed by enclosing groups, in degrees. */
  rotation: number;
  groupIds: string[];
}

export const IDENTITY: Transform = { apply: (r) => r, rotation: 0, groupIds: [] };

function readXfrm(xfrm: XmlNode | undefined): {
  rect?: Rect;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  childOffset?: { x: number; y: number; w: number; h: number };
} {
  const off = child(xfrm, 'off');
  const ext = child(xfrm, 'ext');
  const chOff = child(xfrm, 'chOff');
  const chExt = child(xfrm, 'chExt');
  const rect =
    off && ext
      ? {
          x: numAttr(off, 'x') ?? 0,
          y: numAttr(off, 'y') ?? 0,
          w: numAttr(ext, 'cx') ?? 0,
          h: numAttr(ext, 'cy') ?? 0,
        }
      : undefined;
  return {
    rect,
    rotation: (numAttr(xfrm, 'rot') ?? 0) / 60_000,
    flipH: boolAttr(xfrm, 'flipH') ?? false,
    flipV: boolAttr(xfrm, 'flipV') ?? false,
    childOffset:
      chOff && chExt
        ? {
            x: numAttr(chOff, 'x') ?? 0,
            y: numAttr(chOff, 'y') ?? 0,
            w: numAttr(chExt, 'cx') ?? 0,
            h: numAttr(chExt, 'cy') ?? 0,
          }
        : undefined,
  };
}

/** Compose a group's transform onto the one it sits inside. */
function composeGroup(parent: Transform, grpXfrm: XmlNode | undefined, groupId: string): Transform {
  const { rect, rotation, childOffset } = readXfrm(grpXfrm);
  const groupIds = [...parent.groupIds, groupId];
  if (!rect || !childOffset || !childOffset.w || !childOffset.h) {
    return { ...parent, groupIds };
  }

  const sx = rect.w / childOffset.w;
  const sy = rect.h / childOffset.h;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const rad = (rotation * Math.PI) / 180;

  return {
    groupIds,
    rotation: parent.rotation + rotation,
    apply: (r) => {
      // Child space -> the group's own box.
      let x = rect.x + (r.x - childOffset.x) * sx;
      let y = rect.y + (r.y - childOffset.y) * sy;
      const w = r.w * sx;
      const h = r.h * sy;

      // A rotated group turns its children about the group's centre; each
      // child then also spins by the same angle (added to `rotation` above).
      if (rotation) {
        const px = x + w / 2 - cx;
        const py = y + h / 2 - cy;
        const rx = px * Math.cos(rad) - py * Math.sin(rad);
        const ry = px * Math.sin(rad) + py * Math.cos(rad);
        x = cx + rx - w / 2;
        y = cy + ry - h / 2;
      }

      return parent.apply({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Fills and lines                                                     */
/* ------------------------------------------------------------------ */

const FILL_ELEMENTS = ['solidFill', 'noFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];

export function findFillNode(container: XmlNode | undefined): XmlNode | undefined {
  return container?.children.find((c) => FILL_ELEMENTS.includes(c.name));
}

/**
 * Turn a fill element into the model's Fill.
 *
 * Gradients and patterns have no model equivalent (they're excluded on purpose
 * — they don't survive the PowerPoint/Slides round trip identically), so they
 * collapse to their dominant colour rather than disappearing.
 */
export function toFill(
  node: XmlNode | undefined,
  ctx: ColorContext,
  ds: DesignSystem,
): Fill | undefined {
  if (!node) return undefined;
  switch (node.name) {
    case 'noFill':
      return { kind: 'none' };
    case 'solidFill': {
      const c = resolveFillColor(node, ctx);
      if (!c) return undefined;
      return { kind: 'solid', color: toColorRef(c.hex, ds), alpha: c.alpha < 1 ? c.alpha : undefined };
    }
    case 'gradFill': {
      // The stop nearest the middle reads closest to how the gradient looks as
      // a flat colour; PowerPoint's own "convert to solid" does the same.
      const stops = children(child(node, 'gsLst'), 'gs');
      if (!stops.length) return undefined;
      const mid = stops[Math.floor(stops.length / 2)];
      const c = resolveFillColor(mid, ctx);
      return c
        ? { kind: 'solid', color: toColorRef(c.hex, ds), alpha: c.alpha < 1 ? c.alpha : undefined }
        : undefined;
    }
    case 'pattFill': {
      const fg = resolveFillColor(child(node, 'fgClr'), ctx);
      return fg ? { kind: 'solid', color: toColorRef(fg.hex, ds), alpha: 0.5 } : undefined;
    }
    default:
      return undefined;
  }
}

const DASH: Record<string, Outline['dash']> = {
  solid: 'solid',
  dot: 'dot',
  sysDot: 'dot',
  sysDash: 'dash',
  dash: 'dash',
  dashDot: 'dash',
  lgDash: 'dash',
  lgDashDot: 'dash',
  lgDashDotDot: 'dash',
  sysDashDot: 'dash',
  sysDashDotDot: 'dash',
};

export function toOutline(
  ln: XmlNode | undefined,
  ctx: ColorContext,
  ds: DesignSystem,
): Outline | undefined {
  if (!ln) return undefined;
  if (child(ln, 'noFill')) return undefined;
  const fill = findFillNode(ln);
  const color = fill ? toFill(fill, ctx, ds) : undefined;
  if (!color || color.kind !== 'solid') return undefined;
  return {
    color: color.color,
    // PowerPoint's default line weight when `w` is omitted is 0.75pt.
    widthEmu: numAttr(ln, 'w') ?? 9_525,
    dash: DASH[attr(child(ln, 'prstDash'), 'val') ?? 'solid'] ?? 'solid',
  };
}

/** Resolve `<p:style>`'s theme references into a concrete fill and line. */
function styleRefs(
  style: XmlNode | undefined,
  ctx: SlideContext,
): { fill?: Fill; outline?: Outline; fontColor?: ReturnType<typeof toColorRef> } {
  if (!style) return {};

  const refColor = (ref: XmlNode | undefined): string | undefined => {
    const c = ref?.children.find((n) => n.name !== 'extLst');
    return c ? resolveColorNode(c, ctx)?.hex : undefined;
  };

  const fillRef = child(style, 'fillRef');
  const lnRef = child(style, 'lnRef');
  const fontRef = child(style, 'fontRef');

  // idx is 1-based into the theme's style lists; 0 means "no fill/line".
  const fillIdx = numAttr(fillRef, 'idx') ?? 0;
  const lnIdx = numAttr(lnRef, 'idx') ?? 0;

  const fillNode = fillIdx > 0 ? ctx.fmt.fills[fillIdx - 1] : undefined;
  const lnNode = lnIdx > 0 ? ctx.fmt.lines[lnIdx - 1] : undefined;

  const fill = fillNode
    ? toFill(fillNode, { ...ctx, phClr: refColor(fillRef) }, ctx.ds)
    : undefined;
  const outline = lnNode
    ? toOutline(lnNode, { ...ctx, phClr: refColor(lnRef) }, ctx.ds)
    : undefined;
  const fontHex = refColor(fontRef);

  return {
    fill,
    outline,
    fontColor: fontHex ? toColorRef(fontHex, ctx.ds) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Placeholders                                                        */
/* ------------------------------------------------------------------ */

interface PlaceholderKey {
  type: string;
  idx: string | undefined;
}

function placeholderOf(shape: XmlNode): PlaceholderKey | undefined {
  const ph =
    child(child(child(shape, 'nvSpPr'), 'nvPr'), 'ph') ??
    child(child(child(shape, 'nvGraphicFramePr'), 'nvPr'), 'ph') ??
    child(child(child(shape, 'nvPicPr'), 'nvPr'), 'ph');
  if (!ph) return undefined;
  return { type: attr(ph, 'type') ?? 'body', idx: attr(ph, 'idx') };
}

/**
 * The layout (then master) shape a slide placeholder inherits from.
 *
 * `idx` is the strong match — two body placeholders on one layout are told
 * apart only by it. Type alone is the fallback, and title/ctrTitle are
 * interchangeable across a layout/master pair.
 */
function inheritedPlaceholder(
  key: PlaceholderKey,
  chain: XmlNode[][],
): XmlNode | undefined {
  const family = (t: string) => (t === 'ctrTitle' || t === 'title' ? 'title' : t);
  for (const level of chain) {
    const byIdx =
      key.idx !== undefined
        ? level.find((s) => placeholderOf(s)?.idx === key.idx)
        : undefined;
    if (byIdx) return byIdx;
    const byType = level.find((s) => {
      const k = placeholderOf(s);
      return k && family(k.type) === family(key.type);
    });
    if (byType) return byType;
  }
  return undefined;
}

/** Which master text style a placeholder type reads from. */
function masterStyleFor(type: string | undefined, ctx: SlideContext): XmlNode | undefined {
  if (type === 'title' || type === 'ctrTitle') return ctx.masterStyles.title;
  if (
    type === 'body' ||
    type === 'subTitle' ||
    type === 'obj' ||
    type === undefined
  ) {
    return ctx.masterStyles.body;
  }
  return ctx.masterStyles.other;
}

/* ------------------------------------------------------------------ */
/* The walker                                                          */
/* ------------------------------------------------------------------ */

export async function parseShapeTree(
  spTree: XmlNode,
  ctx: SlideContext,
  transform: Transform = IDENTITY,
): Promise<SlideElement[]> {
  const out: SlideElement[] = [];
  for (const node of spTree.children) {
    switch (node.name) {
      case 'sp':
        out.push(...(await parseSp(node, ctx, transform)));
        break;
      case 'pic':
        out.push(...(await parsePic(node, ctx, transform)));
        break;
      case 'cxnSp':
        out.push(...(await parseConnector(node, ctx, transform)));
        break;
      case 'grpSp': {
        const groupId = `grp_${nanoid(8)}`;
        const inner = composeGroup(
          transform,
          child(child(node, 'grpSpPr'), 'xfrm'),
          groupId,
        );
        out.push(...(await parseShapeTree(node, ctx, inner)));
        break;
      }
      case 'graphicFrame':
        out.push(...(await parseGraphicFrame(node, ctx, transform)));
        break;
    }
  }
  return out;
}

function baseProps(
  node: XmlNode,
  xfrmNode: XmlNode | undefined,
  transform: Transform,
  fallback: Rect,
) {
  const x = readXfrm(xfrmNode);
  const rect = transform.apply(x.rect ?? fallback);
  const nameNode =
    child(child(node, 'nvSpPr'), 'cNvPr') ??
    child(child(node, 'nvPicPr'), 'cNvPr') ??
    child(child(node, 'nvCxnSpPr'), 'cNvPr') ??
    child(child(node, 'nvGraphicFramePr'), 'cNvPr');
  const rotation = x.rotation + transform.rotation;
  return {
    id: nanoid(10),
    name: attr(nameNode, 'name') || undefined,
    rect,
    rotation: rotation ? round2(rotation) : undefined,
    flipH: x.flipH || undefined,
    flipV: x.flipV || undefined,
    groupIds: transform.groupIds.length ? [...transform.groupIds] : undefined,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Role stamped from the placeholder type, so brand/reformat can find it. */
const ROLE: Record<string, string> = {
  title: 'title',
  ctrTitle: 'title',
  subTitle: 'subtitle',
  body: 'body',
  ftr: 'footer',
  sldNum: 'pageNumber',
  dt: 'date',
};

async function parseSp(
  sp: XmlNode,
  ctx: SlideContext,
  transform: Transform,
): Promise<SlideElement[]> {
  const spPr = child(sp, 'spPr');
  const ph = placeholderOf(sp);
  const inherited = ph ? inheritedPlaceholder(ph, ctx.placeholders.chain) : undefined;

  // Geometry falls back to the layout's placeholder box when the slide omits it.
  const xfrmNode =
    child(spPr, 'xfrm') ?? child(child(inherited, 'spPr'), 'xfrm');
  const base = baseProps(sp, xfrmNode, transform, {
    x: 0,
    y: 0,
    w: ctx.slideSize.w,
    h: ctx.slideSize.h,
  });

  const style = styleRefs(child(sp, 'style'), ctx);
  const explicitFill = findFillNode(spPr);
  const inheritedFill = inherited ? findFillNode(child(inherited, 'spPr')) : undefined;
  const fill =
    toFill(explicitFill, ctx, ctx.ds) ??
    (explicitFill ? undefined : toFill(inheritedFill, ctx, ctx.ds)) ??
    style.fill;
  const outline =
    toOutline(child(spPr, 'ln'), ctx, ctx.ds) ??
    (child(spPr, 'ln') ? undefined : toOutline(child(child(inherited, 'spPr'), 'ln'), ctx, ctx.ds)) ??
    style.outline;

  const prstGeom = child(spPr, 'prstGeom') ?? child(child(inherited, 'spPr'), 'prstGeom');
  const custGeom = child(spPr, 'custGeom') ?? child(child(inherited, 'spPr'), 'custGeom');
  const prst = attr(prstGeom, 'prst') ?? 'rect';

  // Text style layers, generic -> specific.
  const textCtx: TextContext = {
    ...ctx,
    layers: [
      ctx.defaultTextStyle,
      masterStyleFor(ph?.type, ctx),
      child(child(inherited, 'txBody'), 'lstStyle'),
    ],
  };

  const txBody = child(sp, 'txBody');
  const parsed = txBody ? parseTextBody(txBody, textCtx) : undefined;
  const body = parsed && !parsed.empty ? parsed.body : undefined;

  // Empty placeholders on the slide are prompt text ("Click to add title"),
  // never content — importing them would litter the deck with empty boxes.
  if (!body && ph && !fill && !outline) return [];

  const elements: SlideElement[] = [];

  if (LINE_PRESETS.has(prst)) {
    if (!outline) return [];
    elements.push({ ...base, type: 'line', outline });
    return elements;
  }

  const preset = presetToShape(prst);
  const role = ph ? ROLE[ph.type] : undefined;

  if (custGeom) {
    const d = custGeomToPath(custGeom, { w: base.rect.w, h: base.rect.h });
    if (d.length) {
      elements.push({ ...base, role, type: 'path', d, fill, outline });
      if (body) elements.push(textOverlay(base, body, role));
      return elements;
    }
  }

  if (!preset) {
    const d = presetToPath(prst, parseAdjustments(prstGeom));
    if (d) {
      elements.push({ ...base, role, type: 'path', d, fill, outline });
      if (body) elements.push(textOverlay(base, body, role));
      return elements;
    }
    ctx.warn(`Shape geometry "${prst}" isn't supported; imported as a rectangle.`);
  }

  // A bare text box is a text element; anything with geometry is a shape that
  // may carry text — the same split the model draws.
  // An explicit `<a:noFill/>` is still "nothing painted" — a rect with no fill,
  // no outline and text in it is a text box, however the writer spelled it.
  const painted = !!fill && fill.kind !== 'none';
  const isTextBox =
    boolAttr(child(child(sp, 'nvSpPr'), 'cNvSpPr'), 'txBox') ||
    (!!body && !painted && !outline && (preset ?? 'rect') === 'rect');

  if (isTextBox && body) {
    const el: TextElement = { ...base, role, type: 'text', body, fill, outline };
    elements.push(el);
  } else {
    const el: ShapeElement = {
      ...base,
      role,
      type: 'shape',
      preset: preset ?? 'rect',
      fill,
      outline,
      body,
    };
    elements.push(el);
  }
  return elements;
}

/** Text that sits on a path element, which the model can't carry inline. */
function textOverlay(
  base: ReturnType<typeof baseProps>,
  body: NonNullable<ReturnType<typeof parseTextBody>['body']>,
  role: string | undefined,
): TextElement {
  return { ...base, id: nanoid(10), role, type: 'text', body };
}

async function parsePic(
  pic: XmlNode,
  ctx: SlideContext,
  transform: Transform,
): Promise<SlideElement[]> {
  const base = baseProps(pic, child(child(pic, 'spPr'), 'xfrm'), transform, {
    x: 0, y: 0, w: 0, h: 0,
  });
  const blipFill = child(pic, 'blipFill');
  const blip = child(blipFill, 'blip');
  const src = await imageDataUrl(attr(blip, 'embed'), ctx);
  if (!src) {
    ctx.warn('An image could not be read from the file and was skipped.');
    return [];
  }
  return [
    {
      ...base,
      type: 'picture',
      src,
      crop: toCrop(child(blipFill, 'srcRect')),
      outline: toOutline(child(child(pic, 'spPr'), 'ln'), ctx, ctx.ds),
    },
  ];
}

/**
 * `<a:srcRect>` — the same insets our `Crop` carries, in thousandths of a
 * percent. Absent sides mean no trim on that side, and an srcRect that trims
 * nothing is dropped so the picture keeps the plain cover fit.
 */
function toCrop(srcRect: XmlNode | undefined): Crop | undefined {
  if (!srcRect) return undefined;
  const side = (name: string) => (numAttr(srcRect, name) ?? 0) / 100000;
  const crop: Crop = {
    left: side('l'),
    top: side('t'),
    right: side('r'),
    bottom: side('b'),
  };
  return isCropped(crop) ? crop : undefined;
}

async function parseConnector(
  cxn: XmlNode,
  ctx: SlideContext,
  transform: Transform,
): Promise<SlideElement[]> {
  const spPr = child(cxn, 'spPr');
  const base = baseProps(cxn, child(spPr, 'xfrm'), transform, { x: 0, y: 0, w: 0, h: 0 });
  const style = styleRefs(child(cxn, 'style'), ctx);
  const outline = toOutline(child(spPr, 'ln'), ctx, ctx.ds) ?? style.outline;
  if (!outline) return [];
  const ln = child(spPr, 'ln');
  return [
    {
      ...base,
      type: 'line',
      outline,
      startArrow: !!child(ln, 'headEnd') && attr(child(ln, 'headEnd'), 'type') !== 'none',
      endArrow: !!child(ln, 'tailEnd') && attr(child(ln, 'tailEnd'), 'type') !== 'none',
    },
  ];
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
};

/**
 * Every media part is turned into a data URL exactly ONCE per package, and the
 * same string is handed to every shape that uses it.
 *
 * This matters more than it looks: a deck's logo or section photo is one part in
 * the zip but appears on dozens of slides, and without this cache each use got
 * its own copy of the base64 — the same picture inflated 40× in memory and again
 * in whatever the deck is saved into.
 */
const mediaCache = new WeakMap<OpcPackage, Map<string, string | null>>();

/**
 * Longest edge we keep, in pixels. A slide is 13.3in wide, so ~2000px is 150dpi
 * across the full bleed — past that the extra pixels are invisible on screen and
 * in an export, and are the single biggest reason a big deck won't fit in
 * storage.
 */
const MAX_IMAGE_EDGE = 2000;
/** Below this, re-encoding costs more than it saves. */
const SHRINK_OVER_BYTES = 200 * 1024;

async function imageDataUrl(rId: string | undefined, ctx: SlideContext): Promise<string | null> {
  const part = await ctx.pkg.related(ctx.part, rId);
  if (!part) return null;

  const ext = part.slice(part.lastIndexOf('.') + 1).toLowerCase();
  const mime = MIME[ext];
  if (!mime || mime === 'image/emf' || mime === 'image/wmf') {
    // EMF/WMF are vector metafiles no browser can draw; better to say so than
    // to plant an unrenderable data URL in the deck. Warned per use, since the
    // note is about this shape, not about the part.
    ctx.warn(`Vector image format .${ext} isn't supported by browsers; that image was skipped.`);
    return null;
  }

  let cache = mediaCache.get(ctx.pkg);
  if (!cache) {
    cache = new Map();
    mediaCache.set(ctx.pkg, cache);
  }
  const hit = cache.get(part);
  if (hit !== undefined) return hit;

  const bytes = await ctx.pkg.bytes(part);
  if (!bytes) {
    cache.set(part, null);
    return null;
  }

  const shrunk = await shrink(bytes, mime);
  if (shrunk) ctx.warn('Oversized images were scaled down so the deck stays a workable size.');
  const url = shrunk ?? `data:${mime};base64,${base64(bytes)}`;
  cache.set(part, url);
  return url;
}

/**
 * Re-encode an oversized raster at screen resolution, or return null to keep the
 * original. Null is also the answer wherever the platform can't decode images
 * (Node, tests) — the import still works there, just without the saving.
 */
async function shrink(bytes: Uint8Array, mime: string): Promise<string | null> {
  if (mime === 'image/svg+xml') return null; // vector: pixels don't apply
  if (bytes.length <= SHRINK_OVER_BYTES) return null;
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return null;
  }

  try {
    const source = new Blob([bytes as BlobPart], { type: mime });
    const bmp = await createImageBitmap(source);
    const longest = Math.max(bmp.width, bmp.height);
    const scale = Math.min(1, MAX_IMAGE_EDGE / longest);
    // Already small enough in pixels: re-encoding at 1:1 would only trade one
    // set of compression artefacts for another.
    if (scale === 1) {
      bmp.close();
      return null;
    }

    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bmp.width * scale)),
      Math.max(1, Math.round(bmp.height * scale)),
    );
    const c2d = canvas.getContext('2d');
    if (!c2d) {
      bmp.close();
      return null;
    }
    c2d.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();

    // PNG keeps its alpha; photographs go to JPEG, which is what they were.
    const outMime = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob({ type: outMime, quality: 0.85 });
    // A re-encode that isn't actually smaller is a pure loss of fidelity.
    if (blob.size >= bytes.length) return null;
    const out = new Uint8Array(await blob.arrayBuffer());
    return `data:${outMime};base64,${base64(out)}`;
  } catch {
    return null; // undecodable: fall back to shipping the original bytes
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
}

/* ------------------------------------------------------------------ */
/* Graphic frames: tables and charts                                   */
/* ------------------------------------------------------------------ */

async function parseGraphicFrame(
  frame: XmlNode,
  ctx: SlideContext,
  transform: Transform,
): Promise<SlideElement[]> {
  const base = baseProps(frame, child(frame, 'xfrm'), transform, { x: 0, y: 0, w: 0, h: 0 });
  const data = child(child(frame, 'graphic'), 'graphicData');
  const uri = attr(data, 'uri') ?? '';

  if (child(data, 'tbl')) return parseTable(child(data, 'tbl')!, base, ctx);

  if (uri.includes('/chart')) {
    // Charts are handled by the chart mapper, which needs the frame's box.
    return [];
  }

  ctx.warn('An embedded object (OLE/SmartArt) was skipped — no equivalent in the model.');
  return [];
}

/**
 * A table becomes real cells: one rect per cell plus its text.
 *
 * The model has no table primitive on purpose (tables are the least
 * interoperable OOXML construct), so this is a faithful decomposition rather
 * than a lossy screenshot — every cell stays editable and on-brand.
 */
async function parseTable(
  tbl: XmlNode,
  base: ReturnType<typeof baseProps>,
  ctx: SlideContext,
): Promise<SlideElement[]> {
  const out: SlideElement[] = [];
  const groupId = `tbl_${nanoid(8)}`;
  const groupIds = [...(base.groupIds ?? []), groupId];

  const colWidths = children(child(tbl, 'tblGrid'), 'gridCol').map(
    (c) => numAttr(c, 'w') ?? 0,
  );
  const rows = children(tbl, 'tr');
  const totalW = colWidths.reduce((a, b) => a + b, 0) || base.rect.w;
  const scaleX = base.rect.w / totalW;

  let y = base.rect.y;
  for (const tr of rows) {
    const rowH = numAttr(tr, 'h') ?? 0;
    let x = base.rect.x;
    const cells = children(tr, 'tc');
    for (let c = 0; c < cells.length; c++) {
      const tc = cells[c];
      const w = (colWidths[c] ?? totalW / Math.max(1, cells.length)) * scaleX;
      // Merged cells: the covered ones carry hMerge/vMerge and draw nothing.
      const spannedH = numAttr(tc, 'gridSpan') ?? 1;
      const merged = attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1';
      const cellW = spannedH > 1
        ? colWidths.slice(c, c + spannedH).reduce((a, b) => a + (b ?? 0), 0) * scaleX
        : w;

      if (!merged) {
        const tcPr = child(tc, 'tcPr');
        const fill = toFill(findFillNode(tcPr), ctx, ctx.ds);
        const rect: Rect = {
          x: Math.round(x),
          y: Math.round(y),
          w: Math.round(cellW),
          h: Math.round(rowH),
        };
        out.push({
          id: nanoid(10),
          type: 'shape',
          preset: 'rect',
          rect,
          groupIds,
          fill: fill ?? { kind: 'none' },
          outline:
            toOutline(child(tcPr, 'lnL'), ctx, ctx.ds) ??
            toOutline(child(tcPr, 'lnT'), ctx, ctx.ds) ?? {
              color: toColorRef('#E5E7EB', ctx.ds),
              widthEmu: 9_525,
              dash: 'solid',
            },
        });

        const txBody = child(tc, 'txBody');
        if (txBody) {
          const parsed = parseTextBody(txBody, {
            ...ctx,
            layers: [ctx.defaultTextStyle],
          });
          if (!parsed.empty) {
            out.push({
              id: nanoid(10),
              type: 'text',
              rect,
              groupIds,
              body: { ...parsed.body, anchor: parsed.body.anchor ?? 'middle' },
            });
          }
        }
      }
      x += w;
    }
    y += rowH;
  }

  // A table whose rows declared no height still has to fill the frame.
  const declaredH = rows.reduce((a, r) => a + (numAttr(r, 'h') ?? 0), 0);
  if (!declaredH && out.length) {
    const rowH = base.rect.h / Math.max(1, rows.length);
    out.forEach((el, i) => {
      const rowIndex = Math.floor(i / Math.max(1, colWidths.length));
      el.rect = { ...el.rect, y: base.rect.y + rowIndex * rowH, h: rowH };
    });
  }

  return out;
}

/** The frames that hold charts, with the box each one occupies. */
export function chartFrames(
  spTree: XmlNode,
  transform: Transform = IDENTITY,
): { rId: string; rect: Rect; rotation: number }[] {
  const out: { rId: string; rect: Rect; rotation: number }[] = [];
  const walk = (node: XmlNode, t: Transform) => {
    for (const c of node.children) {
      if (c.name === 'grpSp') {
        walk(c, composeGroup(t, child(child(c, 'grpSpPr'), 'xfrm'), `grp_${nanoid(6)}`));
      } else if (c.name === 'graphicFrame') {
        const data = child(child(c, 'graphic'), 'graphicData');
        const rId = attr(child(data, 'chart'), 'id');
        if (!rId) continue;
        const x = readXfrm(child(c, 'xfrm'));
        if (!x.rect) continue;
        out.push({ rId, rect: t.apply(x.rect), rotation: x.rotation + t.rotation });
      }
    }
  };
  walk(spTree, transform);
  return out;
}
