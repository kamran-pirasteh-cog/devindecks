'use client';

/**
 * The dummy numbers behind Admin's chart previews.
 *
 * A small grid rather than the real datasheet: `SheetGrid` is bound to a chart
 * spec and its schema changes per kind, and this one table has to drive every
 * preview on the tab at once. The shape is the common denominator — categories
 * down, series across — and `applyPreviewData` is what maps it onto each kind.
 *
 * Editing writes straight through, so the preview beside it redraws as you
 * type. Empty means "no figure" and draws as a gap, which is worth being able
 * to preview: a style has to survive a hole in the data.
 */
import {
  addPreviewCategory,
  addPreviewSeries,
  DEFAULT_CHART_PREVIEW_DATA,
  removePreviewCategory,
  removePreviewSeries,
  setPreviewSecondary,
  setPreviewValue,
  type ChartPreviewData,
} from '@/model';

const CELL =
  'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] outline-none hover:border-zinc-200 focus:border-indigo-400 dark:hover:border-zinc-700';
const BTN =
  'rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800';

export function ChartPreviewDataEditor({
  data,
  onChange,
  showSecondary = false,
}: {
  /** The stored data, or undefined for the built-in sample. */
  data: ChartPreviewData | undefined;
  /** `undefined` clears the override and goes back to the built-in sample. */
  onChange: (next: ChartPreviewData | undefined) => void;
  /**
   * Show the right-hand axis row. Only the previews that HAVE a second axis —
   * a combo's line — read it, and offering the row beside a pie is offering a
   * control that does nothing.
   */
  showSecondary?: boolean;
}) {
  const d = data ?? DEFAULT_CHART_PREVIEW_DATA;
  const custom = data !== undefined;
  const secondary = d.secondary ?? DEFAULT_CHART_PREVIEW_DATA.secondary;

  const setCategory = (i: number, label: string) =>
    onChange({ ...d, categories: d.categories.map((c, x) => (x === i ? label : c)) });

  const setSeriesName = (i: number, name: string) =>
    onChange({ ...d, series: d.series.map((s, x) => (x === i ? { ...s, name } : s)) });

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Sample data
        </span>
        <span className="text-[10px] text-zinc-400">
          {custom ? 'custom' : 'built-in sample'}
        </span>
        <div className="ml-auto flex gap-1">
          <button className={BTN} onClick={() => onChange(addPreviewCategory(d))}>
            + Row
          </button>
          <button className={BTN} onClick={() => onChange(addPreviewSeries(d))}>
            + Series
          </button>
          <button className={BTN} disabled={!custom} onClick={() => onChange(undefined)}>
            Reset
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
              <th className="w-28 px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Row
              </th>
              {d.series.map((s, i) => (
                <th key={i} className="min-w-[6rem] px-1 py-1">
                  <div className="flex items-center gap-0.5">
                    <input
                      value={s.name}
                      onChange={(e) => setSeriesName(i, e.target.value)}
                      aria-label={`Series ${i + 1} name`}
                      className={`${CELL} font-medium`}
                    />
                    <button
                      onClick={() => onChange(removePreviewSeries(d, i))}
                      disabled={d.series.length <= 1}
                      title="Remove this series"
                      aria-label={`Remove series ${s.name}`}
                      className="shrink-0 px-0.5 text-[11px] leading-none text-zinc-300 hover:text-red-500 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.categories.map((cat, c) => (
              <tr key={c} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="px-1 py-0.5">
                  <div className="flex items-center gap-0.5">
                    <input
                      value={cat}
                      onChange={(e) => setCategory(c, e.target.value)}
                      aria-label={`Row ${c + 1} label`}
                      className={CELL}
                    />
                    <button
                      onClick={() => onChange(removePreviewCategory(d, c))}
                      disabled={d.categories.length <= 1}
                      title="Remove this row"
                      aria-label={`Remove row ${cat}`}
                      className="shrink-0 px-0.5 text-[11px] leading-none text-zinc-300 hover:text-red-500 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                </td>
                {d.series.map((s, i) => (
                  <td key={i} className="px-1 py-0.5">
                    <input
                      // `type="text"` on purpose: a number input swallows a
                      // half-typed "-" and "1." mid-edit, and empty has to stay
                      // expressible because a gap is a thing to preview.
                      value={s.values[c] ?? ''}
                      inputMode="decimal"
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const n = raw === '' ? null : Number(raw);
                        if (n !== null && !Number.isFinite(n)) return;
                        onChange(setPreviewValue(d, i, c, n));
                      }}
                      aria-label={`${s.name}, ${cat}`}
                      className={`${CELL} text-right tabular-nums`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showSecondary ? (
        <div className="mt-2 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Right axis (the line)
        </div>
      ) : null}
      {showSecondary ? (
        <div className="mt-0 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-collapse text-left">
            <tbody>
              <tr>
                <td className="w-28 px-1 py-0.5">
                  <input
                    value={secondary?.name ?? ''}
                    onChange={(e) =>
                      onChange(setPreviewSecondary(d, { name: e.target.value }))
                    }
                    aria-label="Right axis series name"
                    className={`${CELL} font-medium`}
                  />
                </td>
                {d.categories.map((cat, c) => (
                  <td key={c} className="min-w-[6rem] px-1 py-0.5">
                    <input
                      value={secondary?.values[c] ?? ''}
                      inputMode="decimal"
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const n = raw === '' ? null : Number(raw);
                        if (n !== null && !Number.isFinite(n)) return;
                        onChange(setPreviewSecondary(d, { at: c, value: n }));
                      }}
                      aria-label={`Right axis, ${cat}`}
                      className={`${CELL} text-right tabular-nums`}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
        {showSecondary
          ? 'The second row is the line, on its own axis down the right — a rate or a margin, in its own units. '
          : ''}
        Preview numbers only — no chart on a slide reads these. A waterfall takes
        the first series, with the first row as its base and the last as a
        computed total; scatter, bubble and Sankey keep their own sample.
      </p>
    </div>
  );
}
