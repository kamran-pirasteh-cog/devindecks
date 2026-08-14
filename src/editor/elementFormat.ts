/**
 * Format painter payload — what PowerPoint's "Copy Formatting" picks up.
 *
 * The rule PowerPoint follows: appearance travels, content and geometry don't.
 * So fill, outline, and every character/paragraph/text-box property come along;
 * position, size, rotation, shape geometry, and the text itself never do.
 *
 * `undefined` for a property is meaningful and is preserved on paste: it means
 * "no override", i.e. inherit the design system default. Pasting therefore
 * DELETES the target's override rather than leaving the old value behind —
 * otherwise a 40pt heading would keep its size after taking the format of a
 * body run that simply inherits 18pt.
 */
import type {
  Autofit,
  Fill,
  Insets,
  Outline,
  Paragraph,
  SlideElement,
  TextRun,
  VerticalAnchor,
} from '@/model';

export type RunFormat = Omit<TextRun, 'text'>;
export type ParagraphFormat = Omit<Paragraph, 'runs'>;

interface BodyFormat {
  anchor?: VerticalAnchor;
  autofit?: Autofit;
  wrap?: boolean;
  insets?: Insets;
}

export interface ElementFormat {
  /** Only carried by shapes and text boxes. */
  fill?: Fill;
  outline?: Outline;
  /** Present when the source carried text; sampled from its first run. */
  run?: RunFormat;
  paragraph?: ParagraphFormat;
  body?: BodyFormat;
}

const RUN_KEYS = ['font', 'sizePt', 'bold', 'italic', 'underline', 'color'] as const;
const PARA_KEYS = [
  'align',
  'level',
  'bullet',
  'lineSpacingPct',
  'spaceBeforePt',
  'spaceAfterPt',
] as const;
const BODY_KEYS = ['anchor', 'autofit', 'wrap', 'insets'] as const;

/** A shape's or text box's body, if it has one. */
function bodyOf(el: SlideElement) {
  return el.type === 'text' || el.type === 'shape' ? el.body : undefined;
}

function pick<T extends object, K extends readonly (keyof T)[]>(
  src: T | undefined,
  keys: K,
): Pick<T, K[number]> {
  const out = {} as Pick<T, K[number]>;
  if (!src) return out;
  for (const k of keys) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

/**
 * Copy every key in `keys` from `src` onto `target`, deleting the ones `src`
 * doesn't define. Mutates `target` (an immer draft at the call sites).
 */
function assignOrDelete<T extends object, K extends readonly (keyof T)[]>(
  target: T,
  src: Partial<T>,
  keys: K,
) {
  for (const k of keys) {
    if (src[k] === undefined) delete target[k];
    else target[k] = structuredClone(src[k]) as T[typeof k];
  }
}

/** Copy the run properties of a sampled format onto `run`, in place. */
export function applyRunFormat(run: TextRun, fmt: RunFormat) {
  assignOrDelete(run, fmt, RUN_KEYS);
}

/** Copy the paragraph properties of a sampled format onto `p`, in place. */
export function applyParagraphFormat(p: Paragraph, fmt: ParagraphFormat) {
  assignOrDelete(p, fmt, PARA_KEYS);
}

/**
 * Lift the formatting off an element, ready to be pasted onto others.
 *
 * `at` names the run to sample — the one under the cursor when the copy came
 * from inside the text editor. Without it the first run stands in, which is the
 * closest equivalent when there is no caret to read.
 */
export function extractFormat(
  el: SlideElement,
  at?: { paragraph: number; run: number },
): ElementFormat {
  const fmt: ElementFormat = {};

  if (el.type === 'text' || el.type === 'shape') {
    if (el.fill) fmt.fill = structuredClone(el.fill);
  }
  if (el.outline) fmt.outline = structuredClone(el.outline);

  const body = bodyOf(el);
  if (body) {
    const para = body.paragraphs[at?.paragraph ?? 0] ?? body.paragraphs[0];
    fmt.run = pick(para?.runs[at?.run ?? 0] ?? para?.runs[0], RUN_KEYS);
    fmt.paragraph = pick(para, PARA_KEYS);
    fmt.body = pick(body, BODY_KEYS);
  }

  return fmt;
}

/**
 * Apply a copied format to `el` in place, skipping anything the target can't
 * express (text format onto a picture, a fill onto a line, …).
 */
export function applyFormat(el: SlideElement, fmt: ElementFormat) {
  if (el.type === 'text' || el.type === 'shape') {
    if (fmt.fill) el.fill = structuredClone(fmt.fill);
    else delete el.fill;
  }

  if (el.type === 'line') {
    // A line must always have an outline, so only a real one replaces it.
    if (fmt.outline) el.outline = structuredClone(fmt.outline);
  } else if (fmt.outline) {
    el.outline = structuredClone(fmt.outline);
  } else {
    delete el.outline;
  }

  const body = bodyOf(el);
  if (!body || !fmt.run) return;

  assignOrDelete(body, fmt.body ?? {}, BODY_KEYS);
  for (const p of body.paragraphs) {
    assignOrDelete(p, fmt.paragraph ?? {}, PARA_KEYS);
    for (const r of p.runs) assignOrDelete(r, fmt.run, RUN_KEYS);
  }
}
