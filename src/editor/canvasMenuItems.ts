/**
 * What the canvas's right-click menu offers.
 *
 * Everything the canvas can do lives on the format and arrange bars; this menu
 * exists for the few commands you reach for WHERE the pointer already is. Crop
 * is the first of them: right-clicking an image is how PowerPoint offers it, so
 * the gesture people already have in their hands works here too.
 *
 * Items are derived from the live selection rather than from what was under the
 * cursor — `EditorCanvas` has already made the right-clicked object the
 * selection by the time this runs, so the two agree, and a menu opened over a
 * multi-selection acts on all of it.
 */
import { isCropped, type SlideElement } from '@/model';
import { useEditor } from '@/store/editorStore';
import type { MenuItem } from './ContextMenu';
import { dateFormatMenuItems } from './chartDateMenu';
import { numberFormatMenuItems } from './chartNumberMenu';
import { selectSimilarLabel, similarIds } from './selectSimilar';

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

  // How a chart writes its numbers, for the same reason crop is here: the
  // pointer is already on the label you want in millions. Empty for anything
  // that isn't one chart's parts.
  items.push(...numberFormatMenuItems(selected));

  // And how it writes its dates, on the ticks that carry them. Empty for any
  // axis whose labels aren't periods — see `dateFormatMenuItems`.
  items.push(...dateFormatMenuItems(selected));

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
