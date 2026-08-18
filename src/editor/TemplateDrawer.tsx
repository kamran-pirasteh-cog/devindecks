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
import { SLIDE_LAYOUT_CATEGORIES, type SlideLayoutCategory } from '@/templates/registry';
import {
  getLayoutSlide,
  listLayouts,
  seedLayoutsIfFirstRun,
  type StoredLayout,
} from '@/templates/layoutRepository';
import {
  ARTIFACT_FOLDERS,
  countByFolder,
  listArtifacts,
  type ArtifactFolderId,
  type StoredArtifact,
} from '@/artifacts/repository';
import { useEditor } from '@/store/editorStore';
import { Thumb } from '@/home/Thumb';
import { makePicture } from './factories';
import { useResizableWidth } from './useResizableWidth';
import { ResizeHandle } from './ResizeHandle';

type Tab = 'templates' | 'loops' | 'artifacts';

/**
 * The asset library, browsed the same way Admin browses it — folders, drilled
 * into one level — but read-only: uploading and organizing stay in Admin so
 * there's one place the shared set is curated. Clicking a tile drops the
 * picture onto the current slide.
 */
function ArtifactPanel() {
  const [openId, setOpenId] = useState<ArtifactFolderId | null>(null);
  const [items, setItems] = useState<StoredArtifact[]>([]);
  const [counts, setCounts] = useState<Record<ArtifactFolderId, number> | null>(null);
  const slideSize = useEditor((s) => s.deck.slideSize);
  const addElement = useEditor((s) => s.addElement);

  // Reads localStorage, so it has to wait for the client — and re-runs on every
  // drill-in, which is also what picks up an upload made in Admin since.
  useEffect(() => {
    setCounts(countByFolder());
    setItems(openId ? listArtifacts(openId) : []);
  }, [openId]);

  const open = ARTIFACT_FOLDERS.find((f) => f.id === openId) ?? null;

  // Transparent PNGs and SVGs are the norm here, and both vanish against a
  // plain tile — same checkerboard as the Admin grid.
  const checkerboard = {
    backgroundImage:
      'linear-gradient(45deg, rgba(120,120,128,.14) 25%, transparent 25% 75%, rgba(120,120,128,.14) 75%), linear-gradient(45deg, rgba(120,120,128,.14) 25%, transparent 25% 75%, rgba(120,120,128,.14) 75%)',
    backgroundSize: '10px 10px',
    backgroundPosition: '0 0, 5px 5px',
  };

  if (open && openId) {
    return (
      <div className="flex-1 overflow-y-auto p-3">
        <button
          onClick={() => setOpenId(null)}
          className="mb-2 flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ‹ {open.name}
        </button>
        {items.length ? (
          <div className="grid grid-cols-2 gap-2">
            {items.map((a) => (
              <button
                key={a.id}
                onClick={() => addElement(makePicture(a.src, a, slideSize))}
                title={`Insert ${a.name}`}
                className="overflow-hidden rounded-md border border-zinc-200 bg-white p-1 text-left transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div
                  className="flex aspect-[4/3] items-center justify-center rounded-sm"
                  style={checkerboard}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.src}
                    alt={a.name}
                    className="max-h-full max-w-full object-contain p-1"
                  />
                </div>
                <div className="mt-1 truncate text-[10px] text-zinc-600 dark:text-zinc-300">
                  {a.name}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="pt-1 text-center text-[10px] text-zinc-400">
            This folder is empty. Add artifacts from Admin → Artifacts.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
      {ARTIFACT_FOLDERS.map((folder) => (
        <button
          key={folder.id}
          onClick={() => setOpenId(folder.id)}
          className="flex w-full items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5 shrink-0 text-zinc-400">
            <path
              fill="currentColor"
              d="M4 5h5.2l1.6 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
            />
          </svg>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">{folder.name}</span>
            <span className="block text-[10px] text-zinc-400">
              {counts ? `${counts[folder.id]} ${counts[folder.id] === 1 ? 'item' : 'items'}` : '—'}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function TemplateDrawer() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('templates');
  const [layouts, setLayouts] = useState<StoredLayout[]>([]);
  /** null = folder list; otherwise the folder whose layouts are shown. */
  const [folder, setFolder] = useState<SlideLayoutCategory | null>(null);
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
    { id: 'loops', label: 'Loops' },
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
          folder === null ? (
            <div className="flex-1 overflow-y-auto p-2">
              {SLIDE_LAYOUT_CATEGORIES.map((category) => {
                const count = layouts.filter((l) => l.category === category).length;
                return (
                  <button
                    key={category}
                    onClick={() => setFolder(category)}
                    title={`Open ${category}`}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="shrink-0 text-zinc-400">🗀</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{category}</span>
                    <span className="shrink-0 text-[10px] text-zinc-400">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              <button
                onClick={() => setFolder(null)}
                className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 px-3 py-2 text-left text-xs text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200"
              >
                <span>←</span>
                <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-100">
                  {folder}
                </span>
              </button>
              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {layouts
                  .filter((l) => l.category === folder)
                  .map((l) => (
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
                {layouts.filter((l) => l.category === folder).length === 0 ? (
                  <div className="pt-1 text-center text-[10px] text-zinc-400">
                    No layouts in this folder yet. Add some from Admin → Layouts.
                  </div>
                ) : null}
              </div>
            </div>
          )
        ) : tab === 'loops' ? (
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
            <div className="rounded-lg bg-zinc-100 p-3 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
              Reusable multi-slide sequences you can drop into a deck as a set.
              <div className="mt-2 text-[11px] text-zinc-400">(Coming soon.)</div>
            </div>
          </div>
        ) : (
          <ArtifactPanel />
        )}
      </div>

    </div>
  );
}
