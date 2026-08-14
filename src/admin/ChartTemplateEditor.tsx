'use client';

/**
 * Authoring one chart template.
 *
 * Deliberately the SAME surfaces the editor uses — the real datasheet, the real
 * properties panel, the real compiler — rather than a parallel admin-only form.
 * A template authored through a different UI drifts from what it produces, and
 * the drift is invisible until someone inserts one.
 *
 * The template's own spec is the source of truth here, held locally and saved
 * explicitly, because a half-edited archetype shouldn't leak into every deck
 * that references it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FitSlideView } from '@/render/FitSlideView';
import {
  inchesToEmu,
  sheetFromSpec,
  SLIDE_16x9,
  specFromSheet,
  token,
  type ChartSpec,
  type DesignSystem,
  type SheetModel,
} from '@/model';
import { compileChart } from '@/chart/compile';
import { SheetGrid } from '@/sheet/SheetGrid';
import { getActiveDesignSystem } from '@/design/repository';
import {
  getChartTemplate,
  saveChartTemplateSpec,
  updateChartTemplateMeta,
  type StoredChartTemplate,
} from '@/charts/repository';
import { CHART_TEMPLATE_CATEGORIES, type ChartTemplateCategory } from '@/charts/registry';
import { buildDevinChartPrompt } from '@/devin/prompt';

const SLIDE_SIZE = { w: SLIDE_16x9.w, h: SLIDE_16x9.h };

const FIELD =
  'rounded border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900';

export function ChartTemplateEditor({ id }: { id: string }) {
  const router = useRouter();
  const [ds, setDs] = useState<DesignSystem | null>(null);
  const [template, setTemplate] = useState<StoredChartTemplate | null>(null);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDs(getActiveDesignSystem());
    const t = getChartTemplate(id);
    setTemplate(t);
    setSpec(t ? structuredClone(t.spec) : null);
  }, [id]);

  const slide = useMemo(() => {
    if (!spec || !ds) return null;
    const { elements } = compileChart(
      {
        id: 'preview',
        groupId: 'pg',
        frame: {
          x: inchesToEmu(0.6),
          y: inchesToEmu(0.6),
          w: SLIDE_SIZE.w - inchesToEmu(1.2),
          h: SLIDE_SIZE.h - inchesToEmu(1.2),
        },
        spec,
      },
      ds,
    );
    return {
      id: 'preview',
      background: { kind: 'solid' as const, color: token('surface.base') },
      elements,
    };
  }, [spec, ds]);

  const sheet = useMemo(() => (spec ? sheetFromSpec(spec) : null), [spec]);

  if (!ds) return null;
  if (!template || !spec || !sheet || !slide) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        That chart template no longer exists.{' '}
        <button onClick={() => router.push('/admin')} className="underline">
          Back to Admin
        </button>
      </div>
    );
  }

  const applySheet = (next: SheetModel) => {
    setSpec(specFromSheet(next, spec).spec);
    setDirty(true);
  };

  const save = () => {
    saveChartTemplateSpec(template.id, spec, template.styleOverrides);
    setDirty(false);
  };

  // Generated from the template's own spec, so an author can see exactly what
  // researchers will be asked before anyone inserts one.
  const promptPreview = buildDevinChartPrompt(spec, {
    deckTitle: template.name,
    ...(template.research?.company ? { deckTags: [template.research.company] } : {}),
  });

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => router.push('/admin')}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Admin
        </button>
        <input
          value={template.name}
          onChange={(e) => setTemplate({ ...template, name: e.target.value })}
          onBlur={() => updateChartTemplateMeta(template.id, { name: template.name })}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
        />
        <span className="text-[11px] text-zinc-400">v{template.version}</span>
        <button
          onClick={save}
          disabled={!dirty}
          className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-zinc-800 dark:bg-white dark:text-black"
        >
          {dirty ? 'Save template' : 'Saved'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 p-4">
            <div className="overflow-hidden rounded-lg ring-1 ring-black/10">
              <FitSlideView slide={slide} slideSize={SLIDE_SIZE} designSystem={ds} />
            </div>
          </div>
          <div className="min-h-0 flex-1 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <SheetGrid sheet={sheet} ds={ds} onChange={applySheet} />
          </div>
        </div>

        <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              About
            </div>
            <textarea
              value={template.description}
              onChange={(e) => setTemplate({ ...template, description: e.target.value })}
              onBlur={() => updateChartTemplateMeta(template.id, { description: template.description })}
              rows={3}
              placeholder="What is this template for?"
              className={`${FIELD} w-full resize-none`}
            />
            <select
              value={template.category}
              onChange={(e) => {
                const category = e.target.value as ChartTemplateCategory;
                setTemplate({ ...template, category });
                updateChartTemplateMeta(template.id, { category });
              }}
              className={`${FIELD} mt-2 w-full`}
            >
              {CHART_TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Research guidance
            </div>
            <p className="mb-1.5 text-[11px] leading-relaxed text-zinc-500">
              Goes into the Devin prompt for every chart made from this template
              — house rules the chart itself can&apos;t imply.
            </p>
            <textarea
              value={template.research?.guidance ?? ''}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  research: { ...template.research, guidance: e.target.value },
                })
              }
              onBlur={() => updateChartTemplateMeta(template.id, { research: template.research })}
              rows={4}
              placeholder="e.g. Use reported segment revenue, not adjusted."
              className={`${FIELD} w-full resize-none`}
            />
            <input
              value={template.research?.preferredSources?.join(', ') ?? ''}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  research: {
                    ...template.research,
                    preferredSources: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              onBlur={() => updateChartTemplateMeta(template.id, { research: template.research })}
              placeholder="Preferred sources, comma separated"
              className={`${FIELD} mt-2 w-full`}
            />
          </div>

          <details className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
            <summary className="cursor-pointer text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
              Devin prompt this produces
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] leading-snug text-zinc-500">
              {promptPreview.text}
            </pre>
          </details>
        </aside>
      </div>
    </div>
  );
}
