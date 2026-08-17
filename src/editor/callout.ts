/**
 * Callout cards — a filled box with a text box sitting on top of it, inserted
 * together as one group.
 *
 * Two elements rather than a shape carrying `body`: the text has to be able to
 * move, resize and be restyled independently of the box (and the box recoloured
 * without touching the type), which is exactly what a group of two primitives
 * gives you and a single shape with text does not. Both are still plain model
 * primitives, so the card exports like anything else.
 *
 * Text colour is DERIVED from the fill's luminance rather than picked: a card is
 * only ever inserted legible, and a later brand change that darkens the token
 * doesn't strand black type on a black box (the tokens re-resolve together).
 */
import { inchesToEmu, resolveColor, token } from '@/model';
import type { DesignSystem, Paragraph, ShapeElement, SlideElement, TextElement } from '@/model';
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
  /** Design-system color token id for the box fill. */
  fillToken: string;
  /** Which text slots the card carries, any subset of `CALLOUT_PARTS`. */
  parts: CalloutPart[];
}

export const DEFAULT_CALLOUT_OPTIONS: CalloutOptions = {
  corners: 'round',
  fillToken: 'brand.primary',
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

/**
 * How tall the card has to be to hold these slots. Autofit is off — a card is a
 * fixed frame — so nothing downstream rescues type that outgrows the box, and
 * the height has to come from the slots at insert time.
 */
export function calloutHeightIn(parts: CalloutPart[], ds: DesignSystem): number {
  const shown = CALLOUT_PARTS.filter((p) => parts.includes(p));
  const typePt = shown.reduce((sum, p, i) => {
    const slot = SLOT[p];
    const after = i === shown.length - 1 ? 0 : slot.afterPt;
    return sum + ds.type[slot.role].sizePt * LINE_HEIGHT * slot.lines + after;
  }, 0);
  return Math.max(MIN_BOX_H_IN, typePt / PT_PER_IN + PAD_IN * 2);
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
        color: slot.strong ? strong : muted,
      },
    ],
    align: 'left',
    spaceAfterPt: slot.afterPt,
  };
}

/**
 * The box and its text, in z-order (box first) and stamped with a shared group
 * id so a click grabs the whole card.
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
  const fill = token(opts.fillToken);
  const onLight = isLightFill(resolveColor(fill, ds));

  const box: ShapeElement = {
    id: newId('shape'),
    type: 'shape',
    role: 'callout.box',
    preset: opts.corners === 'round' ? 'roundRect' : 'rect',
    rect,
    fill: { kind: 'solid', color: fill },
    groupIds: [gid],
  };

  const pad = inchesToEmu(PAD_IN);
  const text: TextElement = {
    id: newId('text'),
    type: 'text',
    role: 'callout.text',
    // Inset from the box rather than sharing its rect: the padding lives in the
    // geometry, so dragging the text off the card keeps the layout you saw.
    rect: {
      x: rect.x + pad,
      y: rect.y + pad,
      w: rect.w - pad * 2,
      h: rect.h - pad * 2,
    },
    body: {
      anchor: 'middle',
      // 'none' — a card is a fixed frame; the type sits inside it and the box
      // must not be resized out from under the fill by a measure pass.
      autofit: 'none',
      paragraphs: parts.length
        ? parts.map((p) => paragraph(p, ds, onLight))
        : [paragraph('title', ds, onLight)],
    },
    groupIds: [gid],
  };

  return [box, text];
}
