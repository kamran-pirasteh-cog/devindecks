/**
 * One pass over the WHOLE deck, before anything is changed.
 *
 * This file exists because of the failure mode that makes converted decks look
 * amateur: deciding per slide. Look at slide 3 alone and its 18pt navy line is
 * obviously a heading; look at slide 40 alone and its identical 18pt navy line
 * might read as a subtitle. Convert them independently and they come out
 * different — and a reader flipping through notices immediately, even though
 * every slide is individually defensible.
 *
 * So nothing here decides anything. It only COUNTS: which sizes appear and
 * where, which colours appear and in what capacity, which assets repeat often
 * enough to be furniture rather than content. `palette.ts`, `type.ts` and
 * `classify.ts` then build one mapping table each from these counts, and every
 * slide is rewritten from the same tables. Consistency stops being something
 * the engine tries for and becomes something its shape guarantees.
 *
 * The other job is finding the source deck's CHROME. A logo, a footer, a page
 * number and a decorative brand bar are the source brand's furniture, not the
 * author's content — they must be removed and replaced with ours. None of them
 * is identifiable from a single slide either: what marks them is that they
 * repeat, in the margins, saying the same thing every time.
 */
import type { EMU, Rect, Slide, SlideElement, TextBody } from '@/model';
import { DEFAULT_MARGINS, marginBox, titleBand } from '@/model';
import type { ColorRef, DesignSystem } from '@/model/tokens';
import { resolveColor } from '@/model/tokens';

/* ------------------------------------------------------------------ */
/* Where on the slide something sits                                  */
/* ------------------------------------------------------------------ */

/**
 * The coarse region an element occupies. A band is a strong role signal — the
 * strip along the bottom is where page numbers and footers live, the title band
 * is where titles live — and it is cheap and stable, unlike anything derived
 * from the text itself.
 */
export type PositionBand = 'title' | 'content' | 'footer' | 'header' | 'bleed';

export function bandOf(rect: Rect, slideSize: { w: EMU; h: EMU }): PositionBand {
  const box = marginBox(slideSize, DEFAULT_MARGINS);
  const band = titleBand(slideSize, DEFAULT_MARGINS);
  const midY = rect.y + rect.h / 2;

  // Full-bleed first: an element crossing the safe area on both sides is
  // background artwork, and its vertical position says nothing about its role.
  const spansWidth = rect.x <= box.x && rect.x + rect.w >= box.x + box.w;
  if (spansWidth && rect.h > slideSize.h * 0.5) return 'bleed';

  if (midY < band.y) return 'header';
  if (midY <= band.y + band.h) return 'title';
  if (midY > slideSize.h - DEFAULT_MARGINS.bottom) return 'footer';
  return 'content';
}

/* ------------------------------------------------------------------ */
/* What the survey collects                                           */
/* ------------------------------------------------------------------ */

export interface SizeStat {
  sizePt: number;
  /** Characters set at this size — weights by ink, not by box count, so one
   *  stray 9pt label doesn't rank alongside the body copy. */
  chars: number;
  /** How many runs use it. */
  runs: number;
  /** How many distinct slides it appears on. */
  slides: number;
  /** Where it appears, by band, so a size can be recognized as title-ish. */
  bands: Record<PositionBand, number>;
  /** Fraction of its runs that are bold. */
  boldShare: number;
  /** Fraction of its runs that are all-caps. */
  capsShare: number;
  /**
   * Fraction of its runs that are entirely a number.
   *
   * The signal that separates the deck's TITLE size from its stat size. Both are
   * "the biggest type on the deck", and position can't tell them apart — a title
   * slide's hero line is usually centred in the middle of the slide, nowhere
   * near the title band, exactly like a KPI is.
   */
  numericShare: number;
}

/** Text that is entirely a number, with optional currency or unit decoration. */
export const NUMERIC_TEXT = /^[-+$€£]?\s*\d[\d,.\s]*\s*(?:%|bps|x|k|m|bn?|tn?)?\s*$/i;

