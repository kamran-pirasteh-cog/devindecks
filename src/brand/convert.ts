/**
 * The conversion, end to end.
 *
 *   survey → classify → decouple → restyle → legibility → refit
 *          → coherence → chrome → lint
 *
 * Pure: no network, no DOM, no clock, no randomness. The same upload converts to
 * the same deck every time, which is what makes it testable, gateable in CI, and
 * debuggable when a real deck comes out wrong.
 *
 * The one pass that only makes sense here, at the whole-deck level, is COHERENCE.
 * Refit works a slide at a time and has to — it can only know whether text fits
 * a box by looking at that box. But its decisions are visible ACROSS slides: if
 * thirty body boxes needed to drop from 14pt to 12pt and four didn't, the deck
 * ships with two body sizes. Every slide is individually correct and the deck
 * looks careless. So after refitting everything we ask, per role: did most of
 * these shrink? If so, that's not thirty local accidents, it's the brand asking
 * for larger type than this deck's content has room for — and the honest
 * response is to apply the smaller size to all of them and refit once more.
 *
 * That is the same doctrine as the survey phase, applied one level up: decide
 * once for the deck, not repeatedly per slide.
 */
import type { Deck, EMU, Slide } from '@/model';
import { ingestSlides, summarize, type Diagnostic } from '@/model/ingest';
import type { DesignSystem } from '@/model/tokens';
import type { SlideArchetype } from '@/model/archetype';
import { defaultMeasurer, type TextMeasurer } from '@/render/measureText';
import { addChrome } from './chrome';
import { buildRoleMap, classifySlide, type BrandRole, type SlideClassification } from './classify';
import { decoupleSlide } from './decouple';
import { errorsOf, flaggedSlides, lintSlide } from './lint';
import { enforceLegibility, type LegibilityFix } from './legibility';
import { buildColorMap, type ColorMap } from './palette';
import { refitSlide, scaleBody, type RefitContext, type RefitOutcome } from './refit';
import { restyleSlide, type RestyleTrace } from './restyle';
import { surveyDeck, type DeckSurvey } from './survey';
import { buildSizeMap, type SizeMap } from './type';
import { bodyOf } from './classify';

/* ------------------------------------------------------------------ */
/* What can actually be converted                                     */
/* ------------------------------------------------------------------ */

/**
 * Is there anything on this slide for the brand engine to change?
 *
 * A slide that is one full-bleed picture and nothing else — which is exactly
 * what a PDF page becomes today (see `import/pdf.ts`) — has no text to re-set,
 * no fills to re-token and no chrome to strip. Converting it is a no-op.
 *
 * That is a fine outcome for the ENGINE and a terrible one for the user, because
 * a no-op is indistinguishable from a success unless something says so: the
 * report reads "0 text sizes → 0, 1 colour → 1 brand token", every slide comes
 * back "clean" because there was nothing to find, and the review screen offers
 * the deck as though it had been rebranded. Detecting this is the difference
 * between "we couldn't do anything with this" and a silent lie.
 */
export function isConvertible(slide: Slide): boolean {
  for (const el of slide.elements) {
    if (el.chartRef) return true; // a chart is re-themed even with no loose text
    const body = bodyOf(el);
    const hasText = (body?.paragraphs ?? []).some((p) =>
      (p.runs ?? []).some((r) => (r.text ?? '').trim() !== ''),
    );
    if (hasText) return true;
    // A fill or an outline is something the palette can re-token.
    if ('fill' in el && el.fill !== undefined && el.fill.kind !== 'none') return true;
    if ('outline' in el && el.outline !== undefined) return true;
  }
  return false;
}

/**
 * Slide numbers (1-based) that conversion can do nothing with.
 *
 * A slide with NO elements is excluded: it is blank, not untouchable, and the
 * two want different words. "Every slide here is a page image" is false and
 * confusing on a deliberately empty slide, and a deck of blank slides is a
 * perfectly successful conversion of nothing.
 */
