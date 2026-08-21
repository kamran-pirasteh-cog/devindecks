/**
 * Make the text fit again.
 *
 * Restyling changed every font and every size, so every wrap point moved. This
 * is where a converted deck either becomes presentable or becomes a deck with
 * text spilling out of nine boxes. It is the highest-stakes file in the engine.
 *
 * There are two levers — change the type, or change the box — and they have
 * ASYMMETRIC COSTS:
 *
 *   - Shrinking the type breaks the brand type ladder, which is the entire
 *     point of having converted the deck.
 *   - Growing the box breaks the layout, which we promised to preserve.
 *
 * Neither is free, so which to reach for is decided by two questions: WHY doesn't
 * it fit, and WHAT is this text for?
 *
 * ── Why ──────────────────────────────────────────────────────────────────
 * `restyle.ts` records `sourcePt` and `brandPt` per box, and their ratio splits
 * the cases:
 *
 *   METRIC DELTA (ratio ≈ 1). It fit at Arial 14 and Geist 14 is a few percent
 *   wider, so three lines became four. Small, systematic, and OUR fault — the
 *   size was right, so the box should absorb it.
 *
 *   LADDER OVERSHOOT (ratio ≫ 1). Source 11pt body, brand body 14pt: a 27% jump
 *   and a large deficit. Not a defect at all — the brand asked for bigger type
 *   than the content has room for — and here the size is legitimately in
 *   question.
 *
 * ── The levers, cheapest first ───────────────────────────────────────────
 *  1. UNWIND THE OVERSHOOT. Step DOWN the brand ladder toward, but never below,
 *     the source's proportional size. Not "shrinking the font" — admitting we
 *     picked the wrong rung. Costs nothing brand-wise: the result is still a
 *     ladder value.
 *  2. GROW THE BOX, into genuinely free space, bounded and speculative.
 *  3. ROLE-ELASTIC TRADEOFF. Titles prefer type (their slot is fixed, and a
 *     title wrapping to three lines and shoving the body down is far more
 *     visible than two points off its size); body prefers box; KPI rows shrink
 *     in lockstep; captions get the box or a flag, never a smaller size.
 *  4. SUB-LADDER SHRINK, in half-point steps. The only step that leaves the
 *     ladder, so it reports itself.
 *  5. FLAG. Never truncate.
 *
 * ── Two things that are easy to get wrong ────────────────────────────────
 * SIBLING COUPLING. Resolving each box alone gives a KPI row reading
 * 48/44/48/40pt — every box fits, and the row looks broken. Elements sharing a
 * role, a top edge and a size resolve as a GROUP, at the worst case's size.
 *
 * OVERLAP IS NOT OVERFLOW. A pre-existing overlap is usually deliberate
 * layering (text over an image) and is never "resolved". An overlap we CREATE by
 * growing is always rolled back.
 */
import type { EMU, Rect, Slide, SlideElement, TextBody } from '@/model';
import { DEFAULT_MARGINS, EMU_PER_POINT, marginBox, titleBand } from '@/model';
import type { DesignSystem } from '@/model/tokens';
import type { TextMeasurer } from '@/render/measureText';
import { measureTextBody, neededHeightEmu } from '@/render/measureTextBody';
import { bodyOf, type BrandRole } from './classify';
import { MIN_LEGIBLE_PT, stepDown, type SizeLadder } from './type';
import type { RestyleTrace } from './restyle';

/* ------------------------------------------------------------------ */
/* Policy per role                                                    */
/* ------------------------------------------------------------------ */

export interface RolePolicy {
  /** Which lever to reach for once the free steps are exhausted. */
  prefer: 'box' | 'type' | 'none';
  /**
   * How far below the brand size this role may be shrunk, as a fraction. A
   * title tolerates more than body copy: nobody reads a title's point size, and
   * everybody notices a title that wrapped.
   */
  floorFraction: number;
  /** May its box grow at all? */
  canGrow: boolean;
}

/*
 * Note on `canGrow`, which used to be false for title/heading/kpiValue.
 *
 * The reasoning was "growing a title's box pushes the content below it down".
 * That is simply not true in this model: elements are absolutely positioned and
 * nothing reflows, so growing a box moves NOTHING. The only real risk is
 * colliding with a neighbour, and `refitSlide` already detects and rolls back
 * any overlap growth creates.
 *
 * The prohibition therefore bought no safety and cost a great deal of quality:
 * a title one line-height taller than its box — which is how a large fraction of
 * real decks are authored, because nothing clips — could only be fixed by
 * shrinking the type. Converting a deck that was ALREADY on-brand shrank type on
 * a hundred boxes for a problem no viewer could have seen.
 *
 * So every unfrozen role may grow, and `prefer` does the job it should always
 * have done: deciding which lever to reach for FIRST when both are available.
 */
