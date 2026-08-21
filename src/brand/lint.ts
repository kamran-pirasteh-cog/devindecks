/**
 * The gate.
 *
 * Every other file in this engine tries to produce a good slide. This one
 * assumes they failed and goes looking for the evidence — and it is the reason
 * "defect free" can be a property of the system rather than a hope. `convert.ts`
 * only reports a deck as clean when this returns no errors, `ConvertReview` flags
 * those slides in the before/after review, and `scripts/validate-brand.ts` exits non-zero
 * on any error across a whole corpus of real decks.
 *
 * Two rules govern what belongs here:
 *
 *  - ERRORS are things a person would call a defect on sight: text spilling out
 *    of its box, type nobody can read against its background, two elements on
 *    top of each other. These block the "clean" claim.
 *
 *  - WARNINGS are things that might be right. Content outside the margins is
 *    often deliberate; a low-confidence colour mapping may well be correct. They
 *    inform the reviewer without crying wolf.
 *
 * It reuses `Diagnostic` from `model/ingest.ts` rather than inventing a parallel
 * shape, so the review UI, the CLI validator and the import notices all read one
 * kind of thing.
 */
import type { Diagnostic } from '@/model/ingest';
import type { EMU, Rect, Slide, SlideElement } from '@/model';
import { EMU_PER_POINT, emuToPoints, marginBox, resolveColor } from '@/model';
import type { DesignSystem } from '@/model/tokens';
import { contrastRatio } from '@/chart/color';
import type { TextMeasurer } from '@/render/measureText';
import { measureTextBody } from '@/render/measureTextBody';
import { bodyOf, type BrandRole } from './classify';
import { marginsForSlide, MIN_LEGIBLE_PT } from './type';
import { freeSpaceBelow, overlapPairs } from './refit';
import { isBrandChrome } from './chrome';
import { groundBehind } from './legibility';

/** Every code this linter can emit. Exported so tests and CI can name them. */
export const LINT_CODES = [
  'text-overflow',
  'contrast-low',
  'element-overlap',
  'off-margin',
  'color-unmapped',
  'role-ambiguous',
  'logo-missing',
  'logo-collision',
  'tiny-text',
  'size-off-ladder',
  'raw-hex',
  'font-not-brand',
] as const;

export type LintCode = (typeof LINT_CODES)[number];

/** Area overlap above which two elements are certainly colliding. */
const OVERLAP_SHARE = 0.15;

/** Point size at or above which text counts as "large" for contrast purposes. */
const LARGE_TEXT_PT = 18;

/**
 * The share of a line box that is empty space rather than ink. Overflow within
 * this much of the box is invisible — see the note where it's used.
 */
const LINE_BOX_SLACK = 0.2;

export interface LintContext {
  ds: DesignSystem;
  measurer: TextMeasurer;
  slideSize: { w: EMU; h: EMU };
  roles: Map<string, BrandRole>;
  /** Overlaps present before conversion — reported as info, never as errors. */
  preExistingOverlaps: Set<string>;
  /** Element ids whose type left the brand ladder during refit. */
  offLadder: Set<string>;
  /** Each element's largest size in the SOURCE deck, for judging `tiny-text`. */
  sourceSizes: Map<string, number>;
  /** The legibility floor for this slide size — see `minLegiblePtFor`. */
  minPt?: number;
  /** True when the logo slot is a placeholder rather than a real mark. */
  logoPlaceholder: boolean;
  logoRect: Rect | null;
}

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/*
 * The colour behind an element comes from `legibility.ts`.
 *
 * This file used to carry its own walk, and two walks that disagree is worse
 * than either: `legibility` reversed a card's type to white because it composited
 * the card's 14%-opaque white fill over a dark page, while the copy here read
 * that same fill as opaque white and reported "#FFFFFF on #FFFFFF". One of them
 * has to be the authority on what a reader actually sees, and it has to be the
 * one that DECIDES the colour — otherwise the gate passes slides the engine
 * broke, and fails slides it fixed.
 */

/**
 * Lint one slide.
 *
 * `slideNumber` is 1-based, as a human counts them — matching `Diagnostic.slide`.
 */
