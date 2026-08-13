'use client';

/** Shared slide thumbnail — renders through SlideView so it matches the editor. */
import { SlideView } from '@/render/SlideView';
import { type Deck } from '@/model';
import { getActiveDesignSystem } from '@/design/repository';

export function Thumb({
  deck,
  width = 320,
}: {
  deck: {
    slides: Deck['slides'];
    slideSize: Deck['slideSize'];
    pageNumbers?: Deck['pageNumbers'];
  };
  width?: number;
}) {
  const ds = getActiveDesignSystem();
  const slide = deck.slides[0];
  if (!slide) {
    return <div style={{ width, height: (width * 9) / 16 }} className="bg-white" />;
  }
  return (
    <SlideView
      slide={slide}
      slideSize={deck.slideSize}
      designSystem={ds}
      width={width}
      page={deck.pageNumbers ? { index: 0, count: deck.slides.length } : undefined}
    />
  );
}
