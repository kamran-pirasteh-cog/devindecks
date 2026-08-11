'use client';

/** Shared slide thumbnail — renders through SlideView so it matches the editor. */
import { SlideView } from '@/render/SlideView';
import { DEFAULT_DESIGN_SYSTEM, type Deck } from '@/model';

const ds = DEFAULT_DESIGN_SYSTEM;

export function Thumb({
  deck,
  width = 320,
}: {
  deck: { slides: Deck['slides']; slideSize: Deck['slideSize'] };
  width?: number;
}) {
  const slide = deck.slides[0];
  if (!slide) {
    return <div style={{ width, height: (width * 9) / 16 }} className="bg-white" />;
  }
  return <SlideView slide={slide} slideSize={deck.slideSize} designSystem={ds} width={width} />;
}
