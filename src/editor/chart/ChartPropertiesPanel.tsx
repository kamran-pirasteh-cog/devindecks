'use client';

/**
 * Everything about a chart that isn't its data: type, axes, labels, legend and
 * number format.
 *
 * Every control writes through `patchChart`, so the panel holds no state of its
 * own and undo works the same whether a change came from here, the datasheet or
 * the canvas. Follows `SelectionFormatBar`'s conventions — a labelled `Group`
 * wrapping a small control, values read from the spec, writes going straight to
 * the store.
 */
import {
  canSwapAxes,
  chartOrientation,
  convertData,
  setChartOrientation,
  supportsOrientation,
  swapAxes,
  isStacked,
  type AxisSpec,
  type ChartInstance,
  type ChartKind,
  type ChartSpec,
  type LabelPlacement,
  type NumberFormat,
} from '@/model';
import { useEditor } from '@/store/editorStore';
import { SUPPORTED_KINDS } from '@/chart/compile';

const FIELD =
  'rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900';

/**
 * Seven types, not twelve.
 *
 * Column and bar are one entry because orientation is its own control now;
 * donut is a variant of pie and area a variant of line, both offered as a
 * switch below rather than as their own type. A stored mekko or butterfly
 * still renders — it just isn't something you can pick your way into.
 */
const KIND_OPTIONS: { value: ChartKind; label: string }[] = [
  { value: 'column', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'combo', label: 'Column + line' },
  { value: 'waterfall', label: 'Waterfall' },
  { value: 'pie', label: 'Pie' },
  { value: 'sankey', label: 'Sankey' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'bubble', label: 'Bubble' },
];

/** The entry a spec's kind is represented by in the list above. */
const displayKind = (kind: ChartKind): ChartKind =>
  kind === 'bar' ? 'column' : kind === 'donut' ? 'pie' : kind === 'area' ? 'line' : kind;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-zinc-100 px-3 py-2 last:border-0 dark:border-zinc-800">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </div>
      {children}
    </div>
  );
}

/** An axis number input where blank genuinely means "auto", not zero. */
function AutoNumber({
  value,
  onChange,
  placeholder = 'auto',
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      className={`${FIELD} w-20 text-right`}
    />
  );
}

