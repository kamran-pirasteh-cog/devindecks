/**
 * The ALLOWED font set. This is deliberately tiny — the restriction is a
 * feature, not a limitation. All three are Google Fonts, so Google Slides
 * renders them by name on import; on .pptx export we additionally EMBED the
 * font so desktop PowerPoint (which won't have them installed) renders
 * identically. Bold/italic are run-level attributes (b/i in OOXML), NOT
 * separate families — so the family list stays at three.
 */

export type FontFamily = 'Geist' | 'Geist Mono' | 'Source Serif 4';

export interface FontDef {
  /** OOXML typeface name — MUST match the Google Fonts name exactly. */
  family: FontFamily;
  /** CSS font-family stack used in the editor preview. */
  cssStack: string;
  category: 'sans' | 'serif' | 'mono';
  /** Weights we allow authors to pick (regular + bold today). */
  weights: number[];
  supportsItalic: boolean;
}

export const FONTS: Record<FontFamily, FontDef> = {
  Geist: {
    family: 'Geist',
    cssStack: 'var(--font-geist-sans), system-ui, sans-serif',
    category: 'sans',
    weights: [400, 500, 600, 700],
    supportsItalic: true,
  },
  'Geist Mono': {
    family: 'Geist Mono',
    cssStack: 'var(--font-geist-mono), ui-monospace, monospace',
    category: 'mono',
    weights: [400, 500, 700],
    supportsItalic: true,
  },
  'Source Serif 4': {
    family: 'Source Serif 4',
    cssStack: 'var(--font-source-serif), Georgia, serif',
    category: 'serif',
    weights: [400, 600, 700],
    supportsItalic: true,
  },
};

export const ALLOWED_FONTS = Object.keys(FONTS) as FontFamily[];

export const isAllowedFont = (f: string): f is FontFamily => f in FONTS;
