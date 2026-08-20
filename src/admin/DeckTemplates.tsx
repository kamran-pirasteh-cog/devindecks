'use client';

/**
 * The deck-template repo, in Admin — the shelf of whole decks everyone starts
 * from, laid out the way the Documents tab lays out documents.
 *
 * That likeness is deliberate rather than decorative. A template IS a deck: the
 * same slides, opened in the same editor, previewed through the same `Thumb`,
 * searched and sorted by the same controls. Anyone who can find a document here
 * can find a template, and the card they click opens the editor they already
 * know — with an "Editing template" badge on it so they know whose deck they're
 * in (see `Editor`).
 *
 * How a change gets out to everyone: the new-document picker reads
 * `listTemplates()` and `createDoc` resolves slides through
 * `getTemplateSlides`, so the store this page writes IS the one every deck is
 * created from. Editing a template's slides bumps its `version`, which is what
 * lets `templateDrift` tell a deck already made from it that its master has
 * moved — surfaced here as the "out of date" count on each row, so an edit's
 * reach is visible from the place the edit was made.
 *
 * Auto-persisting, like Layouts and Charts: every action writes immediately, so
 * there's no Save button here and the header's one belongs to the design
 * system.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Deck } from '@/model';
import { listDocs } from '@/docs/repository';
import { Thumb } from '@/home/Thumb';
import { ConfirmDialog } from '@/home/ConfirmDialog';
import { timeAgo } from '@/home/timeAgo';
import { useToast } from '@/ui/Toast';
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@/templates/registry';
import {
  createTemplate,
  createTemplateFromDeck,
  createTemplateFromImage,
  deleteTemplate,
  duplicateTemplate,
  listTemplates,
  resetBuiltInTemplates,
  seedIfFirstRun,
  updateTemplateMeta,
  type StoredTemplate,
} from '@/templates/repository';
import { templateDrift } from '@/templates/provenance';
import {
  DEFAULT_TEMPLATE_SORT,
  TEMPLATE_SORT_OPTIONS,
  TEMPLATE_SORT_DEFAULT_DIR,
  filterTemplates,
  nextTemplateSort,
  sortTemplates,
  type TemplateSort,
  type TemplateSortBy,
} from '@/templates/sortTemplates';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };

/** Where the Thumbnails switch remembers itself. Unset means on — same rule as
 *  the dashboard's, and a separate key so the two shelves stay independent. */
const THUMBS_KEY = 'devindesign.templatethumbs.v1';

/** The same loose picker filter Layouts uses — see `LAYOUT_IMAGE_ACCEPT`. */
const IMAGE_ACCEPT =
  'image/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.bmp,.ico,.heic,.heif,.tif,.tiff';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|heic|heif|tiff?)$/i;

function stripExt(filename: string): string {
  return filename.replace(/\.[^./]+$/, '');
}

/** How many decks came from a template, and how many are on an older version. */
export interface TemplateUsage {
  decks: number;
  stale: number;
}

/**
 * Reach, per template, in one pass over the documents.
 *
 * Exported for the same reason it's a plain function: the counts are the honest
 * answer to "does anyone actually use this?", and the delete confirmation asks
 * that question too.
 */
export function templateUsage(docs: Deck[], templates: StoredTemplate[]): Map<string, TemplateUsage> {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const usage = new Map<string, TemplateUsage>();
  for (const doc of docs) {
    const id = doc.deckTemplateId;
    if (!id) continue;
    const template = byId.get(id);
    if (!template) continue;
    const cur = usage.get(id) ?? { decks: 0, stale: 0 };
    usage.set(id, {
      decks: cur.decks + 1,
      stale: cur.stale + (templateDrift(doc, template) ? 1 : 0),
    });
  }
  return usage;
}

