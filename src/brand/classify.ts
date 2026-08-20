/**
 * What is this element FOR, and what kind of slide is it on?
 *
 * Restyling needs a semantic role per element, because that's what the brand is
 * expressed in terms of — `ds.type.title`, not "the 32pt one". The source file
 * doesn't carry roles: pptx placeholder types are unreliable (most real decks
 * are loose text boxes) and PDFs have nothing at all. So roles are inferred.
 *
 * The inference is in two layers, and the split is the whole design:
 *
 *   1. DECK-WIDE. Each distinct size level in the deck gets one base role, from
 *      its rank and the band it usually appears in. This is what makes slide 3
 *      and slide 40 agree — the 18pt line is a subtitle on both, because the
 *      decision was made once about "18pt in this deck", not twice about two
 *      text boxes.
 *
 *   2. PER-ELEMENT. Local signals then refine the base role where they are
 *      unambiguous: all-caps and short is an eyebrow, bulleted is body, a bare
 *      number in a big size is a KPI. These override the base role only when
 *      they are strong, so a stray element can be recognized without the
 *      deck-wide agreement being abandoned.
 *
 * Where two signals genuinely disagree, the role is still assigned — restyling
 * must be total — but a `role-ambiguous` note comes with it, so the review
 * screen can flag the slide rather than the engine quietly picking a side.
 */
import type { Slide, SlideElement, TextBody } from '@/model';
import type { SlideArchetype } from '@/model/archetype';
import type { DesignSystem } from '@/model/tokens';
import { bandOf, flatText, type DeckSurvey, type PositionBand } from './survey';
import { distinctLevels } from './type';

/* ------------------------------------------------------------------ */
/* Roles                                                              */
/* ------------------------------------------------------------------ */

/**
 * Roles this engine assigns. The six built-in type roles, plus `eyebrow` (the
 * brand's caps kicker, set in mono — see `editor/eyebrow.ts`), plus the three
 * chrome roles, which mark an element for REMOVAL rather than for styling.
 */
export type BrandRole =
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'body'
  | 'caption'
  | 'kpiValue'
  | 'eyebrow'
  | 'chrome.logo'
  | 'chrome.footer'
  | 'chrome.pageNumber'
  /** Not text: a picture, a line, a decorative shape. Styled, never re-typed. */
  | 'decoration';

/** Roles whose elements are deleted and replaced by our own chrome. */
export const CHROME_ROLES: readonly BrandRole[] = [
  'chrome.logo',
  'chrome.footer',
  'chrome.pageNumber',
];

export const isChromeRole = (role: BrandRole | undefined): boolean =>
  role !== undefined && CHROME_ROLES.includes(role);

/** The `ds.type` role a brand role resolves its typography through. */
export function typeRoleFor(role: BrandRole): string {
  switch (role) {
    case 'eyebrow':
      return 'caption';
    case 'chrome.footer':
    case 'chrome.pageNumber':
      return 'caption';
    case 'chrome.logo':
    case 'decoration':
      return 'body';
    default:
      return role;
  }
}

/* ------------------------------------------------------------------ */
/* Layer 1 — the deck-wide size → role table                          */
/* ------------------------------------------------------------------ */

export interface RoleMap {
  /** Source size → the base role every element at that size starts from. */
  bySize: Map<number, BrandRole>;
  /** Size levels, largest first, for explaining the table. */
  levels: number[][];
}

/** The band a size level mostly appears in. */
function dominantBand(survey: DeckSurvey, level: number[]): PositionBand {
  const totals: Record<PositionBand, number> = {
    title: 0,
    content: 0,
    footer: 0,
    header: 0,
    bleed: 0,
  };
  for (const pt of level) {
    const stat = survey.sizes.find((s) => s.sizePt === pt);
    if (!stat) continue;
    for (const band of Object.keys(totals) as PositionBand[]) {
      totals[band] += stat.bands[band];
    }
  }
  return (Object.keys(totals) as PositionBand[]).reduce((best, b) =>
    totals[b] > totals[best] ? b : best,
  );
}

/**
 * Assign one base role per size level.
 *
 * Rank alone would be wrong: a deck's largest type might be a KPI number rather
 * than a title, and its smallest might be a footnote in the content area rather
 * than a footer caption. So rank proposes and band decides.
 */