/** How a colour is being used — the thing that decides what token it becomes. */
export type ColorUsage = 'text' | 'fill' | 'outline' | 'background';

export interface ColorStat {
  hex: string;
  /** Total weight across usages: characters for text, area in EMU² for fills. */
  usage: Record<ColorUsage, number>;
  slides: number;
  /** Characters set in this colour — only meaningful for `text` usage. */
  chars: number;
  /** Perceived luminance, 0..1. */
  luminance: number;
  /** OKLCH chroma — how saturated. An accent is chromatic; ink is not. */
  chroma: number;
}

/** Something that repeats across the deck in the same place: source furniture. */
export interface RepeatedAsset {
  /** `picture:<src>` or `text:<normalized text>`. */
  key: string;
  kind: 'picture' | 'text';
  /** Slide indexes (0-based) it appears on. */
  slides: number[];
  band: PositionBand;
  /** Element ids, per slide index. */
  elementIds: string[];
  /** Median rect, for judging whether it's mark-sized. */
  rect: Rect;
}

export interface DeckSurvey {
  slideCount: number;
  slideSize: { w: EMU; h: EMU };
  /** Descending by `chars` — the deck's type ladder as actually used. */
  sizes: SizeStat[];
  /** Descending by total usage weight. */
  colors: ColorStat[];
  /** Repeats in a margin band: candidate logos and footers. */
  chrome: RepeatedAsset[];
  /** Element ids that look like source page numbers. */
  pageNumberElementIds: string[];
  /** Element ids belonging to `chrome`, flattened for O(1) lookup. */
  chromeElementIds: Set<string>;
  /** Fonts seen in the source, for the report ("Arial → Geist"). */
  sourceFonts: string[];
}

/* ------------------------------------------------------------------ */
/* Element walking                                                    */
/* ------------------------------------------------------------------ */

const bodyOf = (el: SlideElement): TextBody | undefined =>
  el.type === 'text' || el.type === 'shape' ? el.body : undefined;

/** Flat text of a body, for pattern matching and repeat detection. */
export function flatText(body: TextBody | undefined): string {
  if (!body) return '';
  return (body.paragraphs ?? [])
    .map((p) => (p.runs ?? []).map((r) => r.text ?? '').join(''))
    .join('\n');
}

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);

/**
 * Chart primitives are excluded from the survey entirely.
 *
 * They are compiled output, not authored content: their sizes and colours come
 * from whatever styled the chart, and there are dozens of them per chart. Left
 * in, a single chart's tick labels would outvote the deck's real body copy in
 * the size histogram, and its series colours would dominate the palette. The
 * chart is re-themed as a chart (`restyle.ts` recompiles it from its spec), so
 * its primitives have no business influencing the deck-wide tables.
 */
const isChartPart = (el: SlideElement) => el.chartRef !== undefined;

/* ------------------------------------------------------------------ */
/* Colour maths (local, sRGB — same derivation as chart/color.ts)      */
/* ------------------------------------------------------------------ */

function normalizeHex(hex: string): string | null {
  const h = hex.trim().replace('#', '');
  // Length alone is not enough: an 8-character word like "nonsense" would slice
  // down to a plausible-looking "#NONSEN" and be counted as a real colour.
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }
  if (h.length === 6) return `#${h.toUpperCase()}`;
  // 8-digit (alpha) forms lose their alpha here: the survey classifies the
  // COLOUR, and an accent at 40% opacity is still the accent.
  if (h.length === 8) return `#${h.slice(0, 6).toUpperCase()}`;
  return null;
}

/** Resolve a ColorRef against the source deck; imported decks carry raw hexes. */
const hexOf = (ref: ColorRef | undefined, ds: DesignSystem): string | null =>
  ref ? normalizeHex(resolveColor(ref, ds)) : null;

/* ------------------------------------------------------------------ */
/* The survey                                                         */
/* ------------------------------------------------------------------ */

