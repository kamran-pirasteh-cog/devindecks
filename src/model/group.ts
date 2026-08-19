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
