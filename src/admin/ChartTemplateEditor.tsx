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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  inchesToEmu,
  sheetFromSpec,
  SLIDE_16x9,
  specFromSheet,
  token,
  type ChartRef,
  type ChartSpec,
  type DesignSystem,
  type SheetModel,
} from '@/model';
import { SheetGrid } from '@/sheet/SheetGrid';
import { ChartPartOptions } from '@/editor/chart/ChartPartOptions';
import { ChartPreview } from '@/editor/chart/ChartPreview';
import { getActiveDesignSystem } from '@/design/repository';
import {
  getChartTemplate,
  saveChartTemplateSpec,
  updateChartTemplateMeta,
  type StoredChartTemplate,
} from '@/charts/repository';
import { CHART_TEMPLATE_CATEGORIES, type ChartTemplateCategory } from '@/charts/registry';
import { dsForChartTemplate } from '@/charts/style';
import { buildDevinChartPrompt } from '@/devin/prompt';

/**
 * The chart's own frame, not a whole slide.
 *
 * A template is an archetype for a chart that lands in a content area, so the
 * editor previews it at the size one actually gets — a 16:9 slide inset by its
 * margins — and gives the whole preview over to the chart rather than spending
 * half of it on empty slide.
 */
const FRAME_SIZE = {
  w: SLIDE_16x9.w - inchesToEmu(1.2),
  h: SLIDE_16x9.h - inchesToEmu(1.2),
};

const FIELD =
  'rounded border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900';

export function ChartTemplateEditor({ id }: { id: string }) {
  const router = useRouter();
  const [ds, setDs] = useState<DesignSystem | null>(null);
  const [template, setTemplate] = useState<StoredChartTemplate | null>(null);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [dirty, setDirty] = useState(false);
  /** The part clicked in the preview, or null for the template as a whole. */
  const [part, setPart] = useState<ChartRef | null>(null);

  useEffect(() => {
    setDs(getActiveDesignSystem());
    const t = getChartTemplate(id);
    setTemplate(t);
    setSpec(t ? structuredClone(t.spec) : null);
    setPart(null);
  }, [id]);

  /**
   * The same write the editor's format bar makes, against LOCAL state.
   *
   * Cloned rather than mutated: the controls mutate a draft in place, and every
   * `useMemo` downstream — the preview, the sheet — keys off spec identity.
   */
  const patch = useCallback((fn: (draft: ChartSpec) => void) => {
    setSpec((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      fn(next);
      return next;
    });
    setDirty(true);
  }, []);

  const sheet = useMemo(() => (spec ? sheetFromSpec(spec) : null), [spec]);

  /**
   * The brand with this template's own deviations layered on.
   *
   * The preview has to compile through the same layering an inserted chart
   * gets, or an author formats against one picture and their deck gets
   * another.
   */
  const styledDs = useMemo(
    () => (ds ? dsForChartTemplate(ds, template?.styleOverrides) : null),
    [ds, template?.styleOverrides],
  );

  if (!ds || !styledDs) return null;
  if (!template || !spec || !sheet) {
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
          title={
            dirty
              ? 'Save the archetype. New charts made from it get these settings, and charts already in a deck offer to update — their numbers are kept.'
              : 'No unsaved changes'
          }
          className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-zinc-800 dark:bg-white dark:text-black"
        >
          {dirty ? 'Save template' : 'Saved'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The editor's own format bar, driving this template's spec. Same
              component, same writes — see `ChartPartOptions`. */}
          <ChartPartOptions
            spec={spec}
            ds={styledDs}
            part={part}
            patch={patch}
            onClear={() => setPart(null)}
            trailing={
              <span className="text-[11px] text-zinc-400">
                {part
                  ? 'Editing this template — every chart made from it starts here'
                  : 'Click a part of the preview — an axis, a bar, the legend — to format it'}
              </span>
            }
          />

          {/* Capped by HEIGHT, not width: the preview keeps the frame's
              proportions, and left to fill the column it eats the screen and
              squeezes the datasheet under it down to a row and a half. */}
          <div
            className="mx-auto w-full shrink-0 p-4"
            style={{ maxWidth: `calc(45vh * ${FRAME_SIZE.w / FRAME_SIZE.h})` }}
          >
            <ChartPreview
              spec={spec}
              ds={styledDs}
              size={FRAME_SIZE}
              background={{ kind: 'solid', color: token('surface.base') }}
              part={part}
              onPart={setPart}
              patch={patch}
              className="rounded-lg ring-1 ring-black/10"
            />
          </div>
          <div className="min-h-0 flex-1 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <SheetGrid sheet={sheet} ds={styledDs} onChange={applySheet} />
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
