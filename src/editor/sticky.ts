/**
 * Sticky notes — a tilted card with a strip of tape straddling its top edge,
 * inserted as ONE group of plain model primitives (shape + shape + text).
 *
 * Three elements rather than one shape carrying `body`: the tape is a second
 * fill, and the model has no shape with two of them. What makes them one OBJECT
 * is that the note's rect and rotation are the only state a sticky has — the
 * tape and the text box are DERIVED from them, and re-derived after every
 * mutation (see `syncStickyGeometry`, called on the way out of every store
 * write). So there is no gesture that can peel the tape off: a group resize at
 * an angle, a rotate, a nudge of one member, an undo — each ends with the tape
 * centred on the note's top edge again, because that is the only place the
 * geometry says it can be.
 *
 * Deriving through the note's own rotated frame is what makes that true at ANY
 * angle. Each element rotates about its OWN centre, so "centred on the top edge"
 * cannot be computed in slide coordinates and then rotated — the offset from the
 * note's centre has to be rotated first. See `rotateOffset`.
 *
 * The note also GROWS AS YOU TYPE, which is the one thing autofit can't do here:
 * `autofit: 'resize'` resizes the text box, and the fill it sits on would stay
 * the size it was. So the text box carries `autofit: 'none'` and the canvas
 * measures the open editor and drives the note through `growSticky` instead.
 */
import { inchesToEmu, hex, token } from '@/model';
import type { Rect, ShapeElement, SlideElement, TextElement } from '@/model';
import { nanoid } from 'nanoid';

/**
 * Ids in the store's own shape, minted here rather than imported from it: the
 * store is what calls `makeSticky` (see `insertSticky`), so importing `newId`
 * back out of it would make this module a cycle — same reason as `eyebrow.ts`.
 */
const newId = (prefix: string) => `${prefix}-${nanoid(8)}`;

/** Roles are the handle everything else finds a sticky's parts by. */
export const STICKY_NOTE_ROLE = 'sticky.note';
export const STICKY_TAPE_ROLE = 'sticky.tape';
export const STICKY_TEXT_ROLE = 'sticky.text';

/**
 * Paper stock: the note's own yellow, and a strip of masking tape over it.
 *
 * The tape is a translucent warm grey rather than the translucent WHITE the
 * imported deck used — white tape is invisible on a white slide, and a sticky
 * lands on whatever background the slide already has.
 */
const NOTE_HEX = '#F4E79F';
const TAPE_HEX = '#8C8778';
const TAPE_ALPHA = 0.35;

const NOTE_W_IN = 2.6;
/** Empty, and however short the type, a note still reads as a square-ish card. */
const MIN_NOTE_H_IN = 0.8;

/*
 * Everything derived is a fraction of the note's WIDTH, not an absolute inch:
 * a note resized to twice the size is the same note, twice as big — padding,
 * tape and all. Width rather than height because the height is what the type
 * drives, and padding that grew with the type would grow again as it pushed the
 * note taller.
 */
const PAD_X_FRAC = 0.2 / NOTE_W_IN;
const PAD_Y_FRAC = 0.16 / NOTE_W_IN;
/** A strip, not a lid. */
const TAPE_W_FRAC = 0.32;
const TAPE_H_FRAC = 0.16 / NOTE_W_IN;

/** Stuck on by hand, clockwise. Enough to read as placed, not as broken. */
const TILT_DEG = 2.6;
/** Where a note lands: inside the top-right corner, clear of the margin. */
const ORIGIN_RIGHT_IN = 0.55;
const ORIGIN_TOP_IN = 0.5;
/** Each further note on the same slide steps down and in, so none is hidden. */
const CASCADE_IN = 0.32;

const TEXT_SIZE_PT = 14;

const centreOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * An offset from the note's centre, turned into the note's own frame.
 *
 * Clockwise degrees in screen coordinates (y down), which is what `rotation`
 * means everywhere else in the model.
 */
function rotateOffset(dx: number, dy: number, deg: number): { dx: number; dy: number } {
  if (!deg) return { dx, dy };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}

