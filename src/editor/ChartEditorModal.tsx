'use client';

/**
 * Chart creation/edit popup: an editable spreadsheet for the underlying data,
 * design controls (type, orientation, series colors), dimensions, and axis
 * labels — all mirrored live in a preview pane rendered through the same
 * SlideView the canvas and export use, so what you see is what you get.
 */
import { useEffect, useState } from 'react';
import { SlideView } from '@/render/SlideView';
import { token, type ColorRef, type DesignSystem, type SlideChartConfig } from '@/model';
import { buildChartElements, CHART_TYPES } from '@/templates/charts';

const SLIDE_SIZE = { w: 12_192_000, h: 6_858_000 };

function cloneConfig(cfg: SlideChartConfig): SlideChartConfig {
  return JSON.parse(JSON.stringify(cfg));
}

function ColorSwatch({
  color,
  ds,
  onPick,
}: {
  color: ColorRef;
  ds: DesignSystem;
  onPick: (c: ColorRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const hex = color.kind === 'hex' ? color.hex : ds.colors.find((c) => c.id === color.token)?.hex ?? '#000000';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Series color"
        className="h-5 w-5 shrink-0 rounded-full ring-1 ring-black/10"
        style={{ background: hex }}
      />
      {open ? (
        <div className="absolute left-0 top-6 z-10 flex flex-wrap gap-1 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          {ds.colors.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onPick(token(c.id));
                setOpen(false);
              }}
              title={c.name}
              className="h-5 w-5 rounded-full ring-1 ring-black/10 hover:scale-110"
              style={{ background: c.hex }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChartEditorModal({
  initial,
  ds,
  saveLabel,
  onCancel,
  onSave,
}: {
  initial: SlideChartConfig;
  ds: DesignSystem;
  saveLabel: string;
  onCancel: () => void;
  onSave: (config: SlideChartConfig) => void;
}) {
  const [config, setConfig] = useState<SlideChartConfig>(() => cloneConfig(initial));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const typeDef = CHART_TYPES.find((t) => t.id === config.type);
  const showAxisLabels = config.type !== 'pie' && config.type !== 'donut';

  const patch = (fn: (cfg: SlideChartConfig) => void) => {
    setConfig((prev) => {
      const next = cloneConfig(prev);
      fn(next);
      return next;
    });
  };

  const addCategory = () =>
    patch((c) => {
      c.data.categories.push(`Category ${c.data.categories.length + 1}`);
      c.data.series.forEach((s) => s.values.push(0));
    });

  const removeCategory = (ci: number) =>
    patch((c) => {
      if (c.data.categories.length <= 1) return;
      c.data.categories.splice(ci, 1);
      c.data.series.forEach((s) => s.values.splice(ci, 1));
    });

  const addSeries = () =>
    patch((c) => {
      const color = ds.colors[c.data.series.length % ds.colors.length];
      c.data.series.push({
        name: `Series ${c.data.series.length + 1}`,
        color: token(color?.id ?? 'brand.accent'),
        values: c.data.categories.map(() => 0),
      });
    });

  const removeSeries = (si: number) =>
    patch((c) => {
      if (c.data.series.length <= 1) return;
      c.data.series.splice(si, 1);
    });

  const preview = buildChartElements(config);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">{typeDef?.name ?? 'Chart'}</h2>
          <button
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-0 overflow-y-auto">
          {/* Left: data + design controls */}
          <div className="space-y-5 border-r border-zinc-200 p-5 dark:border-zinc-800">
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Data</div>
              <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                      <th className="p-1.5 text-left font-medium text-zinc-500">Category</th>
                      {config.data.series.map((s, si) => (
                        <th key={si} className="p-1.5">
                          <div className="flex items-center gap-1.5">
                            <ColorSwatch
                              color={s.color}
                              ds={ds}
                              onPick={(c) => patch((cfg) => (cfg.data.series[si].color = c))}
                            />
                            <input
                              value={s.name}
                              onChange={(e) =>
                                patch((cfg) => (cfg.data.series[si].name = e.target.value))
                              }
                              className="w-full min-w-0 bg-transparent text-xs font-medium outline-none"
                            />
                            {config.data.series.length > 1 ? (
                              <button
                                onClick={() => removeSeries(si)}
                                title="Remove series"
                                className="text-zinc-400 hover:text-red-500"
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {config.data.categories.map((cat, ci) => (
                      <tr key={ci} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className="p-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              value={cat}
                              onChange={(e) =>
                                patch((cfg) => (cfg.data.categories[ci] = e.target.value))
                              }
                              className="w-full min-w-0 bg-transparent text-xs outline-none"
                            />
                            {config.data.categories.length > 1 ? (
                              <button
                                onClick={() => removeCategory(ci)}
                                title="Remove category"
                                className="text-zinc-400 hover:text-red-500"
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        </td>
                        {config.data.series.map((s, si) => (
                          <td key={si} className="p-1.5">
                            <input
                              type="number"
                              value={s.values[ci] ?? 0}
                              onChange={(e) =>
                                patch(
                                  (cfg) => (cfg.data.series[si].values[ci] = Number(e.target.value) || 0),
                                )
                              }
                              className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none hover:border-zinc-200 focus:border-indigo-300 dark:hover:border-zinc-700"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={addCategory}
                  className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  + Add category
                </button>
                <button
                  onClick={addSeries}
                  className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  + Add series
                </button>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Design</div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                  Type
                  <select
                    value={config.type}
                    onChange={(e) => patch((cfg) => (cfg.type = e.target.value as SlideChartConfig['type']))}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {CHART_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>

                {typeDef?.orientable ? (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    Orientation
                    <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700">
                      {(['vertical', 'horizontal'] as const).map((o) => (
                        <button
                          key={o}
                          onClick={() => patch((cfg) => (cfg.orientation = o))}
                          className={`px-2 py-1 text-xs first:rounded-l-md last:rounded-r-md ${
                            config.orientation === o
                              ? 'bg-indigo-600 text-white'
                              : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {o === 'vertical' ? 'Vertical' : 'Horizontal'}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Dimensions</div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                  Width (in)
                  <input
                    type="number"
                    min={2}
                    max={12.5}
                    step={0.1}
                    value={config.box.w}
                    onChange={(e) => patch((cfg) => (cfg.box.w = Number(e.target.value) || cfg.box.w))}
                    className="w-16 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                  Height (in)
                  <input
                    type="number"
                    min={2}
                    max={7}
                    step={0.1}
                    value={config.box.h}
                    onChange={(e) => patch((cfg) => (cfg.box.h = Number(e.target.value) || cfg.box.h))}
                    className="w-16 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
              </div>
            </div>

            {showAxisLabels ? (
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Axis labels
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    X axis
                    <input
                      value={config.xLabel ?? ''}
                      onChange={(e) => patch((cfg) => (cfg.xLabel = e.target.value))}
                      placeholder="(none)"
                      className="w-32 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    Y axis
                    <input
                      value={config.yLabel ?? ''}
                      onChange={(e) => patch((cfg) => (cfg.yLabel = e.target.value))}
                      placeholder="(none)"
                      className="w-32 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </div>

          {/* Right: live preview */}
          <div className="flex flex-col items-center justify-center bg-zinc-50 p-5 dark:bg-zinc-950">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Preview</div>
            <div className="overflow-hidden rounded-md shadow-sm ring-1 ring-black/10">
              <SlideView
                slide={{ id: 'preview', elements: preview, background: { kind: 'solid', color: token('surface.base') } }}
                slideSize={SLIDE_SIZE}
                designSystem={ds}
                width={420}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(config)}
            className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