/** A toolbar dropdown, matching the dashboard's. */
function ToolbarSelect({
  label,
  value,
  onChange,
  active,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full appearance-none rounded-md border py-1.5 pl-2.5 pr-8 text-sm outline-none ${
          active
            ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300'
            : 'border-zinc-200 bg-white text-zinc-600 focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
        }`}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 12 12"
        aria-hidden
        className={`pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 ${
          active ? 'text-indigo-500 dark:text-indigo-300' : 'text-zinc-400'
        }`}
      >
        <path
          d="M3 4.75 6 7.75 9 4.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** The dashboard's Thumbnails switch, over the template shelf. */
function ShelfHeader({
  label,
  showThumbs,
  onToggleThumbs,
}: {
  label: string;
  showThumbs: boolean;
  onToggleThumbs: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</span>
      <button
        role="switch"
        aria-checked={showThumbs}
        onClick={onToggleThumbs}
        title={showThumbs ? 'Hide slide previews' : 'Show slide previews'}
        className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Thumbnails
        <span
          aria-hidden
          className={`relative h-3.5 w-6 rounded-full transition-colors ${
            showThumbs ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
        >
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-[left] ${
              showThumbs ? 'left-3' : 'left-0.5'
            }`}
          />
        </span>
      </button>
    </div>
  );
}

/**
 * "N decks · M out of date" — what this template is carrying.
 *
 * The stale half is a link to nothing on purpose: a deck's slides were COPIED
 * at creation, so nothing here can or should reach back into someone's client
 * deck and restyle it. The number is information, not a to-do.
 */
function UsageBadge({ usage }: { usage?: TemplateUsage }) {
  if (!usage?.decks) return <span className="text-zinc-400">No decks yet</span>;
  return (
    <span className="text-zinc-400">
      {usage.decks} deck{usage.decks === 1 ? '' : 's'}
      {usage.stale ? (
        <>
          {' · '}
          <span
            title="These decks were created from an earlier version of this template. Their slides are their own — nothing here rewrites them."
            className="text-amber-600 dark:text-amber-400"
          >
            {usage.stale} on an older version
          </span>
        </>
      ) : null}
    </span>
  );
}

/** Rename · category · duplicate · delete, on both the card and the row. */
function TemplateMenu({
  template,
  onRename,
  onChange,
  buttonClassName = '',
}: {
  template: StoredTemplate;
  onRename: () => void;
  onChange: () => void;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const close = () => {
    setOpen(false);
    setCategories(false);
  };

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={`Actions for ${template.name}`}
        className={`flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-700 ${buttonClassName}`}
      >
        ⋯
      </button>

      {open ? (
        <div
          onMouseLeave={close}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-7 z-20 w-44 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          <MenuItem
            onClick={() => {
              close();
              router.push(`/admin/templates/${template.id}`);
            }}
          >
            Edit slides
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              onRename();
            }}
          >
            Rename
          </MenuItem>
          <MenuItem onClick={() => setCategories((c) => !c)}>Move to category…</MenuItem>
          {categories ? (
            <div className="border-y border-zinc-100 bg-zinc-50 py-1 dark:border-zinc-700 dark:bg-zinc-900/60">
              {TEMPLATE_CATEGORIES.map((c) => (
                <MenuItem
                  key={c}
                  onClick={() => {
                    updateTemplateMeta(template.id, { category: c });
                    close();
                    onChange();
                  }}
                >
                  <span className={c === template.category ? 'font-medium' : ''}>
                    {c === template.category ? '✓ ' : '   '}
                    {c}
                  </span>
                </MenuItem>
              ))}
            </div>
          ) : null}
          <MenuItem
            onClick={() => {
              const copy = duplicateTemplate(template.id);
              close();
              onChange();
              if (copy) toast(`Created “${copy.name}”.`);
            }}
          >
            Duplicate
          </MenuItem>
          <MenuItem
            danger
            onClick={() => {
              close();
              setConfirming(true);
            }}
          >
            Delete
          </MenuItem>
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title={`Delete “${template.name}”?`}
          // Says the one thing someone deleting a template is right to worry
          // about: whether it takes the decks with it. It doesn't — their
          // slides were copied when they were created.
          message="It stops being offered when anyone creates a new deck. Documents already made from it keep their slides and are not affected."
          onConfirm={() => {
            deleteTemplate(template.id);
            setConfirming(false);
            onChange();
            toast(`Deleted “${template.name}”.`, { tone: 'danger' });
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-2.5 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
        danger ? 'text-red-600' : ''
      }`}
    >
      {children}
    </button>
  );
}

