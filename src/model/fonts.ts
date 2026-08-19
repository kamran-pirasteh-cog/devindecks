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
  /**
   * Height of ONE single-spaced line, as a multiple of font size — the font's
   * own ascent + descent + line gap.
   *
   * This is what "single" line spacing means in OOXML: `lnSpc spcPct val=100000`
   * is 100% of *this*, NOT 100% of the font size. Setting CSS `line-height: 1`
   * for 100% packs lines tighter than their own glyph boxes and they visibly
   * collide. Measured from the loaded webfonts (CSS `line-height: normal` at
   * 100px); we embed these same fonts on .pptx export, so PowerPoint lays out
   * against identical metrics.
   */
  singleLineFactor: number;
}

export const FONTS: Record<FontFamily, FontDef> = {
  Geist: {
    family: 'Geist',
    cssStack: 'var(--font-geist-sans), system-ui, sans-serif',
    category: 'sans',
    weights: [400, 500, 600, 700],
    supportsItalic: true,
    singleLineFactor: 1.3,
  },
  'Geist Mono': {
    family: 'Geist Mono',
    cssStack: 'var(--font-geist-mono), ui-monospace, monospace',
    category: 'mono',
    weights: [400, 500, 700],
    supportsItalic: true,
    singleLineFactor: 1.3,
  },
  'Source Serif 4': {
    family: 'Source Serif 4',
    cssStack: 'var(--font-source-serif), Georgia, serif',
    category: 'serif',
    weights: [400, 500, 600, 700],
    supportsItalic: true,
    singleLineFactor: 1.38,
  },
};

/**
 * The CSS weight a run should paint at. `bold` outranks `weight`, so bolding a
 * Medium run thickens it (rather than the 500 silently swallowing the B key),
 * and un-bolding drops it back to its own Medium face.
 */
export const runWeight = (run: { weight?: number; bold?: boolean }): number =>
  run.bold ? 700 : (run.weight ?? 400);

export const ALLOWED_FONTS = Object.keys(FONTS) as FontFamily[];

export const isAllowedFont = (f: string): f is FontFamily => f in FONTS;

/**
 * What the font dropdowns offer: the families, plus the one named WEIGHT that
 * earns its own entry — Geist Medium.
 *
 * A face and a family aren't the same thing, and the model is right to carry
 * only families (weight is a run attribute, which is what survives the .pptx
 * and Slides round-trip — see `TextRun.weight`). But Medium is the weight the
 * deck's own type ladder actually uses, and it was only reachable from the text
 * INSERTER: text already on a slide could be Regular or Bold and nothing in
 * between. Listing it here means picking it is one choice, not "set the family,
 * then find the weight".
 *
 * Note it exports as Regular in .pptx — OOXML carries no Medium — the same
 * caveat that already applies to text inserted as Geist Medium.
 */
export interface FontChoice {
  /** Stable value for a <select>; the family name for the plain entries. */
  id: string;
  label: string;
  family: FontFamily;
  weight: number;
}

export const FONT_CHOICES: FontChoice[] = [
  { id: 'Geist', label: 'Geist', family: 'Geist', weight: 400 },
  { id: 'Geist Medium', label: 'Geist Medium', family: 'Geist', weight: 500 },
  { id: 'Geist Mono', label: 'Geist Mono', family: 'Geist Mono', weight: 400 },
  { id: 'Source Serif 4', label: 'Source Serif 4', family: 'Source Serif 4', weight: 400 },
];

/**
 * Which entry a run is sitting on. Bold is deliberately ignored: it's a
 * separate toggle, so a bolded Geist run still reads as "Geist" rather than
 * dropping the dropdown onto something the B button would have to fight.
 */
export function fontChoiceIdOf(run: { font?: string; weight?: number } | undefined, fallback: FontFamily): string {
  const family = (run?.font ?? fallback) as FontFamily;
  const match = FONT_CHOICES.find((c) => c.family === family && c.weight === (run?.weight ?? 400));
  return match?.id ?? family;
}

/** The patch a dropdown selection makes — family AND weight, together. */
export function fontChoicePatch(id: string): { font: FontFamily; weight: number } {
  const choice = FONT_CHOICES.find((c) => c.id === id);
  return choice
    ? { font: choice.family, weight: choice.weight }
    : { font: id as FontFamily, weight: 400 };
}
