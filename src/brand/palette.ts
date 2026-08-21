/**
 * Every colour in the source deck → one token in ours.
 *
 * The temptation here is nearest-hue matching: source navy is bluish, brand
 * accent is bluish, map them. That is exactly wrong, and it's the difference
 * between a converted deck and a recoloured one. If the source brand's ink was
 * navy and ours is black, navy must become BLACK — not our blue accent, which
 * would turn every paragraph of body copy into an accent-coloured wall. And if
 * the source's accent was orange, it must become our accent even though nothing
 * about orange resembles it.
 *
 * So colours are mapped by the JOB they were doing, inferred from how the
 * source used them:
 *
 *   - text, dark, everywhere            → ink.strong
 *   - text, mid-grey, supporting        → ink.muted
 *   - the page itself                   → surface.base
 *   - large pale panels                 → surface.subtle
 *   - coloured boxes and grounds        → ink.strong
 *   - hairlines and rules               → line.default
 *   - saturated marks, used sparingly   → brand.accent
 *
 * Two properties make the result trustworthy. It is TOTAL — every source colour
 * gets a token, so a converted deck contains no raw hex at all (an assertion in
 * `lint.ts`). And it is deck-wide, so the same source hex becomes the same token
 * on slide 3 and slide 40.
 */
import type { ColorRef, DesignSystem } from '@/model/tokens';
import { token } from '@/model/tokens';
import { contrastRatio } from '@/chart/color';
import type { ColorStat, ColorUsage, DeckSurvey } from './survey';

/** The six jobs a colour can hold. Named by the token each maps to. */
export type ColorRoleId =
  | 'ink.strong'
  | 'ink.muted'
  | 'surface.base'
  | 'surface.subtle'
  | 'line.default'
  | 'brand.accent';

export interface ColorAssignment {
  hex: string;
  role: ColorRoleId;
  /** Which token it resolves to — the role, unless the brand lacks that token. */
  tokenId: string;
  /**
   * How sure we are, 0..1. Below `WEAK_AFFINITY` the caller emits a
   * `color-unmapped` warning: the colour was still mapped (the map is total),
   * but a human should look at it.
   */
  confidence: number;
  /** Why, in words, for the conversion report. */
  reason: string;
}

export interface ColorMap {
  /** Source hex (normalized, uppercase) → the token to use. */
  refs: Map<string, ColorRef>;
  assignments: ColorAssignment[];
  /** Assignments whose confidence fell below the bar. */
  weak: ColorAssignment[];
}

/** Below this, the mapping is a guess worth surfacing. */
export const WEAK_AFFINITY = 0.5;

/** Luminance above which a colour reads as a light surface rather than ink. */
const LIGHT = 0.6;
/** Luminance below which a colour reads as strong ink. */
const DARK = 0.18;
/** Chroma above which a colour is doing something other than being grey. */
const CHROMATIC = 0.35;
/**
 * Channel spread above which a FILL or a GROUND is a colour rather than paper.
 *
 * A different question from `CHROMATIC`, measured with a different number, and
 * both halves of that matter. The question for text and strokes is "is this ink
 * or is this emphasis?", where only a strong colour is emphasis. The question
 * for a filled box is "did the author reach for a colour here?", and a tint
 * answers yes at a fraction of the saturation.
 *
 * `approxChroma` cannot express that answer, which is the part worth recording.
 * It is HSV saturation — a ratio — so it collapses toward zero as a colour
 * approaches white. A lavender card scores 0.13 at #E4D3F5 and 0.04 at #F4EFFA,
 * and no single ratio threshold separates the second from a neutral grey. That
 * is why lowering the bar from 0.35 to 0.12 fixed the mid tints and left the
 * pale ones coming back grey: the measure, not the threshold, was wrong.
 *
 * `spread` (max channel − min channel) does not collapse. A true grey is 0 by
 * construction, whatever its lightness, so the bar can sit low enough to catch
 * violet paper without ever catching actual paper. 0.05 is thirteen points out
 * of 255 — well above the one or two a warm white carries (#FFFEF9 is 0.024)
 * and a cool grey's rounding (#EEF2F7 is 0.035), and well below any fill a
 * designer would describe by its hue.
 */
const TINTED = 0.05;
/**
 * Coverage below which a saturated fill reads as an accent device rather than a
 * ground. Rules, bars and chips cover a fraction of a percent of a slide; a
 * panel or a backdrop covers tens of percent. Nothing real sits between.
 */