export function buildRoleMap(survey: DeckSurvey): RoleMap {
  const levels = distinctLevels(survey.sizes);
  const bySize = new Map<number, BrandRole>();

  // Whether the deck's largest type lives in the title band decides what the
  // SECOND level is. A hero line on a title slide is usually centred in the
  // middle of the slide, far from the title band — and when that's so, the
  // biggest size that IS in the title band is the deck's working slide-title
  // size, not a subtitle.
  const topInTitleBand = levels.length > 0 && dominantBand(survey, levels[0]) === 'title';

  levels.forEach((level, rank) => {
    const band = dominantBand(survey, level);
    const stat = survey.sizes.find((s) => s.sizePt === level[0]);
    const capsHeavy = (stat?.capsShare ?? 0) > 0.6;
    const numericHeavy = (stat?.numericShare ?? 0) > 0.6;

    let role: BrandRole;
    if (band === 'footer' || band === 'header') {
      // Anything living in the margins is supporting text, whatever its rank.
      role = 'caption';
    } else if (rank === 0) {
      // The deck's largest type is either its title or its display statistic,
      // and POSITION cannot tell those apart: a title slide's hero line and a
      // metrics slide's 44pt number both sit in the middle of the slide. What
      // separates them is that one is words and the other is a number.
      role = numericHeavy ? 'kpiValue' : 'title';
    } else if (rank === 1) {
      // Second tier. Caps at this size is a kicker. Otherwise it's the slide
      // title if the top level wasn't sitting in the title band, a subtitle if
      // it was, and a heading if this level leads content.
      role = capsHeavy
        ? 'eyebrow'
        : band === 'title'
          ? topInTitleBand
            ? 'subtitle'
            : 'title'
          : 'heading';
    } else if (rank === levels.length - 1 && levels.length > 3) {
      // The smallest level in a deck with real hierarchy is footnote-sized.
      role = 'caption';
    } else {
      role = 'body';
    }
    for (const pt of level) bySize.set(pt, role);
  });

  return { bySize, levels };
}

/* ------------------------------------------------------------------ */
/* Layer 2 — per-element refinement                                   */
/* ------------------------------------------------------------------ */

/** A text-bearing element's body, or undefined. Text and shapes both carry one. */
export const bodyOf = (el: SlideElement): TextBody | undefined =>
  el.type === 'text' || el.type === 'shape' ? el.body : undefined;

/** Text that is entirely a number, with optional unit decoration: a KPI. */
const NUMERIC = /^[-+$€£]?\s*\d[\d,.\s]*\s*(?:%|bps|x|k|m|bn?|tn?)?\s*$/i;

/** Longest run size in a body, for judging "big". */
function maxSizePt(body: TextBody | undefined, ds: DesignSystem): number {
  let max = 0;
  for (const p of body?.paragraphs ?? []) {
    for (const r of p.runs ?? []) max = Math.max(max, r.sizePt ?? ds.type.body.sizePt);
  }
  return max;
}

function allCaps(body: TextBody | undefined): boolean {
  const runs = (body?.paragraphs ?? []).flatMap((p) => p.runs ?? []);
  const withText = runs.filter((r) => (r.text ?? '').trim() !== '');
  if (!withText.length) return false;
  return withText.every(
    (r) => r.caps === true || (r.text === r.text.toUpperCase() && /[A-Z]/.test(r.text)),
  );
}

function isBulleted(body: TextBody | undefined): boolean {
  return (body?.paragraphs ?? []).some((p) => p.bullet === 'bullet' || p.bullet === 'number');
}

export interface ElementRole {
  role: BrandRole;
  /** 0..1. Below `AMBIGUOUS` the slide is flagged for review. */
  confidence: number;
  reason: string;
}

/**
 * Characters above which a text box is prose rather than a heading. A generous
 * two lines of body copy — long enough that no real title reaches it.
 */
const PROSE_CHARS = 180;

/** Confidence below which the assignment is worth a human glance. */
export const AMBIGUOUS = 0.55;

