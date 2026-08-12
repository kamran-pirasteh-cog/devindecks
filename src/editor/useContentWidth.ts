'use client';

/**
 * Measured inner content width of an element, in px — the space actually
 * available to children after padding, borders and any scrollbar.
 *
 * Deriving this arithmetically (panel width minus a hardcoded padding constant)
 * silently overshoots whenever a scrollbar is present, which renders oversized
 * content into an `overflow-hidden` box and clips its right edge. Measuring
 * `clientWidth` (which excludes both border and scrollbar) and subtracting the
 * computed padding is exact, and stays correct when the padding changes or the
 * scrollbar appears and disappears.
 */
import { useEffect, useState, type RefObject } from 'react';

export function useContentWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const cs = getComputedStyle(el);
      const inner =
        el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      setWidth(inner > 0 ? inner : null);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