/** Inline rename, shared by the card and the row so Enter/Escape behave alike. */
function NameInput({
  template,
  onDone,
  className,
}: {
  template: StoredTemplate;
  onDone: () => void;
  className: string;
}) {
  const [name, setName] = useState(template.name);
  return (
    <input
      autoFocus
      value={name}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => {
        const trimmed = name.trim();
        // A rename is metadata, so it deliberately doesn't bump `version` —
        // see `StoredTemplate.version`.
        if (trimmed && trimmed !== template.name) updateTemplateMeta(template.id, { name: trimmed });
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setName(template.name);
          onDone();
        }
      }}
      className={className}
    />
  );
}

function TemplateCard({
  template,
  usage,
  onChange,
}: {
  template: StoredTemplate;
  usage?: TemplateUsage;
  onChange: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);

  return (
    <div
      onClick={() => !renaming && router.push(`/admin/templates/${template.id}`)}
      className="group relative cursor-pointer rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {renaming ? (
              <NameInput
                template={template}
                onDone={() => {
                  setRenaming(false);
                  onChange();
                }}
                className="w-full rounded border border-indigo-300 bg-white px-1 py-0.5 text-sm font-medium outline-none dark:bg-zinc-800"
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {template.name}
                </span>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {template.category}
                </span>
              </div>
            )}
            <div className="mt-0.5 text-xs text-zinc-400">
              {template.slides.length} slide{template.slides.length === 1 ? '' : 's'} · v
              {template.version} · <UsageBadge usage={usage} />
            </div>
            <div className="mt-0.5 text-xs text-zinc-400">
              Last updated {timeAgo(template.updatedAt)}
            </div>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <TemplateMenu
              template={template}
              onRename={() => setRenaming(true)}
              onChange={onChange}
              buttonClassName="opacity-0 group-hover:opacity-100"
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-b-lg [&>div]:!w-full">
        <Thumb deck={{ slides: template.slides, slideSize: SLIDE_SIZE }} />
      </div>
    </div>
  );
}

/** The columns, in order, and which sort key each names — the table twin of
 *  `DocTable`'s header. */
