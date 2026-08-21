/**
 * Apply the brand. Every colour becomes a token, every font becomes ours, every
 * size lands on the ladder, and the source deck's furniture is removed.
 *
 * Everything here reads from tables built earlier (`palette`, `type`, `classify`)
 * rather than deciding anything itself — that separation is what makes the
 * output consistent across a whole deck and testable in isolation. This file is
 * the part that actually rewrites elements, and it makes exactly four kinds of
 * change:
 *
 *  1. TYPOGRAPHY — font, size, weight, colour, caps, per run.
 *  2. RHYTHM — paragraph spacing and line spacing onto the brand's own values.
 *     Reclaims height before `refit` has to choose between shrinking type and
 *     growing boxes, which is why it belongs here and not there.
 *  3. SHAPE — rectangular presets lose their rounding. See `squareCorners`.
 *  4. REMOVAL — source logos, footers and page numbers, which our chrome
 *     replaces.
 *
 * What it deliberately does NOT change is LAYOUT. Every rect goes through
 * untouched — corners are the brand's, positions and sizes are not this pass's
 * business; `refit` owns those, and only after this pass has told it what the
 * type is now.
 */
import type {
  Fill,
  Outline,
  Paragraph,
  ShapeElement,
  ShapePreset,
  Slide,
  SlideElement,
  TextBody,
  TextRun,
} from '@/model';
import { ROUNDABLE_PRESETS } from '@/model';
import { resolveTypeRole, token, type DesignSystem } from '@/model/tokens';
import type { SlideClassification } from './classify';
import { bodyOf, isChromeRole, typeRoleFor, type BrandRole } from './classify';
import { panelIsLight, PANEL_ROLE } from './decouple';
import { mapColor, type ColorMap } from './palette';
import { mapFont, mapSize, type SizeMap } from './type';
import { normalizeHex } from './survey';

/**
 * What the source run was set at, kept on the element so `refit` can tell a
 * metric delta from a ladder overshoot.
 *
 * Stored per element rather than per run because refit works on whole boxes: it
 * scales a box's type as a unit, so the ratio it needs is the box's.
 */
export interface RestyleTrace {
  elementId: string;
  role: BrandRole;
  /** Largest source size in the box, before conversion. */
  sourcePt: number;
  /** Largest brand size in the box, after conversion. */
  brandPt: number;
  /**
   * > 1 means the brand asked for BIGGER type than the source had — a ladder
   * overshoot, whose overflow refit should answer by stepping the ladder down.
   * ≈ 1 means the size was kept and any overflow is a metric delta, which the
   * box should absorb.
   */
  ratio: number;
}

export interface RestyleResult {
  slide: Slide;
  traces: Map<string, RestyleTrace>;
  /** Ids removed as source chrome, with what they were. */
  removed: { id: string; role: BrandRole }[];
}

export interface RestyleContext {
  ds: DesignSystem;
  colors: ColorMap;
  sizes: SizeMap;
  classification: SlideClassification;
  /** Panel ids from `decouple`, whose text derives its ink from the panel. */
  panels: Map<string, ShapeElement>;
}

/* ------------------------------------------------------------------ */
/* Rhythm                                                             */
/* ------------------------------------------------------------------ */

/**
 * Paragraph spacing, as a fraction of the paragraph's own size.
 *
 * Source decks carry spacing in absolute points chosen for their type sizes —
 * 18pt after a paragraph set in 24pt Arial. Carried across verbatim onto 14pt
 * brand body copy that becomes a canyon, and it's the single biggest source of
 * reclaimable height in a converted deck. Expressed proportionally so it scales
 * with whatever rung the type landed on.
 */
const SPACE_AFTER_EM: Record<string, number> = {
  title: 0.25,
  subtitle: 0.4,
  heading: 0.35,
  body: 0.45,
  caption: 0.3,
  kpiValue: 0.1,
  eyebrow: 0.5,
};

/** The brand's line spacing. 100 = single, which is what the deck is set in. */
const LINE_SPACING_PCT = 100;

/**
 * Normalize a paragraph's rhythm.
 *
 * Three decisions, and the last two were mistakes worth recording because the
 * corpus caught them and they were the largest single cause of overflow errors
 * on real decks.
 *
 * `spaceBefore` is dropped rather than normalized: the brand expresses the gap
 * between two paragraphs once, after the first. A deck carrying both ends up
 * with doubled gaps, and since flex items don't collapse margins (see
 * `measureTextBody`) that doubling is real height, not a rendering quirk.
 *
 * `spaceAfter` is proportional to the paragraph's OWN size, not to the role's
 * nominal size. Using the role's meant an 8pt label in a body-role box was
 * given the 14pt body role's 6.5pt of trailing space — most of a line of it,
 * inside a box 9pt tall.
 *
 * And the LAST paragraph gets none at all. There is nothing beneath it for the
 * space to separate it from, so every point of it is phantom height that pushes
 * a box into overflow it doesn't have. This one line accounted for most of the
 * spurious overflow errors on the reference decks — every single-paragraph text
 * box on every slide was being measured a third taller than its content.
 */