export function classifyElement(
  el: SlideElement,
  survey: DeckSurvey,
  roles: RoleMap,
  ds: DesignSystem,
): ElementRole {
  // ---- Source chrome, decided deck-wide. Highest priority: these elements
  // are deleted, so mistaking one for content is the costly direction. ----
  if (survey.pageNumberElementIds.includes(el.id)) {
    return { role: 'chrome.pageNumber', confidence: 0.9, reason: 'bottom-strip page number' };
  }
  if (survey.chromeElementIds.has(el.id)) {
    const asset = survey.chrome.find((c) => c.elementIds.includes(el.id));
    return asset?.kind === 'picture'
      ? { role: 'chrome.logo', confidence: 0.85, reason: `logo repeated on ${asset.slides.length} slides` }
      : {
          role: 'chrome.footer',
          confidence: 0.85,
          reason: `footer text repeated on ${asset?.slides.length ?? 0} slides`,
        };
  }

  const body = bodyOf(el);

  // ---- Non-text ----
  if (!body || (body.paragraphs ?? []).length === 0) {
    return { role: 'decoration', confidence: 0.9, reason: `${el.type} with no text` };
  }

  const band = bandOf(el.rect, survey.slideSize);
  const sizePt = maxSizePt(body, ds);
  const base = roles.bySize.get(sizePt);
  const text = flatText(body).trim();
  const words = text.split(/\s+/).filter(Boolean).length;

  // ---- Strong local overrides ----

  const numeric = NUMERIC.test(text);

  // A bare number set large is a stat, not a heading.
  //
  // Tested BEFORE the caps check, and this order is load-bearing: "$1.2M" is
  // equal to its own uppercase and contains a capital letter, so a caps-first
  // ordering read every abbreviated currency figure on the deck as an eyebrow
  // and set the KPI wall in 11pt mono.
  if (numeric && sizePt >= ds.type.body.sizePt * 1.5) {
    return { role: 'kpiValue', confidence: 0.85, reason: 'large bare number — a stat' };
  }

  // An all-caps line of a few words is a kicker, at any size. Checked before
  // the base role because a caps kicker is often set at body size, where the
  // deck-wide table has no way to tell it from body copy.
  if (
    !numeric &&
    allCaps(body) &&
    words <= 6 &&
    (body.paragraphs ?? []).length === 1 &&
    band !== 'footer'
  ) {
    return { role: 'eyebrow', confidence: 0.8, reason: 'short all-caps line — a kicker' };
  }

  // Bulleted text is body copy however big it is set.
  if (isBulleted(body)) {
    return { role: 'body', confidence: 0.9, reason: 'bulleted list' };
  }

  // So is a long passage. A heading is short by nature, so length is a stronger
  // signal than size rank: a deck with only two size levels makes its second
  // level a heading, and without this a slide whose one big text box holds three
  // paragraphs would be styled as a heading and set at heading size.
  if (text.length > PROSE_CHARS) {
    return {
      role: 'body',
      confidence: 0.85,
      reason: `${text.length} characters — a passage, not a heading`,
    };
  }

  // ---- Base role from the deck-wide table ----
  if (base) {
    // Band disagreeing with the table is the ambiguous case worth reporting:
    // the size says one thing about this deck, this element's position another.
    const expected =
      base === 'title' || base === 'subtitle'
        ? 'title'
        : base === 'caption'
          ? 'footer'
          : 'content';
    const agrees = band === expected || band === 'bleed';
    return {
      role: base,
      confidence: agrees ? 0.85 : 0.5,
      reason: agrees
        ? `${sizePt}pt is ${base} deck-wide`
        : `${sizePt}pt is ${base} deck-wide, but this one sits in the ${band} band`,
    };
  }

  // ---- Fallback ----
  // A size the survey never saw: whitespace-only text, or a run introduced
  // after the survey. Body is the safe answer — never a title, which would
  // blow a stray label up to display size.
  return { role: 'body', confidence: 0.4, reason: `size ${sizePt}pt not seen in the survey` };
}

/* ------------------------------------------------------------------ */
/* Archetypes                                                         */
/* ------------------------------------------------------------------ */

export interface SlideClassification {
  archetype: SlideArchetype;
  confidence: number;
  reason: string;
  /** Element id → role. Total over the slide's elements. */
  roles: Map<string, ElementRole>;
}

/** Characters of body copy above which a slide reads as dense. */
const DENSE_CHARS = 900;

