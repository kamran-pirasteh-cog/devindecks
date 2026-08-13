'use client';

/**
 * FitSlideView — a <SlideView> that fills whatever box it's dropped into.
 *
 * SlideView needs a pixel width up front (everything inside is absolutely
 * positioned at `emu * width / slideWidth`), so a CSS `w-full` on it only
 * stretches the frame and clips the contents. This measures the container and
 * hands the real width down instead.
 */
import { useEffect, useRef, useState } from 'react';
import type { DesignSystem, Slide } from '@/model';
import { SlideView } from './SlideView';

export function FitSlideView({
  slide,
  slideSize,
  designSystem,
}: {
  slide: Slide;
  slideSize: { w: number; h: number };
  designSystem: DesignSystem;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full" style={{ aspectRatio: `${slideSize.w} / ${slideSize.h}` }}>
      {width > 0 ? (
        <SlideView
          slide={slide}
          slideSize={slideSize}
          designSystem={designSystem}
          width={width}
        />
      ) : null}
    </div>
  );
}
