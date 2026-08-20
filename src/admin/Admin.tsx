"use client";

/**
 * Admin view — Kamran's control room:
 *  - Design system: edit the brand palette + semantic type roles, with a live
 *    preview. Saving bumps the version; because decks reference tokens, the
 *    change reflows everywhere.
 *  - Templates: the repo of whole decks everyone starts from, laid out like the
 *    Documents tab. What's edited here is what the new-document picker offers.
 *  - Charts: the house chart style, plus the chart-template library.
 *  - Layouts: the individual slide-layout library, bucketed by type (mirrors
 *    the RHS drawer's grouping). Build from scratch or upload a reference.
 *  - Artifacts: the shared asset library, browsed Drive-style by folder.
 *
 * In Playground this route gets gated to a template-admin Okta group.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ALLOWED_FONTS,
  EMU_PER_INCH,
  isBuiltInTypeRole,
  EMU_PER_POINT,
  FONT_CHOICES,
  FONTS,
  fontChoiceIdOf,
  fontChoicePatch,
  inchesToEmu,
  pageNumberInk,
  pageNumberLabel,
  runWeight,
  typeRoleIds,
  type BuiltInTypeRole,
  type ColorToken,
  type DesignSystem,
  type FontFamily,
  type PageNumberPosition,
  type PageNumberStyle,
  type TypeRole,
} from "@/model";
import { FitSlideView } from "@/render/FitSlideView";
import {
  CATEGORY_BLURBS,
  type SlideLayoutCategory,
} from "@/templates/registry";
import {
  addCustomFolder,
  createLayout,
  createLayoutFromImage,
  listFolders,
  listLayouts,
  seedLayoutsIfFirstRun,
  type StoredLayout,
} from "@/templates/layoutRepository";
import {
  getDraftDesignSystem,
  hasDesignDraft,
  publishDesignSystem,
  resetDesignSystem,
  saveDesignDraft,
} from "@/design/repository";
import { PrimaryTabs, SubTabs } from "@/nav/PrimaryTabs";
import { useToast } from "@/ui/Toast";
import { ChartStyleSection } from "./ChartStyleSection";
import { ChartTemplates } from "./ChartTemplates";
import { ChartVariants } from "./ChartVariants";
import { DeckTemplates } from "./DeckTemplates";
import { Artifacts } from "./Artifacts";
import { LayoutCard } from "./LayoutCard";
import { LogoSection } from './LogoSection';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };

/**
 * Reference-image picker filter. `image/*` alone is not enough: the OS matches
 * it against the type it guesses from the extension, so anything it doesn't
 * map to an image — HEIC on older systems, a file exported without an
 * extension — is greyed out and unpickable. The explicit extensions widen the
 * filter back to every format the browser can actually decode; whatever slips
 * through is caught by the check in `uploadLayout`.
 */
const LAYOUT_IMAGE_ACCEPT =
  "image/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.bmp,.ico,.heic,.heif,.tif,.tiff";

/** Extensions the accept list admits but a browser may still refuse to decode. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|heic|heif|tiff?)$/i;
type Tab = "design" | "templates" | "charts" | "layouts" | "artifacts";

/**
 * Order matters: Templates sits directly after the design system because it's
 * the level everyone else meets the brand at — a whole deck to start from —
 * with the finer-grained libraries (charts, single slide layouts, assets)
 * behind it.
 */
const ADMIN_TABS: Tab[] = [
  "design",
  "templates",
  "charts",
  "layouts",
  "artifacts",
];

const TAB_LABELS: Record<Tab, string> = {
  design: "Design system",
  templates: "Templates",
  charts: "Charts",
  layouts: "Layouts",
  artifacts: "Artifacts",
};

/**
 * Tabs whose contents are part of the design system's own dirty/save cycle.
 * The chart style lives on `DesignSystem`, so its tab shares the header's Save
 * — the template library below it auto-persists, exactly like Layouts.
 */
const SAVEABLE_TABS: Tab[] = ["design", "charts"];

/**
 * The Charts tab's two halves.
 *
 * `styles` is design-system state and rides the header's Save/Publish;
 * `templates` is its own library with its own instant persistence.
 */
type ChartSection = "styles" | "templates";

const CHART_SECTIONS: { value: ChartSection; label: string }[] = [
  { value: "styles", label: "Chart styles" },
  { value: "templates", label: "House templates" },
];