/** A rect of this size, centred on this point. */
const boxAt = (cx: number, cy: number, w: number, h: number): Rect => ({
  x: Math.round(cx - w / 2),
  y: Math.round(cy - h / 2),
  w: Math.round(w),
  h: Math.round(h),
});

/** The note's padding, in EMU, at whatever size the note currently is. */
export const stickyPad = (note: Rect) => ({
  x: note.w * PAD_X_FRAC,
  y: note.w * PAD_Y_FRAC,
});

/** The note's text box: the note inset by its padding, in the note's own frame. */
export function stickyTextRect(note: Rect, rotation = 0): Rect {
  const pad = stickyPad(note);
  const w = Math.max(1, note.w - pad.x * 2);
  const h = Math.max(1, note.h - pad.y * 2);
  const c = centreOf(note);
  // The text box is centred in the note, so its offset is zero — but the note's
  // centre is where the rotation happens, which is why this goes through the
  // same path as the tape rather than just insetting the rect.
  const off = rotateOffset(0, 0, rotation);
  return boxAt(c.x + off.dx, c.y + off.dy, w, h);
}

/**
 * The tape: centred on the note's top edge, half of it hanging over onto
 * whatever the note is stuck to.
 */
export function stickyTapeRect(note: Rect, rotation = 0): Rect {
  const w = note.w * TAPE_W_FRAC;
  const h = note.w * TAPE_H_FRAC;
  const c = centreOf(note);
  const off = rotateOffset(0, -note.h / 2, rotation);
  return boxAt(c.x + off.dx, c.y + off.dy, w, h);
}

/**
 * The note rect that holds `textHeightEmu` of type — the whole of "grows as you
 * type", as a pure function.
 *
 * The note's TOP EDGE stays where it is and the paper grows away from it, the
 * way a pad does — computed in the note's own frame, so a note stuck on at an
 * angle grows along its own axis and the tape holding its top edge doesn't move
 * at all.
 *
 * The floor is the smaller of the nominal minimum and the height the note
 * already has: an empty note reads as a card rather than a strip, and a
 * deliberately small one stays small.
 */
export function stickyGrowth(note: Rect, textHeightEmu: number, rotation = 0): Rect {
  const pad = stickyPad(note);
  const floor = Math.min(note.h, inchesToEmu(MIN_NOTE_H_IN));
  const h = Math.max(floor, Math.round(textHeightEmu) + pad.y * 2);
  if (Math.round(h) === note.h) return note;
  // Pin the top edge: the centre moves half the growth along the note's own
  // downward axis.
  const c = centreOf(note);
  const top = rotateOffset(0, -note.h / 2, rotation);
  const back = rotateOffset(0, h / 2, rotation);
  return boxAt(c.x + top.dx + back.dx, c.y + top.dy + back.dy, note.w, h);
}

/** Is this element one of a sticky's three parts? */
export const isStickyPart = (el: SlideElement) =>
  el.role === STICKY_NOTE_ROLE || el.role === STICKY_TAPE_ROLE || el.role === STICKY_TEXT_ROLE;

/**
 * Put every sticky on the slide back together: tape and text derived from the
 * note they belong to, all three at the note's angle.
 *
 * MUTATES, and is called at the end of every store write — a sticky is one
 * object, so no gesture is allowed to leave one in a state where it isn't. That
 * includes gestures aimed at a single member: dragging the tape out of a group
 * you've drilled into snaps it back, which is what "the tape is part of the note"
 * has to mean if it's to survive resizing at an angle.
 */
export function syncStickyGeometry(elements: SlideElement[]): void {
  for (const note of elements) {
    if (note.role !== STICKY_NOTE_ROLE) continue;
    const gid = note.groupIds?.[0];
    if (!gid) continue;
    const rotation = note.rotation ?? 0;
    for (const el of elements) {
      if (el === note || !el.groupIds?.includes(gid)) continue;
      if (el.role === STICKY_TAPE_ROLE) el.rect = stickyTapeRect(note.rect, rotation);
      else if (el.role === STICKY_TEXT_ROLE) el.rect = stickyTextRect(note.rect, rotation);
      else continue;
      el.rotation = rotation;
    }
  }
}

