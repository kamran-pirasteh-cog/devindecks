/**
 * What the filmstrip's right-click menu offers.
 *
 * The slide-level counterpart to `canvasMenuItems`: the same clipboard commands
 * the strip already answers to from the keyboard (⌘X / ⌘C / ⌘D), plus the one
 * command that has nowhere else to live — Quick Layout, which re-casts the
 * slides you are pointing at rather than inserting a new one.
 *
 * Paste is deliberately absent. It puts slides in AFTER the current one, which
 * is a place, not the thing under the pointer — the chord in the strip is where
 * that belongs, and an entry here would read as "paste into this slide".
 */
import { useEditor } from '@/store/editorStore';
import type { MenuItem } from './ContextMenu';
import { QUICK_LAYOUTS } from './quickLayout';

/** "3 slides" when the menu acts on a run of them, "" when it acts on one. */
const suffix = (n: number) => (n > 1 ? ` ${n} slides` : '');

export function slideMenuItems(ids: string[]): MenuItem[] {
  const store = useEditor.getState;
  if (!ids.length) return [];
  const n = ids.length;
  const items: MenuItem[] = [
    { label: `Copy${suffix(n)}`, run: () => store().copySlides(ids) },
  ];

  // A deck must keep a slide, and `cutSlides` refuses the whole deck — so the
  // command is absent rather than offered and ignored.
  if (store().deck.slides.length > n) {
    items.push({ label: `Cut${suffix(n)}`, run: () => store().cutSlides(ids) });
  }

  items.push({ label: `Duplicate${suffix(n)}`, run: () => store().duplicateSlides(ids) });
  items.push({
    label: 'Quick Layout',
    items: QUICK_LAYOUTS.map((l) => ({
      label: l.label,
      run: () => store().applyQuickLayout(l.id, ids),
    })),
  });

  return items;
}