/** Repeats on at least this share of slides count as deck furniture. */
export const CHROME_SLIDE_SHARE = 0.3;
/** …but never from a deck too short for "repeats" to mean anything. */
export const CHROME_MIN_SLIDES = 3;

export function surveyDeck(
  slides: Slide[],
  slideSize: { w: EMU; h: EMU },
  ds: DesignSystem,
): DeckSurvey {
  const sizes = new Map<
    number,
    SizeStat & { boldRuns: number; capsRuns: number; numericRuns: number; slideSet: Set<number> }
  >();
  const colors = new Map<string, ColorStat & { slideSet: Set<number> }>();
  const repeats = new Map<string, RepeatedAsset>();
  const fonts = new Set<string>();
  const pageNumberElementIds: string[] = [];

  const noteColor = (
    hex: string | null,
    usage: ColorUsage,
    weight: number,
    slideIndex: number,
    chars = 0,
  ) => {
    if (!hex || weight <= 0) return;
    let stat = colors.get(hex);
    if (!stat) {
      stat = {
        hex,
        usage: { text: 0, fill: 0, outline: 0, background: 0 },
        slides: 0,
        chars: 0,
        luminance: srgbLuminance(hex),
        chroma: approxChroma(hex),
        slideSet: new Set(),
      };
      colors.set(hex, stat);
    }
    stat.usage[usage] += weight;
    stat.chars += chars;
    stat.slideSet.add(slideIndex);
  };

  slides.forEach((slide, slideIndex) => {
    noteColor(
      slide.background?.kind === 'solid' ? hexOf(slide.background.color, ds) : null,
      'background',
      slideSize.w * slideSize.h,
      slideIndex,
    );

    for (const el of slide.elements) {
      if (isChartPart(el)) continue;
      const band = bandOf(el.rect, slideSize);

      // ---- fills and outlines ----
      if ('fill' in el && el.fill?.kind === 'solid') {
        noteColor(hexOf(el.fill.color, ds), 'fill', area(el.rect), slideIndex);
      }
      if ('outline' in el && el.outline) {
        // Weighted by perimeter × width: a hairline rule and a filled panel of
        // the same colour should not count the same.
        const perimeter = 2 * (el.rect.w + el.rect.h);
        noteColor(hexOf(el.outline.color, ds), 'outline', perimeter * el.outline.widthEmu, slideIndex);
      }

      // ---- text: sizes, fonts, colours ----
      const body = bodyOf(el);
      if (body) {
        for (const p of body.paragraphs ?? []) {
          for (const run of p.runs ?? []) {
            const text = run.text ?? '';
            if (run.font) fonts.add(run.font);
            noteColor(hexOf(run.color, ds), 'text', text.length, slideIndex, text.length);
            if (text.trim() === '') continue;

            const sizePt = run.sizePt ?? ds.type.body.sizePt;
            let stat = sizes.get(sizePt);
            if (!stat) {
              stat = {
                sizePt,
                chars: 0,
                runs: 0,
                slides: 0,
                bands: { title: 0, content: 0, footer: 0, header: 0, bleed: 0 },
                boldShare: 0,
                capsShare: 0,
                numericShare: 0,
                boldRuns: 0,
                capsRuns: 0,
                numericRuns: 0,
                slideSet: new Set(),
              };
              sizes.set(sizePt, stat);
            }
            stat.chars += text.length;
            stat.runs += 1;
            stat.bands[band] += 1;
            if (run.bold) stat.boldRuns += 1;
            if (run.caps) stat.capsRuns += 1;
            if (NUMERIC_TEXT.test(text.trim())) stat.numericRuns += 1;
            stat.slideSet.add(slideIndex);
          }
        }
      }

      // ---- repeat detection: only in the margins ----
      // Content that happens to recur (a recurring section heading) is NOT
      // chrome, so only the header/footer strips are considered. A logo in the
      // middle of a content slide is part of that slide's argument.
      if (band === 'footer' || band === 'header') {
        const key =
          el.type === 'picture'
            ? `picture:${el.src}`
            : body
              ? `text:${flatText(body).trim().toLowerCase()}`
              : null;
        if (key && key !== 'text:') {
          const existing = repeats.get(key);
          if (existing) {
            existing.slides.push(slideIndex);
            existing.elementIds.push(el.id);
          } else {
            repeats.set(key, {
              key,
              kind: el.type === 'picture' ? 'picture' : 'text',
              slides: [slideIndex],
              band,
              elementIds: [el.id],
              rect: el.rect,
            });
          }
        }

        // ---- page numbers ----
        // A bottom-strip box whose entire text is a number matching this
        // slide's position. Checked per slide rather than by repetition,
        // because the TEXT differs on every slide — which is exactly why the
        // repeat index above can never find them.
        if (body && looksLikePageNumber(flatText(body), slideIndex, slides.length)) {
          pageNumberElementIds.push(el.id);
        }
      }
    }
  });

  const minSlides = Math.max(CHROME_MIN_SLIDES, Math.ceil(slides.length * CHROME_SLIDE_SHARE));
  const chrome = [...repeats.values()]
    .filter((r) => new Set(r.slides).size >= minSlides)
    .sort((a, b) => b.slides.length - a.slides.length);

  return {
    slideCount: slides.length,
    slideSize,
    sizes: [...sizes.values()]
      .map(({ boldRuns, capsRuns, numericRuns, slideSet, ...rest }) => ({
        ...rest,
        slides: slideSet.size,
        boldShare: rest.runs ? boldRuns / rest.runs : 0,
        capsShare: rest.runs ? capsRuns / rest.runs : 0,
        numericShare: rest.runs ? numericRuns / rest.runs : 0,
      }))
      .sort((a, b) => b.chars - a.chars || b.sizePt - a.sizePt),
    colors: [...colors.values()]
      .map(({ slideSet, ...rest }) => ({ ...rest, slides: slideSet.size }))
      .sort((a, b) => totalUsage(b) - totalUsage(a)),
    chrome,
    pageNumberElementIds,
    chromeElementIds: new Set(chrome.flatMap((c) => c.elementIds)),
    sourceFonts: [...fonts].sort(),
  };
}