export const ROLE_POLICY: Record<string, RolePolicy> = {
  // Type-first: a slightly smaller two-line title reads better than a
  // three-line one, even though both would fit.
  title: { prefer: 'type', floorFraction: 0.7, canGrow: true },
  heading: { prefer: 'type', floorFraction: 0.75, canGrow: true },
  kpiValue: { prefer: 'type', floorFraction: 0.65, canGrow: true },
  // Box-first: legibility is load-bearing, and there is usually room.
  subtitle: { prefer: 'box', floorFraction: 0.8, canGrow: true },
  body: { prefer: 'box', floorFraction: 0.8, canGrow: true },
  // Already at the legibility floor — the box or a flag, never smaller type.
  caption: { prefer: 'box', floorFraction: 1, canGrow: true },
  eyebrow: { prefer: 'box', floorFraction: 1, canGrow: true },
  decoration: { prefer: 'none', floorFraction: 1, canGrow: false },
};

export const policyFor = (role: BrandRole | undefined): RolePolicy =>
  ROLE_POLICY[role ?? 'body'] ?? ROLE_POLICY.body;

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Does this element put any ink on the slide?
 *
 * Real decks are full of shapes that don't: PowerPoint leaves behind spacers,
 * anchors and group-bounding rectangles with no fill, no outline and no text.
 * They render as nothing, and treating them as obstacles is how a title ends up
 * unable to grow into six tenths of an inch of visibly empty slide — which is
 * exactly what blocked one on the reference deck, leaving it to shrink to its
 * floor and overflow anyway.
 *
 * A picture always counts, even a broken one: it occupies its box.
 */
export function drawsSomething(el: SlideElement): boolean {
  if (el.type === 'picture' || el.type === 'line' || el.type === 'path') return true;
  const filled = 'fill' in el && el.fill !== undefined && el.fill.kind !== 'none';
  const stroked = 'outline' in el && el.outline !== undefined;
  if (filled || stroked) return true;
  const body = bodyOf(el);
  return (body?.paragraphs ?? []).some((p) =>
    (p.runs ?? []).some((r) => (r.text ?? '').trim() !== ''),
  );
}

/** Do two rects overlap by more than a hair? */
export function overlaps(a: Rect, b: Rect, tolerance: EMU = 0): boolean {
  return (
    a.x + a.w - tolerance > b.x &&
    b.x + b.w - tolerance > a.x &&
    a.y + a.h - tolerance > b.y &&
    b.y + b.h - tolerance > a.y
  );
}

/** Overlapping pairs of element ids, as `a|b` with ids sorted. */
export function overlapPairs(elements: SlideElement[], tolerance: EMU): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i];
      const b = elements[j];
      // Elements in the same group are meant to sit together — a panel and the
      // text inside it overlap by construction, and flagging that would flag
      // every card on the deck.
      if (a.groupIds?.some((g) => b.groupIds?.includes(g))) continue;
      // Nor is overlapping an invisible spacer a collision anyone can see.
      if (!drawsSomething(a) || !drawsSomething(b)) continue;
      if (overlaps(a.rect, b.rect, tolerance)) {
        pairs.add([a.id, b.id].sort().join('|'));
      }
    }
  }
  return pairs;
}

/** Snap a value onto a guide when it is already within `tol` of it. */
const snapTo = (value: EMU, guide: EMU, tol: EMU): EMU =>
  Math.abs(value - guide) <= tol ? guide : value;

/** Snap tolerance: a quarter inch. Wider and real layout choices get moved. */
export const SNAP_TOL: EMU = 228_600;

/**
 * Nudge an element onto the brand's margins.
 *
 * Only ever a nudge. An element already near the left margin moves to it; one
 * deliberately placed mid-slide stays exactly where it is. Full-bleed elements
 * are left alone entirely — snapping a background image to the safe area would
 * put a white gutter around it.
 */