const ACCENT_COVERAGE = 0.08;
/**
 * Share of ONE slide that a colour's biggest fill must cover before it counts
 * as a coloured box rather than a coloured mark.
 *
 * The deck-wide `coverage` above cannot answer this. A single full-bleed cover
 * in a forty-slide deck is 2.5% of the deck and 100% of its own slide; a row of
 * chips repeated on every slide is the reverse. Asking "is this colour ever a
 * box?" needs the largest single instance, which is what `maxFillArea` records.
 *
 * 2.5% of a slide is about 2.5in² — a small card. Chips, rules and bars are an
 * order of magnitude below it.
 */
const BOX_SHARE = 0.025;
/** Share of the deck's words below which a saturated text colour is emphasis. */
const ACCENT_TEXT_SHARE = 0.25;
/**
 * Share of ONE slide a colour's background usage must reach to be read as that
 * deck's ground regardless of what else it does.
 *
 * Half a page: a full-bleed ground clears it on its own slide, and no chip,
 * rule or card can reach it. Deliberately not 1.0 — a "background" arrives
 * either as the slide's own `bg` or as a full-bleed rectangle, and the latter is
 * often inset by a margin or split into two panels.
 */
const GROUND_SHARE = 0.5;

/**
 * How prevalent a colour is — the second half of what defines an accent.
 * Saturation alone is not enough: a saturated colour painted over half the deck
 * is that brand's GROUND, and mapping it to our accent would put our accent
 * behind every slide.
 *
 * Measured per usage class, in units that mean something for that class. This
 * was originally one number — the colour's total usage over the busiest
 * colour's — and that was wrong in a way worth recording: text weight is
 * counted in CHARACTERS and fill weight in EMU², and a slide background's area
 * is ~10¹³ while a paragraph is ~10³. Every text colour's share came out at
 * essentially zero, so every saturated ink read as "scarce" and became the
 * accent. A deck whose body copy was navy converted to a deck whose body copy
 * was our accent blue.
 *
 *  - text:    share of all the characters in the deck.
 *  - fill:    coverage of the deck's total slide area.
 *  - outline: share of all the stroke weight in the deck.
 *
 * All three are dimensionless and comparable to a threshold that means the same
 * thing in each.
 */
export interface Prevalence {
  /** 0..1 within this colour's own usage class. */
  share: number;
  /** Fill + background area over total slide area. Only meaningful for fills. */
  coverage: number;
}

interface DeckTotals {
  chars: number;
  fillArea: number;
  strokeWeight: number;
  slideArea: number;
  /** One slide's area, for judging whether a single fill is a box. */
  oneSlideArea: number;
}

function deckTotals(survey: DeckSurvey): DeckTotals {
  let chars = 0;
  let fillArea = 0;
  let strokeWeight = 0;
  for (const c of survey.colors) {
    chars += c.usage.text;
    fillArea += c.usage.fill + c.usage.background;
    strokeWeight += c.usage.outline;
  }
  return {
    chars,
    fillArea,
    strokeWeight,
    slideArea: survey.slideSize.w * survey.slideSize.h * Math.max(1, survey.slideCount),
    oneSlideArea: Math.max(1, survey.slideSize.w * survey.slideSize.h),
  };
}

function prevalenceOf(stat: ColorStat, usage: ColorUsage, totals: DeckTotals): Prevalence {
  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);
  const coverage = ratio(stat.usage.fill + stat.usage.background, totals.slideArea);
  switch (usage) {
    case 'text':
      return { share: ratio(stat.usage.text, totals.chars), coverage };
    case 'outline':
      return { share: ratio(stat.usage.outline, totals.strokeWeight), coverage };
    default:
      // Fills and backgrounds are judged by how much of the DECK they cover,
      // not by how they compare to other fills: one full-bleed panel is 100% of
      // a slide whether or not anything else on the deck is filled.
      return { share: coverage, coverage };
  }
}

/**
 * The dominant usage — what this colour mostly does.
 *
 * Each usage is normalized against the deck's total for THAT usage before they
 * are compared, for the same reason `prevalenceOf` does it: text weight is
 * counted in characters and fill weight in EMU², and the numbers differ by ten
 * orders of magnitude. Comparing them raw meant any colour that appeared as even
 * a hairline rule was classified as a fill — including a deck's reversed-out
 * text ink, which then mapped to a pale surface token and vanished against the
 * panel it was written on.
 */