export const unconvertibleSlides = (slides: Slide[]): number[] =>
  slides
    .map((s, i) => (s.elements.length > 0 && !isConvertible(s) ? i + 1 : 0))
    .filter((n) => n > 0);

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

/** What changed, in terms a reviewer can read. */
export interface ConversionReport {
  slideCount: number;
  /** e.g. `['Arial', 'Calibri']` → the brand's three. */
  sourceFonts: string[];
  brandFonts: string[];
  /** Source size count → brand size count. */
  sizesBefore: number;
  sizesAfter: number;
  /** Source colour count → token count. */
  colorsBefore: number;
  tokensAfter: number;
  /** Colour mappings the engine wasn't confident about. */
  weakColors: { hex: string; tokenId: string; reason: string }[];
  /** Source chrome removed, counted by kind. */
  removedChrome: Record<string, number>;
  /** Filled shapes split into panel + text. */
  panelsSplit: number;
  /** Runs whose colour was corrected because it wasn't readable on its ground. */
  legibilityFixes: number;
  /** Roles that the coherence pass resized deck-wide, and to what. */
  coherenceAdjustments: { role: string; fromPt: number; toPt: number; share: number }[];
  /** Per-slide archetype and what refit had to do. */
  slides: {
    number: number;
    archetype: SlideArchetype;
    confidence: number;
    reason: string;
    steps: string[];
    errors: number;
    warnings: number;
  }[];
  /** 1-based slide numbers with at least one error. */
  flagged: number[];
  /**
   * Slides conversion could do nothing with — a page image and nothing else.
   * Reported separately from `flagged` because nothing is WRONG with them; there
   * was simply nothing to change, and saying so is the point.
   */
  unconvertible: number[];
  clean: boolean;
}

export interface ConvertResult {
  slides: Slide[];
  diagnostics: Diagnostic[];
  report: ConversionReport;
}

export interface ConvertOptions {
  ds: DesignSystem;
  slideSize: { w: EMU; h: EMU };
  measurer?: TextMeasurer;
  /** Injected so the caller keeps its own id scheme, as `ingestSlides` does. */
  newId?: (prefix: string) => string;
}

