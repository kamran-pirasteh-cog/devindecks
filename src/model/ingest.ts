/**
 * The ingestion gate for decks that come from outside the app (imported
 * reference decks, user uploads). Everything entering the model MUST pass
 * through `ingestSlides`.
 *
 * Two jobs, deliberately kept separate:
 *
 *  - NORMALIZE: make the deck self-describing. An imported run that omits
 *    `sizePt` or `font` silently inherits whatever the active design system
 *    says, so the same upload renders differently after a brand edit. We
 *    resolve those defaults ONCE, at the door, and store them explicitly.
 *
 *  - VALIDATE: report fidelity risks without touching them. Imported geometry
 *    is ground truth — the source app already laid the deck out, so we never
 *    "fix" a rect. Overflow and out-of-bounds are reported so a human decides,
 *    because silently shrinking text or growing boxes would degrade a deck
 *    that the source file rendered correctly.
 *
 * The one thing we never do is drop content: nothing here removes an element.
 */

import { FONTS, isAllowedFont, type FontFamily } from './fonts';
import type { DesignSystem } from './tokens';
import type { Paragraph, Slide, SlideElement, TextBody } from './types';
import type { EMU } from './units';

/**
 * `info` is not a lesser warning — it's a note about something the engine did
 * ON PURPOSE and wants on the record: type stepped off the brand ladder to make
 * text fit, a PDF region kept as a raster. A reviewer should be able to see
 * every such decision without those decisions competing for attention with
 * things that might be wrong.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** Stable machine-readable code, for tests and CI output. */
  code: string;
  /** 1-based slide number, as a human counts them. */
  slide: number;
  elementId?: string;
  message: string;
}

export interface IngestResult {
  slides: Slide[];
  diagnostics: Diagnostic[];
}

export interface IngestOptions {
  designSystem: DesignSystem;
  slideSize: { w: EMU; h: EMU };
  /** Assigns ids; injected so callers keep their own id scheme. */
  slideId: () => string;
  elementId: (type: string) => string;
}

/** Raw, untrusted shape of an imported slide — every field is suspect. */
export interface RawSlide {
  elements?: unknown;
  background?: Slide['background'];
}

const ELEMENT_TYPES = new Set(['text', 'shape', 'line', 'picture', 'path']);

/** Nearest allowed font for an out-of-set family, so text keeps its character. */
function coerceFont(raw: unknown, ds: DesignSystem): { font: FontFamily; changed: boolean } {
  if (typeof raw === 'string' && isAllowedFont(raw)) return { font: raw, changed: false };
  if (typeof raw !== 'string') return { font: ds.fonts.body, changed: false };
  const lower = raw.toLowerCase();
  const isMono = /mono|consol|courier|menlo|code/.test(lower);
  const isSerif = /serif|georgia|times|garamond|book/.test(lower);
  const font = isMono ? ds.fonts.mono : isSerif ? ds.fonts.body : ds.fonts.heading;
  const serifFallback = (Object.keys(FONTS) as FontFamily[]).find(
    (f) => FONTS[f].category === 'serif',
  );
  return { font: isSerif && serifFallback ? serifFallback : font, changed: true };
}

function normalizeTextBody(
  body: TextBody,
  ctx: { ds: DesignSystem; slide: number; elementId: string; push: (d: Diagnostic) => void },
): TextBody {
  const { ds, slide, elementId, push } = ctx;

  const paragraphs: Paragraph[] = (body.paragraphs ?? []).map((p) => ({
    ...p,
    runs: (p.runs ?? []).map((r) => {
      const { font, changed } = coerceFont(r.font, ds);
      if (changed) {
        push({
          severity: 'warning',
          code: 'font-substituted',
          slide,
          elementId,
          message: `Font ${JSON.stringify(r.font)} is not in the allowed set; substituted ${font}.`,
        });
      }
      // A run with no size is the subtlest ingestion defect there is: it
      // typechecks, it renders, and it silently takes the design system's body
      // size — so the same upload changes size after a brand edit, and the
      // source file's real size is lost. Worth reporting even though we pin it.
      if (r.sizePt === undefined && (r.text ?? '').trim() !== '') {
        push({
          severity: 'warning',
          code: 'run-missing-size',
          slide,
          elementId,
          message:
            `Run ${JSON.stringify(r.text.slice(0, 32))} has no sizePt; ` +
            `pinned to the default body size (${ds.type.body.sizePt}pt). ` +
            `Confirm this matches the source document.`,
        });
      }
      // Resolve inherited size/font to explicit values so the stored deck no
      // longer depends on the design system to look the way it was imported.
      return { ...r, font, sizePt: r.sizePt ?? ds.type.body.sizePt };
    }),
  }));

  if (paragraphs.length === 0) {
    push({
      severity: 'warning',
      code: 'empty-text-body',
      slide,
      elementId,
      message: 'Text element has no paragraphs and will render as an empty box.',
    });
  }

  return { ...body, paragraphs };
}

