'use client';

/**
 * RHS drawer: slide-layout library, chart layouts, and the shared asset
 * library. Collapsed by default. Templates insert a single slide right after
 * the current one via the same command layer as everything else in the
 * editor, bucketed by layout. Charts open the ChartEditorModal for data/design
 * before inserting; hovering a chart card reveals an arrow to start it
 * horizontal instead of vertical.
 */
import { useEffect, useState } from 'react';
import { SLIDE_LAYOUT_CATEGORIES } from '@/templates/registry';
import {
  getLayoutSlide,
  listLayouts,
  seedLayoutsIfFirstRun,
  type StoredLayout,
} from '@/templates/layoutRepository';
import {
  buildChartElements,
  buildChartSlide,
  CHART_TYPES,
  defaultChartConfig,
  type ChartTypeDef,
} from '@/templates/charts';
import type { ChartOrientation, ChartType, SlideChartConfig } from '@/model';
import { useEditor } from '@/store/editorStore';
import { Thumb } from '@/home/Thumb';
import { useResizableWidth } from './useResizableWidth';
import { ResizeHandle } from './ResizeHandle';
import { ChartEditorModal } from './ChartEditorModal';

type Tab = 'templates' | 'charts' | 'artifacts';
type SlideSize = { w: number; h: number };

function ChartOption({
  type,
  slideSize,
  thumbWidth,
  onOpen,
}: {
  type: ChartTypeDef;
  slideSize: SlideSize;
  thumbWidth: number;
  onOpen: (id: ChartType, orientation: ChartOrientation) => void;
}) {
  const preview = { id: 'preview', elements: buildChartElements(defaultChartConfig(type.id, 'vertical')) };
  return (
    <div className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={() => onOpen(type.id, 'vertical')}
        title={`Customize "${type.name}"`}
        className="block w-full text-left"
      >
        <div className="border-b border-zinc-100 dark:border-zinc-800">
          <Thumb deck={{ slides: [preview], slideSize }} width={thumbWidth} />
        </div>
        <div className="px-2 py-1.5">
          <div className="truncate text-xs font-medium">{type.name}</div>
        </div>
      </button>

      {type.orientable ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen(type.id, 'horizontal');
          }}
          title={`Customize "${type.name}" (horizontal)`}
          className="absolute right-1.5 top-[40%] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 opacity-0 shadow-sm transition group-hover:opacity-100 hover:bg-indigo-50 hover:text-indigo-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-indigo-950"
        >
          →
        </button>
      ) : null}
    </div>
  );
}

export function TemplateDrawer() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('templates');
  const [chartModal, setChartModal] = useState<SlideChartConfig | null>(null);
  const [layouts, setLayouts] = useState<StoredLayout[]>([]);
  const slideSize = useEditor((s) => s.deck.slideSize);
  const insertSlides = useEditor((s) => s.insertSlides);
  const ds = useEditor((s) => s.designSystem);
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
          title="Layouts, charts & artifacts"
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ▦
        </button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'templates', label: 'Layouts' },
    { id: 'charts', label: 'Charts' },
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
        ) : tab === 'charts' ? (
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {CHART_TYPES.map((c) => (
              <ChartOption
                key={c.id}
                type={c}
                slideSize={slideSize}
                thumbWidth={thumbWidth}
                onOpen={(id, orientation) => setChartModal(defaultChartConfig(id, orientation))}
              />
            ))}
            <div className="pt-1 text-center text-[10px] text-zinc-400">
              Hover a chart, then click → to start it horizontal.
            </div>
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

      {chartModal ? (
        <ChartEditorModal
          initial={chartModal}
          ds={ds}
          saveLabel="Insert chart"
          onCancel={() => setChartModal(null)}
          onSave={(config) => {
            insertSlides([buildChartSlide(config)]);
            setChartModal(null);
          }}
        />
      ) : null}
    </div>
  );
}
