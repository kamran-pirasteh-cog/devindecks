/**
 * The eyebrow — the small line of type that sits ABOVE a slide's title, with a
 * square mark on its left.
 *
 * Two primitives inserted as one group: a filled square and a text box. Like a
 * callout (see `callout.ts`) and unlike a shape carrying `body`, that keeps the
 * mark recolourable and the type restyleable one at a time, and it exports as
 * two plain primitives.
 *
 * The mark's LEFT EDGE is the eyebrow's anchor, not the text's: an eyebrow is
 * only right when its square lines up with the title underneath it, so the
 * square takes the title's x and the type is pushed right of it.
 *
 * Colour is DERIVED from the slide's background rather than picked — the brand
 * blue on a light slide, white on a black one — so an eyebrow dropped on a dark
 * page is legible without a trip to the colour panel.
 */
import {
  DEFAULT_MARGINS,
  inchesToEmu,
  isShape,
  isText,
  isTitleRole,
  pointsToEmu,
  resolveColor,
  token,
} from '@/model';
import type {
  ColorRef,
  DesignSystem,
  EMU,
  Fill,
  FontFamily,
  ShapeElement,
  SlideElement,
  TextElement,
} from '@/model';
import { nanoid } from 'nanoid';
import { isLightFill } from './callout';

/**
 * Ids in the store's own shape, minted here rather than imported from it: the
 * store is what calls `makeEyebrow` (an eyebrow moves the title, so the insert
 * has to be one undo step), and importing `newId` back out of it would make
 * this module a cycle.
 */
const newId = (prefix: string) => `${prefix}-${nanoid(8)}`;

/** Semantic roles the two halves carry. */
export const EYEBROW_ROLE = 'eyebrow';
export const EYEBROW_MARK_ROLE = 'eyebrow.mark';

/** The square's side, in inches — about the cap height of the type beside it. */
const MARK_IN = 0.11;
/** Square to type. */
const MARK_GAP_IN = 0.1;
/** Type to the title below it — the "slightly" in "moves the title down". */
const TITLE_GAP_IN = 0.07;
/** Leading the renderer gives an unspaced paragraph. */
const LINE_HEIGHT = 1.25;

/** The type role an eyebrow is sized from — the deck's smallest. */
const typeOf = (ds: DesignSystem) => ds.type.caption;

/**
 * The face an eyebrow is set in: mono, regular, all caps.
 *
 * It takes the caption role's SIZE but not its family. An eyebrow is a label on
 * the slide rather than a line of its prose — the same job the mono, uppercase
 * furniture around a chart does (see `chart/theme.ts`) — and caps at this size
 * already carry the emphasis, so the face stays regular rather than bold.
 */
const EYEBROW_FONT: FontFamily = 'Geist Mono';

/** One line of eyebrow type, in EMU. */
export function eyebrowTextHeight(ds: DesignSystem): EMU {
  return pointsToEmu(typeOf(ds).sizePt * LINE_HEIGHT);
}

/**
 * How far down an eyebrow pushes the title: its own line plus the gap under it.
 */
export function eyebrowBlockHeight(ds: DesignSystem): EMU {
  return eyebrowTextHeight(ds) + inchesToEmu(TITLE_GAP_IN);
}

/**
 * The eyebrow's ink. White on a dark slide — mark and type both, so the pair
 * always reads as one object — and the brand accent on a light one.
 */
export function eyebrowInk(background: Fill | undefined, ds: DesignSystem): ColorRef {
  const hex =
    background?.kind === 'solid'
      ? resolveColor(background.color, ds)
      : resolveColor(token('surface.base'), ds);
  return isLightFill(hex) ? token('brand.accent') : token('surface.base');
}

/** The text half of this slide's eyebrow, if it has one. */
export function eyebrowElement(elements: SlideElement[]): TextElement | undefined {
  return elements.find((el): el is TextElement => isText(el) && el.role === EYEBROW_ROLE);
}

/** All the characters in a text element's body, as one string. */
const bodyText = (el: TextElement): string =>
  el.body.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('');

