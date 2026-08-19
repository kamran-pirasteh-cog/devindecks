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
import {
  ALLOWED_FONTS,
  EMU_PER_INCH,
  EMU_PER_POINT,
  FONTS,
  inchesToEmu,
  pageNumberInk,
  pageNumberLabel,
  type ColorToken,
  type DesignSystem,
  type FontFamily,
  type PageNumberPosition,
  type PageNumberStyle,
  type TypeRole,
} from '@/model';
import { FitSlideView } from '@/render/FitSlideView';
import { CATEGORY_BLURBS, type SlideLayoutCategory } from '@/templates/registry';
import {
  addCustomFolder,
  createLayout,
  createLayoutFromImage,
  listFolders,
  listLayouts,
  seedLayoutsIfFirstRun,
  type StoredLayout,
} from '@/templates/layoutRepository';
import { getActiveDesignSystem, resetDesignSystem, saveDesignSystem } from '@/design/repository';
import { PrimaryTabs, SubTabs } from '@/nav/PrimaryTabs';
import { ChartStyleSection } from './ChartStyleSection';
import { ChartTemplates } from './ChartTemplates';
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

type Tab = 'design' | 'charts' | 'templates' | 'artifacts';

const ADMIN_TABS: Tab[] = ['design', 'charts', 'templates', 'artifacts'];

const TAB_LABELS: Record<Tab, string> = {
  design: 'Design system',
  charts: 'Charts',
  templates: 'Layouts',
  artifacts: 'Artifacts',
};

/**
 * Tabs whose contents are part of the design system's own dirty/save cycle.
 * The chart style lives on `DesignSystem`, so its tab shares the header's Save
 * — the template library below it auto-persists, exactly like Layouts.
 */
