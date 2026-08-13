/**
 * Page numbers — a DERIVED slide decoration, never an element.
 *
 * A page number is not authored content: it is a function of where a slide sits
 * in the deck. Baking it into `slide.elements` would mean re-stamping every
 * slide on every insert, delete and reorder (and leaving stale "4 of 7" text
 * behind whenever that pass was missed). Instead the deck carries one boolean,
 * the design system carries the style, and every renderer draws the number from
 * the slide's live index — so reordering renumbers instantly and for free.
 *
 * The ink is likewise derived: black on a light slide, off-white on a dark one,
 * decided per slide from its own background, so a full-bleed dark slide in the
 * middle of a light deck stays legible without anyone touching a setting.
 */

// Types only from `tokens` — that module imports DEFAULT_PAGE_NUMBERS from
// here, and a value import back would close a runtime cycle.
import type { FontFamily } from './fonts';
import type { EMU } from './units';
import { inchesToEmu } from './units';

export type PageNumberPosition = 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface PageNumberStyle {
  font: FontFamily;
  sizePt: number;
  bold?: boolean;
  position: PageNumberPosition;
  /** Distance from the slide's left/right edge (ignored when centered). */
  marginXEmu: EMU;
  /** Distance from the slide's bottom edge to the bottom of the number. */
  marginYEmu: EMU;
  /** Label template. `{n}` = this slide's number, `{total}` = the last one. */
  format: string;
  /** Title slides are conventionally unnumbered; the count still includes them. */
  skipFirst: boolean;
  /** Ink on a light slide. */
  onLightHex: string;
  /** Ink on a dark slide — off-white rather than pure white, per the brand. */
  onDarkHex: string;
}

export const DEFAULT_PAGE_NUMBERS: PageNumberStyle = {
  font: 'Source Serif 4',
  sizePt: 8,
  position: 'bottom-right',
  marginXEmu: inchesToEmu(0.45),
  marginYEmu: inchesToEmu(0.25),
  format: '{n}',
  skipFirst: true,
  onLightHex: '#000000',
  onDarkHex: '#F5F2EA',
};

/**
 * The label for slide `index` (0-based) in a deck of `count`, or null when this
 * slide is deliberately unnumbered.
 */
export function pageNumberLabel(
  style: PageNumberStyle,
  index: number,
  count: number,
): string | null {
  if (style.skipFirst && index === 0) return null;
  return style.format
    .replace(/\{n\}/g, String(index + 1))
    .replace(/\{total\}/g, String(count));
}

/**
 * Relative luminance (WCAG), used only to answer "is this slide dark?".
 */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * The page number's ink for a given slide background. The threshold is the
 * midpoint of perceived lightness (L* 50), not 0.5 luminance — mid greys read
 * as light and take the black number, which is the higher-contrast choice.
 */
export function pageNumberInk(style: PageNumberStyle, backgroundHex: string): string {
  return luminance(backgroundHex) < 0.18 ? style.onDarkHex : style.onLightHex;
}