/**
 * What the insert command does: add one, or — when an empty eyebrow is already
 * sitting above the title — put the caret back in it. Mirrors `titleSlotAction`,
 * and for the same reason: without the second case an eyebrow added and
 * abandoned would get a second one stacked on top of it.
 */
export function eyebrowSlotAction(elements: SlideElement[]): 'add' | 'edit' | 'none' {
  const el = eyebrowElement(elements);
  if (!el) return 'add';
  return bodyText(el).trim() ? 'none' : 'edit';
}

/** The mark belonging to an eyebrow — matched by group, so a stray square isn't. */
export function eyebrowMark(elements: SlideElement[]): ShapeElement | undefined {
  const text = eyebrowElement(elements);
  if (!text) return undefined;
  return elements.find(
    (el): el is ShapeElement =>
      isShape(el) &&
      el.role === EYEBROW_MARK_ROLE &&
      !!el.groupIds?.some((g) => text.groupIds?.includes(g)),
  );
}

/**
 * Where an eyebrow goes: the top-left of the title band, but on the TITLE's own
 * left edge when the slide has one — a title dragged in from the guide takes its
 * eyebrow with it rather than leaving it stranded at the margin.
 */
export function eyebrowOrigin(
  elements: SlideElement[],
  m = DEFAULT_MARGINS,
): { x: EMU; y: EMU } {
  const title = elements.find((el) => isText(el) && isTitleRole(el.role));
  return { x: title?.rect.x ?? m.left, y: m.top };
}

/**
 * Square + type, grouped, at `origin`.
 *
 * The run carries the styling but no text: the eyebrow is inserted straight into
 * edit mode, and typing into an empty paragraph inherits the first run's font,
 * size and colour (see `TextEditor.readParagraphs`) — so the author types the
 * words instead of clearing a placeholder first.
 */
export function makeEyebrow(
  ds: DesignSystem,
  origin: { x: EMU; y: EMU },
  background: Fill | undefined,
  m = DEFAULT_MARGINS,
  slideSize?: { w: EMU; h: EMU },
): SlideElement[] {
  const gid = newId('g');
  const role = typeOf(ds);
  const ink = eyebrowInk(background, ds);
  const lineH = eyebrowTextHeight(ds);
  const mark = inchesToEmu(MARK_IN);
  const textX = origin.x + mark + inchesToEmu(MARK_GAP_IN);

  const square: ShapeElement = {
    id: newId('shape'),
    type: 'shape',
    role: EYEBROW_MARK_ROLE,
    name: 'Eyebrow mark',
    preset: 'rect',
    // Optically centred on the line of type beside it rather than sitting on
    // its box top, where it would read as floating above the words.
    rect: { x: origin.x, y: origin.y + Math.round((lineH - mark) / 2), w: mark, h: mark },
    fill: { kind: 'solid', color: ink },
    groupIds: [gid],
  };

  const text: TextElement = {
    id: newId('text'),
    type: 'text',
    role: EYEBROW_ROLE,
    name: 'Eyebrow',
    rect: {
      x: textX,
      y: origin.y,
      // To the right margin when we know the slide's width — an eyebrow is one
      // line, and a box that runs the full measure never wraps it.
      w: Math.max(inchesToEmu(1), (slideSize ? slideSize.w - m.right : textX + inchesToEmu(4)) - textX),
      h: lineH,
    },
    body: {
      anchor: 'top',
      // 'none', not 'resize': the box is the eyebrow's measure by design, and a
      // fit pass would shrink-wrap it onto the typed words and pull the mark's
      // spacing out of true.
      autofit: 'none',
      paragraphs: [
        {
          align: 'left',
          runs: [
            {
              text: '',
              font: EYEBROW_FONT,
              sizePt: role.sizePt,
              caps: true,
              color: ink,
            },
          ],
        },
      ],
    },
    groupIds: [gid],
  };

  return [square, text];
}

/**
 * Where the title has to sit once an eyebrow is above it — unchanged if the
 * author has already dragged it clear.
 */
export function titleYUnderEyebrow(ds: DesignSystem, currentY: EMU, m = DEFAULT_MARGINS): EMU {
  return Math.max(currentY, m.top + eyebrowBlockHeight(ds));
}