function primaryUsage(stat: ColorStat, totals: DeckTotals): ColorUsage {
  // A GROUND IS A GROUND. Being the whole page behind a slide is the most
  // decisive thing a colour can do, and it is not a claim the normalized scores
  // below can be trusted to reach: deck-wide stroke weight is a hairline total,
  // ~10¹¹, while one slide's ground is ~10¹³, so a colour that paints a full
  // page AND happens to outline a few cards scored as a stroke colour and came
  // back as `line.default`. That is how a deep-purple section opener converted
  // to a pale grey slide — the exact failure the per-usage normalization was
  // introduced to fix, reappearing one usage over.
  //
  // The test is absolute rather than comparative, because the question is not
  // "is this colour mostly a ground?" but "is this colour ever a ground?".
  if (stat.usage.background >= totals.oneSlideArea * GROUND_SHARE) return 'background';

  const share = (n: number, d: number) => (d > 0 ? n / d : 0);
  const scores: Record<ColorUsage, number> = {
    text: share(stat.usage.text, totals.chars),
    fill: share(stat.usage.fill, totals.fillArea),
    background: share(stat.usage.background, totals.fillArea),
    outline: share(stat.usage.outline, totals.strokeWeight),
  };
  return (Object.keys(scores) as ColorUsage[]).reduce((best, k) =>
    scores[k] > scores[best] ? k : best,
  );
}

/**
 * Decide one colour's job.
 *
 * Ordered most-decisive first. Every branch returns a confidence, and the
 * fall-through at the bottom is a real answer rather than a failure — the map
 * has to be total — but it says so with a low score.
 */
export function classifyColor(stat: ColorStat, totals: DeckTotals): ColorAssignment {
  const usage = primaryUsage(stat, totals);
  const { share, coverage } = prevalenceOf(stat, usage, totals);
  const { hex, luminance, chroma, spread } = stat;

  const out = (role: ColorRoleId, confidence: number, reason: string): ColorAssignment => ({
    hex,
    role,
    tokenId: role,
    confidence,
    reason,
  });

  // ---- The page itself ----
  //
  // The ground is the one colour that always becomes our light surface,
  // whatever it was. Mapping it by resemblance is how a converted deck ends up
  // looking recoloured rather than rebranded: a dark source ground read as
  // `ink.strong` turns the whole deck black, and a saturated one read as
  // `brand.accent` puts our accent behind every slide — which is exactly the
  // "why is my deck blue?" result. Our decks are light-ground decks; a source
  // deck's choice of ground is not information we want to preserve.
  //
  // Text that was reversed out on the old dark ground stays readable because
  // `legibility.ts` runs after this and re-derives ink against the ground that
  // actually ends up behind it.
  //
  // The one exception is a CHROMATIC ground. A neutral ground — white, cream,
  // charcoal — carries no meaning worth keeping, but a saturated one is the
  // source brand's colour used at full bleed: a divider, an opener, a statement
  // page. Flattening those to white loses the deck's own rhythm and leaves a
  // run of pages that were meant to punctuate reading like every other slide.
  // Our palette has no full-bleed colour, so the honest equivalent is our ink
  // ground — and `legibility.ts`, running after this, flips the type on it.
  if (usage === 'background') {
    if (spread > TINTED) {
      return out('ink.strong', 0.8, 'saturated full-page ground — becomes the brand ink ground');
    }
    return luminance > LIGHT
      ? out('surface.base', 0.95, 'slide background, light')
      : out('surface.base', 0.7, 'slide background — brought onto the brand ground');
  }

  // ---- Hairlines ----
  // A stroke is a rule unless it is a heavy coloured border, which is far more
  // likely to be an accent device.
  if (usage === 'outline') {
    return chroma > CHROMATIC && share > 0.1
      ? out('brand.accent', 0.6, 'saturated border used as an accent device')
      : out('line.default', 0.85, 'stroke colour');
  }

  // ---- Text ----
  if (usage === 'text') {
    // A saturated text colour used sparingly is emphasis; the same colour used
    // for most of the deck's words is that brand's ink, whatever its hue.
    if (chroma > CHROMATIC && share < ACCENT_TEXT_SHARE) {
      return out('brand.accent', 0.75, 'saturated text used sparingly — emphasis');
    }
    if (luminance < DARK) return out('ink.strong', 0.95, 'dark body/heading text');
    if (luminance < LIGHT) return out('ink.muted', 0.85, 'mid-tone supporting text');
    // Light text is sitting on something dark. It must stay legible, and the
    // only token guaranteed to be light is the base surface.
    return out('surface.base', 0.7, 'light text — reads on a dark ground');
  }

  // ---- Fills ----
  //
  // HUE IS ASKED FIRST, before lightness, and the order is the whole point.
  // Source brands lean on tints — pale lavender cards, soft mint callouts — and
  // a lightness-first test read every one of them as a pale panel and returned
  // the same light grey. A deck whose author had used colour to separate three
  // kinds of content came back with three identical grey boxes: technically
  // on-brand, and visibly flatter than what they uploaded.
  //
  // We have no tints to map them to, so a coloured box becomes an INK box. That
  // keeps the separation the author drew (a filled block still reads as a
  // filled block) at full strength rather than at a whisper, and `legibility.ts`
  // reverses the type out of it afterwards.
  if (spread > TINTED) {
    // Which kind of coloured thing it is depends on the biggest single instance,
    // not on the deck-wide total: a chip repeated forty times and one full-bleed
    // cover sum to the same coverage and want opposite answers.
    const boxShare = totals.oneSlideArea > 0 ? stat.maxFillArea / totals.oneSlideArea : 0;
    if (boxShare >= BOX_SHARE) {
      return out('ink.strong', 0.75, 'coloured box or ground — becomes an ink panel');
    }
    return coverage < ACCENT_COVERAGE
      ? out('brand.accent', 0.8, 'saturated fill used sparingly — accent mark')
      : out('ink.strong', 0.55, 'saturated fill covering much of the deck');
  }
  if (luminance > LIGHT) {
    return out('surface.subtle', 0.85, 'pale panel fill');
  }
  if (luminance < DARK) return out('ink.strong', 0.8, 'dark panel fill');
  return out('ink.muted', 0.4, 'mid-tone fill — no strong signal');
}

