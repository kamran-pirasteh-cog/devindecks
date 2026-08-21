/**
 * Make sure you can read it.
 *
 * `palette.ts` maps each source colour to the token whose JOB matches, which is
 * the right way to convert a brand — but it maps colours one at a time, knowing
 * nothing about what each one ends up sitting ON. That gap produces a specific
 * and very visible defect, and the corpus found it immediately: a source deck
 * with mid-grey supporting text on a dark navy panel converts to `ink.muted` on
 * `ink.strong`, which is 3.6:1 and unreadable.
 *
 * Both halves of that mapping are individually correct. Grey supporting text
 * really is `ink.muted`; a dark ground really is `ink.strong`. The pair is wrong,
 * and only a pass that sees both can tell.
 *
 * So this runs after restyling, when every fill is finally a brand token, and
 * asks one question per run: against the ground actually behind it, does this
 * clear the contrast bar? If not, it is replaced with the brand token that best
 * clears it — DERIVED rather than mapped, exactly as `decouple.ts` derives a
 * panel's ink, and for the same reason: a derived colour follows the brand when
 * the palette changes, and a mapped one goes illegible.
 *
 * It only ever changes a colour that fails. A legible mapping, however
 * surprising, is left alone — this is a safety net, not a second opinion.
 */
import type { Slide, SlideElement, TextRun } from '@/model';
import { resolveColor, token, type ColorRef, type DesignSystem } from '@/model/tokens';
import { contrastRatio, parseHex } from '@/chart/color';
import { bodyOf } from './classify';

/** WCAG AA: 4.5:1 for body text, 3:1 for large or bold text. */
export const BODY_CONTRAST = 4.5;
export const LARGE_CONTRAST = 3;
/** At or above this, text counts as large. */
export const LARGE_TEXT_PT = 18;

export const requiredContrast = (sizePt: number, bold: boolean): number =>
  sizePt >= LARGE_TEXT_PT || bold ? LARGE_CONTRAST : BODY_CONTRAST;

/**
 * The ground behind an element, as a hex — or null when it genuinely can't be
 * known.
 *
 * Walks down the z-order for the first thing that covers this element. A picture
 * underneath makes the answer unknowable (a photo has no single colour), and the
 * honest response there is to decline: forcing an ink choice against a guessed
 * background would recolour every caption over every image on the deck.
 *
 * Shared with `lint.ts`, which asks the same question to report what this pass
 * could not fix.
 */
export function groundBehind(slide: Slide, el: SlideElement, ds: DesignSystem): string | null {
  const index = slide.elements.findIndex((e) => e.id === el.id);
  const own = Math.max(1, el.rect.w * el.rect.h);

  /** How much of THIS element's area sits on top of `other`, 0..1. */
  const covered = (other: SlideElement) => {
    const w = Math.min(el.rect.x + el.rect.w, other.rect.x + other.rect.w) - Math.max(el.rect.x, other.rect.x);
    const h = Math.min(el.rect.y + el.rect.h, other.rect.y + other.rect.h) - Math.max(el.rect.y, other.rect.y);
    return w > 0 && h > 0 ? (w * h) / own : 0;
  };

  /*
   * SEMI-TRANSPARENT PANELS DO NOT STOP THE WALK.
   *
   * The frosted card is how every modern deck builds a panel on a coloured
   * ground: white at 14%, which on a dark page reads as a slightly lighter
   * dark. Returning the panel's own token as the ground answered "white" for a
   * card that is visibly near-black, so this pass reversed the card's type to
   * dark ink — and put black text on black. The whole point of the pass,
   * inverted, by one ignored attribute.
   *
   * So a translucent fill is COLLECTED and the walk continues underneath it,
   * and the stack is composited bottom-up at the end. Only an opaque fill ends
   * the search, because only an opaque fill actually hides what it covers.
   */
  const stack: { hex: string; alpha: number }[] = [];
  let base: string | null = null;

  for (let i = index - 1; i >= 0 && base === null; i -= 1) {
    const under = slide.elements[i];
    const share = covered(under);
    if (share <= 0) continue;
    // A photo has no single colour, so the answer is unknowable rather than
    // wrong — decline, and let the linter report what this pass couldn't judge.
    if (under.type === 'picture' && share > PICTURE_DOUBT) return null;
    if (under.type === 'shape' && under.fill?.kind === 'solid') {
      if (share >= GROUND_SHARE) {
        const hex = resolveColor(under.fill.color, ds);
        const alpha = under.fill.alpha ?? 1;
        if (alpha >= OPAQUE) base = hex;
        else if (alpha > 0) stack.push({ hex, alpha });
        continue;
      }
      // Substantially on a fill but not mostly on it — a numeral in a box a
      // shade bigger than the disc it is centred on, a title straddling a
      // panel's edge. The area says "40% off the panel"; the glyphs say "on the
      // disc", and neither this pass nor `lint.ts` can tell which from a
      // rectangle. Unknowable, exactly like a photo: decline, and leave the
      // colour the palette chose.
      if (share > GROUND_DOUBT) return null;
    }
  }

  if (base === null) {
    base =
      slide.background?.kind === 'solid'
        ? resolveColor(slide.background.color, ds)
        : (ds.colors.find((c) => c.id === 'surface.base')?.hex ?? '#FFFFFF');
  }

  // Bottom-up: the last layer collected is the lowest, so composite in reverse.
  let ground = base;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    ground = blend(stack[i].hex, ground, stack[i].alpha);
  }
  return ground;
}

