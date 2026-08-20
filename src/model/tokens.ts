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

import type { SlideArchetype } from './archetype';
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
  /**
   * Display name, for roles added in Admin. The six built-ins are named in the
   * UI that knows them; a role somebody invents needs to carry its own name,
   * because its id is a generated `custom.N` nobody would recognize.
   */
  label?: string;
}

/**
 * The six roles CODE resolves through — `ds.type.body.sizePt` is the fallback
 * size in a dozen places, callout slots and chart text name these ids, and
 * `factories` builds a title out of `ds.type.title`. They're a contract, not
 * data, which is why Admin can add and remove roles beside them but not delete
 * one of them.
 */
export const BUILT_IN_TYPE_ROLES = [
  'title',
  'subtitle',
  'heading',
  'body',
  'caption',
  'kpiValue',
] as const;

export type BuiltInTypeRole = (typeof BUILT_IN_TYPE_ROLES)[number];

/** The built-ins, guaranteed; anything else an admin has added, by id. */
export type TypeRoles = { [K in BuiltInTypeRole]: TypeRole } & {
  [id: string]: TypeRole;
};

/**
 * Where a logo sits on a slide. `title-hero` is the large centred lockup a
 * title slide gets; the corners are the small mark everything else gets.
 */
export type LogoPlacement =
  | 'none'
  | 'title-hero'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export const LOGO_PLACEMENTS: readonly LogoPlacement[] = [
  'none',
  'title-hero',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/**
 * The brand's mark, and the rule for where it goes.
 *
 * Sized by HEIGHT alone: a logo has a fixed aspect ratio it must never be
 * stretched out of, and height is the dimension that has to agree with the type
 * around it. Width follows from the asset.
 *
 * `srcLight`/`srcDark` are the mark for light and dark grounds — the same asset
 * in two inks, not two different logos. Either may be absent: a brand with only
 * a dark-ground mark still works, and a design system with NEITHER is the
 * normal starting state, which is why `logoSlot` renders a placeholder rather
 * than treating an unset logo as "no logo wanted".
 */
export interface BrandLogo {
  /** For light backgrounds. Absent ⇒ a placeholder is drawn instead. */
  srcLight?: string;
  /** For dark backgrounds. Absent ⇒ `srcLight` is used on every ground. */
  srcDark?: string;
  /** Rendered height in inches. Width follows the asset's aspect ratio. */
  heightIn: number;
  /**
   * Aspect ratio (w / h) of the asset, recorded when it was uploaded so layout
   * can reserve the right width without loading the image. 1 until measured.
   */
  aspect: number;
  /** Placement per archetype, falling back to `default`. */
  placement: Partial<Record<SlideArchetype, LogoPlacement>> & { default: LogoPlacement };
}

export const DEFAULT_BRAND_LOGO: BrandLogo = {
  heightIn: 0.28,
  aspect: 1,
  placement: {
    // A title slide carries the lockup as its own element of the design; a
    // section divider is deliberately bare, so the mark doesn't punctuate every
    // few slides.
    title: 'title-hero',
    section: 'none',
    // Full-bleed artwork has nowhere safe for a mark.
    image: 'none',
    default: 'bottom-right',
  },
};

/** Where the logo goes on a slide of this archetype. */
export const logoPlacementFor = (
  logo: BrandLogo | undefined,
  archetype: SlideArchetype,
): LogoPlacement =>
  logo ? (logo.placement[archetype] ?? logo.placement.default) : 'none';

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

  /**
   * Semantic text roles templates and defaults resolve through. Open-shaped on
   * purpose: a brand with a pull-quote or a legal line can add the role here
   * rather than have every deck set it by hand. See `BUILT_IN_TYPE_ROLES`.
   */
  type: TypeRoles;

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

  /**
   * The brand's mark and where it belongs. Optional because every design system
   * stored before logos existed has no such field — and because an unset logo
   * is a real state with real behaviour (a visible placeholder), not a missing
   * value to be defaulted away.
   */
  logo?: BrandLogo;
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

export const isBuiltInTypeRole = (id: string): id is BuiltInTypeRole =>
  (BUILT_IN_TYPE_ROLES as readonly string[]).includes(id);

/**
 * Every role, built-ins first and added ones in the order they were added.
 * Object key order would already give this for a system created today, but not
 * for one stored before a built-in existed and backfilled since — so the order
 * is stated here rather than inherited from however the record got built.
 */
export const typeRoleIds = (ds: DesignSystem): string[] => [
  ...BUILT_IN_TYPE_ROLES,
  ...Object.keys(ds.type).filter((id) => !isBuiltInTypeRole(id)),
];

/**
 * The role an id names, or body. Anything resolving a role by STRING goes
 * through here: a chart slot or an element can name a role that has since been
 * removed, and the readable answer to that is the deck's default text, not a
 * crash on `undefined.sizePt`.
 */
export const resolveTypeRole = (ds: DesignSystem, id: string | undefined): TypeRole =>
  (id ? ds.type[id] : undefined) ?? ds.type.body;

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