export function classifySlide(
  slide: Slide,
  survey: DeckSurvey,
  roles: RoleMap,
  ds: DesignSystem,
): SlideClassification {
  const assigned = new Map<string, ElementRole>();
  for (const el of slide.elements) {
    // Chart primitives inherit the chart's own role rather than being classified
    // as loose text — they are recompiled, not restyled.
    assigned.set(
      el.id,
      el.chartRef
        ? { role: 'decoration', confidence: 1, reason: 'compiled chart primitive' }
        : classifyElement(el, survey, roles, ds),
    );
  }

  const census = (role: BrandRole) =>
    [...assigned.values()].filter((r) => r.role === role).length;

  const contentElements = slide.elements.filter((el) => {
    const r = assigned.get(el.id)!.role;
    return !isChromeRole(r);
  });

  const bodyChars = slide.elements
    .filter((el) => ['body', 'caption'].includes(assigned.get(el.id)!.role))
    .reduce(
      (sum, el) =>
        sum + flatText(bodyOf(el)).length,
      0,
    );

  const out = (archetype: SlideArchetype, confidence: number, reason: string) => ({
    archetype,
    confidence,
    reason,
    roles: assigned,
  });

  // ---- Charts win: a slide built around a chart IS a chart slide ----
  if ((slide.charts?.length ?? 0) > 0) {
    return out('chart', 0.95, `${slide.charts!.length} chart(s)`);
  }

  // ---- Stat walls ----
  if (census('kpiValue') >= 3) {
    return out('metrics', 0.9, `${census('kpiValue')} stats`);
  }

  const pictures = contentElements.filter((el) => el.type === 'picture');
  const textish = contentElements.filter(
    (el) => (el.type === 'text' || el.type === 'shape') && el.body,
  );

  // ---- Full-bleed artwork ----
  if (pictures.length >= 1 && textish.length <= 1) {
    const biggest = pictures.reduce((a, b) => (a.rect.w * a.rect.h > b.rect.w * b.rect.h ? a : b));
    const coverage =
      (biggest.rect.w * biggest.rect.h) / (survey.slideSize.w * survey.slideSize.h);
    if (coverage > 0.5) return out('image', 0.85, 'a picture covering most of the slide');
  }

  /*
   * STRUCTURE BEFORE PROMINENCE.
   *
   * Everything below this line is checked before the title/section case, and
   * the order matters more than any single rule here. A "big line and not much
   * else" test is satisfied by almost every content slide in a real deck — they
   * all have a title, and none of them has a lot of *characters* — so checking
   * it first labelled slides with three bullets and slides with two comparison
   * columns as SECTION DIVIDERS. Title and section are what's left when a slide
   * has no structure at all, so they are tested last.
   */

  // ---- Lists ----
  if (slide.elements.some((el) => isBulleted(bodyOf(el)))) {
    return out('list', 0.75, 'bulleted content');
  }

  // ---- Comparison: repeated structure across columns ----
  // Two or more same-role text boxes at the same y and the same width is a
  // column layout, which is what a comparison slide is made of.
  if (widestColumnRow(contentElements, assigned) >= 2) {
    return out('comparison', 0.7, 'repeated columns of the same shape');
  }

  // ---- Quote ----
  if (
    textish.length <= 2 &&
    bodyChars > 80 &&
    bodyChars < 400 &&
    /["“”«»]/.test(slide.elements.map((el) => flatText(bodyOf(el))).join(''))
  ) {
    return out('quote', 0.65, 'a short quoted passage, little else');
  }

  // ---- Prose ----
  if (bodyChars > DENSE_CHARS) {
    return out('dense', 0.7, `${bodyChars} characters of body copy`);
  }

  // ---- Title and section ----
  // What's left: a slide carrying a prominent line and no structure. A title
  // slide has something under the headline (a subtitle, a date, a client name);
  // a section divider is deliberately just the one line.
  if (census('title') >= 1 && textish.length <= 3 && bodyChars < 200) {
    return textish.length >= 2
      ? out('title', 0.85, 'a headline with supporting text, nothing else')
      : out('section', 0.8, 'one large line, nothing under it');
  }

  return out('other', 0.4, 'no distinctive structure');
}

/**
 * The widest row of side-by-side elements sharing a top edge and a width.
 *
 * The geometric signature of a column layout: two panels at the same y, the same
 * width, at different x. All three conditions are required — y and w alone would
 * match a title and a chart that happen to line up, and without the distinct-x
 * test two exactly-stacked boxes would read as columns.
 *
 * Returns the size of the largest such row (2 for a two-column comparison), not
 * the number of rows: a comparison slide has ONE row of columns, and counting
 * rows meant the canonical two-column slide scored 1 and never matched.
 */
function widestColumnRow(
  elements: SlideElement[],
  assigned: Map<string, ElementRole>,
): number {
  const TOL = 91_440; // 0.1in — hand-laid columns are rarely pixel-aligned
  const rows = new Map<string, number[]>();
  for (const el of elements) {
    if (assigned.get(el.id)?.role === 'decoration') continue;
    const key = `${Math.round(el.rect.y / TOL)}:${Math.round(el.rect.w / TOL)}`;
    const xs = rows.get(key) ?? [];
    xs.push(Math.round(el.rect.x / TOL));
    rows.set(key, xs);
  }
  let widest = 0;
  for (const xs of rows.values()) widest = Math.max(widest, new Set(xs).size);
  return widest;
}