function restyleRhythm(
  p: Paragraph,
  role: BrandRole,
  ds: DesignSystem,
  isLast: boolean,
): Paragraph {
  const em = SPACE_AFTER_EM[typeRoleFor(role)] ?? 0.4;
  const ownPt = p.runs.reduce((max, r) => Math.max(max, r.sizePt ?? ds.type.body.sizePt), 0);
  const basePt = ownPt || resolveTypeRole(ds, typeRoleFor(role)).sizePt;
  return {
    ...p,
    spaceBeforePt: 0,
    spaceAfterPt: isLast ? 0 : Math.round(basePt * em * 2) / 2,
    lineSpacingPct: LINE_SPACING_PCT,
  };
}

/* ------------------------------------------------------------------ */
/* Runs                                                               */
/* ------------------------------------------------------------------ */

/**
 * The colour a run takes.
 *
 * Three sources, in priority order, and the priority is the point:
 *
 *  1. Inside a panel, DERIVED from the panel's lightness. A mapped colour on a
 *     dark panel stays dark and becomes illegible the moment the brand palette
 *     changes; a derived one flips by itself.
 *  2. For a KPI, the role's token, whatever the source said. See below.
 *  3. Mapped from the source colour, when the source stated one.
 *  4. The role's own token, when it didn't.
 */
function runColor(
  run: TextRun,
  role: BrandRole,
  ctx: RestyleContext,
  panel: ShapeElement | undefined,
) {
  const { ds, colors } = ctx;
  if (panel) {
    return panelIsLight(panel, ds)
      ? token(resolveTypeRole(ds, typeRoleFor(role)).colorToken)
      : token('surface.base');
  }
  /*
   * The big number takes the brand's KPI colour, overriding the source.
   *
   * Every other run is mapped, because the source author's choice of colour
   * usually carries their meaning. A display statistic is the exception: the
   * brand states outright what colour its numbers are (`ds.type.kpiValue`), and
   * a source deck that set its stats in its OWN accent maps that accent to our
   * ink — which is the correct answer for the colour and the wrong answer for
   * the number. The deck came back with every headline figure in black, so the
   * one element on the slide meant to be seen first read as body copy.
   *
   * A run already pointing at a token is left alone: the deck may have been
   * part-converted and its author may have chosen that token deliberately.
   */
  if (typeRoleFor(role) === 'kpiValue' && run.color?.kind !== 'token') {
    return token(resolveTypeRole(ds, 'kpiValue').colorToken);
  }
  if (run.color) {
    // A run already pointing at a token is left pointing at it — the deck may
    // have been part-converted, and remapping a token through the source
    // palette would be meaningless.
    if (run.color.kind === 'token') return run.color;
    return mapColor(colors, normalizeHex(run.color.hex));
  }
  return token(resolveTypeRole(ds, typeRoleFor(role)).colorToken);
}

/**
 * Restyle one run.
 *
 * Bold is preserved rather than taken from the role, because bolding inside a
 * paragraph is authored emphasis: "revenue grew **31%**" loses its meaning if
 * every run in the box adopts the role's weight. The role's weight applies only
 * where the source stated nothing.
 */
function restyleRun(
  run: TextRun,
  role: BrandRole,
  ctx: RestyleContext,
  panel: ShapeElement | undefined,
): TextRun {
  const { ds, sizes } = ctx;
  const typeRole = resolveTypeRole(ds, typeRoleFor(role));
  const sourcePt = run.sizePt ?? ds.type.body.sizePt;

  return {
    ...run,
    font: mapFont(ds, role, run.font),
    sizePt: mapSize(sizes, sourcePt),
    // Author emphasis survives; the role supplies the baseline.
    bold: run.bold === true ? true : typeRole.bold === true ? true : undefined,
    weight: run.bold ? undefined : typeRole.weight,
    // Caps is the brand's for an eyebrow (which is defined by being caps) and
    // the author's everywhere else.
    caps: role === 'eyebrow' ? true : run.caps,
    color: runColor(run, role, ctx, panel),
  };
}

