'use client';

/**
 * The slide's right-click menu.
 *
 * Everything the canvas can do lives on the format and arrange bars; this menu
 * exists for the few commands you reach for WHERE the pointer already is. Crop
 * is the first of them: right-clicking an image is how PowerPoint offers it, so
 * the gesture people already have in their hands works here too.
 *
 * Items are derived from the live selection rather than from what was under the
 * cursor — `EditorCanvas` has already made the right-clicked object the
 * selection by the time this mounts, so the two agree, and a menu opened over a
 * multi-selection acts on all of it.
 */
import { useEffect } from 'react';
import { isCropped, type SlideElement } from '@/model';
import { useEditor } from '@/store/editorStore';
import { selectSimilarLabel, similarIds } from './selectSimilar';

/** Rough per-item height, used only to keep the menu on screen. */
const ITEM_H = 26;
const MENU_W = 180;

export type MenuItem = { label: string; run: () => void };

/**
 * The items a selection offers, or none — `EditorCanvas` uses the empty case to
 * decide there is no menu worth opening and leaves the press alone.
 */
export function contextMenuItems(selected: SlideElement[]): MenuItem[] {
  const store = useEditor.getState;
  const items: MenuItem[] = [];

  // Gathering the selection's kin is a command about where you are pointing —
  // the same reason crop lives here — and it reads the whole slide, not just
  // the selection, so it is derived from the store rather than the argument.
  const slideEls = store().currentSlide()?.elements ?? [];
  const selectedIds = selected.map((el) => el.id);
  const similarLabel = selectSimilarLabel(slideEls, selectedIds);
  if (similarLabel) {
    items.push({
      label: similarLabel,
      run: () => store().select(similarIds(slideEls, selectedIds)),
    });
  }

  const pictures = selected.filter(
    (el): el is Extract<SlideElement, { type: 'picture' }> => el.type === 'picture',
  );
  // Cropping is a gesture on ONE box (the overlay draws a single set of
  // handles); several pictures at once can still be reset, which needs no
  // geometry.
  const sole = pictures.length === 1 && selected.length === 1 ? pictures[0] : null;
  if (sole) items.push({ label: 'Crop', run: () => store().setCropping(sole.id) });

  const cropped = pictures.filter((p) => isCropped(p.crop));
  if (cropped.length) {
    items.push({
      label: 'Reset crop',
      run: () => cropped.forEach((p) => store().setCrop(p.id, undefined)),
    });
  }

  return items;
}

export function CanvasContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  // Any press outside, any scroll, or Escape dismisses. The press that opened
  // the menu is already over by the time these are attached (contextmenu fires
  // after mouseup on the right button), so it can't close itself.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.dd-context-menu')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  if (!items.length) return null;

  return (
    <div
      // `dd-context-menu` is editor chrome (see `CHROME_SELECTOR`): a press on
      // it acts on the selection and must not change or marquee-clear it.
      className="dd-context-menu fixed z-50 min-w-[9rem] overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-[11px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      style={{
        left: Math.min(x, window.innerWidth - MENU_W),
        top: Math.min(y, window.innerHeight - items.length * ITEM_H - 16),
      }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            item.run();
            onClose();
          }}
          className="block w-full px-3 py-1 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