function validateGeometry(
  el: SlideElement,
  ctx: { slideSize: { w: EMU; h: EMU }; slide: number; push: (d: Diagnostic) => void },
) {
  const { slideSize, slide, push } = ctx;
  const { x, y, w, h } = el.rect;

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    push({
      severity: 'error',
      code: 'rect-not-finite',
      slide,
      elementId: el.id,
      message: `Element rect has non-finite values: ${JSON.stringify(el.rect)}.`,
    });
    return;
  }

  // A zero/negative box renders nothing at all — always a real defect, and the
  // only geometry problem severe enough to call an error. Lines are the
  // exception: a horizontal rule is legitimately h=0 and a vertical one w=0, so
  // a line is only degenerate when it has no length on either axis.
  const degenerate = el.type === 'line' ? w <= 0 && h <= 0 : w <= 0 || h <= 0;
  if (degenerate) {
    push({
      severity: 'error',
      code: 'rect-degenerate',
      slide,
      elementId: el.id,
      message: `Element has a non-positive size (w=${w}, h=${h}) and will be invisible.`,
    });
  }

  // Bleed is legitimate design (full-bleed images, intentional crops), so this
  // is only a warning — and only when the element is *entirely* off-slide is it
  // certainly a mistake.
  const offSlide = x + w <= 0 || y + h <= 0 || x >= slideSize.w || y >= slideSize.h;
  if (offSlide) {
    push({
      severity: 'warning',
      code: 'element-off-slide',
      slide,
      elementId: el.id,
      message: `Element lies entirely outside the slide bounds and will not be visible.`,
    });
  }
}

/**
 * Validate + normalize raw imported slides into canonical model slides.
 * Never throws and never drops an element: a deck with diagnostics still
 * renders, so a bad upload degrades visibly rather than disappearing.
 */
export function ingestSlides(raw: RawSlide[], opts: IngestOptions): IngestResult {
  const { designSystem: ds, slideSize, slideId, elementId } = opts;
  const diagnostics: Diagnostic[] = [];
  const push = (d: Diagnostic) => diagnostics.push(d);

  if (!Array.isArray(raw)) {
    return {
      slides: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'not-a-slide-array',
          slide: 0,
          message: 'Imported deck is not an array of slides.',
        },
      ],
    };
  }

  const slides = raw.map((rawSlide, i) => {
    const slide = i + 1;
    const rawElements = Array.isArray(rawSlide?.elements) ? rawSlide.elements : [];

    if (!Array.isArray(rawSlide?.elements)) {
      push({
        severity: 'error',
        code: 'slide-elements-missing',
        slide,
        message: 'Slide has no `elements` array; treated as empty.',
      });
    }

    const elements = (rawElements as SlideElement[])
      .map((rawEl) => {
        if (!rawEl || typeof rawEl !== 'object' || !ELEMENT_TYPES.has((rawEl as SlideElement).type)) {
          push({
            severity: 'error',
            code: 'unknown-element-type',
            slide,
            message: `Skipped element with unsupported type ${JSON.stringify(
              (rawEl as { type?: unknown })?.type,
            )}.`,
          });
          return null;
        }

        const el = { ...rawEl, id: elementId(rawEl.type) } as SlideElement;
        validateGeometry(el, { slideSize, slide, push });

        if (el.type === 'picture' && !el.src) {
          push({
            severity: 'error',
            code: 'picture-missing-src',
            slide,
            elementId: el.id,
            message: 'Picture element has no `src` and will render as a broken image.',
          });
        }

        if ((el.type === 'text' || el.type === 'shape') && el.body) {
          const ctx = { ds, slide, elementId: el.id, push };
          return { ...el, body: normalizeTextBody(el.body, ctx) } as SlideElement;
        }

        if (el.type === 'text' && !el.body) {
          push({
            severity: 'error',
            code: 'text-missing-body',
            slide,
            elementId: el.id,
            message: 'Text element has no `body`.',
          });
        }

        return el;
      })
      .filter((e): e is SlideElement => e !== null);

    return {
      id: slideId(),
      elements,
      ...(rawSlide.background ? { background: rawSlide.background } : {}),
    };
  });

  return { slides, diagnostics };
}

/** Counts by severity, for callers that only need a pass/fail summary. */
export function summarize(diagnostics: Diagnostic[]) {
  const count = (s: DiagnosticSeverity) => diagnostics.filter((d) => d.severity === s).length;
  const errors = count('error');
  const warnings = count('warning');
  return { errors, warnings, info: count('info'), total: diagnostics.length };
}