function restyleBody(
  body: TextBody,
  role: BrandRole,
  ctx: RestyleContext,
  panel: ShapeElement | undefined,
): TextBody {
  const paragraphs = body.paragraphs ?? [];
  return {
    ...body,
    paragraphs: paragraphs.map((p, i) => ({
      // Runs are restyled FIRST so the rhythm is computed against the brand
      // sizes the paragraph will actually be set in, not the source's.
      ...restyleRhythm(
        { ...p, runs: (p.runs ?? []).map((r) => restyleRun(r, role, ctx, panel)) },
        role,
        ctx.ds,
        i === paragraphs.length - 1,
      ),
      runs: (p.runs ?? []).map((r) => restyleRun(r, role, ctx, panel)),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Fills and outlines                                                 */
/* ------------------------------------------------------------------ */

function restyleFill(fill: Fill | undefined, colors: ColorMap): Fill | undefined {
  if (!fill || fill.kind !== 'solid') return fill;
  if (fill.color.kind === 'token') return fill;
  return { ...fill, color: mapColor(colors, normalizeHex(fill.color.hex)) };
}

function restyleOutline(outline: Outline | undefined, colors: ColorMap): Outline | undefined {
  if (!outline) return outline;
  if (outline.color.kind === 'token') return outline;
  return { ...outline, color: mapColor(colors, normalizeHex(outline.color.hex)) };
}

/**
 * Shapes convert without borders.
 *
 * A source deck's outlines are its design language, not its content: the 1pt
 * grey rule around every card, the hairline box around a callout, the stroke
 * that made a pale fill read on a white master. Our decks separate things with
 * space and ground, not with lines, so carrying the strokes across is the same
 * defect as carrying the rounded corners — a deck that is correct in every
 * colour and size and still looks like the deck it came from.
 *
 * A border stays only where it is the ONLY ink the shape has. An unfilled
 * outlined box is a box because of its stroke; removing that stroke does not
 * restyle the element, it deletes it, and deleting the author's content is not
 * a branding decision. The same goes for a `line` element, which the model types
 * separately and this never touches: its outline IS the line.
 */
function dropBorder(el: ShapeElement): ShapeElement {
  if (!el.outline) return el;
  const filled = el.fill !== undefined && el.fill.kind !== 'none';
  if (!filled) return el;
  const { outline: _dropped, ...rest } = el;
  return rest;
}

/**
 * Square the corners of a rectangular shape.
 *
 * Rounding is a brand decision, not the author's content, and it is one of the
 * loudest: a converted deck whose cards, chips and callouts all keep the source
 * deck's pill corners still reads as the source deck's design however correct
 * every colour and size on it is. Our decks are drawn with square corners, so
 * conversion draws square corners.
 *
 * Only the rectangular family is touched, for the reason `ROUNDABLE_PRESETS`
 * gives: an ellipse has no corners to square, and a chevron's are structural —
 * squaring one would turn it into a different shape rather than the same shape
 * unrounded.
 */
function squareCorners(preset: ShapePreset): ShapePreset {
  return ROUNDABLE_PRESETS.includes(preset) ? 'rect' : preset;
}

/* ------------------------------------------------------------------ */
/* The pass                                                           */
/* ------------------------------------------------------------------ */

/** Largest run size in a body. */
function maxRunPt(body: TextBody | undefined, ds: DesignSystem): number {
  let max = 0;
  for (const p of body?.paragraphs ?? []) {
    for (const r of p.runs ?? []) max = Math.max(max, r.sizePt ?? ds.type.body.sizePt);
  }
  return max || ds.type.body.sizePt;
}

export function restyleSlide(slide: Slide, ctx: RestyleContext): RestyleResult {
  const { ds, colors, classification } = ctx;
  const traces = new Map<string, RestyleTrace>();
  const removed: { id: string; role: BrandRole }[] = [];
  const elements: SlideElement[] = [];

  for (const el of slide.elements) {
    const role = classification.roles.get(el.id)?.role ?? 'body';

    // ---- Source chrome: gone, and recorded ----
    if (isChromeRole(role)) {
      removed.push({ id: el.id, role });
      continue;
    }

    // ---- Chart primitives: untouched here ----
    // They are regenerated wholesale by recompiling the chart against the brand
    // theme (see `convert.ts`), so restyling them individually would be work
    // thrown away — and would corrupt the reconcile keys they carry.
    if (el.chartRef) {
      elements.push(el);
      continue;
    }

    const body = bodyOf(el);
    // A text box's panel, when this element is the text half of a split pair.
    const panel = el.groupIds?.length
      ? [...ctx.panels.values()].find(
          (p) => p.id !== el.id && p.groupIds?.some((g) => el.groupIds!.includes(g)),
        )
      : undefined;

    let next: SlideElement = {
      ...el,
      // The inferred role is written onto the element. This is what makes a
      // converted deck behave like an authored one afterwards: `resolveTypeRole`
      // and every later brand change follow it.
      role: el.role ?? (role === 'decoration' ? undefined : role),
    };

    if ('fill' in next) next.fill = restyleFill(next.fill, colors);
    if ('outline' in next) next.outline = restyleOutline(next.outline, colors);
    if (next.type === 'shape') {
      next.preset = squareCorners(next.preset);
      next = dropBorder(next);
    }

    if (body && (body.paragraphs ?? []).length > 0) {
      const sourcePt = maxRunPt(body, ds);
      const restyled = restyleBody(body, role, ctx, panel);
      const brandPt = maxRunPt(restyled, ds);
      next = { ...next, body: restyled } as SlideElement;
      traces.set(el.id, {
        elementId: el.id,
        role,
        sourcePt,
        brandPt,
        ratio: sourcePt > 0 ? brandPt / sourcePt : 1,
      });
    }

    elements.push(next);
  }

  return {
    slide: {
      ...slide,
      // The slide's own ground follows the palette like anything else.
      background: slide.background
        ? (restyleFill(slide.background, colors) as Slide['background'])
        : undefined,
      elements,
    },
    traces,
    removed,
  };
}

export { PANEL_ROLE };
