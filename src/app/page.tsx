import { SlideView } from '@/render/SlideView';
import { DEFAULT_DESIGN_SYSTEM } from '@/model';
import { SAMPLE_DECK } from '@/model/sample';

export default function Home() {
  const deck = SAMPLE_DECK;
  const ds = DEFAULT_DESIGN_SYSTEM;
  const slideWidth = 960;

  return (
    <div className="min-h-full bg-zinc-100 dark:bg-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">Devin Design</span>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800">
            renderer preview
          </span>
        </div>
        <span className="text-xs text-zinc-400">
          {ds.name} · v{ds.version}
        </span>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col items-center gap-8 py-10">
        {deck.slides.map((slide, i) => (
          <div key={slide.id} className="flex flex-col gap-2">
            <span className="text-xs text-zinc-400">Slide {i + 1}</span>
            <div className="shadow-lg ring-1 ring-black/5">
              <SlideView
                slide={slide}
                slideSize={deck.slideSize}
                designSystem={ds}
                width={slideWidth}
              />
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
