'use client';

/**
 * The chart-template library, in Admin.
 *
 * A flat grid grouped by category rather than the album drill-down Layouts
 * uses: there are a dozen or two chart templates, not hundreds, and making
 * someone open a folder to find "Revenue waterfall" is friction with nothing
 * on the other side of it.
 *
 * Auto-persisting, like Layouts — every action writes immediately, so there's
 * no Save button and nothing to lose by navigating away.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FitSlideView } from '@/render/FitSlideView';
import {
  defaultChartSpec,
  inchesToEmu,
  SLIDE_16x9,
  token,
  withChartStyleDefaults,
  type ChartKind,
  type DesignSystem,
} from '@/model';
import { compileChart } from '@/chart/compile';
import {
  createChartTemplate,
  deleteChartTemplate,
  duplicateChartTemplate,
  listChartTemplates,
  resetBuiltInChartTemplates,
  seedChartTemplatesIfFirstRun,
  updateChartTemplateMeta,
  type StoredChartTemplate,
} from '@/charts/repository';
import { CHART_TEMPLATE_CATEGORIES, type ChartTemplateCategory } from '@/charts/registry';
import { CHART_KIND_LABELS } from '@/charts/kinds';
import { dsForChartTemplate } from '@/charts/style';

const SLIDE_SIZE = { w: SLIDE_16x9.w, h: SLIDE_16x9.h };

/**
 * The kinds a new template can start from, in the order they're offered.
 *
 * A subset of the styleable kinds, not all of them: combo, donut and sankey are
 * reached by editing a template, not by starting one. Words come from
 * `CHART_KIND_LABELS` so this picker says what every other surface says.
 */
const NEW_KINDS: ChartKind[] = [
  'column',
  'bar',
  'line',
  'area',
  'pie',
  'waterfall',
  'mekko',
  'scatter',
  'bubble',
];

export function ChartTemplates({ ds }: { ds: DesignSystem }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<StoredChartTemplate[]>([]);
  const [adding, setAdding] = useState(false);

  const refresh = () => setTemplates(listChartTemplates());

  const style = useMemo(() => withChartStyleDefaults(ds.chart), [ds.chart]);

  useEffect(() => {
    // Seeded against the brand: a template built from the house defaults would
    // pin legend, labels and gaps that then beat Admin's own controls.
    seedChartTemplatesIfFirstRun(withChartStyleDefaults(ds.chart));
    setTemplates(listChartTemplates());
    // Seeding is first-run only, so it deliberately doesn't re-run per edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byCategory = useMemo(() => {
    const map = new Map<ChartTemplateCategory, StoredChartTemplate[]>();
    for (const t of templates) {
      map.set(t.category, [...(map.get(t.category) ?? []), t]);
    }
    return map;
  }, [templates]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAdding((a) => !a)}
          className="rounded-md bg-black px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
        >
          + New chart template
        </button>
        <button
          onClick={() => {
            resetBuiltInChartTemplates(style);
            refresh();
          }}
          title="Rebuild the built-in templates against the current chart style. Use this after changing legend, data labels, gaps or number format — a template pins those when it is built. Your own templates are left alone."
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reset built-ins
        </button>
      </div>

      {adding ? (
        <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          {NEW_KINDS.map((kind) => (
            <button
              key={kind}
              onClick={() => {
                const t = createChartTemplate({
                  name: `New ${CHART_KIND_LABELS[kind].toLowerCase()} template`,
                  spec: defaultChartSpec(kind, 'stacked', style),
                });
                setAdding(false);
                router.push(`/admin/charts/${t.id}`);
              }}
              className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {CHART_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      ) : null}

      {CHART_TEMPLATE_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => (
        <div key={category}>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {category}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {(byCategory.get(category) ?? []).map((t) => (
              <ChartTemplateCard key={t.id} template={t} ds={ds} onChange={refresh} />
            ))}
          </div>
        </div>
      ))}

      {!templates.length ? (
        <p className="text-center text-[11px] text-zinc-400">
          No chart templates yet.
        </p>
      ) : null}
    </div>
  );
}

function ChartTemplateCard({
  template,
  ds,
  onChange,
}: {
  template: StoredChartTemplate;
  ds: DesignSystem;
  onChange: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(template.name);

  // Through the real compiler, so a card can't advertise something the
  // template doesn't produce.
  // The template's own deviations layered over the brand, so a card shows what
  // the template actually produces rather than the unlayered house style.
  const templateDs = useMemo(
    () => dsForChartTemplate(ds, template.styleOverrides),
    [ds, template.styleOverrides],
  );

  const slide = useMemo(() => {
    const { elements } = compileChart(
      {
        id: 'preview',
        groupId: 'pg',
        frame: {
          x: inchesToEmu(0.4),
          y: inchesToEmu(0.4),
          w: SLIDE_SIZE.w - inchesToEmu(0.8),
          h: SLIDE_SIZE.h - inchesToEmu(0.8),
        },
        spec: template.spec,
      },
      templateDs,
    );
    return {
      id: 'preview',
      background: { kind: 'solid' as const, color: token('surface.base') },
      elements,
    };
  }, [template.spec, templateDs]);

  return (
    <div className="group relative overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={() => router.push(`/admin/charts/${template.id}`)}
        className="block w-full text-left"
      >
        <div className="border-b border-zinc-100 dark:border-zinc-800">
          <FitSlideView slide={slide} slideSize={SLIDE_SIZE} designSystem={templateDs} />
        </div>
      </button>

      <div className="px-2.5 py-2">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              updateChartTemplateMeta(template.id, { name: name.trim() || template.name });
              setRenaming(false);
              onChange();
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-full rounded border border-indigo-300 px-1 py-0.5 text-xs outline-none dark:bg-zinc-900"
          />
        ) : (
          <div className="truncate text-xs font-medium">{template.name}</div>
        )}
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-zinc-400">
          {template.description}
        </div>
      </div>

      <div className="absolute right-1.5 top-1.5">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-zinc-500 opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-zinc-900 dark:bg-zinc-800/90 dark:text-zinc-300"
        >
          ⋯
        </button>
        {menuOpen ? (
          <div
            onMouseLeave={() => setMenuOpen(false)}
            className="absolute right-0 top-7 z-10 w-32 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
          >
            <MenuItem
              onClick={() => {
                setRenaming(true);
                setMenuOpen(false);
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              onClick={() => {
                duplicateChartTemplate(template.id);
                setMenuOpen(false);
                onChange();
              }}
            >
              Duplicate
            </MenuItem>
            <MenuItem
              danger
              onClick={() => {
                deleteChartTemplate(template.id);
                setMenuOpen(false);
                onChange();
              }}
            >
              Delete
            </MenuItem>
          </div>
        ) : null}
      </div>
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
