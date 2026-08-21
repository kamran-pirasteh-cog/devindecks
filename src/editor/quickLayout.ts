/**
 * Quick Layout — the five arrangements a slide can be re-cast into from the
 * filmstrip's right-click menu.
 *
 * Every one is a REPLICA, on the same terms as the layout album
 * (`templates/slideLayouts.ts`): the ground, the artwork, the geometry and the
 * type are lifted out of a standard reference deck through the same ingestion
 * the decks themselves use. Nothing here is hand-authored to look like the
 * template — the first pass at this file built the five layouts out of design
 * tokens and margin guides, and it produced slides that were plausible and
 * nothing like the deck: a 26pt title where the deck sets 34.7, no texture, no
 * badge, none of the artwork that makes a divider a divider.
 *
 * What a quick layout does to a slide already in progress:
 *
 * - The layout's own furniture (`role: QUICK_FURNITURE_ROLE`) is swapped out,
 *   so clicking through Title → Section → Content re-casts the slide each time
 *   rather than stacking five decks' worth of texture on it.
 * - The slide's TITLE moves into the arrangement's title box, in the template's
 *   type. The words are the author's; the setting is the deck's.
 * - Everything else the author has put on the slide is left where it is, and
 *   re-inked if the ground flipped under it.
 */
import {
  DEFAULT_MARGINS,
  isText,
  isTitleRole,
  resolveColor,
  token,
} from '@/model';
import type {
  ColorRef,
  DesignSystem,
  EMU,
  Fill,
  Slide,
  SlideElement,
  TextElement,
} from '@/model';
import { deckSlide, type DeckSlug } from '@/templates/decks';

export type QuickLayoutId =
  | 'title'
  | 'section-dark'
  | 'section-light'
  | 'content-light'
  | 'content-dark';

/**
 * The role every element a quick layout brings with it carries — the texture,
 * the logo, the badge, the date line. It is what lets the NEXT quick layout
 * take them away again, and it is deliberately not a role anything else in the
 * app looks for.
 */
export const QUICK_FURNITURE_ROLE = 'quick.furniture';

export interface QuickLayoutDef {
  id: QuickLayoutId;
  label: string;
  /** The slide this arrangement is lifted from, verbatim. */
  source: { deck: DeckSlug; slide: number };
  /**
   * The box — and the paragraph inside it — the author's title lands in, named
   * by the words they carry in the source deck. An index into the slide's
   * elements would silently point at the wrong box the first time a deck is
   * re-imported; this fails loudly instead (and `quickLayout.test.ts` applies
   * all five, so it fails in the test run rather than in front of a user).
   */
  slot: string;
  /**
   * 'all' — the source slide's whole arrangement is the layout (a cover, a
   * divider). 'slot' — only its title box is, because the rest of that slide
   * is its content: charts, panels, copy that belongs to the story it told.
   */
  keep: 'all' | 'slot';
  /**
   * Take the ground and the full-bleed art from a DIFFERENT slide. Used for
   * exactly one layout — see `section-light`.
   */
  groundFrom?: { deck: DeckSlug; slide: number };
}

export const QUICK_LAYOUTS: QuickLayoutDef[] = [
  {
    id: 'title',
    label: 'Title',
    // The BVA cover: light texture, the lockup top-left, the eyebrow and the
    // 64pt title hung off the bottom of a tall block, the date under them.
    source: { deck: 'bva-pitch', slide: 1 },
    slot: 'Business Value Assessment',
    keep: 'all',
  },
  {
    id: 'section-dark',
    label: 'Section break, dark',
    // The Fiserv question divider: dark ground, dark texture, the gold "next
    // question" badge, the statement in Source Serif low on the page.
    source: { deck: 'fiserv-exec-readout', slide: 6 },
    slot: 'How do we measure',
    keep: 'all',
  },
  {
    id: 'section-light',
    label: 'Section break, light',
    /*
     * None of the three decks has a light divider — every one of them is on the
     * black ground. So this is the dark divider moved onto the COVER's ground:
     * its fill and its full-bleed art in place of the dark texture, with the
     * statement re-inked by the pass every layout runs. Everything else about
     * the arrangement — the badge, the statement's place on the page — is still
     * the deck's.
     */
    source: { deck: 'fiserv-exec-readout', slide: 6 },
    slot: 'How do we measure',
    keep: 'all',
    groundFrom: { deck: 'bva-pitch', slide: 1 },
  },
  {
    id: 'content-light',
    label: 'Content, light',
    // The BVA "trust shows up" slide, down to its title alone: 34.7pt Geist
    // across the top of the page, and an open canvas under it.
    source: { deck: 'bva-pitch', slide: 3 },
    slot: 'This trust shows up',
    keep: 'slot',
  },
  {
    id: 'content-dark',
    label: 'Content, dark',
    // Its dark counterpart, from the Fiserv model slide.
    source: { deck: 'fiserv-exec-readout', slide: 7 },
    slot: 'We built an',
    keep: 'slot',
  },
];

export const quickLayout = (id: string): QuickLayoutDef | undefined =>
  QUICK_LAYOUTS.find((l) => l.id === id);

