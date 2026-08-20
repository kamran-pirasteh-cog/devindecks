/**
 * Callout cards — a filled box with one text box PER SLOT sitting on top of it,
 * inserted together as one group.
 *
 * Separate elements rather than a shape carrying `body`: the text has to be able
 * to move, resize and be restyled independently of the box (and the box
 * recoloured without touching the type), which is exactly what a group of
 * primitives gives you and a single shape with text does not. And a box per slot
 * rather than one box of stacked paragraphs, because the number, title and
 * supporting line get nudged, resized and recoloured one at a time — paragraphs
 * inside one frame can only be dragged as a block. All of them are still plain
 * model primitives, so the card exports like anything else.
 *
 * Text colour is DERIVED from the fill's luminance rather than picked: a card is
 * only ever inserted legible, and a later brand change that darkens the token
 * doesn't strand black type on a black box (the tokens re-resolve together).
 */
import { inchesToEmu, resolveColor, token } from '@/model';
import type {
  ColorRef,
  DesignSystem,
  Paragraph,
  ShapeElement,
  SlideElement,
  TextElement,
} from '@/model';
import { newId } from '@/store/editorStore';

/** The text slots a card can carry, in the order they stack. */
export const CALLOUT_PARTS = ['eyebrow', 'number', 'title', 'subtitle'] as const;
export type CalloutPart = (typeof CALLOUT_PARTS)[number];

export const CALLOUT_PART_LABEL: Record<CalloutPart, string> = {
  eyebrow: 'Eyebrow',
  number: 'Number',
  title: 'Title',
  subtitle: 'Subtitle',
};

/** Placeholder copy — enough to show the slot's weight at a glance. */
const SAMPLE: Record<CalloutPart, string> = {
  eyebrow: 'EYEBROW',
  number: '10×',
  title: 'Title',
  subtitle: 'Supporting line that explains the number.',
};

export interface CalloutOptions {
  /** Rounded corners, or square. */
  corners: 'round' | 'square';
  /** The box fill — a brand token, or a hex picked from the custom panel. */
  fill: ColorRef;
  /** Which text slots the card carries, any subset of `CALLOUT_PARTS`. */
  parts: CalloutPart[];
}

export const DEFAULT_CALLOUT_OPTIONS: CalloutOptions = {
  corners: 'square',
  fill: token('ink.strong'),
  parts: ['number', 'subtitle'],
};

const BOX_W_IN = 4.2;
const BOX_X_IN = 4.4;
/** Vertical middle of a 7.5in-tall slide. */
const CENTER_Y_IN = 3.75;
/** Breathing room between the box edge and the type. */
const PAD_IN = 0.3;
/** Cards are short and wide; below this a one-slot card looks like a swatch. */
const MIN_BOX_H_IN = 1.1;
const PT_PER_IN = 72;
/** Leading the renderer gives an unspaced paragraph. */
const LINE_HEIGHT = 1.25;

/** Slot geometry: how each part is typed, coloured, and spaced. */
const SLOT: Record<
  CalloutPart,
  { role: keyof DesignSystem['type']; strong: boolean; afterPt: number; lines: number }
> = {
  eyebrow: { role: 'caption', strong: false, afterPt: 6, lines: 1 },
  number: { role: 'kpiValue', strong: true, afterPt: 8, lines: 1 },
  title: { role: 'heading', strong: true, afterPt: 6, lines: 1 },
  // The supporting line is the one slot whose sample wraps at card width.
  subtitle: { role: 'body', strong: false, afterPt: 0, lines: 2 },
};

/** How tall one slot's own text box is, in inches — its lines, nothing else. */
function slotHeightIn(part: CalloutPart, ds: DesignSystem): number {
  const slot = SLOT[part];
  return (ds.type[slot.role].sizePt * LINE_HEIGHT * slot.lines) / PT_PER_IN;
}

/** The slot stack's own height, gaps included but padding excluded. */
function typeHeightIn(parts: CalloutPart[], ds: DesignSystem): number {
  return parts.reduce((sum, p, i) => {
    const after = i === parts.length - 1 ? 0 : SLOT[p].afterPt / PT_PER_IN;
    return sum + slotHeightIn(p, ds) + after;
  }, 0);
}