/** A deterministic id source, so a conversion with no injected one is stable. */
function sequentialIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}_${(n += 1)}`;
}

/* ------------------------------------------------------------------ */
/* Coherence                                                          */
/* ------------------------------------------------------------------ */

/** Share of a role's elements that must have shrunk before the deck follows. */
export const COHERENCE_THRESHOLD = 0.6;

export interface CoherenceDecision {
  role: string;
  fromPt: number;
  toPt: number;
  /** Fraction of this role's elements that shrank. */
  share: number;
}

/**
 * Which roles the whole deck should resize, and to what.
 *
 * "Shrank" means the element's final size came out below the size the brand
 * assigned it. The target is the MEDIAN of the shrunken sizes rather than the
 * minimum: one pathological box stuffed with three paragraphs should not drag
 * the entire deck's body copy down with it.
 */
export function coherenceDecisions(
  outcomes: Map<string, RefitOutcome>,
  traces: Map<string, RestyleTrace>,
  roles: Map<string, BrandRole>,
): CoherenceDecision[] {
  const byRole = new Map<string, { brandPt: number; finalPt: number }[]>();
  for (const [id, outcome] of outcomes) {
    const trace = traces.get(id);
    const role = roles.get(id);
    if (!trace || !role || outcome.finalPt <= 0) continue;
    byRole.set(role, [...(byRole.get(role) ?? []), { brandPt: trace.brandPt, finalPt: outcome.finalPt }]);
  }

  const decisions: CoherenceDecision[] = [];
  for (const [role, entries] of byRole) {
    // Only meaningful for a role with enough instances for "most" to mean
    // something. Two boxes disagreeing is not a deck-wide pattern.
    if (entries.length < 4) continue;
    const brandPt = entries[0].brandPt;
    // Compare against one brand size: a role whose elements were assigned
    // different sizes isn't a single tier and can't be resized as one.
    if (entries.some((e) => e.brandPt !== brandPt)) continue;

    const shrunk = entries.filter((e) => e.finalPt < brandPt - 0.01);
    const share = shrunk.length / entries.length;
    if (share < COHERENCE_THRESHOLD) continue;

    const sizes = shrunk.map((e) => e.finalPt).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)];
    if (median >= brandPt - 0.01) continue;
    decisions.push({ role, fromPt: brandPt, toPt: median, share });
  }
  return decisions.sort((a, b) => a.role.localeCompare(b.role));
}

/** Apply a coherence decision to every element of that role on a slide. */
function applyCoherence(
  slide: Slide,
  decisions: CoherenceDecision[],
  roles: Map<string, BrandRole>,
  traces: Map<string, RestyleTrace>,
  ds: DesignSystem,
): Slide {
  if (!decisions.length) return slide;
  const byRole = new Map(decisions.map((d) => [d.role, d]));
  return {
    ...slide,
    elements: slide.elements.map((el) => {
      const role = roles.get(el.id);
      const decision = role ? byRole.get(role) : undefined;
      const trace = traces.get(el.id);
      const body = bodyOf(el);
      if (!decision || !trace || !body || trace.brandPt !== decision.fromPt) return el;
      return { ...el, body: scaleBody(body, decision.toPt / decision.fromPt, ds) } as typeof el;
    }),
  };
}

/* ------------------------------------------------------------------ */
/* The conversion                                                     */
/* ------------------------------------------------------------------ */

export function convertDeck(sourceSlides: Slide[], opts: ConvertOptions): ConvertResult {
  const { ds, slideSize } = opts;
  const measurer = opts.measurer ?? defaultMeasurer();
  const newId = opts.newId ?? sequentialIds();

  // ---- 1. Survey, then build the three deck-wide tables ----
  const survey: DeckSurvey = surveyDeck(sourceSlides, slideSize, ds);
  const colors: ColorMap = buildColorMap(survey, ds);
  const sizes: SizeMap = buildSizeMap(survey, ds);
  const roleMap = buildRoleMap(survey);

  // ---- 2. Per slide: classify → decouple → restyle ----
  const classifications: SlideClassification[] = [];
  const restyled: Slide[] = [];
  const allTraces = new Map<string, RestyleTrace>();
  const allRoles = new Map<string, BrandRole>();
  const frozen = new Set<string>();
  /** Text lifted out of a filled shape — see `RefitContext.panelText`. */
  const panelText = new Set<string>();
  const removedChrome: Record<string, number> = {};
  const legibilityFixes: LegibilityFix[] = [];
  let panelsSplit = 0;

  for (const source of sourceSlides) {
    const classification = classifySlide(source, survey, roleMap, ds);
    classifications.push(classification);

    const split = decoupleSlide(source, ds, newId);
    panelsSplit += split.splits;
    for (const id of split.frozen) frozen.add(id);
    for (const id of split.textFromShape.keys()) panelText.add(id);

    /*
     * Elements created by the split need roles too.
     *
     * The text half inherits the SHAPE'S OWN role, read from the map `decouple`
     * hands back. It used to be inferred from shared group membership, which
     * quietly failed whenever the shape had no group of its own — the split
     * mints a fresh one, so nothing in the source shares it — and every such
     * text fell back to `body`. A slide title classified as `title` was then
     * restyled and refit as body copy, and since `body` shrinks less far before
     * giving up, it overflowed its band rather than fitting.
     *
     * The panel becomes decoration: its text lives somewhere else now, and all
     * it contributes is a ground.
     */
    const roles = new Map(classification.roles);
    for (const [textId, shapeId] of split.textFromShape) {
      const inherited = classification.roles.get(shapeId);
      roles.set(
        textId,
        inherited ?? { role: 'body', confidence: 0.6, reason: 'split from a panel' },
      );
    }
    for (const id of split.frozen) {
      roles.set(id, { role: 'decoration', confidence: 0.9, reason: 'panel ground' });
    }
    // Anything still unaccounted for — there should be none, but a role must be
    // total for `restyle` and `refit` to work at all.
    for (const el of split.slide.elements) {
      if (!roles.has(el.id)) {
        roles.set(el.id, { role: 'body', confidence: 0.4, reason: 'no role assigned' });
      }
    }

    const withRoles: SlideClassification = { ...classification, roles };
    const panels = new Map(
      split.slide.elements
        .filter((el) => split.frozen.has(el.id) && el.type === 'shape')
        .map((el) => [el.id, el as Extract<typeof el, { type: 'shape' }>]),
    );

    const result = restyleSlide(split.slide, {
      ds,
      colors,
      sizes,
      classification: withRoles,
      panels,
    });

    // Legibility runs HERE, not inside restyle: it needs every fill on the
    // slide to already be a brand token so it can resolve what each run is
    // actually sitting on. `palette.ts` maps colours one at a time and cannot
    // see the pairing — grey supporting text on a dark panel is two correct
    // decisions making one unreadable slide.
    const legible = enforceLegibility(result.slide, ds);
    legibilityFixes.push(...legible.fixes);

    for (const [id, trace] of result.traces) allTraces.set(id, trace);
    for (const [id, r] of roles) allRoles.set(id, r.role);
    for (const { role } of result.removed) {
      removedChrome[role] = (removedChrome[role] ?? 0) + 1;
    }
    restyled.push(legible.slide);
  }

  // ---- 3. Refit ----
  const refitCtx: RefitContext = {
    ds,
    ladder: sizes.ladder,
    measurer,
    slideSize,
    traces: allTraces,
    roles: allRoles,
    frozen,
    panelText,
  };

  let refits = restyled.map((slide) => refitSlide(slide, refitCtx));

  // ---- 4. Coherence: one size per role, deck-wide ----
  const allOutcomes = new Map<string, RefitOutcome>();
  for (const r of refits) for (const [id, o] of r.outcomes) allOutcomes.set(id, o);

  const decisions = coherenceDecisions(allOutcomes, allTraces, allRoles);
  if (decisions.length) {
    // Applied to the RESTYLED slides and refit again from there, not layered on
    // top of the first refit's output: refit may already have grown boxes and
    // stepped ladders for these elements, and re-running over that would apply
    // both adjustments and undershoot.
    refits = restyled
      .map((slide) => applyCoherence(slide, decisions, allRoles, allTraces, ds))
      .map((slide) => refitSlide(slide, refitCtx));
  }

  // ---- 5. Chrome ----
  const withChrome = refits.map((r, i) =>
    addChrome(r.slide, classifications[i].archetype, ds, slideSize, newId),
  );

  // ---- 6. Lint ----
  const diagnostics: Diagnostic[] = [];
  const perSlide = withChrome.map((chrome, i) => {
    const refit = refits[i];
    const offLadder = new Set(
      [...refit.outcomes.entries()].filter(([, o]) => o.offLadder).map(([id]) => id),
    );
    const slideDiagnostics = lintSlide(chrome.slide, i + 1, {
      ds,
      measurer,
      slideSize,
      roles: allRoles,
      preExistingOverlaps: refit.preExistingOverlaps,
      offLadder,
      sourceSizes: new Map([...allTraces].map(([id, t]) => [id, t.sourcePt])),
      logoPlaceholder: chrome.placeholder,
      logoRect: chrome.logoRect,
    });
    diagnostics.push(...slideDiagnostics);

    const counts = summarize(slideDiagnostics);
    const steps = [
      ...new Set([...refit.outcomes.values()].flatMap((o) => o.steps)),
    ].sort();
    return {
      number: i + 1,
      archetype: classifications[i].archetype,
      confidence: classifications[i].confidence,
      reason: classifications[i].reason,
      steps,
      errors: counts.errors,
      warnings: counts.warnings,
    };
  });

  // ---- 7. Through the same door as every other external deck ----
  // `ingestSlides` normalizes and validates everything entering the model. A
  // converted deck is no more trusted than an imported one, and running it
  // through here means the conversion cannot introduce a class of defect the
  // rest of the app already knows how to catch.
  //
  // Ids have to survive the trip, because every diagnostic collected above
  // references one and the review UI has to be able to point at the element a
  // flag is about. `ingestSlides` mints fresh ids from injected factories, so we
  // feed it QUEUES of our own ids in the order it will ask for them — slides
  // outer, elements inner. A queue rather than restoring by index afterwards:
  // ingest DROPS elements of unknown type, which would shift every later index
  // and silently hand each element its neighbour's id.
  const slideIds = withChrome.map((c) => c.slide.id);
  const elementIds = withChrome.flatMap((c) => c.slide.elements.map((el) => el.id));
  let slideCursor = 0;
  let elementCursor = 0;

  const ingested = ingestSlides(
    withChrome.map((c) => ({ elements: c.slide.elements, background: c.slide.background })),
    {
      designSystem: ds,
      slideSize,
      slideId: () => slideIds[slideCursor++] ?? newId('slide'),
      elementId: () => elementIds[elementCursor++] ?? newId('el'),
    },
  );

  // Charts live on the slide, not in `elements`, so ingest neither sees nor
  // returns them — carry them across.
  const slides: Slide[] = ingested.slides.map((slide, i) => ({
    ...slide,
    ...(withChrome[i].slide.charts ? { charts: withChrome[i].slide.charts } : {}),
  }));

  diagnostics.push(...ingested.diagnostics);

  /*
   * A slide with nothing to convert gets a warning of its own. Not an error —
   * the engine did not fail, and failing the CI gate on a deck of screenshots
   * would be wrong — but it must not pass silently either.
   */
  const unconvertible = unconvertibleSlides(slides);
  for (const n of unconvertible) {
    diagnostics.push({
      severity: 'warning',
      code: 'nothing-to-convert',
      slide: n,
      message:
        'This slide is a page image with no text or shapes, so there is nothing ' +
        'to re-brand. Import it as-is, or upload the original .pptx.',
    });
  }

  const report: ConversionReport = {
    slideCount: slides.length,
    sourceFonts: survey.sourceFonts,
    brandFonts: [...new Set(Object.values(ds.fonts))],
    sizesBefore: survey.sizes.length,
    sizesAfter: new Set(sizes.to.values()).size,
    colorsBefore: survey.colors.length,
    tokensAfter: new Set(
      [...colors.refs.values()].map((r) => (r.kind === 'token' ? r.token : r.hex)),
    ).size,
    weakColors: colors.weak.map((w) => ({ hex: w.hex, tokenId: w.tokenId, reason: w.reason })),
    removedChrome,
    panelsSplit,
    legibilityFixes: legibilityFixes.length,
    coherenceAdjustments: decisions,
    slides: perSlide,
    flagged: flaggedSlides(diagnostics),
    unconvertible,
    // A deck the engine could not touch is not "clean" — there is nothing clean
    // about it, and calling it that is how a no-op reads as a success. An empty
    // deck is the exception: nothing to convert and nothing wrong with that.
    clean:
      errorsOf(diagnostics).length === 0 &&
      (slides.length === 0 || unconvertible.length < slides.length),
  };

  return { slides, diagnostics, report };
}

/** Convert and stamp a whole `Deck`. The shape `createDocFromSlides` wants. */
export function convertToDeck(
  sourceSlides: Slide[],
  base: Pick<Deck, 'id' | 'title' | 'createdAt' | 'updatedAt'>,
  opts: ConvertOptions,
): { deck: Deck; diagnostics: Diagnostic[]; report: ConversionReport } {
  const { slides, diagnostics, report } = convertDeck(sourceSlides, opts);
  return {
    deck: {
      ...base,
      slideSize: opts.slideSize,
      slides,
      designSystemId: opts.ds.id,
      designSystemVersion: opts.ds.version,
      // Page numbers become the brand's derived ones. The source deck's own
      // page-number ELEMENTS were removed by `restyle`; this is what replaces
      // them, and it renumbers itself when slides are reordered.
      pageNumbers: true,
    },
    diagnostics,
    report,
  };
}
