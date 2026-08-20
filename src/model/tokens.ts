/**
 * The design system: the single standardized source of brand truth. It is
 * VERSIONED because it's in flux — a deck records which design-system version
 * it was built on, so "apply brand" / "reformat" can re-resolve against the
 * latest. Elements reference colors by TOKEN, not raw hex, so a brand change
 * re-flows everywhere at once.
 *
 * NOTE: the palette below is a neutral placeholder. Kamran supplies the real
 * Cognition brand kit through the Admin view; the fonts, however, are final.
 */

import type { FontFamily } from './fonts';
import { DEFAULT_PAGE_NUMBERS, type PageNumberStyle } from './pageNumbers';
import { DEFAULT_CHART_STYLE, type ChartStyle, type ChartStyleVariant } from './chart/style';
import type { ChartPreviewData } from './chart/previewData';

export interface ColorToken {
  /** Stable id referenced by elements, e.g. 'brand.accent'. */
  id: string;
  name: string;
  hex: string; // #RRGGBB
}

export interface TypeRole {
  font: FontFamily;
  sizePt: number;
  bold?: boolean;
  /**
   * A face between regular and bold — Medium 500 — the same run-level attribute
   * `TextRun.weight` carries, so a role can be set in Geist Medium without
   * pretending Medium is its own family. `bold` still outranks it (see
   * `runWeight`), and OOXML has no Medium, so it exports as regular.
   */
  weight?: number;
  colorToken: string;
}

export interface DesignSystem {
  id: string;
  version: number;
  name: string;
  updatedAt: string;

  colors: ColorToken[];

  fonts: {
    heading: FontFamily;
    body: FontFamily;
    mono: FontFamily;
  };

  /** Semantic text roles templates and defaults resolve through. */
  type: {
    title: TypeRole;
    subtitle: TypeRole;
    heading: TypeRole;
    body: TypeRole;
    caption: TypeRole;
    kpiValue: TypeRole;
  };

  /** How page numbers look on any deck that turns them on. */
  pageNumbers: PageNumberStyle;

  /**
   * How charts look. Brand truth in exactly the way `pageNumbers` is: series
   * colours are token ids, so editing the palette reflows every chart in every
   * deck at once.
   */
  chart: ChartStyle;

  /**
   * Named per-kind formatting variants — "our column charts, the gridless
   * ones, the one with the last bar picked out".
   *
   * Optional because every design system stored before variants existed has no
   * such field, and a kind with no variants resolves to `chart` alone, which is
   * exactly what those decks already drew.
   */
  chartVariants?: ChartStyleVariant[];

  /**
   * The dummy numbers Admin's chart previews draw. Scaffolding for judging a
   * style against the shape of data this brand actually charts — see
   * `model/chart/previewData.ts`. Unset means the built-in sample.
   */
  previewData?: ChartPreviewData;
}

/** A color reference on any element. Prefer tokens; hex is an escape hatch. */
export type ColorRef =
  | { kind: 'token'; token: string }
  | { kind: 'hex'; hex: string };

export const token = (id: string): ColorRef => ({ kind: 'token', token: id });
export const hex = (h: string): ColorRef => ({ kind: 'hex', hex: h });

/**
 * Tokens that no longer exist, and what they became. Decks saved before the
 * palette collapsed its two blacks still reference `brand.primary`, and
 * resolving those to a hardcoded `#000000` would quietly opt them out of every
 * future brand change — so they follow the token that replaced them.
 */
export const LEGACY_COLOR_ALIASES: Record<string, string> = {
  'brand.primary': 'ink.strong',
};

/** Resolve a ColorRef to a concrete hex against a design system. */
export function resolveColor(ref: ColorRef | undefined, ds: DesignSystem): string {
  if (!ref) return '#000000';
  if (ref.kind === 'hex') return ref.hex;
  const id = LEGACY_COLOR_ALIASES[ref.token] ?? ref.token;
  const t = ds.colors.find((c) => c.id === ref.token) ?? ds.colors.find((c) => c.id === id);
  return t?.hex ?? '#000000';
}

/** Placeholder design system. Real brand kit arrives via Admin. */
export const DEFAULT_DESIGN_SYSTEM: DesignSystem = {
  id: 'ds.default',
  version: 1,
  name: 'Placeholder (awaiting Cognition brand)',
  updatedAt: '2026-08-11T00:00:00.000Z',
  colors: [
    // ONE black. The palette used to carry two near-identical darks
    // (`brand.primary` #111111 and `ink.strong` #0A0A0A) that nobody could
    // tell apart on a slide, so they collapsed into this single token; see
    // LEGACY_COLOR_ALIASES for what happens to the old id.
    { id: 'ink.strong', name: 'Black', hex: '#191919' },
    { id: 'brand.accent', name: 'Accent', hex: '#2600FF' },
    { id: 'ink.muted', name: 'Muted', hex: '#6B7280' },
    { id: 'surface.base', name: 'Surface', hex: '#FFFFFF' },
    { id: 'surface.subtle', name: 'Subtle Surface', hex: '#F5F5F5' },
    { id: 'line.default', name: 'Line', hex: '#E5E7EB' },
  ],
  fonts: { heading: 'Geist', body: 'Geist', mono: 'Geist Mono' },
  type: {
    title: { font: 'Geist', sizePt: 26, weight: 500, colorToken: 'ink.strong' },
    subtitle: { font: 'Geist', sizePt: 20, colorToken: 'ink.muted' },
    heading: { font: 'Geist', sizePt: 24, bold: true, colorToken: 'ink.strong' },
    body: { font: 'Geist', sizePt: 14, colorToken: 'ink.strong' },
    caption: { font: 'Geist', sizePt: 11, colorToken: 'ink.muted' },
    kpiValue: { font: 'Geist', sizePt: 48, bold: true, colorToken: 'brand.accent' },
  },
  pageNumbers: DEFAULT_PAGE_NUMBERS,
  chart: DEFAULT_CHART_STYLE,
};