export function snapToMargins(
  rect: Rect,
  role: BrandRole | undefined,
  slideSize: { w: EMU; h: EMU },
): Rect {
  const box = marginBox(slideSize, DEFAULT_MARGINS);
  const band = titleBand(slideSize, DEFAULT_MARGINS);

  const bleeds =
    rect.x <= 0 || rect.y <= 0 || rect.x + rect.w >= slideSize.w || rect.y + rect.h >= slideSize.h;
  if (bleeds) return rect;

  const right = rect.x + rect.w;
  const x = snapTo(rect.x, box.x, SNAP_TOL);
  const snappedRight = snapTo(right, box.x + box.w, SNAP_TOL);
  const y =
    role === 'title' || role === 'heading'
      ? snapTo(rect.y, band.y, SNAP_TOL)
      : snapTo(rect.y, box.y, SNAP_TOL);

  return { x, y, w: Math.max(EMU_PER_POINT, snappedRight - x), h: rect.h };
}

/* ------------------------------------------------------------------ */
/* Type scaling                                                       */
/* ------------------------------------------------------------------ */

/** Rescale every run in a body by a factor, half-point rounded. */
export function scaleBody(body: TextBody, factor: number, ds: DesignSystem): TextBody {
  return {
    ...body,
    paragraphs: (body.paragraphs ?? []).map((p) => ({
      ...p,
      // Paragraph spacing is proportional to the type, so it scales too —
      // otherwise shrinking type leaves the original gaps and the box stays
      // just as full.
      spaceAfterPt:
        p.spaceAfterPt === undefined
          ? undefined
          : Math.round(p.spaceAfterPt * factor * 2) / 2,
      runs: (p.runs ?? []).map((r) => {
        const from = r.sizePt ?? ds.type.body.sizePt;
        // Clamped at the ABSOLUTE floor, not the legibility floor: the callers
        // impose their own, higher floors (`policy.floorFraction`), and the
        // restore-source-size step legitimately needs to go below 9pt to hand a
        // deck back the 8pt its author chose.
        return { ...r, sizePt: Math.max(ABSOLUTE_MIN_PT, Math.round(from * factor * 2) / 2) };
      }),
    })),
  };
}

const maxRunPt = (body: TextBody, ds: DesignSystem): number => {
  let max = 0;
  for (const p of body.paragraphs ?? []) {
    for (const r of p.runs ?? []) max = Math.max(max, r.sizePt ?? ds.type.body.sizePt);
  }
  return max || ds.type.body.sizePt;
};

/* ------------------------------------------------------------------ */
/* One element                                                        */
/* ------------------------------------------------------------------ */

/** What refit did, in order, so a bad result can be explained. */
export type RefitStep =
  | 'margin-snap'
  | 'sibling-box-match'
  | 'ladder-step-down'
  | 'unwrap-label'
  | 'restore-source-size'
  | 'grow'
  | 'grow-rolled-back'
  | 'sub-ladder-shrink'
  | 'coupled-shrink'
  | 'overflow';

export interface RefitOutcome {
  element: SlideElement;
  steps: RefitStep[];
  /** Residual overflow in EMU. > 0 means it still doesn't fit. */
  overflowEmu: EMU;
  /** Final size, for the coherence pass and the sibling coupler. */
  finalPt: number;
  /** Whether the type left the brand ladder to get here. */
  offLadder: boolean;
}

export interface RefitContext {
  ds: DesignSystem;
  ladder: SizeLadder;
  measurer: TextMeasurer;
  slideSize: { w: EMU; h: EMU };
  traces: Map<string, RestyleTrace>;
  roles: Map<string, BrandRole>;
  /** Panel ids from `decouple` — frozen geometry, never resized. */
  frozen: Set<string>;
  /**
   * Ids of text boxes that `decouple` lifted OUT of a filled shape — the label
   * on a chip, the caption in a card. Their width is fixed by the panel behind
   * them, so they are the one case where wrapping is a defect rather than a
   * layout. See `LABEL_CHARS`.
   */
  panelText: Set<string>;
}

/**
 * The smallest size this engine will ever produce, even to honour a source
 * deck's own choice. Below this it is not text any more.
 */
export const ABSOLUTE_MIN_PT = 6;

/**
 * Characters below which a text box is a LABEL rather than a sentence.
 *
 * Only consulted for text lifted out of a panel, and only to decide whether a
 * wrap is a defect. "Devin Lite" inside a chip is meant to be one line: the chip
 * was drawn around it, so a second line makes the pill look broken however
 * neatly the text fits vertically. Ordinary prose wrapping is not a defect and
 * is never touched — which is why this is bounded by a character count and by
 * panel membership rather than applied to every short box on the slide.
 */
