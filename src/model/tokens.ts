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

export interface ColorToken {
  /** Stable id referenced by elements, e.g. 'brand.primary'. */
  id: string;
  name: string;
  hex: string; // #RRGGBB
}

export interface TypeRole {
  font: FontFamily;
  sizePt: number;
  bold?: boolean;
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
}

/** A color reference on any element. Prefer tokens; hex is an escape hatch. */
export type ColorRef =
  | { kind: 'token'; token: string }
  | { kind: 'hex'; hex: string };

export const token = (id: string): ColorRef => ({ kind: 'token', token: id });
export const hex = (h: string): ColorRef => ({ kind: 'hex', hex: h });

/** Resolve a ColorRef to a concrete hex against a design system. */
export function resolveColor(ref: ColorRef | undefined, ds: DesignSystem): string {
  if (!ref) return '#000000';
  if (ref.kind === 'hex') return ref.hex;
  const t = ds.colors.find((c) => c.id === ref.token);
  return t?.hex ?? '#000000';
}

/** Placeholder design system. Real brand kit arrives via Admin. */
export const DEFAULT_DESIGN_SYSTEM: DesignSystem = {
  id: 'ds.default',
  version: 1,
  name: 'Placeholder (awaiting Cognition brand)',
  updatedAt: '2026-08-11T00:00:00.000Z',
  colors: [
    { id: 'brand.primary', name: 'Primary', hex: '#111111' },
    { id: 'brand.accent', name: 'Accent', hex: '#4F46E5' },
    { id: 'ink.strong', name: 'Ink', hex: '#0A0A0A' },
    { id: 'ink.muted', name: 'Muted', hex: '#6B7280' },
    { id: 'surface.base', name: 'Surface', hex: '#FFFFFF' },
    { id: 'surface.subtle', name: 'Subtle Surface', hex: '#F5F5F5' },
    { id: 'line.default', name: 'Line', hex: '#E5E7EB' },
  ],
  fonts: { heading: 'Geist', body: 'Geist', mono: 'Geist Mono' },
  type: {
    title: { font: 'Geist', sizePt: 40, bold: true, colorToken: 'ink.strong' },
    subtitle: { font: 'Geist', sizePt: 20, colorToken: 'ink.muted' },
    heading: { font: 'Geist', sizePt: 24, bold: true, colorToken: 'ink.strong' },
    body: { font: 'Geist', sizePt: 14, colorToken: 'ink.strong' },
    caption: { font: 'Geist', sizePt: 11, colorToken: 'ink.muted' },
    kpiValue: { font: 'Geist', sizePt: 48, bold: true, colorToken: 'brand.accent' },
  },
  pageNumbers: DEFAULT_PAGE_NUMBERS,
};
