/**
 * DrawingML colour resolution.
 *
 * A colour in OOXML is a base (`srgbClr`, `schemeClr`, `sysClr`, `prstClr`,
 * `scrgbClr`, `hslClr`) plus an ordered list of TRANSFORMS (`lumMod`, `shade`,
 * `tint`, `alpha`, ...). Ignoring the transforms is the single biggest source
 * of "the import looks washed out" — a theme's accent1 with `lumMod 60000
 * lumOff 40000` is a different colour on the slide than in the palette, and
 * that pairing is what every built-in PowerPoint style is made of.
 *
 * Transform maths follows the ECMA-376 definitions: luminance transforms in
 * HSL, shade/tint in LINEAR RGB (undoing sRGB gamma first), which is what
 * PowerPoint itself does — doing shade naively in gamma space comes out
 * visibly too dark.
 */
import { hex as hexRef, type ColorRef, type DesignSystem } from '@/model';
import { attr, numAttr, type XmlNode } from '../xml';

export interface ThemeColors {
  /** Scheme slot -> #RRGGBB, keyed by the raw slot names (dk1, lt1, accent1...). */
  scheme: Record<string, string>;
  majorFont?: string;
  minorFont?: string;
}

/** Maps `tx1`/`bg1`/... to concrete scheme slots; comes from the master. */
export type ColorMap = Record<string, string>;

export interface ColorContext {
  theme: ThemeColors;
  clrMap: ColorMap;
  /** The style-colour placeholder, set while resolving a shape's style ref. */
  phClr?: string;
}

export interface ResolvedColor {
  hex: string;
  /** 0..1 opacity; 1 unless an `alpha` transform said otherwise. */
  alpha: number;
}

const PRESET_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  gray: '#808080',
  grey: '#808080',
  darkGray: '#A9A9A9',
  lightGray: '#D3D3D3',
  orange: '#FFA500',
  purple: '#800080',
  brown: '#A52A2A',
  pink: '#FFC0CB',
};

export const DEFAULT_COLOR_MAP: ColorMap = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
};

/** Parse `ppt/theme/themeN.xml` into the slots colours resolve against. */
export function parseTheme(themeXml: XmlNode | undefined): ThemeColors {
  const scheme: Record<string, string> = {};
  const elements = themeXml?.children.find((c) => c.name === 'themeElements');
  const clrScheme = elements?.children.find((c) => c.name === 'clrScheme');
  for (const slot of clrScheme?.children ?? []) {
    const srgb = slot.children.find((c) => c.name === 'srgbClr');
    const sys = slot.children.find((c) => c.name === 'sysClr');
    const value = srgb
      ? normalizeHex(attr(srgb, 'val'))
      : sys
        ? normalizeHex(attr(sys, 'lastClr'))
        : undefined;
    if (value) scheme[slot.name] = value;
  }

  const fontScheme = elements?.children.find((c) => c.name === 'fontScheme');
  const typeface = (which: string) =>
    attr(
      fontScheme?.children
        .find((c) => c.name === which)
        ?.children.find((c) => c.name === 'latin'),
      'typeface',
    );

  return {
    scheme,
    majorFont: typeface('majorFont'),
    minorFont: typeface('minorFont'),
  };
}

/** Read a master's `<p:clrMap>` element into a ColorMap. */
export function parseColorMap(clrMapNode: XmlNode | undefined): ColorMap {
  if (!clrMapNode) return { ...DEFAULT_COLOR_MAP };
  const map: ColorMap = { ...DEFAULT_COLOR_MAP };
  for (const [k, v] of Object.entries(clrMapNode.attrs)) map[k] = v;
  return map;
}

/**
 * Resolve a colour CONTAINER — the element that holds a colour child, such as
 * `<a:solidFill>`, `<a:fgClr>` or `<a:lnRef>`. Returns undefined when there is
 * no colour child at all (which is different from an explicit black).
 */
export function resolveFillColor(
  container: XmlNode | undefined,
  ctx: ColorContext,
): ResolvedColor | undefined {
  const node = container?.children.find((c) => isColorNode(c.name));
  return node ? resolveColorNode(node, ctx) : undefined;
}

const isColorNode = (name: string): boolean =>
  name === 'srgbClr' ||
  name === 'schemeClr' ||
  name === 'sysClr' ||
  name === 'prstClr' ||
  name === 'scrgbClr' ||
  name === 'hslClr';