export function ChartPropertiesPanel({ chart }: { chart: ChartInstance }) {
  const patchChart = useEditor((s) => s.patchChart);
  const { spec } = chart;

  const patch = (fn: (s: ChartSpec) => void) => patchChart(chart.id, fn);

  const setAxis = (axis: 'x' | 'y', fn: (a: AxisSpec) => void) =>
    patch((s) => {
      fn(s.axes[axis]);
    });

  const setFormat = (fn: (f: NumberFormat) => void) =>
    patch((s) => {
      fn(s.numberFormat);
    });

  const stacked = isStacked(spec);
  const hasStack = 'stack' in spec;
  const labels = spec.decorations.labels;
  const valueAxis = spec.axes.y;

  return (
    <div className="w-56 shrink-0 overflow-y-auto border-l border-zinc-200 dark:border-zinc-800">
      <Section title="Chart">
        <Group label="Type">
          <select
            value={displayKind(spec.kind)}
            onChange={(e) => {
              const next = e.target.value as ChartKind;
              patchChart(chart.id, (s) => {
                // Keep the orientation across a type change: someone who set
                // up horizontal bars and switches to a waterfall means a
                // horizontal waterfall, not a reset.
                const was = chartOrientation(s);
                const converted = convertData(s, next);
                Object.assign(
                  s,
                  supportsOrientation(next) ? setChartOrientation(converted, was) : converted,
                );
              });
            }}
            className={`${FIELD} w-28`}
          >
            {KIND_OPTIONS.filter((k) => SUPPORTED_KINDS.includes(k.value)).map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Group>

        {supportsOrientation(spec.kind) ? (
          <Group label="Orientation">
            <div className="flex overflow-hidden rounded border border-zinc-200 dark:border-zinc-700">
              {(['vertical', 'horizontal'] as const).map((o) => (
                <button
                  key={o}
                  onClick={() =>
                    patchChart(chart.id, (s) => Object.assign(s, setChartOrientation(s, o)))
                  }
                  className={`px-2 py-0.5 text-[11px] capitalize ${
                    chartOrientation(spec) === o
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </Group>
        ) : null}

        {canSwapAxes(spec.kind) ? (
          <Group label="Axes">
            <button
              onClick={() => patchChart(chart.id, (s) => Object.assign(s, swapAxes(s)))}
              title="Trade the two variables, carrying each axis's settings with its values"
              className={`${FIELD} w-28 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800`}
            >
              Swap X and Y
            </button>
          </Group>
        ) : null}

        {spec.kind === 'pie' || spec.kind === 'donut' ? (
          <Group label="Donut">
            <input
              type="checkbox"
              checked={spec.kind === 'donut'}
              onChange={(e) =>
                patch((s) => {
                  if (s.kind !== 'pie' && s.kind !== 'donut') return;
                  s.kind = e.target.checked ? 'donut' : 'pie';
                  if (e.target.checked) s.innerRadiusPct ??= 55;
                })
              }
            />
          </Group>
        ) : null}

        {spec.kind === 'line' || spec.kind === 'area' ? (
          <Group label="Fill under">
            <input
              type="checkbox"
              checked={spec.kind === 'area'}
              onChange={(e) =>
                patchChart(chart.id, (s) => {
                  const was = chartOrientation(s);
                  Object.assign(
                    s,
                    setChartOrientation(convertData(s, e.target.checked ? 'area' : 'line'), was),
                  );
                })
              }
            />
          </Group>
        ) : null}

        {hasStack ? (
          <Group label="Stacking">
            <select
              value={(spec as { stack: string }).stack}
              onChange={(e) =>
                patch((s) => {
                  if (!('stack' in s)) return;
                  const mode = e.target.value as 'clustered' | 'stacked' | 'stacked100';
                  s.stack = mode;
                  // Overlap is what actually makes bars sit on top of one
                  // another; leaving it clustered would stack them visually apart.
                  if ('overlapPct' in s) s.overlapPct = mode === 'clustered' ? -27 : 100;
                })
              }
              className={`${FIELD} w-28`}
            >
              <option value="clustered">Clustered</option>
              <option value="stacked">Stacked</option>
              <option value="stacked100">100% stacked</option>
            </select>
          </Group>
        ) : null}

        <Group label="Title">
          <input
            value={spec.title ?? ''}
            placeholder="(none)"
            onChange={(e) => patch((s) => (s.title = e.target.value || undefined))}
            className={`${FIELD} w-28`}
          />
        </Group>

        {'gapWidthPct' in spec ? (
          <Group label="Gap width">
            <input
              type="number"
              min={0}
              max={500}
              step={10}
              value={spec.gapWidthPct}
              onChange={(e) =>
                patch((s) => {
                  if ('gapWidthPct' in s) s.gapWidthPct = Number(e.target.value) || 0;
                })
              }
              className={`${FIELD} w-20 text-right`}
            />
          </Group>
        ) : null}
      </Section>

      <Section title="Value axis">
        <Group label="Show">
          <input
            type="checkbox"
            checked={valueAxis.show}
            onChange={(e) => setAxis('y', (a) => (a.show = e.target.checked))}
          />
        </Group>
        <Group label="Title">
          <input
            value={valueAxis.title ?? ''}
            placeholder="(none)"
            onChange={(e) => setAxis('y', (a) => (a.title = e.target.value || undefined))}
            className={`${FIELD} w-28`}
          />
        </Group>
        <Group label="Minimum">
          <AutoNumber value={valueAxis.min} onChange={(v) => setAxis('y', (a) => (a.min = v))} />
        </Group>
        <Group label="Maximum">
          <AutoNumber value={valueAxis.max} onChange={(v) => setAxis('y', (a) => (a.max = v))} />
        </Group>
        <Group label="Tick step">
          <AutoNumber
            value={valueAxis.tickStep}
            onChange={(v) => setAxis('y', (a) => (a.tickStep = v))}
          />
        </Group>
        <Group label="Divide by">
          <select
            value={valueAxis.unitDivisor ?? 1}
            onChange={(e) =>
              setAxis('y', (a) => {
                const d = Number(e.target.value);
                a.unitDivisor = d === 1 ? undefined : d;
                // The note is the only thing telling a reader the axis is
                // scaled, so it moves with the divisor unless they've written
                // their own.
                const auto = { 1000: 'in thousands', 1000000: 'in millions', 1000000000: 'in billions' };
                if (!a.unitNote || Object.values(auto).includes(a.unitNote)) {
                  a.unitNote = auto[d as keyof typeof auto];
                }
              })
            }
            className={`${FIELD} w-28`}
          >
            <option value={1}>—</option>
            <option value={1000}>Thousands</option>
            <option value={1000000}>Millions</option>
            <option value={1000000000}>Billions</option>
          </select>
        </Group>
        <Group label="Unit note">
          <input
            value={valueAxis.unitNote ?? ''}
            placeholder="(none)"
            onChange={(e) => setAxis('y', (a) => (a.unitNote = e.target.value || undefined))}
            className={`${FIELD} w-28`}
          />
        </Group>
        <Group label="Gridlines">
          <input
            type="checkbox"
            checked={spec.decorations.gridlines.major?.show ?? false}
            onChange={(e) =>
              patch((s) => (s.decorations.gridlines.major = { show: e.target.checked }))
            }
          />
        </Group>
      </Section>

      <Section title="Category axis">
        <Group label="Show">
          <input
            type="checkbox"
            checked={spec.axes.x.show}
            onChange={(e) => setAxis('x', (a) => (a.show = e.target.checked))}
          />
        </Group>
        <Group label="Title">
          <input
            value={spec.axes.x.title ?? ''}
            placeholder="(none)"
            onChange={(e) => setAxis('x', (a) => (a.title = e.target.value || undefined))}
            className={`${FIELD} w-28`}
          />
        </Group>
      </Section>

      <Section title="Labels">
        <Group label="Data labels">
          <input
            type="checkbox"
            checked={labels.show}
            onChange={(e) => patch((s) => (s.decorations.labels.show = e.target.checked))}
          />
        </Group>
        <Group label="Show">
          <select
            value={labels.content.kind}
            onChange={(e) =>
              patch((s) => {
                s.decorations.labels.content =
                  e.target.value === 'percent' ? { kind: 'percent' } : { kind: 'value' };
              })
            }
            className={`${FIELD} w-28`}
          >
            <option value="value">Value</option>
            <option value="percent">Share of total</option>
          </select>
        </Group>
        <Group label="Position">
          <select
            value={labels.placement}
            onChange={(e) =>
              patch((s) => (s.decorations.labels.placement = e.target.value as LabelPlacement))
            }
            className={`${FIELD} w-28`}
          >
            <option value="auto">Auto</option>
            <option value="insideCenter">Inside centre</option>
            <option value="insideEnd">Inside end</option>
            <option value="outsideEnd">Outside end</option>
          </select>
        </Group>
        {stacked ? (
          <Group label="Totals">
            <input
              type="checkbox"
              checked={spec.decorations.totals?.show ?? false}
              onChange={(e) =>
                patch((s) => {
                  s.decorations.totals = e.target.checked
                    ? { show: true, content: { kind: 'value' }, placement: 'above' }
                    : undefined;
                })
              }
            />
          </Group>
        ) : null}
      </Section>

      <Section title="Numbers">
        <Group label="Format">
          <select
            value={spec.numberFormat.style}
            onChange={(e) =>
              setFormat((f) => (f.style = e.target.value as NumberFormat['style']))
            }
            className={`${FIELD} w-28`}
          >
            <option value="number">Number</option>
            <option value="currency">Currency</option>
            <option value="percent">Percent</option>
          </select>
        </Group>
        {spec.numberFormat.style === 'currency' ? (
          <Group label="Currency">
            <select
              value={spec.numberFormat.currency ?? 'USD'}
              onChange={(e) => setFormat((f) => (f.currency = e.target.value))}
              className={`${FIELD} w-28`}
            >
              {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Group>
        ) : null}
        <Group label="Decimals">
          <AutoNumber
            value={spec.numberFormat.decimals}
            onChange={(v) => setFormat((f) => (f.decimals = v))}
          />
        </Group>
        <Group label="Thousands">
          <input
            type="checkbox"
            checked={spec.numberFormat.thousands ?? true}
            onChange={(e) => setFormat((f) => (f.thousands = e.target.checked))}
          />
        </Group>
        <Group label="Scale">
          <select
            value={spec.numberFormat.scale ?? 'none'}
            onChange={(e) => setFormat((f) => (f.scale = e.target.value as NumberFormat['scale']))}
            className={`${FIELD} w-28`}
          >
            <option value="none">—</option>
            <option value="auto">Auto</option>
            <option value="K">Thousands (K)</option>
            <option value="M">Millions (M)</option>
            <option value="B">Billions (B)</option>
          </select>
        </Group>
        <Group label="Negatives">
          <select
            value={spec.numberFormat.negative ?? 'minus'}
            onChange={(e) =>
              setFormat((f) => (f.negative = e.target.value as NumberFormat['negative']))
            }
            className={`${FIELD} w-28`}
          >
            <option value="minus">-1,234</option>
            <option value="parens">(1,234)</option>
            <option value="red">Red</option>
          </select>
        </Group>
      </Section>

      <Section title="Legend">
        <Group label="Show">
          <input
            type="checkbox"
            checked={spec.legend.show}
            onChange={(e) => patch((s) => (s.legend.show = e.target.checked))}
          />
        </Group>
        <Group label="Position">
          <select
            value={spec.legend.position}
            onChange={(e) =>
              patch((s) => (s.legend.position = e.target.value as typeof s.legend.position))
            }
            className={`${FIELD} w-28`}
          >
            <option value="top">Top</option>
            <option value="right">Right</option>
            <option value="bottom">Bottom</option>
            <option value="left">Left</option>
          </select>
        </Group>
      </Section>
    </div>
  );
}