export function lintSlide(slide: Slide, slideNumber: number, ctx: LintContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const push = (
    severity: Diagnostic['severity'],
    code: LintCode,
    message: string,
    elementId?: string,
  ) => out.push({ severity, code, slide: slideNumber, message, ...(elementId ? { elementId } : {}) });

  const box = marginBox(ctx.slideSize, marginsForSlide(ctx.slideSize));

  for (const el of slide.elements) {
    const role = ctx.roles.get(el.id);
    const body = bodyOf(el);

    /*
     * ---- Overflow ----
     *
     * Whether this is a DEFECT depends on where the spill goes, and getting that
     * distinction right is what makes this gate worth having.
     *
     * `TextBodyView` renders with `overflow: visible`, exactly as PowerPoint and
     * Google Slides do — a text box with autofit off does not clip. So authors
     * routinely leave a box a few points shorter than its own line height and
     * nothing looks wrong, because the text simply occupies the empty space
     * below it. Measuring the bundled reference decks makes the scale of this
     * plain: 312 of their 497 text boxes "overflow", and those decks are the
     * ones we ship as exemplars.
     *
     * Flagging all of that as an error would be both wrong and worse than
     * useless — a reviewer handed 92 errors on a deck that looks perfect stops
     * reading the errors. So:
     *
     *   - spill into empty space, still on the slide → INFO. Nothing is
     *     obscured, nothing is clipped, no viewer can tell.
     *   - spill onto another element, or off the slide → ERROR. That is text
     *     landing on top of other text, or text running off the page, and both
     *     are visible defects.
     */
    if (body && (body.paragraphs ?? []).length > 0) {
      const metrics = measureTextBody(body, el.rect, ctx.ds, ctx.measurer);
      /*
       * A line BOX is taller than the ink in it — 1.3× the font size for these
       * faces (`FONTS.singleLineFactor`), so roughly the bottom fifth of the
       * last line is empty by construction. Text overflowing its box by less
       * than that has not put a single pixel anywhere it shouldn't be, so the
       * grace is subtracted before anything is judged. Without it the gate
       * reported errors for 1.2pt spills — 0.017 of an inch, entirely inside the
       * descender space of the line above.
       */
      const lineH = metrics.paragraphs[0]?.lines[0]?.heightEmu ?? 0;
      const grace = Math.round(lineH * LINE_BOX_SLACK);
      const spill = metrics.overflowEmu - grace;
      if (spill > EMU_PER_POINT) {
        const free = freeSpaceBelow(el, slide.elements, ctx.slideSize);
        const absorbed = spill <= free;
        const pt = emuToPoints(spill).toFixed(1);
        if (absorbed) {
          push(
            'info',
            'text-overflow',
            `Text runs ${pt}pt past its box into empty space below. Visible to no ` +
              `one — nothing clips — but the box is smaller than its text.`,
            el.id,
          );
        } else {
          push(
            'error',
            'text-overflow',
            `Text overflows its box by ${pt}pt (${metrics.lines} lines) and spills ` +
              `onto other content or off the slide.`,
            el.id,
          );
        }
      }

      // ---- Legibility ----
      for (const p of body.paragraphs ?? []) {
        for (const run of p.runs ?? []) {
          if ((run.text ?? '').trim() === '') continue;
          const sizePt = run.sizePt ?? ctx.ds.type.body.sizePt;

          /*
           * Only when the engine made it small. `refit`'s restore-source-size
           * step deliberately hands a deck back the 8pt its author chose, in
           * preference to enlarging it and breaking the layout — and warning
           * about the size we correctly decided on is the engine second-guessing
           * itself. 150 such warnings on one deck is noise that buries the real
           * findings. Below the source size, though, this is ours to answer for.
           */
          const sourcePt = ctx.sourceSizes.get(el.id);
          // Half a point of tolerance, because `scaleBody` rounds to half
          // points: restoring a source size of 8.1pt lands on 8.0pt, and
          // reporting that 0.1pt as "reduced" is reporting our own rounding.
          const floorPt = ctx.minPt ?? MIN_LEGIBLE_PT;
          if (sizePt < floorPt && (sourcePt === undefined || sizePt < sourcePt - 0.5)) {
            push(
              'warning',
              'tiny-text',
              `Text was reduced to ${sizePt}pt — below the ${floorPt}pt floor` +
                `${sourcePt !== undefined ? `, from ${sourcePt}pt in the original` : ''}.`,
              el.id,
            );
          }

          // ---- A converted deck must contain no raw hex at all ----
          if (run.color?.kind === 'hex') {
            push(
              'warning',
              'raw-hex',
              `Run colour is a raw hex (${run.color.hex}) rather than a brand token, so it ` +
                `will not follow a brand change.`,
              el.id,
            );
          }

          if (run.font && !Object.values(ctx.ds.fonts).includes(run.font)) {
            push('warning', 'font-not-brand', `Run is set in ${run.font}, which is not a brand face.`, el.id);
          }

          // ---- Contrast ----
          const ground = groundBehind(slide, el, ctx.ds);
          if (ground && run.color) {
            const fg = resolveColor(run.color, ctx.ds);
            const ratio = contrastRatio(fg, ground);
            const large = sizePt >= LARGE_TEXT_PT || run.bold === true;
            const required = large ? 3 : 4.5;
            if (ratio < required) {
              push(
                'error',
                'contrast-low',
                `${fg} on ${ground} is ${ratio.toFixed(1)}:1 — below the ${required}:1 needed ` +
                  `for ${large ? 'large' : 'body'} text.`,
                el.id,
              );
            }
          }
        }
      }
    }

    // ---- Raw hex on fills and outlines ----
    if ('fill' in el && el.fill?.kind === 'solid' && el.fill.color.kind === 'hex') {
      push('warning', 'raw-hex', `Fill is a raw hex (${el.fill.color.hex}), not a brand token.`, el.id);
    }
    if ('outline' in el && el.outline?.color.kind === 'hex') {
      push('warning', 'raw-hex', `Outline is a raw hex (${el.outline.color.hex}), not a brand token.`, el.id);
    }

    // ---- Off-margin ----
    // Only for content. Full-bleed artwork and our own chrome live outside the
    // safe area by design.
    const bleeds =
      el.rect.x <= 0 ||
      el.rect.y <= 0 ||
      el.rect.x + el.rect.w >= ctx.slideSize.w ||
      el.rect.y + el.rect.h >= ctx.slideSize.h;
    if (!bleeds && !isBrandChrome(el) && role !== 'decoration') {
      const outside =
        el.rect.x < box.x - EMU_PER_POINT ||
        el.rect.y < box.y - EMU_PER_POINT ||
        el.rect.x + el.rect.w > box.x + box.w + EMU_PER_POINT ||
        el.rect.y + el.rect.h > box.y + box.h + EMU_PER_POINT;
      if (outside) {
        push('warning', 'off-margin', 'Element extends outside the brand safe area.', el.id);
      }
    }

    // ---- Off-ladder type ----
    if (ctx.offLadder.has(el.id)) {
      push(
        'info',
        'size-off-ladder',
        'Type was reduced off the brand ladder to make the text fit.',
        el.id,
      );
    }
  }

  // ---- Overlaps ----
  // Only ones conversion CREATED. A pre-existing overlap is usually deliberate
  // layering, and "fixing" it would mean redesigning the author's slide.
  const pairs = overlapPairs(slide.elements, EMU_PER_POINT);
  for (const pair of pairs) {
    if (ctx.preExistingOverlaps.has(pair)) continue;
    const [aId, bId] = pair.split('|');
    const a = slide.elements.find((e) => e.id === aId);
    const b = slide.elements.find((e) => e.id === bId);
    if (!a || !b) continue;
    // Decoration under content is layering, not collision.
    if (ctx.roles.get(aId) === 'decoration' || ctx.roles.get(bId) === 'decoration') continue;
    const share = intersectionArea(a.rect, b.rect) / Math.max(1, Math.min(area(a.rect), area(b.rect)));
    if (share > OVERLAP_SHARE) {
      push(
        'error',
        'element-overlap',
        `Two elements overlap by ${Math.round(share * 100)}% of the smaller one.`,
        aId,
      );
    }
  }

  // ---- Logo ----
  if (ctx.logoPlaceholder) {
    push(
      'warning',
      'logo-missing',
      'No brand logo is set, so a placeholder was drawn. Drop an image on it or click to upload.',
    );
  }
  if (ctx.logoRect) {
    for (const el of slide.elements) {
      if (isBrandChrome(el)) continue;
      if (ctx.roles.get(el.id) === 'decoration') continue;
      const share = intersectionArea(ctx.logoRect, el.rect) / Math.max(1, area(ctx.logoRect));
      if (share > 0.25) {
        push('warning', 'logo-collision', 'The logo overlaps slide content.', el.id);
        break;
      }
    }
  }

  return out;
}

/** Errors only — the set that blocks a "clean" claim. */
export const errorsOf = (diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((d) => d.severity === 'error');

/** Slide numbers with at least one error, ascending. */
export const flaggedSlides = (diagnostics: Diagnostic[]): number[] =>
  [...new Set(errorsOf(diagnostics).map((d) => d.slide))].sort((a, b) => a - b);