/**
 * The id of the text box to write on, for a selection that is (or is inside) a
 * sticky — otherwise undefined.
 *
 * This is what makes the paper and the tape typeable: neither carries text of
 * its own, and the user shouldn't have to know which of the three parts the
 * words live in. Double-clicking any part and typing at a selected note both
 * come through here.
 */
export function stickyTextTarget(elements: SlideElement[], ids: string[]): string | undefined {
  for (const id of ids) {
    const el = elements.find((e) => e.id === id);
    if (!el || !isStickyPart(el)) continue;
    if (el.role === STICKY_TEXT_ROLE) return el.id;
    const gid = el.groupIds?.[0];
    const text = gid
      ? elements.find((e) => e.role === STICKY_TEXT_ROLE && e.groupIds?.includes(gid))
      : undefined;
    if (text) return text.id;
  }
  return undefined;
}

/** The note a sticky's text box belongs to. */
export function stickyNoteOf(
  elements: SlideElement[],
  textId: string,
): SlideElement | undefined {
  const text = elements.find((e) => e.id === textId);
  if (!text || text.role !== STICKY_TEXT_ROLE) return undefined;
  const gid = text.groupIds?.[0];
  return gid
    ? elements.find((e) => e.role === STICKY_NOTE_ROLE && e.groupIds?.includes(gid))
    : undefined;
}

/**
 * Where the next note on this slide goes. Counts the notes already there and
 * steps, rather than stacking a second one exactly on the first.
 */
export function stickyOrigin(
  elements: SlideElement[],
  slideSize: { w: number; h: number },
): { x: number; y: number } {
  const n = elements.filter((e) => e.role === STICKY_NOTE_ROLE).length;
  const step = inchesToEmu(CASCADE_IN) * n;
  const x = slideSize.w - inchesToEmu(ORIGIN_RIGHT_IN + NOTE_W_IN) - step;
  const y = inchesToEmu(ORIGIN_TOP_IN) + step;
  return { x: Math.max(inchesToEmu(0.2), x), y };
}

/**
 * Note, tape and text — in z-order, at one tilt, under one group id.
 *
 * The text arrives EMPTY: the click that asks for a sticky is followed by the
 * words, and a placeholder would only have to be selected and deleted first.
 */
export function makeSticky(origin: { x: number; y: number }): SlideElement[] {
  const gid = newId('g');
  const note: Rect = {
    x: origin.x,
    y: origin.y,
    w: inchesToEmu(NOTE_W_IN),
    h: inchesToEmu(MIN_NOTE_H_IN),
  };

  const paper: ShapeElement = {
    id: newId('shape'),
    type: 'shape',
    role: STICKY_NOTE_ROLE,
    name: 'Sticky',
    preset: 'rect',
    rect: note,
    rotation: TILT_DEG,
    fill: { kind: 'solid', color: hex(NOTE_HEX) },
    groupIds: [gid],
  };

  const tape: ShapeElement = {
    id: newId('shape'),
    type: 'shape',
    role: STICKY_TAPE_ROLE,
    name: 'Tape',
    preset: 'rect',
    rect: stickyTapeRect(note, TILT_DEG),
    rotation: TILT_DEG,
    fill: { kind: 'solid', color: hex(TAPE_HEX), alpha: TAPE_ALPHA },
    groupIds: [gid],
  };

  const text: TextElement = {
    id: newId('text'),
    type: 'text',
    role: STICKY_TEXT_ROLE,
    name: 'Sticky text',
    rect: stickyTextRect(note, TILT_DEG),
    rotation: TILT_DEG,
    body: {
      anchor: 'top',
      wrap: true,
      // 'none': the note is grown by `growSticky`, not by a fit pass that would
      // resize the type's box out from under the paper it's written on.
      autofit: 'none',
      paragraphs: [
        {
          align: 'left',
          runs: [
            {
              text: '',
              font: 'Geist',
              sizePt: TEXT_SIZE_PT,
              color: token('ink.strong'),
            },
          ],
        },
      ],
    },
    groupIds: [gid],
  };

  return [paper, tape, text];
}
