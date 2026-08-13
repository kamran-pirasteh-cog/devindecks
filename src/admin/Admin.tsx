'use client';

/**
 * Admin view — Kamran's control room. Three areas:
 *  - Design system: edit the brand palette + semantic type roles, with a live
 *    preview. Saving bumps the version; because decks reference tokens, the
 *    change reflows everywhere.
 *  - Layouts: the individual slide-layout library, bucketed by type (mirrors
 *    the RHS drawer's grouping). Build from scratch or upload a reference.
 *  - Artifacts: the shared asset library, browsed Drive-style by folder.
 *
 * In Playground this route gets gated to a template-admin Okta group.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ALLOWED_FONTS, type ColorToken, type DesignSystem, type FontFamily, type TypeRole } from '@/model';
import { FitSlideView } from '@/render/FitSlideView';
import { SlideView } from '@/render/SlideView';
import { SLIDE_LAYOUT_CATEGORIES, TEMPLATES, type SlideLayoutCategory } from '@/templates/registry';
import {
  createLayout,
  createLayoutFromImage,
  listLayouts,
  seedLayoutsIfFirstRun,
  type StoredLayout,
} from '@/templates/layoutRepository';
import { getActiveDesignSystem, resetDesignSystem, saveDesignSystem } from '@/design/repository';
import { Artifacts } from './Artifacts';
import { LayoutCard } from './LayoutCard';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };
const TYPE_ROLES: (keyof DesignSystem['type'])[] = [
  'title',
  'subtitle',
  'heading',
  'body',
  'caption',
  'kpiValue',
];

type Tab = 'design' | 'templates' | 'artifacts';

const TAB_LABELS: Record<Tab, string> = {
  design: 'Design system',
  templates: 'Layouts',
  artifacts: 'Artifacts',
};

function stripExt(filename: string): string {
  return filename.replace(/\.[^./]+$/, '');
}

export function Admin() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('design');
  const [ds, setDs] = useState<DesignSystem>(() => getActiveDesignSystem());
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [layouts, setLayouts] = useState<StoredLayout[]>([]);
  // null = album shelf; otherwise we're inside one slide-type album.
  const [album, setAlbum] = useState<SlideLayoutCategory | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    seedLayoutsIfFirstRun();
    setLayouts(listLayouts());
  }, []);

  const refreshLayouts = () => setLayouts(listLayouts());

  const buildLayout = (category: SlideLayoutCategory) => {
    const l = createLayout({ name: 'Untitled layout', category });
    router.push(`/admin/layouts/${l.id}`);
  };

  const uploadLayout = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const l = createLayoutFromImage(reader.result as string, stripExt(file.name));
      router.push(`/admin/layouts/${l.id}`);
    };
    reader.readAsDataURL(file);
  };

  const patch = (next: Partial<DesignSystem>) => {
    setDs((cur) => ({ ...cur, ...next }));
    setDirty(true);
  };

  const setColor = (i: number, next: Partial<ColorToken>) =>
    patch({ colors: ds.colors.map((c, idx) => (idx === i ? { ...c, ...next } : c)) });

  const addColor = () =>
    patch({
      colors: [...ds.colors, { id: `custom.${ds.colors.length + 1}`, name: 'New color', hex: '#888888' }],
    });

  const removeColor = (i: number) => patch({ colors: ds.colors.filter((_, idx) => idx !== i) });

  const setRole = (role: keyof DesignSystem['type'], next: Partial<TypeRole>) =>
    patch({ type: { ...ds.type, [role]: { ...ds.type[role], ...next } } });

  const save = () => {
    const next = saveDesignSystem(ds);
    setDs(next);
    setDirty(false);
    setSavedAt(next.updatedAt);
  };

  const reset = () => {
    const def = resetDesignSystem();
    setDs(def);
    setDirty(false);
    setSavedAt(null);
  };

  const previewSlides = TEMPLATES.find((t) => t.id === 'qbr')!.buildSlides();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/70">
        {/* Fixed height, not py-3: the bordered Reset button is 2px taller
            than the dashboard's New button, which would otherwise make this
            header taller than the one on /. */}
        <div className="flex h-13 items-center justify-between px-8">
          {/* Same brand block as the dashboard — the Artifacts/Layouts tabs
              already say where you are, so no "/ Admin" crumb. */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-70">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/devin-logo.svg" alt="" className="h-6 w-6 shrink-0 dark:invert" />
            <span className="text-xl font-semibold tracking-tight">Decks</span>
          </Link>
          {/* shrink-0 so a long design-system name can't squeeze the logo
              out of square when the window is narrow. */}
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-zinc-400">
            <span className="whitespace-nowrap">
              {ds.name} · v{ds.version}
            </span>
            <button
              onClick={reset}
              disabled={tab !== 'design'}
              className={`rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
                tab === 'design' ? '' : 'invisible'
              }`}
            >
              Reset
            </button>
            <button
              onClick={save}
              disabled={!dirty || tab !== 'design'}
              className={`rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black ${
                tab === 'design' ? '' : 'invisible'
              }`}
            >
              {dirty ? 'Save changes' : savedAt ? 'Saved' : 'Saved'}
            </button>
          </div>
        </div>
        <div className="flex gap-1 px-7">
          {(['design', 'templates', 'artifacts'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium ${
                tab === t
                  ? 'border-indigo-500 text-zinc-900 dark:text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </header>

      <main className="px-8 py-6">
        {tab === 'design' ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              {/* Colors */}
              <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Brand palette</h3>
                  <button
                    onClick={addColor}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    + Add color
                  </button>
                </div>
                <div className="space-y-2">
                  {ds.colors.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="color"
                        value={c.hex}
                        onChange={(e) => setColor(i, { hex: e.target.value })}
                        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-zinc-200 dark:border-zinc-700"
                      />
                      <input
                        value={c.name}
                        onChange={(e) => setColor(i, { name: e.target.value })}
                        className="w-40 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                      />
                      <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                        {c.id}
                      </code>
                      <input
                        value={c.hex}
                        onChange={(e) => setColor(i, { hex: e.target.value })}
                        className="w-24 rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800"
                      />
                      <button
                        onClick={() => removeColor(i)}
                        className="ml-auto h-6 w-6 rounded text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Type roles */}
              <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-3 text-sm font-semibold">Type roles</h3>
                <div className="space-y-2">
                  {TYPE_ROLES.map((role) => {
                    const r = ds.type[role];
                    return (
                      <div key={role} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 text-xs capitalize text-zinc-500">{role}</span>
                        <select
                          value={r.font}
                          onChange={(e) => setRole(role, { font: e.target.value as FontFamily })}
                          className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          {ALLOWED_FONTS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={r.sizePt}
                          onChange={(e) => setRole(role, { sizePt: parseFloat(e.target.value) })}
                          className="w-16 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                          title="Size (pt)"
                        />
                        <label className="flex items-center gap-1 text-xs text-zinc-500">
                          <input
                            type="checkbox"
                            checked={!!r.bold}
                            onChange={(e) => setRole(role, { bold: e.target.checked })}
                          />
                          Bold
                        </label>
                        <select
                          value={r.colorToken}
                          onChange={(e) => setRole(role, { colorToken: e.target.value })}
                          className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                          title="Color token"
                        >
                          {ds.colors.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Fonts (locked) */}
              <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-1 text-sm font-semibold">Fonts</h3>
                <p className="mb-3 text-[11px] text-zinc-400">
                  Locked to fonts that survive both PowerPoint and Google Slides.
                </p>
                <div className="flex gap-2">
                  {ALLOWED_FONTS.map((f) => (
                    <span
                      key={f}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </section>
            </div>

            {/* Live preview */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Live preview
              </h3>
              {previewSlides.map((slide, i) => (
                <div key={i} className="overflow-hidden rounded-lg shadow ring-1 ring-black/5">
                  <SlideView slide={slide} slideSize={SLIDE_SIZE} designSystem={ds} width={360} />
                </div>
              ))}
            </div>
          </div>
        ) : tab === 'templates' ? (
          <div>
            <div className="mb-4 flex items-center justify-between gap-4">
              {album ? (
                <div className="min-w-0">
                  <button
                    onClick={() => setAlbum(null)}
                    className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    ← All albums
                  </button>
                  <h2 className="mt-1 text-sm font-semibold">
                    {album}{' '}
                    <span className="font-normal text-zinc-400">
                      · {layouts.filter((l) => l.category === album).length}
                    </span>
                  </h2>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  Slide layouts are organized into albums by slide type. Open an album to browse
                  and edit its layouts, or create a new one from scratch or an uploaded reference.
                </p>
              )}
              <div className="flex shrink-0 gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={uploadLayout}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Upload to create layout
                </button>
                <button
                  onClick={() => buildLayout(album ?? 'Blank')}
                  className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
                >
                  + Build layout
                </button>
              </div>
            </div>
            {album ? (
              layouts.filter((l) => l.category === album).length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
                  No layouts in this album yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {layouts
                    .filter((l) => l.category === album)
                    .map((l) => (
                      <LayoutCard key={l.id} layout={l} designSystem={ds} onChange={refreshLayouts} />
                    ))}
                </div>
              )
            ) : (
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
                {SLIDE_LAYOUT_CATEGORIES.map((category) => (
                  <AlbumCard
                    key={category}
                    category={category}
                    layouts={layouts.filter((l) => l.category === category)}
                    designSystem={ds}
                    onOpen={() => setAlbum(category)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <Artifacts />
        )}
      </main>
    </div>
  );
}

/**
 * One slide-type album on the Layouts shelf. The cover is the album's first
 * layout with two stacked "cards" peeking out behind it, so a full album reads
 * as a stack at a glance; empty albums show a dashed placeholder instead.
 */
function AlbumCard({
  category,
  layouts,
  designSystem,
  onOpen,
}: {
  category: SlideLayoutCategory;
  layouts: StoredLayout[];
  designSystem: DesignSystem;
  onOpen: () => void;
}) {
  const cover = layouts[0];
  return (
    <button onClick={onOpen} className="group block w-full text-left">
      <div className="relative pt-2">
        {layouts.length > 2 ? (
          <div className="absolute inset-x-4 top-0 h-3 rounded-t-md border border-b-0 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
        ) : null}
        {layouts.length > 1 ? (
          <div className="absolute inset-x-2 top-1 h-3 rounded-t-md border border-b-0 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
        ) : null}
        <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
          {cover ? (
            <FitSlideView slide={cover.slide} slideSize={SLIDE_SIZE} designSystem={designSystem} />
          ) : (
            <div
              className="flex items-center justify-center text-xs text-zinc-300 dark:text-zinc-600"
              style={{ aspectRatio: `${SLIDE_SIZE.w} / ${SLIDE_SIZE.h}` }}
            >
              Empty
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <div className="truncate text-sm font-medium">{category}</div>
        <div className="text-[11px] text-zinc-400">
          {layouts.length} {layouts.length === 1 ? 'layout' : 'layouts'}
        </div>
      </div>
    </button>
  );
}
