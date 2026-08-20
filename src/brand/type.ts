/**
 * Every font size in the source deck → one step on the brand's type ladder.
 *
 * The naive version maps each element's size from its role: a title becomes
 * `ds.type.title.sizePt`, body becomes body. That collapses the deck. Real decks
 * carry more sizes than a ladder has rungs — a 12pt body with 10pt sub-bullets
 * and an 11pt table, three deliberate levels of a hierarchy — and role-only
 * mapping flattens all three to 14pt, destroying the structure the author built.
 *
 * The other naive version keeps every source size and just changes the font.
 * That preserves the hierarchy and abandons the brand: you get a deck in our
 * typeface at their sizes, which is most of the way to not having converted it.
 *
 * So: build the ladder from the brand, then map the deck's DISTINCT sizes onto
 * it MONOTONICALLY. Bigger stays bigger, near-duplicates merge, and the result
 * only ever contains brand values. Two properties matter:
 *
 *   - Order preserved. If 24pt > 18pt in the source, their images are ordered
 *     the same way — so a hierarchy can compress but never invert.
 *   - Deck-wide. 12pt maps to the same rung on slide 3 and slide 40, which is
 *     the thing that makes a converted deck feel like one deck.
 */
import type { DesignSystem } from '@/model/tokens';
import { BUILT_IN_TYPE_ROLES, resolveTypeRole } from '@/model/tokens';
import type { FontFamily } from '@/model/fonts';
import type { DeckSurvey, SizeStat } from './survey';

/**
 * Sizes within this many points of each other are the same size.
 *
 * Source decks are full of 11.5s and 13.02s — the residue of someone dragging a
 * text box in an app with autofit on. Treating those as distinct levels of a
 * hierarchy manufactures rungs the author never intended.
 */
export const SIZE_EPSILON_PT = 1;

/** No brand rung below this: it stops being readable on a projector. */
export const MIN_LEGIBLE_PT = 9;

export interface SizeLadder {
  /** Ascending, deduplicated brand sizes. */
  steps: number[];
  /** The role each step came from, for explaining the mapping. */
  originOf: Map<number, string>;
}

/**
 * The brand's ladder: every type role's size, plus bounded steps above and
 * below.
 *
 * The extra rungs exist so a deliberately-huge stat or a deliberately-tiny
 * footnote has somewhere on-brand to land. Without them a 60pt hero number and
 * a 48pt KPI both become 48pt and the slide loses its focal point. They are
 * multiples of a role's own size rather than free values, so every rung is
 * still derived from the brand.
 */
export function buildLadder(ds: DesignSystem): SizeLadder {
  const originOf = new Map<number, string>();
  const add = (pt: number, origin: string) => {
    const rounded = Math.round(pt * 2) / 2; // half-point precision, as PowerPoint uses
    if (rounded < MIN_LEGIBLE_PT) return;
    if (!originOf.has(rounded)) originOf.set(rounded, origin);
  };

  // Built-ins first so they own their rung when a custom role collides.
  const roleIds = [
    ...BUILT_IN_TYPE_ROLES,
    ...Object.keys(ds.type).filter(
      (id) => !(BUILT_IN_TYPE_ROLES as readonly string[]).includes(id),
    ),
  ];

  for (const id of roleIds) {
    const role = resolveTypeRole(ds, id);
    add(role.sizePt, id);
  }
  // One step out on each side of the extremes only — interior gaps are already
  // covered by the roles themselves, and filling them would invent a ladder
  // finer than the brand actually specifies.
  const sized = [...originOf.keys()].sort((a, b) => a - b);
  if (sized.length) {
    add(sized[0] * 0.85, 'step below smallest');
    add(sized[sized.length - 1] * 1.25, 'step above largest');
  }

  return { steps: [...originOf.keys()].sort((a, b) => a - b), originOf };
}

export interface SizeMapping {
  sourcePt: number;
  brandPt: number;
  /** Why this rung — for the report and for debugging a bad conversion. */
  reason: string;
}

export interface SizeMap {
  ladder: SizeLadder;
  /** Source size → brand size. Total over every size the survey saw. */
  to: Map<number, number>;
  mappings: SizeMapping[];
}

/**
 * Collapse the deck's sizes into distinct levels.
 *
 * Weighted by ink (`chars`), so the level a size belongs to is decided by the
 * size that actually carries the deck's text rather than by whichever value
 * happened to appear first.
 */
export function distinctLevels(sizes: SizeStat[]): number[][] {
  const ordered = [...sizes].sort((a, b) => b.sizePt - a.sizePt);
  const groups: number[][] = [];
  for (const stat of ordered) {
    const last = groups[groups.length - 1];
    const anchor = last?.[0];
    if (anchor !== undefined && anchor - stat.sizePt <= SIZE_EPSILON_PT) last.push(stat.sizePt);
    else groups.push([stat.sizePt]);
  }
  return groups;
}

/**
 * Build the deck's size map.
 *
 * The deck's distinct levels, largest first, are laid against the ladder's
 * rungs, largest first. Each level takes the highest rung not yet taken by a
 * larger level — which is what makes the mapping monotonic by construction
 * rather than by a check afterwards.
 *
 * When the deck has more levels than the ladder has rungs, the surplus levels
 * pile onto the smallest rung: a hierarchy deeper than the brand's cannot be
 * expressed, and compressing its bottom end is strictly better than either
 * inverting it or inventing off-brand sizes for it.
 */