/** Resolve a colour ELEMENT (`<a:srgbClr val="FF0000"><a:alpha .../></a:srgbClr>`). */
export function resolveColorNode(node: XmlNode, ctx: ColorContext): ResolvedColor | undefined {
  let hex: string | undefined;

  switch (node.name) {
    case 'srgbClr':
      hex = normalizeHex(attr(node, 'val'));
      break;
    case 'sysClr':
      hex = normalizeHex(attr(node, 'lastClr')) ?? (attr(node, 'val') === 'window' ? '#FFFFFF' : '#000000');
      break;
    case 'prstClr':
      hex = PRESET_COLORS[attr(node, 'val') ?? ''] ?? '#000000';
      break;
    case 'scrgbClr': {
      // Percentages of LINEAR light, not sRGB bytes.
      const c = (n: string) => linearToSrgb((numAttr(node, n) ?? 0) / 100_000);
      hex = rgbToHex({ r: c('r'), g: c('g'), b: c('b') });
      break;
    }
    case 'hslClr': {
      const h = (numAttr(node, 'hue') ?? 0) / 60_000;
      const s = (numAttr(node, 'sat') ?? 0) / 100_000;
      const l = (numAttr(node, 'lum') ?? 0) / 100_000;
      hex = rgbToHex(hslToRgb({ h, s, l }));
      break;
    }
    case 'schemeClr': {
      const slot = attr(node, 'val') ?? '';
      if (slot === 'phClr') hex = ctx.phClr;
      else hex = ctx.theme.scheme[ctx.clrMap[slot] ?? slot] ?? ctx.theme.scheme[slot];
      break;
    }
  }

  if (!hex) return undefined;

  let rgb = hexToRgb(hex);
  let alpha = 1;

  // Transforms apply in document order — `lumMod` then `lumOff` is not the
  // same colour as the reverse.
  for (const t of node.children) {
    const val = numAttr(t, 'val');
    switch (t.name) {
      case 'alpha':
        if (val !== undefined) alpha *= val / 100_000;
        break;
      case 'alphaOff':
        if (val !== undefined) alpha = clamp01(alpha + val / 100_000);
        break;
      case 'lumMod':
        if (val !== undefined) rgb = withLum(rgb, (l) => l * (val / 100_000));
        break;
      case 'lumOff':
        if (val !== undefined) rgb = withLum(rgb, (l) => l + val / 100_000);
        break;
      case 'satMod':
        if (val !== undefined) rgb = withSat(rgb, (s) => s * (val / 100_000));
        break;
      case 'satOff':
        if (val !== undefined) rgb = withSat(rgb, (s) => s + val / 100_000);
        break;
      case 'shade':
        if (val !== undefined) rgb = mapLinear(rgb, (c) => c * (val / 100_000));
        break;
      case 'tint':
        if (val !== undefined) {
          const t0 = val / 100_000;
          rgb = mapLinear(rgb, (c) => c * t0 + (1 - t0));
        }
        break;
      case 'gray':
        rgb = withSat(rgb, () => 0);
        break;
      case 'inv':
        rgb = { r: 255 - rgb.r, g: 255 - rgb.g, b: 255 - rgb.b };
        break;
    }
  }

  return { hex: rgbToHex(rgb), alpha: clamp01(alpha) };
}

/**
 * A resolved colour as a model ColorRef, snapped to a design-system TOKEN when
 * the hex matches one exactly.
 *
 * This is what makes an imported deck respond to a brand change like a native
 * one: a slide that already used the brand's ink comes in referencing
 * `ink.strong`, not a frozen `#0A0A0A`. Anything else keeps its literal hex —
 * guessing "close enough" would silently recolour the customer's deck.
 */
export function toColorRef(hex: string, ds: DesignSystem): ColorRef {
  const up = hex.toUpperCase();
  const match = ds.colors.find((c) => c.hex.toUpperCase() === up);
  return match ? { kind: 'token', token: match.id } : hexRef(up);
}

/* ------------------------------------------------------------------ */
/* Colour maths                                                       */
/* ------------------------------------------------------------------ */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function normalizeHex(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const clean = v.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return undefined;
  return `#${clean.toUpperCase()}`;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clamp255 = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const linearToSrgb = (c: number): number =>
  (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055) * 255;

/** Apply a function to each channel in linear light, then back to sRGB bytes. */
function mapLinear(rgb: Rgb, fn: (c: number) => number): Rgb {
  const ch = (v: number) => linearToSrgb(clamp01(fn(srgbToLinear(v / 255))));
  return { r: ch(rgb.r), g: ch(rgb.g), b: ch(rgb.b) };
}

function withLum(rgb: Rgb, fn: (l: number) => number): Rgb {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({ ...hsl, l: clamp01(fn(hsl.l)) });
}

function withSat(rgb: Rgb, fn: (s: number) => number): Rgb {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({ ...hsl, s: clamp01(fn(hsl.s)) });
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const channel = (t: number) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };
  return {
    r: channel(hk + 1 / 3) * 255,
    g: channel(hk) * 255,
    b: channel(hk - 1 / 3) * 255,
  };
}
