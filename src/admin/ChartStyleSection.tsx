'use client';

/**
 * The brand's chart CONVENTIONS — the rules every chart starts from.
 *
 * Half of the Charts tab. The other half is per-kind variants
 * (`ChartVariants`), which layer on top of what's edited here. Keeping the two
 * visibly separate is the point: this panel answers "how do our charts look",
 * and a variant answers "…except our gridless columns".
 *
 * Structured like `PageNumbersSection`: compact controls beside a LIVE preview
 * compiled through the real engine. Previewing the rule rather than describing
 * it is the only way anyone can tell what "gridlines: major" actually does.
 */
import { useState } from 'react';
import type { ChartPreviewData, ChartStyle, DesignSystem } from '@/model';
import { ChartPreviewDataEditor } from './ChartPreviewDataEditor';
import { ChartStyleControls } from './ChartStyleControls';
import { ChartStylePreview, type PreviewChart } from './ChartStylePreview';

/**
 * What the preview can show.
 *
 * The panel used to be pinned to column+line, so nothing you did to a pie,
 * a waterfall or a scatter was visible until you inserted one — even though
 * those settings applied to them just the same.
 */
const PREVIEW_SETS: { id: string; label: string; charts: PreviewChart[] }[] = [
  {
    id: 'bars',
    label: 'Bars + line',
    charts: [
      { kind: 'column', stack: 'stacked', title: 'Stacked column' },
      { kind: 'line', title: 'Line' },
    ],
  },
  { id: 'pie', label: 'Pie', charts: [{ kind: 'pie', title: 'Share of revenue' }] },
  {
    id: 'waterfall',
    label: 'Waterfall',
    charts: [{ kind: 'waterfall', title: 'Revenue bridge' }],
  },
  {
    id: 'xy',
    label: 'Scatter',
    charts: [{ kind: 'scatter', title: 'Accounts' }],
  },
  { id: 'mekko', label: 'Mekko', charts: [{ kind: 'mekko', title: 'Market structure' }] },
];

export function ChartStyleSection({
  ds,
  onChange,
  onPreviewData,
}: {
  ds: DesignSystem;
  onChange: (chart: ChartStyle) => void;
  onPreviewData: (next: ChartPreviewData | undefined) => void;
}) {
  const [set, setSet] = useState(PREVIEW_SETS[0].id);
  const active = PREVIEW_SETS.find((s) => s.id === set) ?? PREVIEW_SETS[0];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">Conventions</h3>
      <p className="mb-3 mt-0.5 text-[11px] leading-relaxed text-zinc-500">
        How every chart in the brand starts out. Palette, gridlines, axis colour
        and type apply to charts that already exist; the rest seeds new ones.
      </p>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <ChartStyleControls ds={ds} style={ds.chart} onChange={onChange} />

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Preview
            </span>
            <div className="flex flex-wrap gap-1">
              {PREVIEW_SETS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSet(s.id)}
                  className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                    s.id === active.id
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <ChartStylePreview ds={ds} charts={active.charts} />
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            Compiled by the same engine the editor uses, so this is exactly what
            a new chart will look like.
          </p>

          {/* The numbers under the preview, editable. A style that reads at
              three series can fall apart at six, and the only way to find that
              out used to be inserting a real chart. */}
          <div className="mt-3">
            <ChartPreviewDataEditor data={ds.previewData} onChange={onPreviewData} />
          </div>
        </div>
      </div>
    </section>
  );
}

