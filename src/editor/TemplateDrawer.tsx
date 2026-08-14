'use client';

/**
 * RHS drawer: the slide-layout library and the shared asset library.
 * Collapsed by default. Layouts insert a single slide right after the current
 * one via the same command layer as everything else in the editor.
 *
 * Charts are NOT here: inserting one is the same kind of act as adding a shape
 * or a text box, so it lives on the toolbar (see `ChartPopover`) rather than
 * behind a panel that made it feel like a separate mode.
 */
import { useEffect, useState } from 'react';
import { SLIDE_LAYOUT_CATEGORIES } from '@/templates/registry';
import {
  getLayoutSlide,
  listLayouts,
  seedLayoutsIfFirstRun,
  type StoredLayout,
} from '@/templates/layoutRepository';
import { useEditor } from '@/store/editorStore';
import { Thumb } from '@/home/Thumb';
import { useResizableWidth } from './useResizableWidth';
import { ResizeHandle } from './ResizeHandle';

type Tab = 'templates' | 'artifacts';

export function TemplateDrawer() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('templates');
  const [layouts, setLayouts] = useState<StoredLayout[]>([]);
  const slideSize = useEditor((s) => s.deck.slideSize);
  const insertSlides = useEditor((s) => s.insertSlides);
  const { width, startDrag } = useResizableWidth(220, 200, 400, 'left');
  // Drawer padding (p-3 = 12px/side) + card border (1px/side).
  const thumbWidth = width - 26;

  useEffect(() => {
    seedLayoutsIfFirstRun();
    setLayouts(listLayouts());
  }, []);

  if (!open) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-l border-zinc-200 bg-white py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
        <button
          onClick={() => setOpen(true)}
          title="Layouts & artifacts"
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ▦
        </button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'templates', label: 'Layouts' },
    { id: 'artifacts', label: 'Artifacts' },
  ];

  return (
    <div className="flex h-full shrink-0">
      <ResizeHandle onPointerDown={startDrag} />
      <div
        style={{ width }}
        className="flex h-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center border-b border-zinc-200 pl-1 pr-2 dark:border-zinc-800">
          <div className="flex flex-1 gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-2 py-2.5 text-xs font-medium ${
                  tab === t.id
                    ? 'border-indigo-500 text-zinc-900 dark:text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setOpen(false)}
            title="Collapse"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            »
          </button>
        </div>

        {tab === 'templates' ? (
          <div className="flex-1 space-y-5 overflow-y-auto p-3">
            {SLIDE_LAYOUT_CATEGORIES.map((category) => {
              const inCategory = layouts.filter((l) => l.category === category);
              if (!inCategory.length) return null;
              return (
                <div key={category}>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {category}
                  </div>
                  <div className="space-y-3">
                    {inCategory.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => {
                          const slide = getLayoutSlide(l.id);
                          if (slide) insertSlides([slide]);
                        }}
                        title={`Insert "${l.name}" slide`}
                        className="group block w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <div className="border-b border-zinc-100 dark:border-zinc-800">
                          <Thumb deck={{ slides: [l.slide], slideSize }} width={thumbWidth} />
                        </div>
                        <div className="px-2 py-1.5">
                          <div className="truncate text-xs font-medium">{l.name}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {layouts.length === 0 ? (
              <div className="pt-1 text-center text-[10px] text-zinc-400">
                No layouts yet. Create some from Admin → Layouts.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
            <div className="rounded-lg bg-zinc-100 p-3 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
              A shared library of images and icons, organized into folders.
              Assets are uploaded and organized centrally from Admin — everyone
              picks from the same set here.
              <div className="mt-2 text-[11px] text-zinc-400">(Coming soon.)</div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