/**
 * How tall the card has to be to hold these slots. Autofit is off — a card is a
 * fixed frame — so nothing downstream rescues type that outgrows the box, and
 * the height has to come from the slots at insert time.
 */
export function calloutHeightIn(parts: CalloutPart[], ds: DesignSystem): number {
  const shown = CALLOUT_PARTS.filter((p) => parts.includes(p));
  return Math.max(MIN_BOX_H_IN, typeHeightIn(shown, ds) + PAD_IN * 2);
}

/**
 * Perceived lightness of a #RRGGBB, 0..1 — sRGB relative luminance. Above ~0.5
 * the box reads as light and wants dark type.
 */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 1;
  const chan = (i: number) => {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}

export const isLightFill = (fillHex: string) => luminance(fillHex) > 0.45;

function paragraph(part: CalloutPart, ds: DesignSystem, onLight: boolean): Paragraph {
  // Strong slots take the full-contrast ink; supporting slots step down — but
  // only on a light box, where a muted grey is still readable.
  const slot = SLOT[part];
  const role = ds.type[slot.role];
  const strong = onLight ? token('ink.strong') : token('surface.base');
  const muted = onLight ? token('ink.muted') : token('surface.base');

  return {
    runs: [
      {
        text: SAMPLE[part],
        font: role.font,
        sizePt: role.sizePt,
        bold: role.bold,
        weight: role.weight,
        color: slot.strong ? strong : muted,
      },
    ],
    align: 'left',
    // The gap between slots is geometry now — each slot is its own frame — so
    // the paragraph carries none of it.
    spaceAfterPt: 0,
  };
}

/**
 * The box and one text box per slot, in z-order (box first, then top to bottom)
 * and stamped with a shared group id so a click grabs the whole card.
 */
export function makeCallout(
  ds: DesignSystem,
  opts: CalloutOptions = DEFAULT_CALLOUT_OPTIONS,
): SlideElement[] {
  const gid = newId('g');
  // Ordered by CALLOUT_PARTS, not by the order they were ticked, so the card
  // always reads eyebrow → number → title → subtitle.
  const parts = CALLOUT_PARTS.filter((p) => opts.parts.includes(p));
  const hIn = calloutHeightIn(parts, ds);
  const rect = {
    x: inchesToEmu(BOX_X_IN),
    // Sits on the slide's centre line however tall it came out, so ticking a
    // slot on grows the card in both directions rather than pushing it down.
    y: inchesToEmu(CENTER_Y_IN - hIn / 2),
    w: inchesToEmu(BOX_W_IN),
    h: inchesToEmu(hIn),
  };
  const onLight = isLightFill(resolveColor(opts.fill, ds));

  const box: ShapeElement = {
    id: newId('shape'),
    type: 'shape',
    role: 'callout.box',
    preset: opts.corners === 'round' ? 'roundRect' : 'rect',
    rect,
    fill: { kind: 'solid', color: opts.fill },
    groupIds: [gid],
  };

  const pad = inchesToEmu(PAD_IN);
  // An empty card still gets one slot — a card with no text box at all can't be
  // typed into, and there'd be nothing to select but the fill.
  const shown = parts.length ? parts : (['title'] as CalloutPart[]);
  // The stack is centred in the box rather than pinned to the top pad, so a card
  // that came out at MIN_BOX_H_IN doesn't sit its type high.
  let y = rect.y + Math.round((rect.h - inchesToEmu(typeHeightIn(shown, ds))) / 2);

  const texts: TextElement[] = shown.map((p) => {
    const h = inchesToEmu(slotHeightIn(p, ds));
    const el: TextElement = {
      id: newId('text'),
      type: 'text',
      role: 'callout.text',
      name: CALLOUT_PART_LABEL[p],
      // Inset from the box rather than sharing its rect: the padding lives in
      // the geometry, so dragging a slot off the card keeps the layout you saw.
      rect: { x: rect.x + pad, y, w: rect.w - pad * 2, h },
      body: {
        anchor: 'middle',
        // 'none' — a card is a fixed frame; the type sits inside it and the box
        // must not be resized out from under the fill by a measure pass.
        autofit: 'none',
        paragraphs: [paragraph(p, ds, onLight)],
      },
      groupIds: [gid],
    };
    y += h + Math.round(inchesToEmu(SLOT[p].afterPt / PT_PER_IN));
    return el;
  });

  return [box, ...texts];
}
