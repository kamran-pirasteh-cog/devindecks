'use client';

/**
 * Per-kind chart style variants.
 *
 * The half of the Charts tab that answers "how do WE draw a column chart" —
 * and lets the answer be more than one. A variant is formatting only: no data,
 * no archetype, nothing pinned. That's the whole line between this and a house
 * template, and it's why a variant edit reflows every chart inserted from it
 * while a template edit doesn't.
 *
 * Editing works by resolving the variant against the conventions, handing the
 * resolved style to the SAME controls the conventions panel uses, and storing
 * back only the difference. So "inherited" is the default state of every
 * control without any control having to know it.
 */
import { useState } from 'react';
import { nanoid } from 'nanoid';
import {
  diffChartStyle,
  resolveChartStyle,
  variantOverridesCount,
  withChartStyleDefaults,
  withDefaultVariant,
  type ChartKind,
  type ChartStyle,
  type ChartStyleVariant,
  type DesignSystem,
} from '@/model';
import type { ChartPreviewData } from '@/model';
import { CHART_KIND_LABELS, STYLEABLE_KINDS } from '@/charts/kinds';
import { ChartPreviewDataEditor } from './ChartPreviewDataEditor';
import { ChartStyleControls } from './ChartStyleControls';
import { ChartStylePreview } from './ChartStylePreview';

const BTN =
  'rounded border border-zinc-200 px-2 py-1 text-[11px] transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800';

/** A stacked column shows more of a style than a clustered one does. */
const previewStackFor = (kind: ChartKind) =>
  kind === 'column' || kind === 'bar' ? ('stacked' as const) : undefined;

