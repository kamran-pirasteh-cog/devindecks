'use client';

/**
 * Crop mode for a picture — PowerPoint's crop, in the browser.
 *
 * The whole source image is painted dimmed on its PLANE (see `model/crop.ts`),
 * with the part that survives shown bright inside the crop window. Handles trim
 * the window; dragging inside it slides the image under the window instead, so
 * both halves of "which pixels, and where on the slide" are reachable with one
 * gesture each.
 *
 * Nothing is written to the store until the crop is committed: the overlay owns
 * the live geometry, so Escape can drop it whole and one crop costs one undo
 * step rather than one per mouse move.
 */
import { useEffect, useRef, useState } from 'react';
import { cropPlane, cropWindow, coverCrop, type Rect, type SlideElement } from '@/model';
import { useEditor } from '@/store/editorStore';
import { OVERLAY_Z } from './layers';

type Picture = Extract<SlideElement, { type: 'picture' }>;

/** The eight trim handles, as their unit position on the window's box. */
const HANDLES = [
  { dir: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { dir: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { dir: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { dir: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
  { dir: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { dir: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { dir: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { dir: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
] as const;

export function CropOverlay({ el, scale }: { el: Picture; scale: number }) {
  const store = useEditor.getState;

  // Both in canvas px. `plane` is where the untrimmed source sits; `window` is
  // the part kept, which becomes the element's rect on commit.
  const [plane, setPlane] = useState<Rect | null>(null);
  const [win, setWin] = useState<Rect | null>(null);
  const dragRef = useRef<{ move: (e: PointerEvent) => void; up: () => void } | null>(null);

  const elId = el.id;
  const rectKey = `${el.rect.x},${el.rect.y},${el.rect.w},${el.rect.h}`;

  // Seed the geometry once per picture. An already-cropped picture carries its
  // plane in its insets; an uncropped one is cover-fit, so the source's pixel
  // size is what says how much of it the box is already hiding.
  useEffect(() => {
    let live = true;
    const seed = (crop: Picture['crop']) => {
      if (!live) return;
      const rect = useEditor.getState().deck.slides
        .flatMap((s) => s.elements)
        .find((e) => e.id === elId)?.rect;
      if (!rect) return;
      const p = cropPlane(rect, crop);
      setPlane({ x: p.x * scale, y: p.y * scale, w: p.w * scale, h: p.h * scale });
      setWin({ x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale });
    };
    if (el.crop) {
      seed(el.crop);
    } else {
      const img = new Image();
      img.onload = () => seed(coverCrop({ w: img.naturalWidth, h: img.naturalHeight }, el.rect));
      // A source the browser can't measure still crops — from the full frame,
      // which is what an unmeasurable image is being drawn as anyway.
      img.onerror = () => seed(undefined);
      img.src = el.src;
    }
    return () => {
      live = false;
    };
    // Re-seeds when the picture, its box or the zoom changes — never per frame
    // of a drag, which writes `plane`/`win` directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elId, el.src, rectKey, scale]);

  /** Write the crop through and leave the mode. */
  const commit = () => {
    if (!plane || !win) {
      store().setCropping(null);
      return;
    }
    const toEmu = (r: Rect): Rect => ({
      x: r.x / scale,
      y: r.y / scale,
      w: r.w / scale,
      h: r.h / scale,
    });
    const { rect, crop } = cropWindow(toEmu(plane), toEmu(win));
    store().setCrop(elId, crop, rect);
    store().setCropping(null);
  };

  // Enter commits, Escape drops the whole thing. Captured at the window so the
  // keys work wherever focus landed after the click that opened crop mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        store().setCropping(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A press anywhere outside the overlay means "done", the same as clicking off
  // a text box. Registered in the capture phase so the crop is already in the
  // model by the time the canvas resolves what that click selected.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.dd-crop-overlay, .dd-format-bar')) return;
      commit();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  });

  useEffect(() => () => dragRef.current?.up(), []);

  if (!plane || !win) return null;

  /** Shared pointer plumbing: every gesture is "read the delta, set state". */
  const startDrag = (
    e: React.PointerEvent,
    apply: (dx: number, dy: number) => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => apply(ev.clientX - x0, ev.clientY - y0);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    dragRef.current = { move, up };
  };

  const trim = (e: React.PointerEvent, dir: (typeof HANDLES)[number]['dir']) => {
    const start = { ...win };
    startDrag(e, (dx, dy) => {
      const left = dir.includes('w') ? start.x + dx : start.x;
      const top = dir.includes('n') ? start.y + dy : start.y;
      const right = dir.includes('e') ? start.x + start.w + dx : start.x + start.w;
      const bottom = dir.includes('s') ? start.y + start.h + dy : start.y + start.h;
      // Clamped to the plane's edges and to a floor of a few px, so a handle
      // pushed past the far side stops instead of turning the box inside out.
      const x = clamp(Math.min(left, right - MIN_PX), plane.x, plane.x + plane.w - MIN_PX);
      const y = clamp(Math.min(top, bottom - MIN_PX), plane.y, plane.y + plane.h - MIN_PX);
      setWin({
        x,
        y,
        w: clamp(Math.max(right, x + MIN_PX), x + MIN_PX, plane.x + plane.w) - x,
        h: clamp(Math.max(bottom, y + MIN_PX), y + MIN_PX, plane.y + plane.h) - y,
      });
    });
  };

  /** Dragging inside slides the IMAGE, not the window — PowerPoint's pan. */
  const pan = (e: React.PointerEvent) => {
    const start = { ...plane };
    startDrag(e, (dx, dy) => {
      setPlane({
        ...start,
        // The plane may never uncover the window, so its travel stops where its
        // own edge reaches the window's.
        x: clamp(start.x + dx, win.x + win.w - start.w, win.x),
        y: clamp(start.y + dy, win.y + win.h - start.h, win.y),
      });
    });
  };

  const imgStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: plane.w,
    height: plane.h,
    objectFit: 'fill',
    // Both copies are drawn at PLANE size, which is larger than the box they
    // sit in; the CSS reset's `img { max-width: 100% }` would shrink them back
    // and the crop would look like a stretch. See `SlideView`'s picture.
    maxWidth: 'none',
    maxHeight: 'none',
  };

  return (
    <div
      className="dd-crop-overlay absolute"
      style={{ left: 0, top: 0, zIndex: OVERLAY_Z }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The trimmed-away image, dimmed. Ignores the pointer so the gestures
          below it (pan, trim) are the only things a press can hit. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={el.src}
        alt=""
        draggable={false}
        className="pointer-events-none absolute opacity-35"
        style={{ ...imgStyle, left: plane.x, top: plane.y }}
      />

      {/* What survives: the same image, undimmed, clipped to the window. */}
      <div
        className="absolute cursor-move overflow-hidden ring-1 ring-white/70"
        style={{ left: win.x, top: win.y, width: win.w, height: win.h }}
        onPointerDown={pan}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={el.src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute"
          style={{ ...imgStyle, left: plane.x - win.x, top: plane.y - win.y }}
        />
      </div>

      {/* Done / Cancel ride with the window, under it when there's room. The
          format bar can't own these: the live geometry is local to this
          component until it commits. */}
      <div
        className="absolute flex -translate-x-1/2 gap-1 rounded-lg border border-zinc-200 bg-white px-1.5 py-1 text-[11px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        style={{ left: win.x + win.w / 2, top: win.y + win.h + 12 }}
      >
        <button
          type="button"
          onClick={commit}
          className="rounded bg-indigo-600 px-2 py-0.5 font-medium text-white hover:bg-indigo-500"
        >
          Done
        </button>
        <button
          type="button"
          onClick={() => store().setCropping(null)}
          className="rounded px-2 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>

      {HANDLES.map((h) => (
        <div
          key={h.dir}
          role="slider"
          aria-label={`Crop ${h.dir}`}
          aria-valuenow={0}
          tabIndex={-1}
          className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-zinc-900 shadow"
          style={{
            left: win.x + h.x * win.w,
            top: win.y + h.y * win.h,
            cursor: h.cursor,
          }}
          onPointerDown={(e) => trim(e, h.dir)}
        />
      ))}
    </div>
  );
}

/** Smallest crop window, in canvas px — below this the handles overlap. */
const MIN_PX = 16;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