/** Opacity at or above which a fill hides everything behind it. */
const OPAQUE = 0.99;

/**
 * `top` at `alpha` over `bottom`, in sRGB.
 *
 * Straight sRGB compositing rather than anything perceptual, because that is
 * literally what the renderers do — CSS `rgba()` and PowerPoint's `<a:alpha>`
 * both blend in the encoded space — and this function's only job is to predict
 * the pixel a reader will see.
 */
function blend(top: string, bottom: string, alpha: number): string {
  // `parseHex` answers in 0..1 per channel, so the mix happens there and the
  // scale back to bytes happens once, at the end.
  const t = parseHex(top);
  const b = parseHex(bottom);
  const byte = (i: number) =>
    Math.max(0, Math.min(255, Math.round((t[i] * alpha + b[i] * (1 - alpha)) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(0)}${byte(1)}${byte(2)}`.toUpperCase();
}

/**
 * Share of an element's own area that must sit on a fill for that fill to count
 * as its ground.
 *
 * NOT full containment, which is what this required first and which was wrong in
 * the most ordinary way possible: a label on a panel is very often a hair wider
 * than the panel it sits on. One text box overhanging its black panel by 0.2in
 * was judged to be on the white slide behind it, so its near-white ink read as
 * illegible and this pass "corrected" it to a mid grey — on black. A pass meant
 * to guarantee legibility destroyed it.
 *
 * Two thirds, so a box straddling the edge of a panel — genuinely ambiguous —
 * still resolves to the panel it is mostly on.
 */
const GROUND_SHARE = 0.66;

/** Overlap with a picture beyond which the ground is unknowable. */
const PICTURE_DOUBT = 0.25;

/**
 * Overlap with a fill that is too much to ignore and too little to be the
 * ground. Between this and `GROUND_SHARE` the answer is a coin flip, and the
 * one thing worse than no contrast decision is a confident wrong one.
 */
const GROUND_DOUBT = 0.25;

/**
 * The most readable brand token on this ground, preferring the ones that carry
 * the right MEANING.
 *
 * Order matters: on a dark ground we want the light surface token rather than
 * whichever token happens to have the highest ratio, because `surface.base` is
 * what the rest of the app already uses for reversed-out type (see `band.ts` and
 * `callout.ts`). Only if none of the intended tokens clears the bar do we fall
 * back to whatever scores best.
 */
export function legibleToken(
  groundHex: string,
  required: number,
  ds: DesignSystem,
  muted: boolean,
): ColorRef {
  // The tokens worth reaching for, in order of preference, given how dark the
  // ground is and whether the run was supporting text.
  const preferred = muted
    ? ['ink.muted', 'surface.subtle', 'surface.base', 'ink.strong']
    : ['ink.strong', 'surface.base', 'ink.muted', 'surface.subtle'];

  const scored = ds.colors.map((c) => ({ id: c.id, ratio: contrastRatio(c.hex, groundHex) }));
  const byId = new Map(scored.map((s) => [s.id, s.ratio]));

  for (const id of preferred) {
    const ratio = byId.get(id);
    if (ratio !== undefined && ratio >= required) return token(id);
  }
  // Nothing intended clears it — take the best the palette can do. Still better
  // than leaving text nobody can read, and `lint.ts` will report it if it is
  // still short.
  const best = scored.sort((a, b) => b.ratio - a.ratio)[0];
  return token(best?.id ?? 'ink.strong');
}

export interface LegibilityFix {
  elementId: string;
  from: string;
  to: string;
  groundHex: string;
  ratio: number;
}

/** Correct any run that can't be read against its own ground. */
export function enforceLegibility(
  slide: Slide,
  ds: DesignSystem,
): { slide: Slide; fixes: LegibilityFix[] } {
  const fixes: LegibilityFix[] = [];

  const elements = slide.elements.map((el) => {
    const body = bodyOf(el);
    if (!body || (body.paragraphs ?? []).length === 0) return el;
    // Chart primitives are themed by the chart engine, which does its own
    // contrast work (`chart/color.ts` has `inkOn` for exactly this).
    if (el.chartRef) return el;

    const ground = groundBehind(slide, el, ds);
    if (!ground) return el;

    let changed = false;
    const paragraphs = (body.paragraphs ?? []).map((p) => ({
      ...p,
      runs: (p.runs ?? []).map((run: TextRun) => {
        if (!run.color || (run.text ?? '').trim() === '') return run;
        const fg = resolveColor(run.color, ds);
        const sizePt = run.sizePt ?? ds.type.body.sizePt;
        const required = requiredContrast(sizePt, run.bold === true);
        const ratio = contrastRatio(fg, ground);
        if (ratio >= required) return run;

        const muted =
          run.color.kind === 'token' &&
          (run.color.token === 'ink.muted' || run.color.token === 'surface.subtle');
        const next = legibleToken(ground, required, ds, muted);
        const nextHex = resolveColor(next, ds);
        if (nextHex.toUpperCase() === fg.toUpperCase()) return run;

        changed = true;
        fixes.push({ elementId: el.id, from: fg, to: nextHex, groundHex: ground, ratio });
        return { ...run, color: next };
      }),
    }));

    return changed ? ({ ...el, body: { ...body, paragraphs } } as SlideElement) : el;
  });

  return { slide: { ...slide, elements }, fixes };
}