/**
 * Build the deck's colour map.
 *
 * The token a role resolves to is checked against the brand's actual palette:
 * a design system that renamed or dropped `surface.subtle` must not leave
 * elements pointing at a token `resolveColor` will answer with black. The
 * fallback chain walks to the nearest surviving token of the same kind.
 */
export function buildColorMap(survey: DeckSurvey, ds: DesignSystem): ColorMap {
  const available = new Set(ds.colors.map((c) => c.id));
  const totals = deckTotals(survey);

  /** Ordered fallbacks per role, most-similar first. */
  const FALLBACKS: Record<ColorRoleId, string[]> = {
    'ink.strong': ['ink.strong', 'ink.muted'],
    'ink.muted': ['ink.muted', 'ink.strong'],
    'surface.base': ['surface.base', 'surface.subtle'],
    'surface.subtle': ['surface.subtle', 'surface.base'],
    'line.default': ['line.default', 'ink.muted', 'surface.subtle'],
    'brand.accent': ['brand.accent', 'ink.strong'],
  };

  const resolveToken = (role: ColorRoleId): string => {
    const found = FALLBACKS[role].find((id) => available.has(id));
    // Last resort: the first token the brand does have. Never an invented id —
    // `resolveColor` would answer black and the element would silently go dark.
    return found ?? ds.colors[0]?.id ?? role;
  };

  const assignments = survey.colors.map((stat) => {
    const assigned = classifyColor(stat, totals);
    return { ...assigned, tokenId: resolveToken(assigned.role) };
  });

  return {
    refs: new Map(assignments.map((a) => [a.hex, token(a.tokenId)])),
    assignments,
    weak: assignments.filter((a) => a.confidence < WEAK_AFFINITY),
  };
}

/**
 * The token for a source hex, or `ink.strong` for one the survey never saw.
 *
 * A miss is possible — a colour hidden inside a chart spec, or one introduced
 * between survey and restyle — and the safe answer is the deck's primary ink:
 * always legible on a light ground, never a surprise accent.
 */
export function mapColor(map: ColorMap, hex: string | null | undefined): ColorRef {
  if (!hex) return token('ink.strong');
  return map.refs.get(hex.toUpperCase()) ?? token('ink.strong');
}

/**
 * Would text in this token be readable on that ground? Used by `lint.ts`, and
 * by `chrome.ts` when choosing between the light and dark logo.
 */
export function readable(fgHex: string, bgHex: string, largeText: boolean): boolean {
  return contrastRatio(fgHex, bgHex) >= (largeText ? 3 : 4.5);
}
