'use client';

/** Drag-to-resize for a side panel. `edge` is which side of the panel the drag handle sits on. */
import { useCallback, useRef, useState } from 'react';

export function useResizableWidth(initial: number, min: number, max: number, edge: 'left' | 'right') {
  const [width, setWidth] = useState(initial);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const dir = edge === 'right' ? 1 : -1;

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { startX, startWidth } = dragRef.current;
      const next = startWidth + (e.clientX - startX) * dir;
      setWidth(Math.min(max, Math.max(min, next)));
    },
    [dir, min, max],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove]);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = { startX: e.clientX, startWidth: width };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [width, onPointerMove, onPointerUp],
  );

  return { width, startDrag };
}
