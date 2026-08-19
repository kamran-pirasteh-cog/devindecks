'use client';

/**
 * Keyboard shortcut reference.
 *
 * Every binding here is transcribed from the real handlers — `Editor.tsx`'s
 * window keydown, `TextEditor.tsx`'s in-place editor, `fontSizeShortcut.ts`, and
 * the drag/resize modifiers in `EditorCanvas.tsx`. If you add or change a
 * binding in any of those, update the matching row here; a shortcut sheet that
 * drifts from the code is worse than none.
 */
import { useEffect } from 'react';
import { MODAL_Z } from './layers';
import { FLAGS } from '@/flags';

interface Shortcut {
  keys: string[];
  label: string;
  /** Shown when a binding only fires in a particular context. */
  note?: string;
}

interface Group {
  title: string;
  items: Shortcut[];
}

/**
 * ⌘ on Apple platforms, Ctrl elsewhere — the handlers accept either, this is
 * only about labelling. Read at render rather than module scope: the modal is
 * client-only (it mounts on click), so there's nothing to hydrate against, and
 * evaluating at import would bake in the server's answer.
 */
const modKey = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

const buildGroups = (MOD: string): Group[] => [
  {
    title: 'General',
    items: [
      { keys: [MOD, 'Z'], label: 'Undo' },
      { keys: [MOD, 'Y'], label: 'Redo', note: `or ${MOD}⇧Z` },
      { keys: [MOD, 'A'], label: 'Select everything on the slide' },
      { keys: [MOD, 'M'], label: 'New slide', note: 'after the current one' },
      {
        keys: [MOD, '⇧', 'E'],
        label: 'Add an eyebrow above the title',
        note: 'nudges the title down',
      },
      { keys: ['Delete'], label: 'Delete selection' },
      { keys: ['Esc'], label: 'Clear selection', note: 'exits text editing first' },
      { keys: ['Double-click'], label: 'Edit text in place' },
      { keys: ['⇧', 'Click'], label: 'Add or remove from selection' },
      { keys: ['⌥', '↑', '↓'], label: 'Select the next object that way', note: 'nothing selected? starts at the top-left — ⌥←/→ work that way too' },
      { keys: ['Click'], label: 'Select only what you clicked', note: 'empty space clears' },
      { keys: [MOD, 'Scroll'], label: 'Zoom the slide in or out' },
      { keys: [MOD, '⌥', 'C'], label: 'Copy formatting', note: `whole object, or the text you highlighted — also ${MOD}⇧C` },
      { keys: [MOD, '⌥', 'V'], label: 'Paste formatting', note: `onto the highlighted text only, if any — also ${MOD}⇧V` },
      ...(FLAGS.comments
        ? [
            { keys: [MOD, '⌥', 'M'], label: 'Comment', note: 'on the selection, or the slide' },
            { keys: [MOD, '↵'], label: 'Post comment or reply', note: 'in the comments panel' },
          ]
        : []),
    ],
  },
  {
    title: 'Text',
    items: [
      { keys: [MOD, 'B'], label: 'Bold' },
      { keys: [MOD, 'I'], label: 'Italic' },
      { keys: [MOD, 'U'], label: 'Underline' },
      { keys: [MOD, 'L'], label: 'Align left' },
      { keys: [MOD, 'E'], label: 'Align centre' },
      { keys: [MOD, 'R'], label: 'Align right' },
      { keys: [MOD, '⌥', 'Ctrl', '←'], label: 'Align the text left', note: 'press it again to centre' },
      { keys: [MOD, '⌥', 'Ctrl', '→'], label: 'Align the text right', note: 'press it again to centre' },
      { keys: [MOD, '⌥', 'Ctrl', '↑'], label: 'Sit the text at the top of its box', note: 'press it again to centre' },
      { keys: [MOD, '⌥', 'Ctrl', '↓'], label: 'Sit the text at the bottom of its box', note: 'press it again to centre' },
      { keys: [MOD, '⇧', '>'], label: 'Increase font size', note: `also ${MOD}⌥>` },
      { keys: [MOD, '⇧', '<'], label: 'Decrease font size', note: `also ${MOD}⌥<` },
      { keys: [MOD, '⇧', '8'], label: 'Bulleted list', note: 'while editing text' },
      { keys: [MOD, '⇧', '7'], label: 'Numbered list', note: 'while editing text' },
      { keys: ['Tab'], label: 'Indent list item', note: 'while editing text' },
      { keys: ['⇧', 'Tab'], label: 'Outdent list item', note: 'while editing text' },
      { keys: ['↵'], label: 'Finish editing', note: `while editing text — also ${MOD}↵` },
      { keys: ['⇧', '↵'], label: 'New line', note: 'stays in the text box' },
    ],
  },
  {
    title: 'Move & arrange',
    items: [
      { keys: ['↑', '↓', '←', '→'], label: 'Nudge' },
      { keys: ['⇧', 'Arrow'], label: 'Resize', note: '→ ↓ grow, ← ↑ shrink' },
      {
        keys: ['⌥', '⇧', 'Arrow'],
        label: 'Stretch one side',
        note: 'pictures keep their proportions without ⌥',
      },
      {
        keys: ['⌥', '←', '→'],
        label: 'Rotate',
        note: '22.5° a press — an object dragged off the grid snaps back onto it',
      },
      { keys: [MOD, 'D'], label: 'Duplicate selection' },
      { keys: [MOD, 'G'], label: 'Group', note: '2+ objects' },
      { keys: [MOD, '⌥', 'G'], label: 'Ungroup', note: 'one level at a time' },
      { keys: ['Click'], label: 'Select a member of a group', note: 'with the group selected' },
      { keys: ['Esc'], label: 'Step back out to the group', note: 'inside a group' },
      { keys: [MOD, '⌥', '↑'], label: 'Bring forward', note: `${MOD}⌥⇧↑ jumps to the front` },
      { keys: [MOD, '⌥', '↓'], label: 'Send backward', note: `${MOD}⌥⇧↓ drops to the back` },
      { keys: [MOD, 'Arrow'], label: 'Align edges that way', note: '2+ selected' },
      { keys: ['Ctrl', 'Arrow'], label: 'Snap to that margin guide', note: 'one object' },
      { keys: ['…', 'again'], label: 'Travel on to the next guide, then the slide edge', note: 'stops when there is nothing further that way' },
      { keys: ['…', 'midway'], label: 'Centred on the slide', note: 'one object, on the way past' },
    ],
  },
  {
    title: 'Drag & resize',
    items: [
      { keys: ['⇧', 'Drag'], label: 'Lock to one axis' },
      { keys: [MOD, 'Drag'], label: 'Duplicate as you drag' },
      { keys: [MOD, '⇧', 'Drag'], label: 'Duplicate, locked to one axis' },
      { keys: [MOD, '⇧', 'G'], label: 'Show or hide margin guides', note: 'snapping stays on' },
      { keys: ['⇧', 'Resize'], label: 'Keep aspect ratio' },
      { keys: [MOD, 'Resize'], label: 'Resize from centre' },
      { keys: ['Double-click'], label: 'Reset rotation to 0°', note: 'on the rotation handle' },
      {
        keys: ['Double-click'],
        label: 'Fit box to its text',
        note: 'on the bottom-right handle',
      },
    ],
  },
  {
    title: 'Slides panel',
    items: [
      { keys: ['⇧', 'Click'], label: 'Select a range of slides' },
      { keys: [MOD, 'Click'], label: 'Add or remove one slide from the selection' },
      { keys: [MOD, 'C'], label: 'Copy the selected slides' },
      { keys: [MOD, 'X'], label: 'Cut the selected slides' },
      { keys: [MOD, 'V'], label: 'Paste slides', note: 'after the current one' },
      { keys: ['Delete'], label: 'Delete selected slides' },
      { keys: ['Drag'], label: 'Reorder slides' },
    ],
  },
];

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-zinc-300 bg-zinc-50 px-1.5 font-sans text-[11px] font-medium text-zinc-700 shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </kbd>
  );
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const groups = buildGroups(modKey());

  // Esc closes. Capture phase, because the editor's own window-level Escape
  // handler would otherwise clear the canvas selection behind the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      style={{ zIndex: MODAL_Z }}
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl select-none flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-x-8 gap-y-6 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.items.map((s) => (
                  <li key={`${g.title}-${s.label}-${s.keys.join()}`} className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-zinc-700 dark:text-zinc-300">
                      {s.label}
                      {s.note ? (
                        <span className="ml-1.5 text-[11px] text-zinc-400">({s.note})</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k, i) => (
                        <Key key={i}>{k}</Key>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