export const LABEL_CHARS = 28;

/** How much of its size a label may give up to stay on one line. */
const UNWRAP_FLOOR_FRACTION = 0.75;

/** A single short paragraph — a chip's label, a card's kicker. */
export function isLabel(body: TextBody): boolean {
  const paragraphs = body.paragraphs ?? [];
  if (paragraphs.length !== 1) return false;
  const text = (paragraphs[0].runs ?? []).map((r) => r.text ?? '').join('').trim();
  return text.length > 0 && text.length <= LABEL_CHARS;
}

/** Tolerance for "it fits": one point of sub-pixel rounding. */
const FIT_TOL: EMU = EMU_PER_POINT;

/**
 * How much a box may gain, measured in LINES of its own type.
 *
 * `freeSpaceBelow` and the measured deficit already bound growth honestly — one
 * to what's actually free, the other to what's actually needed — so this cap
 * exists only to catch the pathological case: a caption box someone pasted three
 * paragraphs into, which would otherwise grow to fill every inch of whitespace
 * on the slide. That's a content problem, not a fitting problem, and it should
 * be flagged rather than absorbed.
 *
 * Expressed in lines rather than as a fraction of the box's height, which is
 * what it was first: a fraction of a SMALL box is nothing. A 0.45in box needing
 * 0.76in was capped at +0.11in and fell through to shrinking the type — the
 * wrong lever for a metric delta, and the box had four inches of empty slide
 * under it.
 */
const MAX_GROW_LINES = 4;

/**
 * How much free room is below this element before it hits a neighbour or the
 * bottom margin.
 *
 * Only neighbours that actually overlap this element's horizontal span count: a
 * box in the left column is not blocked by one in the right.
 */
export function freeSpaceBelow(
  el: SlideElement,
  siblings: SlideElement[],
  slideSize: { w: EMU; h: EMU },
): EMU {
  const box = marginBox(slideSize, DEFAULT_MARGINS);
  let limit = box.y + box.h;
  for (const other of siblings) {
    if (other.id === el.id) continue;
    if (other.groupIds?.some((g) => el.groupIds?.includes(g))) continue;
    // An element that draws nothing is not an obstacle.
    if (!drawsSomething(other)) continue;
    const sharesColumn =
      other.rect.x < el.rect.x + el.rect.w && el.rect.x < other.rect.x + other.rect.w;
    if (!sharesColumn) continue;
    // Only things BELOW this element's top edge can block its growth downward.
    if (other.rect.y >= el.rect.y + el.rect.h) limit = Math.min(limit, other.rect.y);
  }
  return Math.max(0, limit - (el.rect.y + el.rect.h));
}

/**
 * The same, upward: room above this element before its nearest neighbour or the
 * top margin.
 *
 * Needed because growth is not always downward. A box anchored `bottom` or
 * `middle` holds its text against the bottom (or the centre) of the box, so
 * adding height at the bottom MOVES THE TEXT DOWN — a card heading that grew a
 * line slid down onto the bullets underneath it, closing a gap its unwrapped
 * siblings kept. Such a box has to gain its height upward instead, which needs
 * the room above measured too.
 */
export function freeSpaceAbove(
  el: SlideElement,
  siblings: SlideElement[],
  slideSize: { w: EMU; h: EMU },
): EMU {
  const box = marginBox(slideSize, DEFAULT_MARGINS);
  let limit = box.y;
  for (const other of siblings) {
    if (other.id === el.id) continue;
    if (other.groupIds?.some((g) => el.groupIds?.includes(g))) continue;
    if (!drawsSomething(other)) continue;
    const sharesColumn =
      other.rect.x < el.rect.x + el.rect.w && el.rect.x < other.rect.x + other.rect.w;
    if (!sharesColumn) continue;
    // Only things ABOVE this element's bottom edge can block its growth upward.
    if (other.rect.y + other.rect.h <= el.rect.y) {
      limit = Math.max(limit, other.rect.y + other.rect.h);
    }
  }
  return Math.max(0, el.rect.y - limit);
}

/**
 * Refit one text element.
 *
 * Pure: it never inspects or mutates anything outside its arguments, so the
 * caller can run it speculatively (which the grow step relies on).
 */
