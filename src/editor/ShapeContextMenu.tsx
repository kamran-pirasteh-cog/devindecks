'use client';

/**
 * Right-click menu for a canvas element. Mirrors Inspector's controls (same
 * store actions, same design-system swatches + allowed fonts) so there's one
 * place that knows how fill/font/size get applied.
 */
import { useEffect, useRef, useState } from 'react';
import { ALLOWED_FONTS, hex as hexColor, token, type FontFamily, type SlideElement } from '@/model';
import { useEditor } from '@/store/editorStore';
import { OVERLAY_Z } from './layers';

interface ShapeContextMenuProps {
  x: number;
  y: number;
  elementIds: string[];
  primary: SlideElement;
  onClose: () => void;
}

export function ShapeContextMenu({ x, y, elementIds, primary, onClose }: ShapeContextMenuProps) {
  const ds = useEditor((s) => s.designSystem);
  const store = useEditor.getState;
  const ref = useRef<HTMLDivElement>(null);

  const hasText = primary.type === 'text' || (primary.type === 'shape' && !!primary.body);
  const firstRun =
    primary.type === 'text' || (primary.type === 'shape' && primary.body)
      ? primary.body?.paragraphs[0]?.runs[0]
      : undefined;

  const initialColor = firstRun?.color;
  const [customHex, setCustomHex] = useState(
    initialColor && initialColor.kind === 'hex' ? initialColor.hex : '#4F46E5',
  );

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
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
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: x, top: y, zIndex: OVERLAY_Z }}
      className="w-52 rounded-lg border border-zinc-200 bg-white py-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Color
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {ds.colors.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              store().setFill(elementIds, { kind: 'solid', color: token(c.id) });
              onClose();
            }}
            title={c.name}
            className="h-6 w-6 rounded border border-black/10 hover:ring-2 hover:ring-indigo-400"
            style={{ background: c.hex }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <input
          type="color"
          value={customHex}
          onChange={(e) => setCustomHex(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border border-zinc-300 bg-transparent p-0 dark:border-zinc-600"
        />
        <input
          type="text"
          value={customHex}
          onChange={(e) => setCustomHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              store().setFill(elementIds, { kind: 'solid', color: hexColor(customHex) });
              onClose();
            }
          }}
          className="w-16 rounded border border-zinc-200 bg-white px-1.5 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          onClick={() => {
            store().setFill(elementIds, { kind: 'solid', color: hexColor(customHex) });
            onClose();
          }}
          className="rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
        >
          Apply
        </button>
      </div>

      {hasText ? (
        <>
          <div className="border-t border-zinc-100 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            Font
          </div>
          <div className="px-3 pb-2">
            <select
              value={firstRun?.font ?? ds.fonts.body}
              onChange={(e) => {
                store().patchRuns(elementIds, { font: e.target.value as FontFamily });
                onClose();
              }}
              className="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              {ALLOWED_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="border-t border-zinc-100 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            Font size
          </div>
          <div className="flex items-center gap-2 px-3 pb-1">
            <input
              type="number"
              defaultValue={firstRun?.sizePt ?? ds.type.body.sizePt}
              key={firstRun?.sizePt}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) store().patchRuns(elementIds, { sizePt: v });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = parseFloat((e.target as HTMLInputElement).value);
                  if (!Number.isNaN(v)) store().patchRuns(elementIds, { sizePt: v });
                  onClose();
                }
              }}
              className="w-16 rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <span className="text-xs text-zinc-400">pt</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
