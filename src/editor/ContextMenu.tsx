'use client';

/**
 * The editor's right-click menu — the surface, not the commands.
 *
 * Both menus in the editor render through this: the canvas builds its items
 * from the selection (`canvasMenuItems`), the filmstrip from the slides you are
 * pointing at (`slideMenuItems`). Keeping one component means one dismissal
 * rule, one on-screen clamp, and one set of hover manners for a submenu.
 */
import { useEffect, useState } from 'react';

/** Rough per-item height, used only to keep the menu on screen. */
const ITEM_H = 26;
const MENU_W = 180;

/**
 * A command, a heading that opens more (`items`), or a text field (`input`).
 *
 * A parent runs nothing itself: pointing at it is how you reach the children.
 * A field is the escape hatch for a setting no list can enumerate — a custom
 * date pattern, say — offered WHERE the pointer already is rather than sending
 * the author off to a panel to type six characters.
 */
export type MenuItem =
  | { label: string; run: () => void; items?: undefined; input?: undefined }
  | { label: string; items: MenuItem[]; run?: undefined; input?: undefined }
  | { label: string; input: MenuInput; run?: undefined; items?: undefined };

export interface MenuInput {
  /** What the field starts with — the value in force, not a draft. */
  value: string;
  placeholder?: string;
  /** Rejects a keystroke-in-progress, so the field can go red before Enter. */
  valid?: (raw: string) => boolean;
  /** Enter or blur. The menu closes on Enter, as any other command does. */
  commit: (raw: string) => void;
}

/**
 * One field on the menu. Its own component because it holds a DRAFT: the value
 * is applied when the author says so, not on every keystroke on the way there.
 */
function MenuField({
  label,
  item,
  onClose,
}: {
  label: string;
  item: MenuInput;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(item.value);
  const invalid = draft.trim() !== '' && item.valid?.(draft) === false;

  const commit = () => {
    if (draft.trim() === '' || invalid) return;
    item.commit(draft);
  };

  return (
    <input
      value={draft}
      placeholder={item.placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setDraft(e.target.value)}
      // A press inside the field must not read as a press on the command
      // behind it — the menu treats a click on a row as "run and close".
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          onClose();
        }
        if (e.key === 'Escape') setDraft(item.value);
      }}
      aria-label={label}
      aria-invalid={invalid}
      className={`h-5 w-full min-w-0 rounded border bg-white px-1 font-mono text-[10px] dark:bg-zinc-900 ${
        invalid
          ? 'border-rose-400 text-rose-600 dark:text-rose-400'
          : 'border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200'
      }`}
    />
  );
}

export function ContextMenu({
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
  const [openLabel, setOpenLabel] = useState<string | null>(null);

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

  // Room for the flyout is decided here, once, from the parent menu's own left
  // edge — the submenu is the same width, so if it doesn't fit to the right of
  // the menu it goes to the left of it.
  const flyoutLeft = x + MENU_W * 2 > window.innerWidth;

  // The vertical clamp has to leave room for the tallest flyout too, measured
  // from the LAST row — a submenu opening off the bottom of the screen is the
  // one clipping the fixed positioning can't recover from.
  const rows =
    items.length + Math.max(0, ...items.map((i) => (i.items ? i.items.length - 1 : 0)));

  const rowClass =
    'flex w-full items-center justify-between gap-3 px-3 py-1 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800';

  return (
    <div
      // `dd-context-menu` is editor chrome (see `CHROME_SELECTOR`): a press on
      // it acts on the selection and must not change or marquee-clear it.
      className="dd-context-menu fixed z-50 min-w-[9rem] rounded-md border border-zinc-200 bg-white py-1 text-[11px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      style={{
        left: Math.min(x, window.innerWidth - MENU_W),
        top: Math.max(4, Math.min(y, window.innerHeight - rows * ITEM_H - 16)),
      }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) =>
        item.items ? (
          <div
            key={item.label}
            className="relative"
            // Hover opens it, the way a menu bar does; leaving the row closes
            // it, so two submenus can never be open at once.
            onMouseEnter={() => setOpenLabel(item.label)}
          >
            <button type="button" role="menuitem" aria-haspopup="menu" className={rowClass}>
              {item.label}
              <span aria-hidden className="text-zinc-400">
                ›
              </span>
            </button>
            {openLabel === item.label ? (
              <div
                role="menu"
                className={`absolute -top-1 z-10 min-w-[9rem] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
                  flyoutLeft ? 'right-full mr-0.5' : 'left-full ml-0.5'
                }`}
              >
                {item.items.map((child) =>
                  child.input ? (
                    <div key={child.label} className={`${rowClass} gap-2`}>
                      <span className="shrink-0 text-zinc-400">{child.label}</span>
                      <MenuField label={child.label} item={child.input} onClose={onClose} />
                    </div>
                  ) : (
                    <button
                      key={child.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        child.run?.();
                        onClose();
                      }}
                      className={rowClass}
                    >
                      {child.label}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ) : item.input ? (
          <div
            key={item.label}
            className={`${rowClass} gap-2`}
            onMouseEnter={() => setOpenLabel(null)}
          >
            <span className="shrink-0 text-zinc-400">{item.label}</span>
            <MenuField label={item.label} item={item.input} onClose={onClose} />
          </div>
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onMouseEnter={() => setOpenLabel(null)}
            onClick={() => {
              item.run();
              onClose();
            }}
            className={rowClass}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
