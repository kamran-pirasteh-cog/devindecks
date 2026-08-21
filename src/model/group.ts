/**
 * Grouping.
 *
 * A group is NOT a container element. Membership is a flat `groupIds` stamp on
 * each member — outermost group first — so every existing operation (render,
 * z-order, export, Devin edits) keeps seeing one flat element list and needs no
 * knowledge of groups at all. Only the parts that must behave differently
 * (selection, transform, arrange) consult these helpers.
 *
 * Nesting falls out of the array for free: grouping a selection unshifts a new
 * id in front of whatever each member already carried, and ungrouping shifts
 * the outermost one back off — exactly PowerPoint's one-level-at-a-time
 * ungroup.
 */
import type { SlideElement } from './types';

/** The group a click selects: the outermost one the element belongs to. */
export const outerGroupId = (el: SlideElement): string | undefined => el.groupIds?.[0];

/** Every element in `gid`, in z-order. */
export const groupMembers = (elements: SlideElement[], gid: string): SlideElement[] =>
  elements.filter((e) => e.groupIds?.includes(gid));

/**
 * The ids a single click on `id` selects — the whole outermost group, or just
 * the element when it isn't grouped.
 */
export function selectionUnit(elements: SlideElement[], id: string): string[] {
  const el = elements.find((e) => e.id === id);
  const gid = el && outerGroupId(el);
  if (!gid) return el ? [id] : [];
  // Clicked element first: `matchSize`/`matchFormat` read the head of the
  // selection as their reference, so the object under the cursor stays it.
  return [id, ...groupMembers(elements, gid).map((e) => e.id).filter((x) => x !== id)];
}

/** Grow a raw id list so no group is ever half-selected. */
export function expandSelection(elements: SlideElement[], ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const memberId of selectionUnit(elements, id)) {
      if (seen.has(memberId)) continue;
      seen.add(memberId);
      out.push(memberId);
    }
  }
  return out;
}

/**
 * The selection split into the things the user thinks they are manipulating:
 * one entry per top-level group plus one per loose element. Align, distribute
 * and "can I group this?" all reason in these units, not in raw elements — a
 * group has to move as one box, not fall apart under an align.
 */
export function selectionUnits(elements: SlideElement[], ids: string[]): string[][] {
  const selected = new Set(ids);
  const units: string[][] = [];
  const claimed = new Set<string>();
  for (const id of ids) {
    if (claimed.has(id)) continue;
    const unit = selectionUnit(elements, id).filter((x) => selected.has(x));
    unit.forEach((x) => claimed.add(x));
    units.push(unit);
  }
  return units;
}

/** True when ⌘G would do something: two or more independent things selected. */
export const canGroup = (elements: SlideElement[], ids: string[]): boolean =>
  selectionUnits(elements, ids).length >= 2;

/** True when ⌘⇧G would do something: at least one member of a group selected. */
export const canUngroup = (elements: SlideElement[], ids: string[]): boolean =>
  elements.some((e) => ids.includes(e.id) && !!outerGroupId(e));

/** Bounding box of a set of elements, in EMU. */
export function unionRect(elements: SlideElement[], ids: string[]) {
  const els = elements.filter((e) => ids.includes(e.id));
  if (!els.length) return null;
  const x = Math.min(...els.map((e) => e.rect.x));
  const y = Math.min(...els.map((e) => e.rect.y));
  const r = Math.max(...els.map((e) => e.rect.x + e.rect.w));
  const b = Math.max(...els.map((e) => e.rect.y + e.rect.h));
  return { x, y, w: r - x, h: b - y };
}

/**
 * The axis-aligned box a rotated object actually occupies on the slide.
 *
 * A group's outline is the union of these, not of its members' own boxes: a
 * text box turned 30° sticks out past its width and height, and PowerPoint's
 * group box wraps what you can see. Moveable measures the rotated nodes, so
 * this is also the only bounds a group resize can use as its "size at the start
 * of the gesture" — measure the unrotated rects instead and the very first
 * frame divides the live box by a smaller number, which lands a scale factor
 * that isn't 1 and makes the selection jump the instant a handle moves.
 *
 * `rotation` is clockwise degrees in screen coordinates (y down), as everywhere
 * else in the model. The box grows about its own centre, which rotation leaves
 * where it is.
 */
export function rotatedBounds(
  box: { x: number; y: number; w: number; h: number },
  rotation = 0,
): { x: number; y: number; w: number; h: number } {
  if (!rotation) return { ...box };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = box.w * cos + box.h * sin;
  const h = box.w * sin + box.h * cos;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * What a set of elements OCCUPIES on the slide: the union of their rotated
 * bounding boxes.
 *
 * This is the box the canvas rings a selection with (Moveable measures the
 * rotated nodes) and therefore the box a group transform has to scale. See
 * `unionRect` for the union of the model rects themselves, which is what
 * alignment and spacing work in.
 */
export function occupiedRect(elements: SlideElement[], ids: string[]) {
  const boxes = elements
    .filter((e) => ids.includes(e.id))
    .map((e) => rotatedBounds(e.rect, e.rotation ?? 0));
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(r - x), h: Math.round(b - y) };
}

/**
 * True when `ids` is exactly one whole group — the case PowerPoint rings with a
 * single box.
 *
 * Outlining every member as well would draw the group's insides on top of it,
 * which is the opposite of what grouping is for: the group is one object now.
 * Deliberately false for two groups picked together (each still deserves its own
 * box) and for a partly selected group, which isn't a group's box at all.
 */
export function isSoleGroup(elements: SlideElement[], ids: string[]): boolean {
  if (ids.length < 2) return false;
  const first = elements.find((e) => e.id === ids[0]);
  const gid = first && outerGroupId(first);
  if (!gid) return false;
  const members = groupMembers(elements, gid);
  return members.length === ids.length && members.every((m) => ids.includes(m.id));
}