export function refitElement(
  el: SlideElement,
  siblings: SlideElement[],
  ctx: RefitContext,
): RefitOutcome {
  const { ds, measurer } = ctx;
  const role = ctx.roles.get(el.id);
  const policy = policyFor(role);
  const steps: RefitStep[] = [];

  const body = bodyOf(el);
  if (!body || (body.paragraphs ?? []).length === 0 || policy.prefer === 'none') {
    return { element: el, steps, overflowEmu: 0, finalPt: 0, offLadder: false };
  }

  // ---- Step 1: margin snap. Geometry only, before anything is measured. ----
  let rect = el.rect;
  if (!ctx.frozen.has(el.id)) {
    const snapped = snapToMargins(rect, role, ctx.slideSize);
    if (snapped.x !== rect.x || snapped.y !== rect.y || snapped.w !== rect.w) {
      steps.push('margin-snap');
      rect = snapped;
    }
  }

  let current = body;
  const brandPt = maxRunPt(body, ds);
  const measure = (b: TextBody, r: Rect) => measureTextBody(b, r, ds, measurer).overflowEmu;
  /** Set by any step that leaves the brand ladder, and reported in the outcome. */
  let offLadder = false;

  /*
   * ---- Step 1b: a chip's label must not wrap ----
   *
   * The only place this engine looks at WIDTH. Everything else here is a height
   * question, because height is what overflows — but a label lifted out of a
   * panel has a width it cannot exceed either, and the failure looks nothing
   * like overflow. "SWE 1.7" broke across two lines inside a pill drawn for one,
   * and every measurement said it fit: the box was tall enough for both lines.
   *
   * The panel cannot grow (it is frozen, and growing one chip in a row of three
   * is the sibling problem `decouple.ts` exists to avoid), and the text box
   * cannot grow sideways past it, so the only lever is the type. A pill's label
   * half a point smaller is invisible; a pill's label on two lines is not.
   */
  if (ctx.panelText.has(el.id) && isLabel(current)) {
    const wrapped = () => measureTextBody(current, rect, ds, measurer).lines > 1;
    if (wrapped()) {
      let pt = maxRunPt(current, ds);
      // The role's own floor is not the right bound here. A caption's is 1.0 —
      // it may not shrink at all, because a caption is already at the
      // legibility floor — and that reasoning does not survive contact with a
      // chip, whose alternative is not "slightly small text" but "a pill with
      // its label broken in half". So the label may give up a quarter of its
      // size, and never a point below what anyone can read.
      const floor = Math.max(MIN_LEGIBLE_PT, brandPt * UNWRAP_FLOOR_FRACTION);
      let shrank = false;
      while (wrapped() && pt - 0.5 >= floor) {
        current = scaleBody(current, (pt - 0.5) / pt, ds);
        pt -= 0.5;
        shrank = true;
      }
      // Below the ladder, so it says so — even when it did not fix the wrap, in
      // which case `lint.ts` still has a box to complain about.
      if (shrank) {
        steps.push('unwrap-label');
        offLadder = true;
      }
    }
  }

  if (measure(current, rect) <= FIT_TOL) {
    return {
      element: { ...el, rect, body: current } as SlideElement,
      steps,
      overflowEmu: 0,
      finalPt: maxRunPt(current, ds),
      offLadder,
    };
  }

  // ---- Step 2: unwind the ladder overshoot ----
  // Only when the brand actually asked for bigger type than the source had, and
  // only down to the source's own proportional size. Every stop is a ladder
  // value, so nothing here costs us brand fidelity.
  const trace = ctx.traces.get(el.id);
  if (trace && trace.ratio > 1.05) {
    let pt = brandPt;
    // The floor for THIS step is the source's size: below that we are no longer
    // unwinding an overshoot, we are shrinking the author's type.
    const floor = Math.max(trace.sourcePt, MIN_LEGIBLE_PT);
    for (;;) {
      const nextPt = stepDown(ctx.ladder, pt);
      if (nextPt === null || nextPt < floor) break;
      const candidate = scaleBody(current, nextPt / pt, ds);
      current = candidate;
      pt = nextPt;
      steps.push('ladder-step-down');
      if (measure(current, rect) <= FIT_TOL) {
        return {
          element: { ...el, rect, body: current } as SlideElement,
          steps,
          overflowEmu: 0,
          finalPt: pt,
          offLadder,
        };
      }
    }
  }

  /*
   * Step 2b: give the author their own size back.
   *
   * The ladder's smallest rung is bounded by `MIN_LEGIBLE_PT`, so a deck whose
   * labels are set at 8pt has them mapped UP — and `stepDown` cannot help,
   * because there is no rung below the bottom one. The engine has then made the
   * text bigger than the author chose and broken the layout doing it, with no
   * way back.
   *
   * Enlarging text is never worth a defect. So when the brand asked for more
   * than the source had and it still doesn't fit, the size returns to exactly
   * what the source used. That isn't shrinking the author's type below their
   * intent — it IS their intent, and the deck demonstrably had room for it.
   *
   * This leaves the ladder, so it says so; and `lint.ts` will add a `tiny-text`
   * note if the result is genuinely small, which is the honest outcome for a
   * source deck that was set in 8pt.
   */
  if (trace && maxRunPt(current, ds) > trace.sourcePt + 0.01 && measure(current, rect) > FIT_TOL) {
    const target = Math.max(trace.sourcePt, ABSOLUTE_MIN_PT);
    if (target < maxRunPt(current, ds)) {
      current = scaleBody(current, target / maxRunPt(current, ds), ds);
      steps.push('restore-source-size');
      if (measure(current, rect) <= FIT_TOL) {
        return {
          element: { ...el, rect, body: current } as SlideElement,
          steps,
          overflowEmu: 0,
          finalPt: maxRunPt(current, ds),
          // Back at the source's own size, which the brand ladder may not
          // contain. Reported, so the review screen can show it.
          offLadder: true,
        };
      }
    }
  }

  /*
   * Steps 3 and 4, in the order this role wants them.
   *
   * `prefer: 'box'` grows first and shrinks only if growth wasn't enough.
   * `prefer: 'type'` tries a bounded shrink first — a title or a stat reads
   * better a little smaller than a line taller — and still falls back to the box
   * if the shrink hits its floor.
   *
   * Both are attempts, not commitments: each returns whether it helped, and the
   * other still runs if the text doesn't fit yet.
   */

  /** Grow into free space below. Bounded by what's free, needed, and the cap. */
  const tryGrow = (): boolean => {
    if (!policy.canGrow || ctx.frozen.has(el.id)) return false;
    // Which way the box has to gain its height, so the text it already holds
    // stays put: a top-anchored box grows downward, a bottom-anchored one
    // upward, a middle-anchored one half each way.
    const up = current.anchor === 'bottom' ? 1 : current.anchor === 'middle' ? 0.5 : 0;
    const down = 1 - up;
    const above = freeSpaceAbove({ ...el, rect }, siblings, ctx.slideSize);
    const below = freeSpaceBelow({ ...el, rect }, siblings, ctx.slideSize);
    // What's free, converted into total growth: a middle-anchored box with an
    // inch below it can only take two inches if it also has one inch above.
    const free = Math.min(up > 0 ? above / up : Infinity, down > 0 ? below / down : Infinity);
    const lineH =
      measureTextBody(current, rect, ds, measurer).paragraphs[0]?.lines[0]?.heightEmu ?? 0;
    // At least its own height, so a tall box is not held to four lines' worth.
    const cap = Math.max(lineH * MAX_GROW_LINES, rect.h);
    const needed = neededHeightEmu(current, rect, ds, measurer) - rect.h;
    const grow = Math.min(free, cap, Math.max(0, needed));
    if (grow <= FIT_TOL) return false;
    const grown = { ...rect, y: rect.y - grow * up, h: rect.h + grow };
    if (measure(current, grown) >= measure(current, rect)) return false;
    rect = grown;
    steps.push('grow');
    return true;
  };

  /**
   * Shrink in half-point steps down to the role's floor.
   *
   * The only step that leaves the brand ladder, so it sets `offLadder` and says
   * so in the report. A role with `floorFraction: 1` — a caption, already at the
   * legibility floor — declines immediately, which is correct: 9pt text made
   * smaller is not a fix.
   */
  const tryShrink = (): boolean => {
    let pt = maxRunPt(current, ds);
    const floor = Math.max(MIN_LEGIBLE_PT, brandPt * policy.floorFraction);
    let shrank = false;
    while (pt - 0.5 >= floor) {
      const nextPt = pt - 0.5;
      current = scaleBody(current, nextPt / pt, ds);
      pt = nextPt;
      shrank = true;
      offLadder = true;
      if (measure(current, rect) <= FIT_TOL) break;
    }
    if (shrank) steps.push('sub-ladder-shrink');
    return shrank;
  };

  const done = () => measure(current, rect) <= FIT_TOL;
  const levers = policy.prefer === 'type' ? [tryShrink, tryGrow] : [tryGrow, tryShrink];
  for (const lever of levers) {
    lever();
    if (done()) break;
  }

  // ---- Step 5: flag. Never truncate. ----
  const residual = measure(current, rect);
  if (residual > FIT_TOL) steps.push('overflow');
  return {
    element: { ...el, rect, body: current } as SlideElement,
    steps,
    overflowEmu: residual,
    finalPt: maxRunPt(current, ds),
    offLadder,
  };
}