const COLUMNS: { key: TemplateSortBy; label: string; className: string; center?: boolean }[] = [
  { key: 'name', label: 'Name', className: 'w-full py-1.5 pl-3 pr-3' },
  { key: 'category', label: 'Category', className: 'py-1.5 px-3', center: true },
  { key: 'slides', label: 'Slides', className: 'py-1.5 px-3', center: true },
  { key: 'updated', label: 'Last updated', className: 'py-1.5 px-3', center: true },
];

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sort: TemplateSort;
  onSort: (by: TemplateSortBy) => void;
}) {
  const active = sort.by === column.key;
  const caret = active ? (sort.dir === 'asc' ? '↑' : '↓') : '↓';
  return (
    <th
      className={`${column.className} font-medium`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        onClick={() => onSort(column.key)}
        title={`Sort by ${column.label.toLowerCase()}`}
        className={`group/sort flex w-full items-center gap-1 uppercase tracking-wide ${
          column.center ? 'justify-center' : ''
        } ${active ? 'text-zinc-600 dark:text-zinc-200' : 'hover:text-zinc-600 dark:hover:text-zinc-200'}`}
      >
        {column.label}
        <span
          aria-hidden
          className={`text-[10px] leading-none ${
            active ? '' : 'opacity-0 group-hover/sort:opacity-60'
          }`}
        >
          {caret}
        </span>
      </button>
    </th>
  );
}

function TemplateTable({
  templates,
  usage,
  sort,
  onSort,
  onChange,
}: {
  templates: StoredTemplate[];
  usage: Map<string, TemplateUsage>;
  sort: TemplateSort;
  onSort: (by: TemplateSortBy) => void;
  onChange: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    // Not a scroll container, for the reason `DocTable` spells out: `overflow`
    // of any kind clips the row menus, which hang outside the table box.
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 [&>th:first-child]:rounded-tl-lg [&>th:last-child]:rounded-tr-lg text-[11px] font-medium whitespace-nowrap uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
            {COLUMNS.map((c) => (
              <SortHeader key={c.key} column={c} sort={sort} onSort={onSort} />
            ))}
            <th className="py-1.5 pr-3 font-medium">Used by</th>
            <th className="w-8 pr-2" />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr
              key={t.id}
              onClick={() => renaming !== t.id && router.push(`/admin/templates/${t.id}`)}
              className="group cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-800/40"
            >
              <td className="w-full max-w-0 py-2 pl-3 pr-3">
                {renaming === t.id ? (
                  <NameInput
                    template={t}
                    onDone={() => {
                      setRenaming(null);
                      onChange();
                    }}
                    className="w-full min-w-0 rounded border border-indigo-300 bg-white px-1 py-0.5 text-sm outline-none dark:bg-zinc-800"
                  />
                ) : (
                  <div className="truncate text-sm text-zinc-800 dark:text-zinc-100">
                    {t.name}
                    <span className="ml-1.5 text-[11px] tabular-nums text-zinc-400">
                      v{t.version}
                    </span>
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-center text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-300">
                {t.category}
              </td>
              <td className="px-3 py-2 text-center text-xs tabular-nums whitespace-nowrap text-zinc-400">
                {t.slides.length}
              </td>
              <td className="px-3 py-2 text-center text-xs whitespace-nowrap text-zinc-400">
                {timeAgo(t.updatedAt)}
              </td>
              <td className="py-2 pr-3 text-xs whitespace-nowrap">
                <UsageBadge usage={usage.get(t.id)} />
              </td>
              {/* Its own stacking context, so later rows don't paint over an
                  open menu. */}
              <td className="relative w-8 py-2 pr-2 align-middle">
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <TemplateMenu
                    template={t}
                    onRename={() => setRenaming(t.id)}
                    onChange={onChange}
                    buttonClassName="opacity-0 group-hover:opacity-100"
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What "New template" is waiting for a category before it can do. */
type Pending = 'build' | 'upload' | { kind: 'doc'; id: string };

export function DeckTemplates() {
  const router = useRouter();
  const toast = useToast();
  const [templates, setTemplates] = useState<StoredTemplate[]>([]);
  const [docs, setDocs] = useState<Deck[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<TemplateSort>(DEFAULT_TEMPLATE_SORT);
  const [showThumbs, setShowThumbs] = useState(true);
  // Every entry point picks a category first, so a new template can't land
  // somewhere nobody browses — the same two-step Layouts uses for folders.
  const [pending, setPending] = useState<Pending | null>(null);
  const [pickingDoc, setPickingDoc] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<TemplateCategory | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    setTemplates(listTemplates());
    setDocs(listDocs());
  };

  useEffect(() => {
    seedIfFirstRun();
    refresh();
    // Read in an effect, not in the initializer: there's no localStorage during
    // the server render, and seeding state from it would hydrate a different
    // shelf than the markup says.
    if (window.localStorage.getItem(THUMBS_KEY) === '0') setShowThumbs(false);
  }, []);

  const toggleThumbs = () => {
    const next = !showThumbs;
    setShowThumbs(next);
    window.localStorage.setItem(THUMBS_KEY, next ? '1' : '0');
  };

  const usage = useMemo(() => templateUsage(docs, templates), [docs, templates]);

  const visible = useMemo(
    () => sortTemplates(filterTemplates(templates, { query, category }), sort),
    [templates, query, category, sort],
  );

  /** Category chosen: build opens the editor, upload the file dialog, and a
   *  document is promoted on the spot. */
  const startInCategory = (chosen: TemplateCategory) => {
    const action = pending;
    setPending(null);
    if (action === 'build') {
      const t = createTemplate({ name: 'Untitled template', category: chosen });
      router.push(`/admin/templates/${t.id}`);
    } else if (action === 'upload') {
      setPendingCategory(chosen);
      fileInputRef.current?.click();
    } else if (action && typeof action === 'object') {
      const deck = docs.find((d) => d.id === action.id);
      if (!deck) return;
      const t = createTemplateFromDeck(deck, {
        category: chosen,
        description: `Started from the “${deck.title}” document.`,
      });
      refresh();
      toast(`“${t.name}” is now a template.`);
      router.push(`/admin/templates/${t.id}`);
    }
  };

  const uploadReference = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const chosen = pendingCategory;
    setPendingCategory(null);
    if (!file || !chosen) return;
    // The picker's filter is deliberately loose, so the real check is here —
    // `type` is empty for a file the OS didn't recognise.
    if (!(file.type.startsWith('image/') || IMAGE_EXT.test(file.name))) {
      toast(
        `“${file.name}” isn't an image. A reference is a picture — export a PDF or deck page to PNG first.`,
        { tone: 'danger' },
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const t = createTemplateFromImage(reader.result as string, stripExt(file.name));
      updateTemplateMeta(t.id, { category: chosen });
      router.push(`/admin/templates/${t.id}`);
    };
    reader.onerror = () => toast(`Couldn't read “${file.name}”.`, { tone: 'danger' });
    reader.readAsDataURL(file);
  };

  const hasFilters = Boolean(query || category);

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        onChange={uploadReference}
        className="hidden"
      />

      <p className="mb-4 max-w-3xl text-[11px] leading-relaxed text-zinc-500">
        The decks everyone starts from. These are the templates the new-document
        picker offers, so an edit here is what the next person gets when they
        create a deck from the same template — decks already made keep the slides
        they were created with.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setPending((p) => (p === 'build' ? null : 'build'));
            setPickingDoc(false);
          }}
          className="rounded-md bg-black px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
        >
          + New template
        </button>
        <button
          onClick={() => {
            setPending((p) => (p === 'upload' ? null : 'upload'));
            setPickingDoc(false);
          }}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Upload a reference deck page
        </button>
        <button
          onClick={() => {
            setPickingDoc((p) => !p);
            setPending(null);
          }}
          title="Promote a document to a template everyone can start from"
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          From a document
        </button>
        <button
          onClick={() => {
            resetBuiltInTemplates();
            refresh();
            toast('Built-in templates rebuilt from the reference decks.');
          }}
          title="Rebuild the three standard reference decks from the shipped source, discarding edits made to them here. Templates you authored are left alone."
          className="ml-auto rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reset built-ins
        </button>
      </div>

      {/* Step one of "From a document": which document. Picking one leaves
          `pending` set, so the category row below takes over. */}
      {pickingDoc ? (
        <div className="mb-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Which document?
          </div>
          {docs.length === 0 ? (
            <p className="text-xs text-zinc-400">There are no documents to promote yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {docs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setPickingDoc(false);
                    setPending({ kind: 'doc', id: d.id });
                  }}
                  className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {d.title}
                  <span className="ml-1.5 text-[10px] text-zinc-400">{d.slides.length} slides</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {pending ? (
        <div className="mb-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Which category?
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => startInCategory(c)}
                className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* One toolbar row, laid out like the dashboard's: search and filter on
          the left, sort at the right edge. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <div className="relative w-72">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 pr-7 text-sm outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                title="Clear search"
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                ×
              </button>
            ) : null}
          </div>
          <ToolbarSelect
            label="Filter by category"
            value={category}
            onChange={setCategory}
            active={Boolean(category)}
          >
            <option value="">All categories</option>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </ToolbarSelect>
          {hasFilters ? (
            <button
              onClick={() => {
                setQuery('');
                setCategory('');
              }}
              className="shrink-0 rounded px-1 text-xs font-medium text-red-500 hover:text-red-600 hover:underline dark:text-red-400 dark:hover:text-red-300"
            >
              Clear
            </button>
          ) : null}
        </div>

        <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
          Sort by
          <ToolbarSelect
            label="Sort by"
            value={sort.by}
            // Picking a key here takes that key's own direction; the column
            // headers are where you reverse one.
            onChange={(v) =>
              setSort({
                by: v as TemplateSortBy,
                dir: TEMPLATE_SORT_DEFAULT_DIR[v as TemplateSortBy],
              })
            }
          >
            {TEMPLATE_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </ToolbarSelect>
        </label>
      </div>

      <ShelfHeader
        label={hasFilters ? 'Results' : 'All templates'}
        showThumbs={showThumbs}
        onToggleThumbs={toggleThumbs}
      />

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {hasFilters ? 'No templates match your search.' : 'No templates yet.'}
        </div>
      ) : showThumbs ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {visible.map((t) => (
            <TemplateCard key={t.id} template={t} usage={usage.get(t.id)} onChange={refresh} />
          ))}
        </div>
      ) : (
        <TemplateTable
          templates={visible}
          usage={usage}
          sort={sort}
          onSort={(by) => setSort((s) => nextTemplateSort(s, by))}
          onChange={refresh}
        />
      )}
    </div>
  );
}