/* ------------------------------------------------------------------ */
/* Reading the source slide                                           */
/* ------------------------------------------------------------------ */

/** Every character in a text element's body, as one string. */
const bodyText = (el: TextElement): string =>
  el.body.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('');

/** Art wide enough to be the slide's ground rather than an illustration on it. */
const isFullBleed = (el: SlideElement, slideWidth: EMU): boolean =>
  el.type === 'picture' && el.rect.w >= slideWidth * 0.9;

/**
 * The imported decks carry PowerPoint's page-number field as literal text. The
 * app draws page numbers itself, from the slide's index (see
 * `model/pageNumbers.ts`), so a layout that brought this along would put the
 * characters `‹#›` on the slide next to the real number.
 */
const isPageNumberField = (el: SlideElement): boolean =>
  el.type === 'text' && bodyText(el).trim() === '‹#›';

/**
 * The source slide's title box and the paragraph in it that holds the title.
 *
 * The paragraph matters as much as the box: the cover keeps its eyebrow in the
 * first paragraph of the same box, and the Fiserv divider carries an empty
 * trailing one. Writing the author's title into either of those would put it
 * where nobody can see it.
 */
function slotOf(slide: Slide, words: string): { el: TextElement; para: number } {
  for (const el of slide.elements) {
    if (!isText(el)) continue;
    const i = el.body.paragraphs.findIndex((p) =>
      p.runs.map((r) => r.text).join('').includes(words),
    );
    if (i >= 0) return { el, para: i };
  }
  throw new Error(`quick layout: no paragraph saying "${words}" on its source slide`);
}

/* ------------------------------------------------------------------ */
/* Ink                                                                */
/* ------------------------------------------------------------------ */

/** WCAG relative luminance, 0..1. Same formula as `pageNumbers.ts`. */
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

/** How far apart the channels are — 0 for any grey, black or white. */
function chroma(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 255;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.max(...ch) - Math.min(...ch);
}

/**
 * Where each ink token lands on each ground. Only the four neutrals are listed:
 * `brand.accent` is a deliberate colour, not a default that happened to suit a
 * white page, and it comes through untouched.
 *
 * The light column is not an identity map — a slide coming BACK from a dark
 * layout has white copy on it, and leaving that alone would blank the page.
 */
const INK: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    'ink.strong': 'ink.strong',
    'ink.muted': 'ink.muted',
    'surface.base': 'ink.strong',
    'surface.subtle': 'ink.muted',
  },
  dark: {
    'ink.strong': 'surface.base',
    'ink.muted': 'surface.subtle',
    'surface.base': 'surface.base',
    'surface.subtle': 'surface.subtle',
  },
};

/** Ink and ground this close in luminance can't be read apart. */
const VANISHES = 0.15;
/** Up to here a colour is a grey, and a grey the ground's shade is a default. */
const NEUTRAL = 24;

/**
 * One run's colour, re-inked for a ground.
 *
 * Two rules. A neutral TOKEN follows the table — that is the brand's own
 * light/dark pair. A raw HEX is normally left alone, because a hand-picked
 * colour is a decision, *unless* it is a near-grey that would vanish into the
 * new ground: the imported decks set their titles in `#141414` and their
 * dark-ground copy in `#F7F6F5`, and those are the page's default ink written
 * out long-hand, not a choice to be black on black.
 */
function reink(
  color: ColorRef | undefined,
  ground: 'light' | 'dark',
  groundHex: string,
): ColorRef | undefined {
  if (!color) return color;
  if (color.kind === 'token') {
    const next = INK[ground][color.token];
    return next ? token(next) : color;
  }
  const vanishes =
    chroma(color.hex) <= NEUTRAL &&
    Math.abs(luminance(color.hex) - luminance(groundHex)) < VANISHES;
  return vanishes ? token(INK[ground]['ink.strong']) : color;
}

/** A shape whose fill covers this element — its ground is the panel, not the slide. */
const onPanel = (el: SlideElement, elements: SlideElement[]): boolean =>
  elements.some(
    (p) =>
      p !== el &&
      p.type === 'shape' &&
      p.fill?.kind === 'solid' &&
      p.rect.x <= el.rect.x &&
      p.rect.y <= el.rect.y &&
      p.rect.x + p.rect.w >= el.rect.x + el.rect.w &&
      p.rect.y + p.rect.h >= el.rect.y + el.rect.h,
  );