export function ChartVariants({
  ds,
  onChange,
  onPreviewData,
}: {
  ds: DesignSystem;
  onChange: (variants: ChartStyleVariant[]) => void;
  /** The dummy data every preview on the tab draws — see `ChartPreviewDataEditor`. */
  onPreviewData: (next: ChartPreviewData | undefined) => void;
}) {
  const variants = ds.chartVariants ?? [];
  const [kind, setKind] = useState<ChartKind>('column');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const conventions = withChartStyleDefaults(ds.chart);
  const forKind = variants.filter((v) => v.kind === kind);
  const editing = forKind.find((v) => v.id === editingId) ?? null;

  const dsFor = (v: ChartStyleVariant): DesignSystem => ({
    ...ds,
    chart: resolveChartStyle(conventions, v.overrides),
  });

  const add = (from?: ChartStyleVariant) => {
    const created: ChartStyleVariant = {
      id: `chartvar-${nanoid(8)}`,
      kind,
      name: from ? `${from.name} copy` : `${CHART_KIND_LABELS[kind]} ${forKind.length + 1}`,
      // The first variant of a kind becomes its default, because a kind whose
      // only variant isn't the one it inserts as is a trap.
      isDefault: forKind.length === 0,
      overrides: from ? structuredClone(from.overrides) : {},
    };
    onChange([...variants, created]);
    setEditingId(created.id);
  };

  const update = (id: string, fn: (v: ChartStyleVariant) => ChartStyleVariant) =>
    onChange(variants.map((v) => (v.id === id ? fn(v) : v)));

  const remove = (v: ChartStyleVariant) => {
    const rest = variants.filter((x) => x.id !== v.id);
    // Deleting the default hands the flag to whatever's left of that kind, so
    // the kind never ends up with variants but no default.
    const orphaned = v.isDefault && rest.some((x) => x.kind === v.kind);
    const next = orphaned
      ? withDefaultVariant(rest, rest.find((x) => x.kind === v.kind)!.id)
      : rest;
    onChange(next);
    if (editingId === v.id) setEditingId(null);
    setConfirmDelete(null);
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">Chart types</h3>
      <p className="mb-3 mt-0.5 text-[11px] leading-relaxed text-zinc-500">
        Named ways to draw each type, layered on the conventions above. Authors
        drop these into a slide as blank charts; the default is what a plain
        insert of that type uses.
      </p>

      <div className="grid gap-4 lg:grid-cols-[10rem_1fr]">
        <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {STYLEABLE_KINDS.map((k) => {
            const n = variants.filter((v) => v.kind === k).length;
            return (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setEditingId(null);
                }}
                className={`flex shrink-0 items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] transition ${
                  k === kind
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                <span>{CHART_KIND_LABELS[k]}</span>
                {n > 0 ? (
                  <span className={k === kind ? 'opacity-70' : 'text-zinc-400'}>{n}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div>
          {editing ? (
            <VariantEditor
              ds={dsFor(editing)}
              variant={editing}
              onBack={() => setEditingId(null)}
              onRename={(name) => update(editing.id, (v) => ({ ...v, name }))}
              onStyle={(next) =>
                update(editing.id, (v) => ({
                  ...v,
                  overrides: diffChartStyle(conventions, next),
                }))
              }
              onReset={() => update(editing.id, (v) => ({ ...v, overrides: {} }))}
              onPreviewData={onPreviewData}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {forKind.map((v) => (
                  <div
                    key={v.id}
                    className="group rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
                  >
                    <ChartStylePreview
                      ds={dsFor(v)}
                      charts={[{ kind: v.kind, stack: previewStackFor(v.kind) }]}
                    />
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium">{v.name}</span>
                      {v.isDefault ? (
                        <span className="rounded bg-indigo-50 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      {variantOverridesCount(v.overrides) === 0
                        ? 'Inherits the conventions'
                        : `${variantOverridesCount(v.overrides)} override${
                            variantOverridesCount(v.overrides) === 1 ? '' : 's'
                          }`}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button className={BTN} onClick={() => setEditingId(v.id)}>
                        Edit
                      </button>
                      <button className={BTN} onClick={() => add(v)}>
                        Duplicate
                      </button>
                      <button
                        className={BTN}
                        disabled={v.isDefault}
                        onClick={() => onChange(withDefaultVariant(variants, v.id))}
                      >
                        Make default
                      </button>
                      {confirmDelete === v.id ? (
                        <>
                          <button
                            className={`${BTN} border-red-300 text-red-600 dark:border-red-800`}
                            onClick={() => remove(v)}
                          >
                            Really delete
                          </button>
                          <button className={BTN} onClick={() => setConfirmDelete(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className={`${BTN} text-red-600`}
                          onClick={() => setConfirmDelete(v.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => add()}
                  className="flex min-h-[8rem] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-zinc-300 text-[11px] text-zinc-500 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700"
                >
                  <span className="text-lg leading-none">+</span>
                  New {CHART_KIND_LABELS[kind].toLowerCase()} style
                </button>
              </div>

              {forKind.length === 0 ? (
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                  No {CHART_KIND_LABELS[kind].toLowerCase()} styles yet — these
                  charts draw with the conventions alone.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function VariantEditor({
  ds,
  variant,
  onBack,
  onRename,
  onStyle,
  onReset,
  onPreviewData,
}: {
  /** A design system carrying the RESOLVED style, so the preview is honest. */
  ds: DesignSystem;
  variant: ChartStyleVariant;
  onBack: () => void;
  onRename: (name: string) => void;
  onStyle: (next: ChartStyle) => void;
  onReset: () => void;
  onPreviewData: (next: ChartPreviewData | undefined) => void;
}) {
  const count = variantOverridesCount(variant.overrides);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className={BTN} onClick={onBack}>
          ← All {CHART_KIND_LABELS[variant.kind].toLowerCase()} styles
        </button>
        <input
          value={variant.name}
          onChange={(e) => onRename(e.target.value)}
          className="rounded border border-transparent px-1 py-0.5 text-[13px] font-medium outline-none hover:border-zinc-200 focus:border-indigo-400 dark:hover:border-zinc-700 dark:bg-transparent"
        />
        <span className="text-[10px] text-zinc-400">
          {count === 0 ? 'inherits everything' : `${count} override${count === 1 ? '' : 's'}`}
        </span>
        <button className={`${BTN} ml-auto`} disabled={count === 0} onClick={onReset}>
          Reset to conventions
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <ChartStyleControls ds={ds} style={ds.chart} onChange={onStyle} />
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Preview
          </div>
          <ChartStylePreview
            ds={ds}
            charts={[{ kind: variant.kind, stack: previewStackFor(variant.kind) }]}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            Anything left untouched follows the conventions — edit the
            conventions and this style follows along.
          </p>

          {/* Shared with the conventions panel on purpose: the dummy data is
              the brand's, not this variant's, so two styles of the same kind
              are always compared on the same numbers. */}
          <div className="mt-3">
            <ChartPreviewDataEditor data={ds.previewData} onChange={onPreviewData} />
          </div>
        </div>
      </div>
    </div>
  );
}