/* ------------------------------------------------------------------ */
/* Sibling coupling                                                   */
/* ------------------------------------------------------------------ */

/**
 * Groups of elements that must end up the same size.
 *
 * Same role, same top edge, same original size: a KPI row, a set of comparison
 * column headings, a row of card labels. Keyed generously on position (a tenth
 * of an inch) because hand-laid rows are rarely exact.
 */
export function siblingGroups(
  elements: SlideElement[],
  ctx: RefitContext,
): SlideElement[][] {
  const TOL: EMU = 91_440; // 0.1in
  const buckets = new Map<string, SlideElement[]>();
  for (const el of elements) {
    const role = ctx.roles.get(el.id);
    if (!role || policyFor(role).prefer === 'none') continue;
    const trace = ctx.traces.get(el.id);
    if (!trace) continue;
    const key = `${role}:${Math.round(el.rect.y / TOL)}:${trace.brandPt}`;
    buckets.set(key, [...(buckets.get(key) ?? []), el]);
  }
  return [...buckets.values()].filter((g) => g.length >= 2);
}

/**
 * Give a row of siblings the same box, not just the same size.
 *
 * `siblingGroups` says these boxes must end up at one size, and `refitSlide`
 * gets there by taking the SMALLEST size any of them could fit — which hands
 * the whole row's typography to whichever box happens to be the shortest.
 *
 * That is fine when the boxes were drawn alike and fatal when they weren't, and
 * decks exported from Google Slides never draw them alike: an auto-sized text
 * box is exactly as tall as the glyphs it held, so `01`, `02` and `03` arrive
 * 0.46in, 0.43in and 0.33in tall. The 0.33in box could not hold 26pt, so it
 * shrank to 17pt, and coupling then pushed its two identical neighbours down to
 * 17pt as well — three display numerals set SMALLER than the sentence beside
 * them, which is the hierarchy of the slide read backwards.
 *
 * The boxes were meant to be the same box. So before anything is measured, the
 * short ones are grown to match the tallest in their group, and the row is fit
 * as the row it was drawn as. Growth is only ever downward-from-anchor and only
 * accepted when it collides with nothing, so this cannot introduce an overlap
 * that wasn't there — and `refitSlide`'s rollback treats it as a geometry step
 * like any other, so a collision it does cause is undone.
 */
