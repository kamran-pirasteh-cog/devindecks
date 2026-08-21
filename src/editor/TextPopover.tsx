'use client';

/**
 * Text inserter — pick the face and the size, then a single click drops the box.
 * Each row previews itself in its own typeface at its own weight, so the choice
 * is made by eye rather than by reading a font name.
 *
 * The list is faces (Geist Medium, Geist Mono Bold, …), not families: the model
 * still carries the three allowed families with weight/italic as run attributes,
 * which is what survives the .pptx and Slides round-trip.
 */
import { useEffect, useRef, useState } from 'react';
import { FONTS, hex as hexRef, resolveColor, token, type ColorRef } from '@/model';
import { useEditor } from '@/store/editorStore';
import { CustomColorSwatch, customHexOf } from './color';
import {
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_SIZE_PT,
  TEXT_SIZES,
  TEXT_STYLES,
  makeText,
  type TextStyle,
} from './factories';
import { OVERLAY_Z } from './layers';

/** Preview cap, so a 54pt sample doesn't blow the popover open. */
const PREVIEW_MAX_PX = 20;

export function TextPopover({
  onClose,
  anchorRef,
}: {
  onClose: () => void;
  /** The trigger's wrapper — clicks inside it must not count as "outside", or
   *  the close-then-toggle race would leave the popover stuck open. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const ds = useEditor((s) => s.designSystem);
  const addElement = useEditor((s) => s.addElement);
  const [sizePt, setSizePt] = useState<number>(DEFAULT_TEXT_SIZE_PT);
  const [color, setColor] = useState<ColorRef>(DEFAULT_TEXT_COLOR);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  const insert = (style: TextStyle) => {
    addElement(makeText(style, sizePt, color));
    onClose();
  };

  const previewColor = resolveColor(color, ds);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Insert text"
      style={{ zIndex: OVERLAY_Z }}
      className="absolute top-full left-0 mt-1.5 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Size
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {TEXT_SIZES.map((pt) => {
              const active = sizePt === pt;
              return (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setSizePt(pt)}
                  aria-pressed={active}
                  title={`${pt} pt`}
                  className={`flex h-7 min-w-8 items-center justify-center rounded-md border px-1.5 text-xs ${
                    active
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  {pt}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Color
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {ds.colors.map((c) => {
              const active = color.kind === 'token' && color.token === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  title={c.name}
                  aria-label={c.name}
                  aria-pressed={active}
                  onClick={() => setColor(token(c.id))}
                  className={`h-6 w-6 rounded-full border ${
                    active
                      ? 'border-zinc-900 ring-2 ring-zinc-900 ring-offset-1 dark:border-white dark:ring-white dark:ring-offset-zinc-900'
                      : 'border-zinc-300 dark:border-zinc-600'
                  }`}
                  style={{ background: c.hex }}
                />
              );
            })}
            <CustomColorSwatch
              value={customHexOf(color)}
              active={color.kind === 'hex'}
              onPick={(h) => setColor(hexRef(h))}
              shape="rounded-full"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Typeface
          </span>
          <div className="flex flex-col">
            {TEXT_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => insert(s)}
                title={`${s.label} · ${sizePt} pt`}
                className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span
                  className="truncate"
                  style={{
                    color: previewColor,
                    fontFamily: FONTS[s.font].cssStack,
                    fontWeight: s.weight,
                    fontStyle: s.italic ? 'italic' : 'normal',
                    fontSize: Math.min(sizePt, PREVIEW_MAX_PX),
                  }}
                >
                  {s.label}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                  {sizePt}pt
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