function stripExt(filename: string): string {
  return filename.replace(/\.[^./]+$/, "");
}

export function Admin() {
  const router = useRouter();
  // `?tab=` is how the editor's "Admin" link comes back to the area you left —
  // edit a template's slides and the way out lands on Templates, not on the
  // design system. Read once, at mount: the tab strip owns it from there.
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get("tab");
    return (ADMIN_TABS as string[]).includes(requested ?? "")
      ? (requested as Tab)
      : "design";
  });
  const [chartSection, setChartSection] = useState<ChartSection>("styles");
  // Admin edits the DRAFT; the rest of the app renders the published copy.
  const [ds, setDs] = useState<DesignSystem>(() => getDraftDesignSystem());
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** Saved but not yet live — the state the publish step exists to make visible. */
  const [unpublished, setUnpublished] = useState(false);
  const [layouts, setLayouts] = useState<StoredLayout[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  // null = album shelf; otherwise we're inside one album.
  const [album, setAlbum] = useState<string | null>(null);
  // Non-empty search takes over the shelf: albums first, then single layouts.
  const [layoutQuery, setLayoutQuery] = useState("");
  // A new layout has to land somewhere, so both entry points ask for a folder
  // first; the file dialog only opens once "upload" has one.
  const [pendingNew, setPendingNew] = useState<"build" | "upload" | null>(null);
  const [uploadFolder, setUploadFolder] = useState<string | null>(null);
  // Palette drag-to-reorder. `armed` gates `draggable` on the row so the name
  // and hex inputs keep normal text selection until the grip is pressed.
  const [colorDragArmed, setColorDragArmed] = useState<number | null>(null);
  const [colorDragFrom, setColorDragFrom] = useState<number | null>(null);
  const [colorDragOver, setColorDragOver] = useState<{
    index: number;
    after: boolean;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

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
    if (action === "build") {
      const l = createLayout({ name: "Untitled layout", category });
      router.push(`/admin/layouts/${l.id}`);
    } else if (action === "upload") {
      setUploadFolder(category);
      fileInputRef.current?.click();
    }
  };

  const uploadLayout = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const category = uploadFolder;
    setUploadFolder(null);
    if (!file || !category) return;
    // The picker's filter is deliberately loose, so the real check is here.
    // Type can be empty for a file the OS didn't recognise, hence the fallback
    // to the extension rather than a straight `type.startsWith('image/')`.
    if (!(file.type.startsWith("image/") || IMAGE_EXT.test(file.name))) {
      toast(
        `“${file.name}” isn't an image. A layout reference is a picture — export a PDF or deck page to PNG first.`,
        { tone: "danger" },
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const l = createLayoutFromImage(
        reader.result as string,
        stripExt(file.name),
        category,
      );
      router.push(`/admin/layouts/${l.id}`);
    };
    reader.onerror = () =>
      toast(`Couldn't read “${file.name}”.`, { tone: "danger" });
    reader.readAsDataURL(file);
  };

  // Search spans the whole library, so it overrides whichever album is open.
  const q = layoutQuery.trim().toLowerCase();
  const searching = q.length > 0;
  const matchedFolders = searching
    ? folders.filter((f) => f.toLowerCase().includes(q))
    : [];
  const matchedLayouts = searching
    ? layouts.filter((l) => l.name.toLowerCase().includes(q))
    : [];

  const patch = (next: Partial<DesignSystem>) => {
    setDs((cur) => ({ ...cur, ...next }));
    setDirty(true);
  };

  const setColor = (i: number, next: Partial<ColorToken>) =>
    patch({
      colors: ds.colors.map((c, idx) => (idx === i ? { ...c, ...next } : c)),
    });

  const addColor = () =>
    patch({
      colors: [
        ...ds.colors,
        {
          id: `custom.${ds.colors.length + 1}`,
          name: "New color",
          hex: "#888888",
        },
      ],
    });

  const removeColor = (i: number) =>
    patch({ colors: ds.colors.filter((_, idx) => idx !== i) });

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

  const setRole = (role: string, next: Partial<TypeRole>) =>
    patch({ type: { ...ds.type, [role]: { ...ds.type[role], ...next } } });

  /**
   * A role starts as a copy of body, the way a new colour starts grey: the
   * point of adding one is usually that some text needs to differ from the
   * default in one respect, and starting from the default makes that one
   * respect the only thing there is to set.
   *
   * Ids are `custom.N` for the first N free, not `count + 1` — roles are
   * OBJECT KEYS, so a count-derived id after a removal wouldn't sit beside an
   * existing role, it would silently overwrite it.
   */
  const addRole = () => {
    let n = 1;
    while (`custom.${n}` in ds.type) n += 1;
    const id = `custom.${n}`;
    patch({
      type: { ...ds.type, [id]: { ...ds.type.body, label: `New role ${n}` } },
    });
  };

  /**
   * Built-ins are not removable and the UI doesn't offer it — `ds.type.body` is
   * the fallback size in a dozen call sites and templates name these ids — so
   * this guard is about the model, not the button.
   */
  const removeRole = (role: string) => {
    if (isBuiltInTypeRole(role)) return;
    const next = { ...ds.type };
    delete next[role];
    patch({ type: next });
  };

  const setPageNumbers = (next: Partial<PageNumberStyle>) =>
    patch({ pageNumbers: { ...ds.pageNumbers, ...next } });

  /** Save the draft. Bumps nothing: no deck can see a draft, so none has drifted. */
  const save = () => {
    const next = saveDesignDraft(ds);
    setDs(next);
    setDirty(false);
    setSavedAt(next.updatedAt);
    setUnpublished(true);
  };

  /**
   * Make the draft the brand. This is the one action that bumps `version` and
   * so marks every deck built on the previous one as stale — which is why it's
   * a separate, deliberate button rather than a side effect of typing.
   */
  const publish = () => {
    const next = publishDesignSystem(dirty ? saveDesignDraft(ds) : undefined);
    setDs(next);
    setDirty(false);
    setSavedAt(next.updatedAt);
    setUnpublished(false);
  };

  const reset = () => {
    const def = resetDesignSystem();
    setDs(def);
    setDirty(false);
    setSavedAt(null);
    setUnpublished(false);
  };

  /**
   * Does the header's Save/Publish/Reset govern what's on screen right now?
   *
   * The Charts tab is half design-system state and half its own instantly
   * persisted library, so the tab alone isn't the answer any more — showing
   * Save while someone edits a house template is exactly the ambiguity the
   * section split exists to remove.
   */
  const saveable =
    SAVEABLE_TABS.includes(tab) &&
    !(tab === "charts" && chartSection === "templates");

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
            <img
              src="/devin-logo.svg"
              alt=""
              className="h-6 w-6 shrink-0 dark:invert"
            />
            <span className="text-xl font-semibold tracking-tight">Decks</span>
          </Link>
          {/* shrink-0 so a long design-system name can't squeeze the logo
              out of square when the window is narrow. */}
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-zinc-400">
            <span className="whitespace-nowrap">
              {ds.name} · v{ds.version}
              {unpublished || hasDesignDraft() ? (
                <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                  Draft
                </span>
              ) : null}
            </span>
            <button
              onClick={reset}
              disabled={!saveable}
              className={`rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
                saveable ? "" : "invisible"
              }`}
            >
              Reset
            </button>
            <button
              onClick={save}
              disabled={!dirty || !saveable}
              className={`rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-black ${
                saveable ? "" : "invisible"
              }`}
            >
              {dirty ? "Save changes" : "Saved"}
            </button>
            <button
              onClick={publish}
              disabled={(!dirty && !unpublished) || !saveable}
              title="Make this the live brand for every deck"
              className={`rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 ${
                saveable ? "" : "invisible"
              }`}
            >
              Publish
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
        {tab === "design" ? (
          <div>
            <div className="space-y-6">
              {/* Palette and type are the two halves of one decision — which
                  ink, and how it's set — so they sit side by side on wide
                  screens and stack below lg. */}
              <div className="grid items-start gap-6 lg:grid-cols-2">
                {/* Colors */}
                <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <h3 className="text-sm font-semibold">Brand palette</h3>
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
                          colorDragFrom === i ? "opacity-40" : ""
                        }`}
                        draggable={colorDragArmed === i}
                        onDragStart={(e) => {
                          setColorDragFrom(i);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", c.id);
                        }}
                        onDragEnd={() => {
                          setColorDragArmed(null);
                          setColorDragFrom(null);
                          setColorDragOver(null);
                        }}
                        onDragOver={(e) => {
                          if (colorDragFrom === null || colorDragFrom === i)
                            return;
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setColorDragOver({
                            index: i,
                            after: e.clientY - rect.top > rect.height / 2,
                          });
                        }}
                        onDragLeave={() => {
                          setColorDragOver((cur) =>
                            cur?.index === i ? null : cur,
                          );
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (colorDragFrom !== null && colorDragOver) {
                            // Splice-out shifts everything after `from` down one,
                            // so an insert point past it loses an index.
                            const raw =
                              colorDragOver.index +
                              (colorDragOver.after ? 1 : 0);
                            moveColor(
                              colorDragFrom,
                              raw > colorDragFrom ? raw - 1 : raw,
                            );
                          }
                          setColorDragArmed(null);
                          setColorDragFrom(null);
                          setColorDragOver(null);
                        }}
                      >
                        {colorDragOver?.index === i ? (
                          <div
                            className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-indigo-500 ${
                              colorDragOver.after ? "bottom-0" : "top-0"
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
                          <svg
                            width="10"
                            height="14"
                            viewBox="0 0 10 14"
                            aria-hidden="true"
                          >
                            <g fill="currentColor">
                              {[2, 7, 12].map((y) =>
                                [2, 8].map((x) => (
                                  <circle
                                    key={`${x}-${y}`}
                                    cx={x}
                                    cy={y}
                                    r="1"
                                  />
                                )),
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
                          onChange={(e) =>
                            setColor(i, { name: e.target.value })
                          }
                          aria-label="Color name"
                          className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                        />
                        <input
                          value={c.hex}
                          onChange={(e) => setColor(i, { hex: e.target.value })}
                          aria-label="Hex"
                          className="w-24 shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-xs uppercase dark:border-zinc-700 dark:bg-zinc-800"
                        />
                        <code className="truncate font-mono text-[11px] text-zinc-400">
                          {c.id}
                        </code>
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
                <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <h3 className="text-sm font-semibold">Type roles</h3>
                    <button
                      onClick={addRole}
                      className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      + Add role
                    </button>
                  </div>
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {typeRoleIds(ds).map((role) => (
                      <TypeRoleRow
                        key={role}
                        role={role}
                        style={ds.type[role]}
                        colors={ds.colors}
                        onChange={(next) => setRole(role, next)}
                        onRemove={
                          isBuiltInTypeRole(role)
                            ? undefined
                            : () => removeRole(role)
                        }
                      />
                    ))}
                  </div>
                </section>
              </div>

              {/* Logo and page numbers: the two pieces of chrome the BRAND
                  owns rather than any individual deck, so they sit together and
                  share the design system's own Save/Publish cycle. */}
              <LogoSection logo={ds.logo} onChange={(logo) => patch({ logo })} />

              {/* Page numbers */}
              <PageNumbersSection
                style={ds.pageNumbers}
                onChange={setPageNumbers}
              />
            </div>
          </div>
        ) : tab === "charts" ? (
          <div className="space-y-4">
            {/* Two different things with two different save models used to be
                stacked on one page: chart style is part of the design system
                (draft → Save → Publish), while the template library persists
                the moment you touch it. The header's Save/Publish buttons are
                visible either way, so nobody could tell what they governed.
                Splitting them is what makes those buttons honest. */}
            <div className="flex gap-1">
              {CHART_SECTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setChartSection(s.value)}
                  className={`rounded-md px-2.5 py-1 text-[12px] transition ${
                    chartSection === s.value
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {chartSection === "styles" ? (
              <div className="space-y-6">
                <ChartStyleSection
                  ds={ds}
                  onChange={(chart) => patch({ chart })}
                  onPreviewData={(previewData) => patch({ previewData })}
                />
                <ChartVariants
                  ds={ds}
                  onChange={(chartVariants) => patch({ chartVariants })}
                  onPreviewData={(previewData) => patch({ previewData })}
                />
              </div>
            ) : (
              <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-1 text-sm font-semibold">House templates</h3>
                <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
                  Named archetypes authors drop in and repoint at their own data
                  — chart type, axes, formats and research framing already set.
                  Unlike chart styles, these save the moment you edit them and
                  aren&rsquo;t part of the design system&rsquo;s publish cycle.
                </p>
                <ChartTemplates ds={ds} />
              </section>
            )}
          </div>
        ) : tab === "templates" ? (
          <DeckTemplates />
        ) : tab === "layouts" ? (
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
                      {album}{" "}
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
                  accept={LAYOUT_IMAGE_ACCEPT}
                  onChange={uploadLayout}
                  className="hidden"
                />
                <button
                  onClick={() => setPendingNew("upload")}
                  className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Upload to create layout
                </button>
                <button
                  onClick={() => setPendingNew("build")}
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
                          layouts={layouts.filter(
                            (l) => l.category === category,
                          )}
                          designSystem={ds}
                          onOpen={() => {
                            setLayoutQuery("");
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
                      <LayoutCard
                        key={l.id}
                        layout={l}
                        designSystem={ds}
                        onChange={refreshLayouts}
                      />
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
                title={
                  pendingNew === "build"
                    ? "Build layout in…"
                    : "Upload layout into…"
                }
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
const ROLE_SAMPLES: Record<BuiltInTypeRole, string> = {
  title: "Quarterly Business Review",
  subtitle: "FY26 Q2 · Prepared for the board",
  heading: "Where things stand",
  body: "Enterprise renewals carried the quarter, with net revenue retention at 118%.",
  caption: "Source: internal finance data, as of Aug 2026",
  kpiValue: "118%",
};

const ROLE_LABELS: Record<BuiltInTypeRole, string> = {
  title: "Title",
  subtitle: "Subtitle",
  heading: "Heading",
  body: "Body",
  caption: "Caption",
  kpiValue: "KPI value",
};

/**
 * What a row is called and what it's set in. A built-in has both written above;
 * an added role has only the name its admin typed, so that name is also the
 * sample — a role called "Pull quote" shown in itself says everything a lorem
 * line would, and says it about this brand.
 */
const roleLabel = (id: string, style: TypeRole) =>
  isBuiltInTypeRole(id) ? ROLE_LABELS[id] : style.label || "Untitled role";

const roleSample = (id: string, style: TypeRole) =>
  isBuiltInTypeRole(id) ? ROLE_SAMPLES[id] : style.label || "Sample text";

/**
 * Slide points shown at true size: CSS defines 96px to the inch and there are
 * 72pt to the inch, so this is the same physical size the type takes on a slide
 * shown at 100%. Shrinking it to fit the row was the wrong trade — the whole
 * point of setting each row in its own role is that you can judge 14pt body
 * against a 26pt title, and a factor under 1 makes every one of those calls
 * against type smaller than the thing being decided.
 */
const SAMPLE_PX_PER_PT = 96 / 72;

/**
 * One type role: the line it sets, and — on click — the menu that shapes it.
 *
 * The knobs used to sit in the row, four selects deep, six times over: the
 * panel read as a form about type rather than as type. Slides has the right
 * idea — you click the thing and the controls come to it — and here it buys
 * something extra, because a role IS its sample. With the row down to a name
 * and a line, the samples stack close enough to compare, which is the whole
 * job of this panel.
 *
 * `onRemove` absent means built-in — the six roles code resolves through by
 * name. Their menu shows no delete rather than a disabled one with an
 * explanation, because "why can't I delete Body" is a question about the code,
 * and the answer isn't actionable from here.
 */
function TypeRoleRow({
  role,
  style,
  colors,
  onChange,
  onRemove,
}: {
  role: string;
  style: TypeRole;
  colors: ColorToken[];
  onChange: (next: Partial<TypeRole>) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const font = FONTS[style.font];
  const color = colors.find((c) => c.id === style.colorToken);
  const hex = color?.hex ?? "#000000";

  // Outside click and Escape, the same dismissal the editor's colour picker
  // uses. Deliberately not a focus trap: the menu is a handful of native
  // controls, and tabbing out of it to the next role is a reasonable thing to
  // want to do.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          {roleLabel(role, style)}
        </span>
        {/* The id: what a template or the chat agent names to resolve through
            this role, exactly as a colour row shows its token. */}
        <code className="truncate font-mono text-[10px] text-zinc-300 dark:text-zinc-600">
          {role}
        </code>
        {/* The settings in words, so the panel still reads as a spec sheet
            without opening six menus. The sample shows what they DO; this says
            what they ARE, which is what you quote to someone in Figma. */}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
          {fontChoiceIdOf(style, style.font)} · {style.sizePt}pt
          {style.bold ? " · Bold" : ""}
          {color ? ` · ${color.name}` : ""}
        </span>
      </div>
      {/* Set in the role itself, on a white ground: these colours are picked
          against slides, so previewing them on the app's dark chrome would lie
          about contrast. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Edit ${roleLabel(role, style)}`}
        className={`mt-1 block w-full overflow-hidden rounded-md bg-white px-3 py-2 text-left ring-1 transition hover:ring-zinc-300 dark:hover:ring-zinc-600 ${
          open ? "ring-zinc-400 dark:ring-zinc-500" : "ring-zinc-100 dark:ring-zinc-800"
        }`}
      >
        <div
          className="truncate"
          style={{
            fontFamily: font.cssStack,
            fontSize: style.sizePt * SAMPLE_PX_PER_PT,
            lineHeight: font.singleLineFactor,
            fontWeight: runWeight(style),
            color: hex,
          }}
        >
          {roleSample(role, style)}
        </div>
      </button>
      {open ? (
        // Overlapping the row below, not pushing it: the reason to open a menu
        // here is to watch one sample change against the others, and a menu
        // that reflowed the stack would move the very lines being compared.
        <div
          role="toolbar"
          aria-label={`${roleLabel(role, style)} type`}
          className="absolute left-0 top-full z-30 mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {/* An added role's name lives here rather than in the row: it's an
              edit, and edits are what this menu is. */}
          {onRemove ? (
            <input
              value={style.label ?? ""}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder="Role name"
              aria-label="Role name"
              className="w-28 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
            />
          ) : null}
          {/* Faces, not just families: the deck's title ladder is set in Geist
              Medium, and a role that could only say "Geist" had no way to name
              it. `fontChoicePatch` sets family and weight together. */}
          <select
            value={fontChoiceIdOf(style, style.font)}
            onChange={(e) => onChange(fontChoicePatch(e.target.value))}
            aria-label="Font"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          >
            {FONT_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
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
          {onRemove ? (
            <>
              <span className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
              <button
                onClick={onRemove}
                className="rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
              >
                Remove role
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const POSITIONS: { value: PageNumberPosition; label: string }[] = [
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];

const FORMATS: { value: string; label: string }[] = [
  { value: "{n}", label: "7" },
  { value: "Page {n}", label: "Page 7" },
  { value: "{n} / {total}", label: "7 / 12" },
  { value: "{n} of {total}", label: "7 of 12" },
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
    "rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Page numbers</h3>
        <span className="text-[11px] text-zinc-400">
          Turned on per deck from the editor toolbar
        </span>
      </div>
      <p className="mb-3 text-[11px] text-zinc-400">
        Numbers are drawn from each slide&rsquo;s position, so decks renumber
        themselves as slides are added, removed or reordered.
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
          onChange={(e) =>
            onChange({ sizePt: parseFloat(e.target.value) || 1 })
          }
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
          onChange={(e) =>
            onChange({ position: e.target.value as PageNumberPosition })
          }
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
            onChange={(e) =>
              onChange({
                marginXEmu: inchesToEmu(parseFloat(e.target.value) || 0),
              })
            }
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
            onChange={(e) =>
              onChange({
                marginYEmu: inchesToEmu(parseFloat(e.target.value) || 0),
              })
            }
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
        {["#FFFFFF", "#0A0A0A"].map((bg) => (
          <PageNumberPreview key={bg} style={style} backgroundHex={bg} />
        ))}
      </div>
    </section>
  );
}

/**
 * A zoomed-in crop of the slide corner the number lands in — the rest of the
 * slide carries no information here, so showing it only shrinks the type past
 * legibility. Dashed guides mark the two margins the controls above set.
 */
function PageNumberPreview({
  style,
  backgroundHex,
}: {
  style: PageNumberStyle;
  backgroundHex: string;
}) {
  const label = pageNumberLabel({ ...style, skipFirst: false }, 6, 12);
  const justify =
    style.position === "bottom-center"
      ? "center"
      : style.position === "bottom-left"
        ? "flex-start"
        : "flex-end";
  // The crop: a corner-sized window onto the slide. The slide itself is laid
  // out at full size behind it and anchored so the window lands on the corner,
  // which keeps every inset in true slide proportion while the type comes out
  // ~2.5x bigger than it would at whole-slide scale.
  const CROP_W = 0.4;
  const CROP_H = 0.34;
  const VIEW_W = 240;
  const scale = VIEW_W / CROP_W / SLIDE_SIZE.w;
  const pct = (emu: number, of: number) => `${(emu / of) * 100}%`;
  const ink = pageNumberInk(style, backgroundHex);
  const inches = (emu: number) => Math.round((emu / EMU_PER_INCH) * 100) / 100;
  const guide = {
    position: "absolute",
    borderColor: ink,
    opacity: 0.35,
  } as const;
  const tick = {
    position: "absolute",
    color: ink,
    opacity: 0.55,
    fontSize: 9,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    whiteSpace: "nowrap",
  } as const;
  const centered = style.position === "bottom-center";
  return (
    <div
      className="relative overflow-hidden rounded border border-zinc-200 dark:border-zinc-700"
      style={{
        background: backgroundHex,
        aspectRatio: `${CROP_W * SLIDE_SIZE.w} / ${CROP_H * SLIDE_SIZE.h}`,
      }}
    >
      <div
        className="absolute flex"
        style={{
          bottom: 0,
          left: centered
            ? "50%"
            : style.position === "bottom-left"
              ? 0
              : undefined,
          right: style.position === "bottom-right" ? 0 : undefined,
          transform: centered ? "translateX(-50%)" : undefined,
          width: `${100 / CROP_W}%`,
          aspectRatio: `${SLIDE_SIZE.w} / ${SLIDE_SIZE.h}`,
          alignItems: "flex-end",
          justifyContent: justify,
          padding: `0 ${style.marginXEmu * scale}px ${style.marginYEmu * scale}px`,
        }}
      >
        {/* Bottom margin: the baseline the number sits on. */}
        <div
          style={{
            ...guide,
            left: 0,
            right: 0,
            bottom: pct(style.marginYEmu, SLIDE_SIZE.h),
            borderTopWidth: 1,
            borderTopStyle: "dashed",
          }}
        />
        {/* Side margin: one edge, or both when the number is centered. */}
        {(centered || style.position === "bottom-left") && (
          <div
            style={{
              ...guide,
              top: 0,
              bottom: 0,
              left: pct(style.marginXEmu, SLIDE_SIZE.w),
              borderLeftWidth: 1,
              borderLeftStyle: "dashed",
            }}
          />
        )}
        {(centered || style.position === "bottom-right") && (
          <div
            style={{
              ...guide,
              top: 0,
              bottom: 0,
              right: pct(style.marginXEmu, SLIDE_SIZE.w),
              borderLeftWidth: 1,
              borderLeftStyle: "dashed",
            }}
          />
        )}
        <span
          style={{
            fontFamily: FONTS[style.font].cssStack,
            fontSize: style.sizePt * EMU_PER_POINT * scale,
            lineHeight: FONTS[style.font].singleLineFactor,
            fontWeight: style.bold ? 700 : 400,
            color: ink,
          }}
        >
          {label}
        </span>
      </div>
      {/* Guide readouts, pinned to the crop so they never sit under the number. */}
      <div style={{ ...tick, left: 4, bottom: 3 }}>
        {inches(style.marginYEmu)}&Prime; bottom
      </div>
      <div style={{ ...tick, right: 4, top: 3 }}>
        {inches(style.marginXEmu)}&Prime; side
      </div>
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
              style={
                cell
                  ? undefined
                  : { aspectRatio: `${SLIDE_SIZE.w} / ${SLIDE_SIZE.h}` }
              }
            >
              {cell ? (
                <FitSlideView
                  slide={cell.slide}
                  slideSize={SLIDE_SIZE}
                  designSystem={designSystem}
                />
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
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {blurb}
          </div>
        ) : null}
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {layouts.length} {layouts.length === 1 ? "layout" : "layouts"}
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
  const [newFolder, setNewFolder] = useState("");

  const create = () => {
    const created = onCreate(newFolder);
    if (!created) return;
    setNewFolder("");
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
                if (selected === f) el?.scrollIntoView({ block: "nearest" });
              }}
              onClick={() => setSelected(f)}
              onDoubleClick={() => onPick(f)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                selected === f
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
              if (e.key === "Enter") create();
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