const SAVEABLE_TABS: Tab[] = ['design', 'charts'];

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
  const [folders, setFolders] = useState<string[]>([]);
  // null = album shelf; otherwise we're inside one album.
  const [album, setAlbum] = useState<string | null>(null);
  // Non-empty search takes over the shelf: albums first, then single layouts.
  const [layoutQuery, setLayoutQuery] = useState('');
  // A new layout has to land somewhere, so both entry points ask for a folder
  // first; the file dialog only opens once "upload" has one.
  const [pendingNew, setPendingNew] = useState<'build' | 'upload' | null>(null);
  const [uploadFolder, setUploadFolder] = useState<string | null>(null);
  // Palette drag-to-reorder. `armed` gates `draggable` on the row so the name
  // and hex inputs keep normal text selection until the grip is pressed.
  const [colorDragArmed, setColorDragArmed] = useState<number | null>(null);
  const [colorDragFrom, setColorDragFrom] = useState<number | null>(null);
  const [colorDragOver, setColorDragOver] = useState<{ index: number; after: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    seedLayoutsIfFirstRun();
    setLayouts(listLayouts());
    setFolders(listFolders());
  }, []);

  const refreshLayouts = () => {
    setLayouts(listLayouts());
    setFolders(listFolders());
  };

  /** Folder chosen in the picker: build opens the editor, upload the file dialog. */
  const startInFolder = (category: string) => {
    const action = pendingNew;
    setPendingNew(null);
    if (action === 'build') {
      const l = createLayout({ name: 'Untitled layout', category });
      router.push(`/admin/layouts/${l.id}`);
    } else if (action === 'upload') {
      setUploadFolder(category);
      fileInputRef.current?.click();
    }
  };

  const uploadLayout = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const category = uploadFolder;
    setUploadFolder(null);
    if (!file || !category) return;
    const reader = new FileReader();
    reader.onload = () => {
      const l = createLayoutFromImage(reader.result as string, stripExt(file.name), category);
      router.push(`/admin/layouts/${l.id}`);
    };
    reader.readAsDataURL(file);
  };

  // Search spans the whole library, so it overrides whichever album is open.
  const q = layoutQuery.trim().toLowerCase();
  const searching = q.length > 0;
  const matchedFolders = searching ? folders.filter((f) => f.toLowerCase().includes(q)) : [];
  const matchedLayouts = searching
    ? layouts.filter((l) => l.name.toLowerCase().includes(q))
    : [];

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

  /**
   * Palette order is meaningful: every swatch row in the editor renders
   * `ds.colors` in array order (and some, like the chart part menu, only show
   * the first few), so dragging a colour up here promotes it everywhere.
   */
  const moveColor = (from: number, to: number) => {
    if (from === to) return;
    const next = ds.colors.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    patch({ colors: next });
  };

  const setRole = (role: keyof DesignSystem['type'], next: Partial<TypeRole>) =>
    patch({ type: { ...ds.type, [role]: { ...ds.type[role], ...next } } });

  const setPageNumbers = (next: Partial<PageNumberStyle>) =>
    patch({ pageNumbers: { ...ds.pageNumbers, ...next } });

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
              disabled={!SAVEABLE_TABS.includes(tab)}
              className={`rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
                SAVEABLE_TABS.includes(tab) ? '' : 'invisible'
              }`}
            >
              Reset
            </button>
            <button
              onClick={save}
              disabled={!dirty || !SAVEABLE_TABS.includes(tab)}
              className={`rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black ${
                SAVEABLE_TABS.includes(tab) ? '' : 'invisible'
              }`}
            >
              {dirty ? 'Save changes' : savedAt ? 'Saved' : 'Saved'}
            </button>
          </div>
        </div>
        {/* The app's tabs stay put, with Admin marked active; Admin's own areas
            hang off it as a second row instead of replacing the strip. */}
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <PrimaryTabs active="admin" />
        </div>
        <SubTabs
          tabs={ADMIN_TABS.map((t) => ({ value: t, label: TAB_LABELS[t] }))}
          active={tab}
          onSelect={setTab}
        />
      </header>

      <main className="px-8 py-6">
        {tab === 'design' ? (
          <div>
            <div className="space-y-6">
              {/* Colors */}
              <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">Brand palette</h3>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                      Elements reference these by token id, so editing a hex here
                      recolours every deck at once. Drag a row to reorder — this
                      order is the order swatches appear in the editor.
                    </p>
                  </div>
                  <button
                    onClick={addColor}
                    className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    + Add color
                  </button>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {ds.colors.map((c, i) => (
                    <div
                      key={i}
                      className={`relative flex items-center gap-3 py-2 first:pt-0 last:pb-0 ${
                        colorDragFrom === i ? 'opacity-40' : ''
                      }`}
                      draggable={colorDragArmed === i}
                      onDragStart={(e) => {
                        setColorDragFrom(i);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', c.id);
                      }}
                      onDragEnd={() => {
                        setColorDragArmed(null);
                        setColorDragFrom(null);
                        setColorDragOver(null);
                      }}
                      onDragOver={(e) => {
                        if (colorDragFrom === null || colorDragFrom === i) return;
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColorDragOver({
                          index: i,
                          after: e.clientY - rect.top > rect.height / 2,
                        });
                      }}
                      onDragLeave={() => {
                        setColorDragOver((cur) => (cur?.index === i ? null : cur));
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (colorDragFrom !== null && colorDragOver) {
                          // Splice-out shifts everything after `from` down one,
                          // so an insert point past it loses an index.
                          const raw = colorDragOver.index + (colorDragOver.after ? 1 : 0);
                          moveColor(colorDragFrom, raw > colorDragFrom ? raw - 1 : raw);
                        }
                        setColorDragArmed(null);
                        setColorDragFrom(null);
                        setColorDragOver(null);
                      }}
                    >
                      {colorDragOver?.index === i ? (
                        <div
                          className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-indigo-500 ${
                            colorDragOver.after ? 'bottom-0' : 'top-0'
                          }`}
                        />
                      ) : null}
                      {/* Grip, not a whole-row drag target: the row is mostly
                          inputs, and making those draggable kills click-to-place
                          the caret and drag-to-select inside them. */}
                      <button
                        onPointerDown={() => setColorDragArmed(i)}
                        onPointerUp={() => setColorDragArmed(null)}
                        aria-label={`Reorder ${c.name}`}
                        title="Drag to reorder"
                        className="grid size-5 shrink-0 cursor-grab place-items-center text-zinc-300 hover:text-zinc-500 active:cursor-grabbing dark:text-zinc-600 dark:hover:text-zinc-400"
                      >
                        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
                          <g fill="currentColor">
                            {[2, 7, 12].map((y) =>
                              [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />),
                            )}
                          </g>
                        </svg>
                      </button>
                      {/* Square, not a pill: a swatch reads as the flat fill it
                          will become on a slide, and rounded corners next to a
                          rounded input made both look like buttons. */}
                      <input
                        type="color"
                        value={c.hex}
                        onChange={(e) => setColor(i, { hex: e.target.value })}
                        aria-label={`${c.name} hex`}
                        className="size-9 shrink-0 cursor-pointer rounded-none border border-zinc-200 p-0 dark:border-zinc-700"
                      />
                      <input
                        value={c.name}
                        onChange={(e) => setColor(i, { name: e.target.value })}
                        aria-label="Color name"
                        className="w-40 shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                      />
                      <input
                        value={c.hex}
                        onChange={(e) => setColor(i, { hex: e.target.value })}
                        aria-label="Hex"
                        className="w-24 shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-xs uppercase dark:border-zinc-700 dark:bg-zinc-800"
                      />
                      <code className="truncate font-mono text-[11px] text-zinc-400">{c.id}</code>
                      <button
                        onClick={() => removeColor(i)}
                        className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Type roles */}
              <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="text-sm font-semibold">Type roles</h3>
                <p className="mt-0.5 mb-4 text-[11px] leading-relaxed text-zinc-500">
                  What every template and default resolves through. Each row is
                  set in its own role, so the sample is the actual output.
                </p>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {TYPE_ROLES.map((role) => (
                    <TypeRoleRow
                      key={role}
                      role={role}
                      style={ds.type[role]}
                      colors={ds.colors}
                      onChange={(next) => setRole(role, next)}
                    />
                  ))}
                </div>
              </section>

              {/* Page numbers */}
              <PageNumbersSection style={ds.pageNumbers} onChange={setPageNumbers} />
            </div>
          </div>
        ) : tab === 'charts' ? (
          <div className="space-y-6">
            <ChartStyleSection ds={ds} onChange={(chart) => patch({ chart })} />
            <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="mb-1 text-sm font-semibold">Chart templates</h3>
              <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
                Named archetypes authors drop in and repoint at their own data —
                chart type, axes, formats and research framing already set.
                Saved as you go.
              </p>
              <ChartTemplates ds={ds} />
            </section>
          </div>
        ) : tab === 'templates' ? (
          <div>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <input
                  value={layoutQuery}
                  onChange={(e) => setLayoutQuery(e.target.value)}
                  placeholder="Search albums and layouts"
                  className="w-full max-w-sm rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                />
                {album && !searching ? (
                  <div className="mt-2">
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
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={uploadLayout}
                  className="hidden"
                />
                <button
                  onClick={() => setPendingNew('upload')}
                  className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Upload to create layout
                </button>
                <button
                  onClick={() => setPendingNew('build')}
                  className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
                >
                  + Build layout
                </button>
              </div>
            </div>
            {searching ? (
              /* Albums first, then the individual layouts, so a family match
                 never gets buried under the layouts inside it. */
              <div className="space-y-6">
                {matchedFolders.length ? (
                  <section>
                    <h3 className="mb-2 text-[11px] uppercase tracking-wide text-zinc-400">
                      Albums · {matchedFolders.length}
                    </h3>
                    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
                      {matchedFolders.map((category) => (
                        <AlbumCard
                          key={category}
                          category={category}
                          layouts={layouts.filter((l) => l.category === category)}
                          designSystem={ds}
                          onOpen={() => {
                            setLayoutQuery('');
                            setAlbum(category);
                          }}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                {matchedLayouts.length ? (
                  <section>
                    <h3 className="mb-2 text-[11px] uppercase tracking-wide text-zinc-400">
                      Layouts · {matchedLayouts.length}
                    </h3>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {matchedLayouts.map((l) => (
                        <LayoutCard
                          key={l.id}
                          layout={l}
                          designSystem={ds}
                          onChange={refreshLayouts}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                {!matchedFolders.length && !matchedLayouts.length ? (
                  <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
                    Nothing matches “{layoutQuery.trim()}”.
                  </div>
                ) : null}
              </div>
            ) : album ? (
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
                {folders.map((category) => (
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
            {pendingNew ? (
              <FolderPickerModal
                title={pendingNew === 'build' ? 'Build layout in…' : 'Upload layout into…'}
                folders={folders}
                counts={layouts}
                initial={album}
                onCancel={() => setPendingNew(null)}
                onPick={startInFolder}
                onCreate={(name) => {
                  const created = addCustomFolder(name);
                  if (created) setFolders(listFolders());
                  return created;
                }}
              />
            ) : null}
          </div>
        ) : (
          <Artifacts />
        )}
      </main>
    </div>
  );
}

/**
 * The line each role is shown with. Real sentences, not "Aa" or the role name:
 * a title's job is to hold a real headline at a real length, and a 26pt vs 30pt
 * decision is only visible in copy that behaves like the copy authors type.
 */
const ROLE_SAMPLES: Record<keyof DesignSystem['type'], string> = {
  title: 'Quarterly Business Review',
  subtitle: 'FY26 Q2 · Prepared for the board',
  heading: 'Where things stand',
  body: 'Enterprise renewals carried the quarter, with net revenue retention at 118%.',
  caption: 'Source: internal finance data, as of Aug 2026',
  kpiValue: '118%',
};

const ROLE_LABELS: Record<keyof DesignSystem['type'], string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  heading: 'Heading',
  body: 'Body',
  caption: 'Caption',
  kpiValue: 'KPI value',
};

/**
 * Slide points shown as CSS pixels at slightly under 1:1. Not the real
 * renderer's scale — a 48pt KPI at true size would blow the row apart — but a
 * single shared factor, so the roles stay in the same proportion to each other
 * as they will be on the slide.
 */
const SAMPLE_PX_PER_PT = 0.82;

/** One type role: the sample it produces, then the knobs that shape it. */
function TypeRoleRow({
  role,
  style,
  colors,
  onChange,
}: {
  role: keyof DesignSystem['type'];
  style: TypeRole;
  colors: ColorToken[];
  onChange: (next: Partial<TypeRole>) => void;
}) {
  const font = FONTS[style.font];
  const hex = colors.find((c) => c.id === style.colorToken)?.hex ?? '#000000';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          {ROLE_LABELS[role]}
        </div>
        {/* Set in the role itself, on a white ground: these colours are picked
            against slides, so previewing them on the app's dark chrome would
            lie about contrast. */}
        <div className="mt-1 overflow-hidden rounded-md bg-white px-3 py-2 ring-1 ring-zinc-100 dark:ring-zinc-800">
          <div
            className="truncate"
            style={{
              fontFamily: font.cssStack,
              fontSize: style.sizePt * SAMPLE_PX_PER_PT,
              lineHeight: font.singleLineFactor,
              fontWeight: style.bold ? 700 : 400,
              color: hex,
            }}
          >
            {ROLE_SAMPLES[role]}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <select
          value={style.font}
          onChange={(e) => onChange({ font: e.target.value as FontFamily })}
          aria-label="Font"
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
        >
          {ALLOWED_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-zinc-500">
          <input
            type="number"
            value={style.sizePt}
            onChange={(e) => onChange({ sizePt: parseFloat(e.target.value) })}
            className="w-16 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          />
          pt
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={!!style.bold}
            onChange={(e) => onChange({ bold: e.target.checked })}
          />
          Bold
        </label>
        <select
          value={style.colorToken}
          onChange={(e) => onChange({ colorToken: e.target.value })}
          aria-label="Color token"
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
        >
          {colors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span
          className="size-5 shrink-0 border border-zinc-200 dark:border-zinc-700"
          style={{ background: hex }}
          title={hex}
        />
      </div>
    </div>
  );
}

const POSITIONS: { value: PageNumberPosition; label: string }[] = [
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
];

const FORMATS: { value: string; label: string }[] = [
  { value: '{n}', label: '7' },
  { value: 'Page {n}', label: 'Page 7' },
  { value: '{n} / {total}', label: '7 / 12' },
  { value: '{n} of {total}', label: '7 of 12' },
];

/**
 * The brand's page-number rule. It lives in the design system, not on a deck:
 * a deck only decides WHETHER it shows numbers (the toolbar's # button), while
 * where they sit, what they say and what ink they take is brand truth, so
 * editing it here re-flows every deck at once.
 */
function PageNumbersSection({
  style,
  onChange,
}: {
  style: PageNumberStyle;
  onChange: (next: Partial<PageNumberStyle>) => void;
}) {
  const inches = (emu: number) => Math.round((emu / EMU_PER_INCH) * 100) / 100;
  const field =
    'rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800';

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Page numbers</h3>
        <span className="text-[11px] text-zinc-400">
          Turned on per deck from the editor toolbar
        </span>
      </div>
      <p className="mb-3 text-[11px] text-zinc-400">
        Numbers are drawn from each slide&rsquo;s position, so decks renumber themselves as
        slides are added, removed or reordered.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={style.font}
          onChange={(e) => onChange({ font: e.target.value as FontFamily })}
          className={field}
          title="Font"
        >
          {ALLOWED_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={style.sizePt}
          onChange={(e) => onChange({ sizePt: parseFloat(e.target.value) || 1 })}
          className={`w-16 ${field}`}
          title="Size (pt)"
        />
        <label className="flex items-center gap-1 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={!!style.bold}
            onChange={(e) => onChange({ bold: e.target.checked })}
          />
          Bold
        </label>
        <select
          value={style.position}
          onChange={(e) => onChange({ position: e.target.value as PageNumberPosition })}
          className={field}
          title="Position"
        >
          {POSITIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={style.format}
          onChange={(e) => onChange({ format: e.target.value })}
          className={field}
          title="Format"
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={style.skipFirst}
            onChange={(e) => onChange({ skipFirst: e.target.checked })}
          />
          Skip title slide
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          Side margin
          <input
            type="number"
            step={0.05}
            value={inches(style.marginXEmu)}
            onChange={(e) => onChange({ marginXEmu: inchesToEmu(parseFloat(e.target.value) || 0) })}
            className={`w-16 ${field}`}
          />
          in
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          Bottom margin
          <input
            type="number"
            step={0.05}
            value={inches(style.marginYEmu)}
            onChange={(e) => onChange({ marginYEmu: inchesToEmu(parseFloat(e.target.value) || 0) })}
            className={`w-16 ${field}`}
          />
          in
        </label>
        {/* Two inks, picked per slide from its own background — that's why this
            is a pair rather than one color token. */}
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          On light
          <input
            type="color"
            value={style.onLightHex}
            onChange={(e) => onChange({ onLightHex: e.target.value })}
            className="h-7 w-7 cursor-pointer rounded border border-zinc-200 dark:border-zinc-700"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          On dark
          <input
            type="color"
            value={style.onDarkHex}
            onChange={(e) => onChange({ onDarkHex: e.target.value })}
            className="h-7 w-7 cursor-pointer rounded border border-zinc-200 dark:border-zinc-700"
          />
        </label>
      </div>

      {/* Both cases side by side: the same slide on white and on near-black. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {['#FFFFFF', '#0A0A0A'].map((bg) => (
          <PageNumberPreview key={bg} style={style} backgroundHex={bg} />
        ))}
      </div>
    </section>
  );
}

/** A miniature slide corner showing where the number lands and in which ink. */
function PageNumberPreview({
  style,
  backgroundHex,
}: {
  style: PageNumberStyle;
  backgroundHex: string;
}) {
  const label = pageNumberLabel({ ...style, skipFirst: false }, 6, 12);
  const justify =
    style.position === 'bottom-center'
      ? 'center'
      : style.position === 'bottom-left'
        ? 'flex-start'
        : 'flex-end';
  // 16:9 at a fixed 240px-wide mental slide, so the inset and type size shrink
  // in the same proportion the real renderer uses.
  const scale = 240 / SLIDE_SIZE.w;
  return (
    <div
      className="flex overflow-hidden rounded border border-zinc-200 dark:border-zinc-700"
      style={{
        background: backgroundHex,
        aspectRatio: `${SLIDE_SIZE.w} / ${SLIDE_SIZE.h}`,
        alignItems: 'flex-end',
        justifyContent: justify,
        padding: `0 ${style.marginXEmu * scale}px ${style.marginYEmu * scale}px`,
      }}
    >
      <span
        style={{
          fontFamily: FONTS[style.font].cssStack,
          fontSize: Math.max(7, style.sizePt * EMU_PER_POINT * scale),
          lineHeight: FONTS[style.font].singleLineFactor,
          fontWeight: style.bold ? 700 : 400,
          color: pageNumberInk(style, backgroundHex),
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * One slide-type album on the Layouts shelf. The cover is a 2x2 mosaic of the
 * album's first four layouts — the remaining cells stay grey, so how full an
 * album is reads at a glance; an entirely empty album is four grey cells.
 */
function AlbumCard({
  category,
  layouts,
  designSystem,
  onOpen,
}: {
  category: string;
  layouts: StoredLayout[];
  designSystem: DesignSystem;
  onOpen: () => void;
}) {
  const blurb = CATEGORY_BLURBS[category as SlideLayoutCategory];
  // Four cells of slide aspect in a 2x2 grid keep the card's overall shape the
  // same as a single slide, so the shelf stays on one rhythm.
  const cells = [0, 1, 2, 3].map((i) => layouts[i]);
  return (
    <button onClick={onOpen} className="group block w-full text-left">
      <div className="relative">
        <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 p-1 shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md dark:border-zinc-800 dark:bg-zinc-800">
          {cells.map((cell, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-sm bg-white dark:bg-zinc-900"
              style={cell ? undefined : { aspectRatio: `${SLIDE_SIZE.w} / ${SLIDE_SIZE.h}` }}
            >
              {cell ? (
                <FitSlideView slide={cell.slide} slideSize={SLIDE_SIZE} designSystem={designSystem} />
              ) : (
                <div className="h-full w-full bg-zinc-200 dark:bg-zinc-700" />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <div className="truncate text-sm font-medium">{category}</div>
        {/* What belongs in this family, not just how full it is — the shelf is
            browsed by the shape of the idea, the way SmartArt is. Folders Admin
            created have no authored blurb, so they simply don't get a line. */}
        {blurb ? (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{blurb}</div>
        ) : null}
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {layouts.length} {layouts.length === 1 ? 'layout' : 'layouts'}
        </div>
      </div>
    </button>
  );
}

/**
 * Asked before a layout exists, by both Build and Upload: a layout with no
 * folder would land in whatever bucket the code happened to default to, and
 * then have to be found and moved. Creating a folder is part of the same step,
 * so "it doesn't belong anywhere yet" isn't a dead end.
 */
function FolderPickerModal({
  title,
  folders,
  counts,
  initial,
  onPick,
  onCreate,
  onCancel,
}: {
  title: string;
  folders: string[];
  counts: StoredLayout[];
  initial: string | null;
  onPick: (folder: string) => void;
  /** Returns the canonical folder name, or null if the name was empty. */
  onCreate: (name: string) => string | null;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(initial);
  const [newFolder, setNewFolder] = useState('');

  const create = () => {
    const created = onCreate(newFolder);
    if (!created) return;
    setNewFolder('');
    setSelected(created);
  };

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold dark:border-zinc-800">
          {title}
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {folders.map((f) => (
            <button
              key={f}
              // A folder created from the field below can be out of view in a
              // long list; scrolling it in is the only confirmation it worked.
              ref={(el) => {
                if (selected === f) el?.scrollIntoView({ block: 'nearest' });
              }}
              onClick={() => setSelected(f)}
              onDoubleClick={() => onPick(f)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                selected === f
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="shrink-0 opacity-60">🗀</span>
              <span className="min-w-0 flex-1 truncate font-medium">{f}</span>
              <span className="shrink-0 opacity-60">
                {counts.filter((l) => l.category === f).length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <input
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
            placeholder="New folder name"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            onClick={create}
            disabled={!newFolder.trim()}
            className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Create
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <button
            onClick={onCancel}
            className="rounded-md px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={() => selected && onPick(selected)}
            disabled={!selected}
            className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
