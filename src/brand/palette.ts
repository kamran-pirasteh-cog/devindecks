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
 *   - hairlines and rules               → line.default
 *   - saturated, used sparingly         → brand.accent
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
 * Coverage below which a saturated fill reads as an accent device rather than a
 * ground. Rules, bars and chips cover a fraction of a percent of a slide; a
 * panel or a backdrop covers tens of percent. Nothing real sits between.
 */
const ACCENT_COVERAGE = 0.08;
/** Share of the deck's words below which a saturated text colour is emphasis. */
const ACCENT_TEXT_SHARE = 0.25;

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
  const { hex, luminance, chroma } = stat;

  const out = (role: ColorRoleId, confidence: number, reason: string): ColorAssignment => ({
    hex,
    role,
    tokenId: role,
    confidence,
    reason,
  });

  // ---- The page itself ----
  if (usage === 'background') {
    if (luminance > LIGHT) return out('surface.base', 0.95, 'slide background, light');
    // Chroma has to be consulted here, not just lightness. A brand's own accent
    // is often BOTH saturated and dark — #2600FF has a luminance of 0.076 — and
    // a luminance-only test mapped it to `ink.strong`, turning the source
    // brand's signature colour into black wherever it backed a slide.
    return chroma > CHROMATIC
      ? out('brand.accent', 0.75, 'saturated dark ground — the source brand\'s accent')
      : out('ink.strong', 0.8, 'slide background, dark — becomes an ink ground');
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
  if (luminance > LIGHT) {
    return out('surface.subtle', 0.85, 'pale panel fill');
  }
  if (chroma > CHROMATIC) {
    // A saturated fill is an accent block if it barely covers anything, and the
    // brand's ink ground if the deck is built on it. `ACCENT_COVERAGE` is small
    // on purpose: accent devices are rules, bars and chips, which cover a
    // fraction of a percent of a slide.
    return coverage < ACCENT_COVERAGE
      ? out('brand.accent', 0.8, 'saturated fill used sparingly — accent block')
      : out('ink.strong', 0.55, 'saturated fill covering much of the deck');
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