export function buildSizeMap(survey: DeckSurvey, ds: DesignSystem): SizeMap {
  const ladder = buildLadder(ds);
  const levels = distinctLevels(survey.sizes);
  const to = new Map<number, number>();
  const mappings: SizeMapping[] = [];

  if (ladder.steps.length === 0) {
    // A design system with no legible roles at all. Pass sizes through rather
    // than map everything to nothing.
    for (const stat of survey.sizes) {
      to.set(stat.sizePt, stat.sizePt);
      mappings.push({ sourcePt: stat.sizePt, brandPt: stat.sizePt, reason: 'no brand ladder' });
    }
    return { ladder, to, mappings };
  }

  const rungs = [...ladder.steps].sort((a, b) => b - a); // descending

  // The deck's biggest level anchors to the ladder rung nearest its own size,
  // not automatically to the top rung. A deck whose largest text is 16pt is a
  // dense deck, and stretching that 16pt up to a 60pt hero rung because it
  // happens to be the biggest thing present would be a violent misreading.
  const biggest = levels[0]?.[0];
  const cursor =
    biggest === undefined
      ? 0
      : rungs.reduce(
          (best, rung, i) =>
            Math.abs(rung - biggest) < Math.abs(rungs[best] - biggest) ? i : best,
          0,
        );

  /*
   * How a level's rung is chosen depends on whether the ladder is big enough.
   *
   * ONE RUNG PER LEVEL, while they last. The deck's hierarchy maps straight onto
   * the brand's, which is what you want for a normal deck of five or six levels.
   *
   * PROPORTIONALLY, once there are more levels than rungs. The obvious
   * alternative — keep stepping down and pile everything past the last rung onto
   * the bottom one — is what this did first, and it is badly wrong on a deck with
   * real size variety: a deck with 52 levels had every level from the eighth
   * down mapped to the smallest rung, so a 35.6pt heading and a 7pt footnote
   * both came out at 9.5pt. Spreading the levels across the ladder instead keeps
   * the hierarchy legible: a heading stays a heading, the compression is shared
   * out evenly, and the mapping is still monotonic.
   */
  const spread = levels.length > rungs.length - cursor;
  const span = rungs.length - 1 - cursor;

  levels.forEach((level, i) => {
    const index = spread
      ? cursor + Math.round((i * span) / Math.max(1, levels.length - 1))
      : Math.min(cursor + i, rungs.length - 1);
    const rung = rungs[Math.min(Math.max(index, 0), rungs.length - 1)];
    for (const sourcePt of level) {
      to.set(sourcePt, rung);
      mappings.push({
        sourcePt,
        brandPt: rung,
        reason:
          i === 0
            ? `deck's largest type (${sourcePt}pt) → nearest brand rung`
            : spread
              ? `level ${i + 1} of ${levels.length} — more levels than the ladder has ` +
                `rungs, so they are spread across it`
              : `level ${i + 1} of ${levels.length} → ${ladder.originOf.get(rung) ?? 'ladder'}`,
      });
    }
  });

  return { ladder, to, mappings };
}

/** The brand size for a source size, nearest rung if the survey never saw it. */
export function mapSize(map: SizeMap, sourcePt: number): number {
  const direct = map.to.get(sourcePt);
  if (direct !== undefined) return direct;
  if (!map.ladder.steps.length) return sourcePt;
  return map.ladder.steps.reduce((best, rung) =>
    Math.abs(rung - sourcePt) < Math.abs(best - sourcePt) ? rung : best,
  );
}

/**
 * The rung one step down from this one, or null at the bottom.
 *
 * `refit.ts`'s cheapest lever: stepping down the ladder keeps the result on
 * brand, unlike an arbitrary point reduction.
 */
export function stepDown(ladder: SizeLadder, pt: number): number | null {
  const below = ladder.steps.filter((s) => s < pt - 0.01);
  return below.length ? below[below.length - 1] : null;
}

/** The rung one step up, or null at the top. */
export function stepUp(ladder: SizeLadder, pt: number): number | null {
  return ladder.steps.find((s) => s > pt + 0.01) ?? null;
}

/* ------------------------------------------------------------------ */
/* Fonts                                                              */
/* ------------------------------------------------------------------ */

/**
 * Roles that wear the heading face. Everything else takes the body face —
 * except the eyebrow, which the brand sets in mono (see `editor/eyebrow.ts`).
 */
const HEADING_ROLES = new Set(['title', 'subtitle', 'heading', 'kpiValue']);

/** The brand font for a role, given what the source run was set in. */
export function mapFont(
  ds: DesignSystem,
  role: string | undefined,
  sourceFont: string | undefined,
): FontFamily {
  if (role === 'eyebrow' || role === 'eyebrow.mark') return ds.fonts.mono;
  // A monospaced source run is almost always deliberate — a code sample, a
  // ticker, a fixed-width table — and flattening it to the body face destroys
  // the alignment it was chosen for.
  if (sourceFont && /mono|consol|courier|menlo|code/i.test(sourceFont)) return ds.fonts.mono;
  if (role && HEADING_ROLES.has(role)) return ds.fonts.heading;
  return ds.fonts.body;
}
