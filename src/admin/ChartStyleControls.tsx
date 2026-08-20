'use client';

/**
 * The chart-style control column.
 *
 * Lifted out of `ChartStyleSection` so the brand conventions and a per-kind
 * variant are edited by the SAME controls. A variant editor that reimplemented
 * these against `DeepPartial<ChartStyle>` would have drifted from the
 * conventions panel by the second control anyone added; instead a variant edits
 * a fully-resolved style and stores the difference (`diffChartStyle`).
 */
import type { ChartStyle, DesignSystem, NumberFormat } from '@/model';
import { resolveTypeRole } from '@/model';

const FIELD =
  'rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export function ChartStyleControls({
  ds,
  style,
  onChange,
}: {
  ds: DesignSystem;
  /** The style being edited — the conventions, or a variant resolved against them. */
  style: ChartStyle;
  onChange: (next: ChartStyle) => void;
}) {
  const patch = (fn: (s: ChartStyle) => void) => {
    const next = structuredClone(style);
    fn(next);
    onChange(next);
  };

  const setFormat = (which: keyof ChartStyle['numberFormats'], fn: (f: NumberFormat) => void) =>
    patch((s) => fn(s.numberFormats[which]));

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Series palette
        </div>
        <p className="mb-1.5 text-[11px] leading-relaxed text-zinc-500">
          The order charts assign colours in. Leave it empty and charts pick
          the most distinct brand colours themselves.
        </p>
        <div className="flex flex-wrap gap-1">
          {ds.colors.map((c) => {
            const index = style.paletteTokenIds.indexOf(c.id);
            const on = index >= 0;
            return (
              <button
                key={c.id}
                onClick={() =>
                  patch((s) => {
                    s.paletteTokenIds = on
                      ? s.paletteTokenIds.filter((id) => id !== c.id)
                      : [...s.paletteTokenIds, c.id];
                  })
                }
                title={`${c.name}${on ? ` — position ${index + 1}` : ''}`}
                className={`relative h-7 w-7 rounded ring-1 ring-black/10 transition ${
                  on ? 'ring-2 ring-indigo-500' : 'opacity-50 hover:opacity-100'
                }`}
                style={{ background: c.hex }}
              >
                {on ? (
                  <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-600 text-[8px] font-bold text-white">
                    {index + 1}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Axes and gridlines
        </div>
        <Row label="Horizontal gridlines">
          <select
            value={style.gridlines.horizontal}
            onChange={(e) =>
              patch((s) => (s.gridlines.horizontal = e.target.value as 'none' | 'major' | 'major+minor'))
            }
            className={`${FIELD} w-32`}
          >
            <option value="none">None</option>
            <option value="major">Major</option>
            <option value="major+minor">Major + minor</option>
          </select>
        </Row>
        <Row label="Gridline colour">
          <select
            value={style.gridlines.tokenId}
            onChange={(e) => patch((s) => (s.gridlines.tokenId = e.target.value))}
            className={`${FIELD} w-32`}
          >
            {ds.colors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Gridline style">
          <select
            value={style.gridlines.dash}
            onChange={(e) =>
              patch((s) => (s.gridlines.dash = e.target.value as ChartStyle['gridlines']['dash']))
            }
            className={`${FIELD} w-32`}
          >
            <option value="solid">Solid</option>
            <option value="dash">Dashed</option>
            <option value="dot">Dotted</option>
          </select>
        </Row>
        <Row label="Axis colour">
          <select
            value={style.axis.lineTokenId}
            onChange={(e) => patch((s) => (s.axis.lineTokenId = e.target.value))}
            className={`${FIELD} w-32`}
          >
            {ds.colors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Row>
      </div>

      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Type
        </div>
        {(['axis', 'dataLabel', 'legend', 'title'] as const).map((slot) => (
          <Row
            key={slot}
            label={
              slot === 'dataLabel' ? 'Data labels' : slot === 'axis' ? 'Axis labels' : slot === 'legend' ? 'Legend' : 'Chart title'
            }
          >
            <input
              type="number"
              min={6}
              max={24}
              value={style.fonts[slot].sizePt ?? resolveTypeRole(ds, style.fonts[slot].role).sizePt}
              onChange={(e) => patch((s) => (s.fonts[slot].sizePt = Number(e.target.value) || 9))}
              className={`${FIELD} w-16 text-right`}
            />
          </Row>
        ))}
      </div>

      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Bars
        </div>
        <Row label="Gap width %">
          <input
            type="number"
            min={0}
            max={500}
            step={10}
            value={style.gaps.categoryGapPct}
            onChange={(e) => patch((s) => (s.gaps.categoryGapPct = Number(e.target.value) || 0))}
            className={`${FIELD} w-16 text-right`}
          />
        </Row>
        <Row label="Cluster overlap %">
          <input
            type="number"
            min={-100}
            max={100}
            step={5}
            value={style.gaps.seriesOverlapPct}
            onChange={(e) => patch((s) => (s.gaps.seriesOverlapPct = Number(e.target.value) || 0))}
            className={`${FIELD} w-16 text-right`}
          />
        </Row>
      </div>

      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Defaults for new charts
        </div>
        <Row label="Legend">
          <select
            value={style.legend.show ? style.legend.position : 'none'}
            onChange={(e) =>
              patch((s) => {
                if (e.target.value === 'none') s.legend.show = false;
                else {
                  s.legend.show = true;
                  s.legend.position = e.target.value as ChartStyle['legend']['position'];
                }
              })
            }
            className={`${FIELD} w-32`}
          >
            <option value="none">Hidden</option>
            <option value="top">Top</option>
            <option value="right">Right</option>
            <option value="bottom">Bottom</option>
            <option value="left">Left</option>
            <option value="insideTopLeft">Inside top left</option>
            <option value="insideTopRight">Inside top right</option>
          </select>
        </Row>
        <Row label="Data labels">
          <input
            type="checkbox"
            checked={style.labels.show}
            onChange={(e) => patch((s) => (s.labels.show = e.target.checked))}
          />
        </Row>
        <Row label="Number format">
          <select
            value={style.numberFormats.value.style}
            onChange={(e) =>
              setFormat('value', (f) => (f.style = e.target.value as NumberFormat['style']))
            }
            className={`${FIELD} w-32`}
          >
            <option value="number">Number</option>
            <option value="currency">Currency</option>
            <option value="percent">Percent</option>
          </select>
        </Row>
        <Row label="Thousands separator">
          <input
            type="checkbox"
            checked={style.numberFormats.value.thousands ?? true}
            onChange={(e) => setFormat('value', (f) => (f.thousands = e.target.checked))}
          />
        </Row>
      </div>
    </div>
  );
}