function matchSiblingBoxes(slide: Slide, ctx: RefitContext): Map<string, Rect> {
  const matched = new Map<string, Rect>();
  for (const group of siblingGroups(slide.elements, ctx)) {
    const tallest = Math.max(...group.map((el) => el.rect.h));
    for (const el of group) {
      if (ctx.frozen.has(el.id) || el.rect.h >= tallest) continue;
      // A box sitting ON something does not own its own size — the shape behind
      // it does. A numeral centred on a disc that grows a tenth of an inch is no
      // longer mostly on the disc, and the ink `legibility.ts` derived for it
      // against that disc stops being the ink for what's now behind it. Rows of
      // chips and discs are already uniform anyway; it is the auto-sized text
      // boxes with nothing behind them that arrive ragged.
      if (ctx.panelText.has(el.id)) continue;
      const body = bodyOf(el);
      if (!body) continue;
      // The same anchor arithmetic `tryGrow` uses, so the text this box already
      // holds does not move when the box gains height.
      const up = body.anchor === 'bottom' ? 1 : body.anchor === 'middle' ? 0.5 : 0;
      const gain = tallest - el.rect.h;
      const rect: Rect = { ...el.rect, y: el.rect.y - gain * up, h: tallest };
      if (rect.y < 0 || rect.y + rect.h > ctx.slideSize.h) continue;
      const grown = { ...el, rect } as SlideElement;
      const others = slide.elements.filter((o) => o.id !== el.id);
      const wasClear = !overlapPairs([el, ...others], FIT_TOL).size;
      const stillClear = !overlapPairs([grown, ...others], FIT_TOL).size;
      if (wasClear && !stillClear) continue;
      matched.set(el.id, rect);
    }
  }
  return matched;
}