/** Re-ink every run on the slide that the new ground is actually behind. */
function reinkSlide(slide: Slide, ds: DesignSystem): void {
  const groundHex =
    slide.background?.kind === 'solid'
      ? resolveColor(slide.background.color, ds)
      : resolveColor(token('surface.base'), ds);
  const ground = luminance(groundHex) < 0.45 ? 'dark' : 'light';

  for (const el of slide.elements) {
    // Chart text is owned by the chart: it is re-derived from the chart style
    // on the next recompile, so re-inking it here would be undone and, until
    // then, would disagree with the rest of the chart.
    if (el.chartRef) continue;
    const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
    if (!body) continue;
    // Type inside a filled panel is read against the PANEL — the gold badge on
    // a divider carries black type on a black slide, and it is right.
    if (onPanel(el, slide.elements)) continue;
    for (const para of body.paragraphs) {
      for (const run of para.runs) run.color = reink(run.color, ground, groundHex);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The title the slide already has                                    */
/* ------------------------------------------------------------------ */

/**
 * Type this size in the title band is the slide's title; anything smaller is an
 * eyebrow, a label or a stray caption that happens to sit up there.
 */
const MIN_TITLE_PT = 20;

const paraSize = (p: { runs: { sizePt?: number }[] }): number =>
  Math.max(0, ...p.runs.map((r) => r.sizePt ?? 0));

const maxSize = (el: TextElement): number =>
  Math.max(0, ...el.body.paragraphs.map(paraSize));

/**
 * The title inside a title box — its biggest line, or lines.
 *
 * Not the whole box: a cover's title box carries the eyebrow above the title in
 * the same box, and taking the lot would fold "COGNITION TRANSFORMATION
 * PARTNERSHIP" into the title every time the layout was switched.
 */
function titleWords(el: TextElement): string {
  const top = maxSize(el);
  return el.body.paragraphs
    .filter((p) => paraSize(p) === top)
    .map((p) => p.runs.map((r) => r.text).join(''))
    .join(' ')
    .trim();
}

/**
 * The element acting as this slide's title.
 *
 * By role first. Failing that, by PLACE: the biggest type hanging in the title
 * band. The reference decks arrive with no roles on most slides, so a slide
 * made from a layout replica has a real title that says nothing about itself —
 * and without this it would keep its old title box and get a second one from
 * the layout, two titles deep.
 */
export function slideTitle(slide: Slide): TextElement | undefined {
  const byRole = slide.elements.find(
    (el): el is TextElement => isText(el) && isTitleRole(el.role) && !el.chartRef,
  );
  if (byRole) return byRole;

  const inBand = slide.elements.filter(
    (el): el is TextElement =>
      isText(el) &&
      !el.chartRef &&
      el.rect.y < DEFAULT_MARGINS.contentTop &&
      maxSize(el) >= MIN_TITLE_PT &&
      bodyText(el).trim().length > 0,
  );
  return inBand.sort((a, b) => maxSize(b) - maxSize(a))[0];
}

/**
 * Lift the slide's title off it, as plain words.
 *
 * Plain, not runs: the whole point of a quick layout is that the title comes
 * out in the template's setting, so the author's size, face and colour are what
 * is being replaced. Their words are what is being kept.
 */
function takeTitle(slide: Slide): string {
  const el = slideTitle(slide);
  if (!el) return '';
  slide.elements = slide.elements.filter((e) => e !== el);
  return titleWords(el);
}

/** Write `words` into the slot's own paragraph, keeping the slot's type. */
function fill(slot: { el: TextElement; para: number }, words: string): void {
  const para = slot.el.body.paragraphs[slot.para];
  const style = para.runs[0];
  para.runs = [{ ...style, text: words }];
}

/* ------------------------------------------------------------------ */
/* Applying                                                           */
/* ------------------------------------------------------------------ */

/**
 * Re-cast `slide` into `def`, in place.
 *
 * Mutating rather than returning a copy, so the store can hand it an immer
 * draft and get one history entry for a menu click that re-casts nine slides.
 */
export function applyQuickLayoutTo(
  slide: Slide,
  def: QuickLayoutDef,
  ds: DesignSystem,
  slideSize: { w: EMU; h: EMU },
): void {
  const source = deckSlide(def.source.deck, def.source.slide);
  const slot = slotOf(source, def.slot);
  const slotEl = slot.el;

  // The furniture, in two parts: the full-bleed artwork that IS the ground, and
  // everything else the arrangement carries.
  const brought =
    def.keep === 'all'
      ? source.elements.filter((el) => el !== slotEl && !isPageNumberField(el))
      : [];
  let background: Fill | undefined = source.background;
  let art = brought.filter((el) => isFullBleed(el, slideSize.w));
  let rest = brought.filter((el) => !isFullBleed(el, slideSize.w));

  if (def.groundFrom) {
    const other = deckSlide(def.groundFrom.deck, def.groundFrom.slide);
    background = other.background;
    art = other.elements.filter((el) => isFullBleed(el, slideSize.w));
    // The source's own artwork was for the ground it is leaving behind.
    rest = rest.filter((el) => el.type !== 'picture');
  }

  const furniture = [...art, ...rest];
  for (const el of furniture) el.role = QUICK_FURNITURE_ROLE;
  slotEl.role = 'title';

  // Out with the last quick layout's furniture, so switching between layouts
  // re-casts the slide instead of layering onto it.
  slide.elements = slide.elements.filter((el) => el.role !== QUICK_FURNITURE_ROLE);

  const words = takeTitle(slide);
  if (words) fill(slot, words);

  slide.background = background;
  // Artwork at the back, the author's own work in front of it.
  slide.elements = [...furniture, slotEl, ...slide.elements];
  reinkSlide(slide, ds);
}