export const totalUsage = (c: ColorStat): number =>
  c.usage.text + c.usage.fill + c.usage.outline + c.usage.background;

/**
 * Is this text a page number for this slide?
 *
 * Deliberately strict. "5" on slide 5 is a page number; "5" on slide 2 is a
 * statistic that happens to sit low on the slide, and stripping it would delete
 * content. So the number has to MATCH the position — allowing for the common
 * offsets: 1-based, 0-based, and a deck whose numbering skips a cover.
 */
export function looksLikePageNumber(text: string, slideIndex: number, total: number): boolean {
  const t = text.trim();
  if (t === '') return false;
  // Bare number, or `n / total`, or `n of total`, or `Page n`.
  const match = t.match(/^(?:page\s*)?(\d{1,3})(?:\s*(?:\/|of)\s*(\d{1,3}))?$/i);
  if (!match) return false;
  const n = Number(match[1]);
  const stated = match[2] ? Number(match[2]) : undefined;
  // A stated total that matches the deck is conclusive on its own.
  if (stated !== undefined && stated === total) return true;
  return n === slideIndex + 1 || n === slideIndex || n === slideIndex + 2;
}

/* ------------------------------------------------------------------ */
/* Local colour maths                                                 */
/* ------------------------------------------------------------------ */

/** sRGB relative luminance, 0..1. Same formula as `chart/color.ts`. */
export function srgbLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 1;
  const chan = (i: number) => {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}

/**
 * How saturated a colour is, 0..1 — max channel minus min, over max.
 *
 * HSV saturation rather than true OKLCH chroma: `hexToOklch` is available and
 * more perceptually correct, but all this needs to do is separate "a grey" from
 * "a colour", and for that the cheap version is not just adequate but more
 * predictable — pure #FF0000 and pure #0000FF score identically here, where
 * their OKLCH chromas differ by more than 2×.
 */
export function approxChroma(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 0;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export { normalizeHex };