/* ------------------------------------------------------------------ */
/* One slide                                                          */
/* ------------------------------------------------------------------ */

export interface SlideRefit {
  slide: Slide;
  outcomes: Map<string, RefitOutcome>;
  /** Overlaps that existed before conversion — never "fixed", only recorded. */
  preExistingOverlaps: Set<string>;
}

export function refitSlide(slide: Slide, ctx: RefitContext): SlideRefit {
  const before = overlapPairs(slide.elements, FIT_TOL);
  const outcomes = new Map<string, RefitOutcome>();

  // ---- Row geometry first: a row of siblings is fit as one row ----
  const matched = matchSiblingBoxes(slide, ctx);
  const start = matched.size
    ? slide.elements.map((el) => {
        const rect = matched.get(el.id);
        return rect ? ({ ...el, rect } as SlideElement) : el;
      })
    : slide.elements;

  // ---- First pass: every element independently ----
  let elements = start.map((el) => {
    const fit = refitElement(el, start, ctx);
    const outcome = matched.has(el.id)
      ? { ...fit, steps: ['sibling-box-match' as RefitStep, ...fit.steps] }
      : fit;
    outcomes.set(el.id, outcome);
    return outcome.element;
  });

  // ---- Roll back growth that created an overlap ----
  // Growth is the only step that can collide with a neighbour, and a converted
  // deck with two boxes on top of each other is worse than one with slightly
  // smaller type. So the grow is undone and that element is refit again with
  // growth withheld, which pushes it onto the type lever instead.
  const after = overlapPairs(elements, FIT_TOL);
  const created = [...after].filter((p) => !before.has(p));
  if (created.length) {
    // Any step that MOVED or RESIZED the element could be the cause — margin
    // snap as much as growth. Snapping a box's left edge and right edge onto the
    // brand margins widens it, and on a hand-laid slide that is quite enough to
    // put it on top of its neighbour.
    const movedIt = (id: string) => {
      const steps = outcomes.get(id)?.steps ?? [];
      return (
        steps.includes('grow') ||
        steps.includes('margin-snap') ||
        steps.includes('sibling-box-match')
      );
    };
    const culprits = new Set(created.flatMap((p) => p.split('|')).filter(movedIt));
    if (culprits.size) {
      // Freezing the culprit withholds BOTH geometry levers from it — growth
      // and margin snap — which is what "put it back where it was" means. It
      // then has only the type lever, which cannot collide with anything.
      const noGeometry: RefitContext = {
        ...ctx,
        frozen: new Set([...ctx.frozen, ...culprits]),
      };
      elements = slide.elements.map((el) => {
        if (!culprits.has(el.id)) return outcomes.get(el.id)!.element;
        const redone = refitElement(el, slide.elements, noGeometry);
        outcomes.set(el.id, {
          ...redone,
          steps: [...redone.steps, 'grow-rolled-back'],
        });
        return redone.element;
      });
    }
  }

  // ---- Sibling coupling: one size per row ----
  const coupled = new Map<string, number>();
  for (const group of siblingGroups(slide.elements, ctx)) {
    const sizes = group.map((el) => outcomes.get(el.id)?.finalPt ?? 0).filter((n) => n > 0);
    if (!sizes.length) continue;
    const worst = Math.min(...sizes);
    for (const el of group) {
      const outcome = outcomes.get(el.id);
      if (!outcome || outcome.finalPt <= worst) continue;
      coupled.set(el.id, worst);
    }
  }
  if (coupled.size) {
    elements = elements.map((el) => {
      const target = coupled.get(el.id);
      const body = bodyOf(el);
      if (target === undefined || !body) return el;
      const outcome = outcomes.get(el.id)!;
      const scaled = scaleBody(body, target / outcome.finalPt, ctx.ds);
      const next = { ...el, body: scaled } as SlideElement;
      outcomes.set(el.id, {
        ...outcome,
        element: next,
        steps: [...outcome.steps, 'coupled-shrink'],
        finalPt: target,
        overflowEmu: measureTextBody(scaled, el.rect, ctx.ds, ctx.measurer).overflowEmu,
      });
      return next;
    });
  }

  return { slide: { ...slide, elements }, outcomes, preExistingOverlaps: before };
}
