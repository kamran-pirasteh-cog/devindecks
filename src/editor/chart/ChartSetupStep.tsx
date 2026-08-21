'use client';

/**
 * The step between picking a chart and getting one: what is this chart OF?
 *
 * Picking a tile chooses a picture. It doesn't choose a measure, a period, or a
 * cut — and until those are chosen the chart is a shape with placeholder labels
 * on it, which is the state most charts used to be inserted in and then edited
 * out of by hand. Asking here is cheaper than fixing there, and it is the only
 * point at which the answers can reach the Devin prompt as facts the author
 * STATED rather than things we read off an axis afterwards.
 *
 * The form is not the same for every chart, and `src/charts/setupForm.ts` is
 * where that lives — a scatter asks for two measures and no span, a pie for one
 * moment and exactly one cut, a Gantt for a window and nothing else. This file
 * is the panel around whatever that module says to ask.
 *
 * Warnings are shown, not enforced away: a blocker names a chart that would
 * state something untrue (a stack of averages) and holds the Insert button; a
 * note is taste, and doesn't.
 */
import { useMemo, useState } from 'react';
import { SlideView } from '@/render/SlideView';
import { MEASURE_GROUPS, MEASURES, type MeasureDef } from '@/charts/measures';
import { SEGMENTS, resolveSegment } from '@/charts/segments';
import {
  GRAINS_FOR,
  SPAN_PRESETS,
  formFor,
  setupIssues,
  timeQuestionFor,
  withGrain,
  type ChartSetup,
  type MeasureSlot,
  type SegmentSlot,
  type SetupForm,
} from '@/charts/setupForm';
import { setupPeriods, setupSentence } from '@/charts/setupSpec';
import {
  cellCount,
  cellLabel,
  cellOptions,
  currentCell,
  endsOnCurrent,
  pickerFor,
  rangeEndingAt,
  shiftCells,
  snap,
} from '@/charts/periodRange';
import { layoutById, type ChartLayout } from '@/charts/layouts';
import { periodNoun } from '@/charts/intent';
import { token, type DateGrain, type DesignSystem, type SlideElement } from '@/model';

const PREVIEW_SLIDE = { w: 12_192_000, h: 6_858_000 };
const PREVIEW_W = 400;

/** The sentinel the selects use for "something not on the list". */
const OTHER = ' other';

export function ChartSetupStep({
  ds,
  layout,
  setup,
  elements,
  asOf,
  onChange,
  onInsert,
  onBlank,
  onBack,
}: {
  ds: DesignSystem;
  layout: ChartLayout;
  setup: ChartSetup;
  /** The chart these answers currently make, compiled by the caller. */
  elements: SlideElement[];
  asOf: string;
  onChange: (next: ChartSetup) => void;
  onInsert: () => void;
  /** Skip the questions and drop the sample chart, as the picker used to. */
  onBlank: () => void;
  onBack: () => void;
}) {
  const form = useMemo(() => formFor(layout), [layout]);
  const issues = useMemo(() => setupIssues(layout, setup), [layout, setup]);
  const blocked = issues.some((i) => i.level === 'blocker');
  const periods = useMemo(() => setupPeriods(layout, setup), [layout, setup]);

  const set = (patch: Partial<ChartSetup>) => onChange({ ...setup, ...patch });

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Set up
        </span>
        <span className="text-xs font-medium">{layout.name}</span>
        <button
          onClick={onBack}
          className="text-[10px] text-zinc-400 underline decoration-dotted hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          change
        </button>
        <span className="flex-1" />
        <span className="truncate text-[10px] text-zinc-400">{form.reads}</span>
      </div>

      <div className="flex gap-3">
        <div className="min-w-0 flex-1 space-y-2.5">
          {form.measures.map((slot) => (
            <MeasureField
              key={slot.key}
              slot={slot}
              value={measureOf(setup, slot)}
              onChange={(v) => set(patchMeasure(slot, v))}
            />
          ))}

          {form.axis === 'either' ? (
            <Field label="Across the bottom" hint="what the reader scans along">
              <Segmented
                options={[
                  { value: 'time', label: `Time (${periodNoun(setup.grain)}s)` },
                  { value: 'segment', label: 'A category' },
                ]}
                value={setup.axis}
                onChange={(v) => set({ axis: v as 'time' | 'segment' })}
              />
            </Field>
          ) : null}

          <TimeFields form={form} setup={setup} periods={periods} asOf={asOf} onChange={set} />

          {form.segments
            // On a categorical chart with time along the bottom the first cut
            // has nowhere to go — the periods are already the columns — so the
            // question is dropped rather than shown and quietly ignored.
            .filter(
              (slot) =>
                !(form.axis === 'either' && setup.axis === 'time' && slot.key === 'primary'),
            )
            .map((slot) => (
              <SegmentField
                key={slot.key}
                slot={slot}
                value={slot.key === 'primary' ? setup.segment : setup.segment2}
                onChange={(v) => set(slot.key === 'primary' ? { segment: v } : { segment2: v })}
              />
            ))}
        </div>

        <div className="w-[25rem] shrink-0">
          <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
            <SlideView
              slide={{
                id: `setup-${layout.id}`,
                elements,
                background: { kind: 'solid', color: token('surface.base') },
              }}
              slideSize={PREVIEW_SLIDE}
              designSystem={ds}
              width={PREVIEW_W}
            />
          </div>
          {/* The sentence the answers amount to. It is the same string that
              goes onto the chart as the author's brief and into the Devin
              prompt as what they asked for, so it is worth reading back. */}
          <p className="mt-1.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
            {setupSentence(layout, setup, periods) || 'Nothing chosen yet.'}
          </p>
        </div>
      </div>

      {issues.length ? (
        <ul className="mt-2.5 space-y-1">
          {issues.map((issue) => (
            <li
              key={issue.text}
              className={`text-[10px] leading-snug ${
                issue.level === 'blocker' ? 'text-red-600' : 'text-amber-600'
              }`}
            >
              {issue.text}
              {issue.insteadId && layoutById(issue.insteadId) ? (
                <span className="text-zinc-400">
                  {' '}
                  A {layoutById(issue.insteadId)!.name.toLowerCase()} doesn&rsquo;t have this
                  problem.
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
        <NotesField value={setup.notes ?? ''} onChange={(notes) => set({ notes })} />
      </div>

      <div className="mt-2.5 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={onInsert}
            disabled={blocked}
            title={blocked ? 'Answer the points in red first' : undefined}
            className="whitespace-nowrap rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Insert this chart
          </button>
          <button
            onClick={onBlank}
            className="whitespace-nowrap rounded px-2 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Insert blank instead
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">
          These answers become the chart&rsquo;s labels and the brief it carries; the figures are
          placeholders. Select the chart and press <span className="font-medium">Data</span> to
          fill them in, or generate the Devin prompt — it asks for exactly these rows and series,
          in a format that pastes straight back.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Time                                                               */
/* ------------------------------------------------------------------ */

function TimeFields({
  form,
  setup,
  periods,
  asOf,
  onChange,
}: {
  form: SetupForm;
  setup: ChartSetup;
  periods: string[];
  asOf: string;
  onChange: (patch: Partial<ChartSetup>) => void;
}) {
  const question = timeQuestionFor(form, setup.axis);
  const grains = GRAINS_FOR[question];
  const { grain, range, fiscal } = setup;
  const cells = cellCount(grain, range);
  const noun = periodNoun(grain);

  // A fiscal label only exists at year and quarter grain: nobody writes a month
  // as FY26, and offering the choice there is a control with no effect.
  const showFiscal = grain === 'year' || grain === 'quarter';
  // A moment has one end, and showing the reader two boxes that must agree is
  // two ways to say one thing.
  const onlyEnd = question === 'moment';

  const label =
    question === 'range'
      ? 'Timeframe'
      : question === 'moment'
        ? 'As of'
        : question === 'endpoints'
          ? 'From and to'
          : question === 'points'
            ? 'Moments to compare'
            : 'Window';

  const hint =
    question === 'moment'
      ? 'the single period this chart is at'
      : question === 'endpoints'
        ? 'the two totals the bridge runs between'
        : question === 'points'
          ? 'the ends of the comparison'
          : question === 'window'
            ? 'the span the bars sit inside'
            : 'the unit of time, then the two ends';

  /** Both ends re-snapped when the grain changes — see `withGrain`. */
  const setGrain = (next: DateGrain) => onChange(withGrain(setup, next, question));

  /** A preset counts back from whatever end is showing, rather than from today. */
  const setSpan = (n: number) => onChange({ range: rangeEndingAt(grain, range.to, n) });

  const setEnd = (iso: string) =>
    onChange({
      range: onlyEnd
        ? { from: snap(grain, iso), to: snap(grain, iso) }
        : { ...range, to: snap(grain, iso) },
    });

  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        <Segmented
          options={grains.map((g) => ({ value: g, label: `${periodNoun(g)}s` }))}
          value={grain}
          onChange={(v) => setGrain(v as DateGrain)}
        />

        <div className="flex items-center gap-1.5">
          {onlyEnd ? null : (
            <>
              <PeriodPicker
                grain={grain}
                value={range.from}
                fiscal={fiscal}
                asOf={asOf}
                ariaLabel="Start of the range"
                onChange={(iso) => onChange({ range: { ...range, from: snap(grain, iso) } })}
              />
              <span className="text-[10px] text-zinc-400">to</span>
            </>
          )}
          <PeriodPicker
            grain={grain}
            value={range.to}
            fiscal={fiscal}
            asOf={asOf}
            ariaLabel={onlyEnd ? 'The period this chart is at' : 'End of the range'}
            onChange={setEnd}
          />
          {/* Back to the period in progress in one click, since that is the end
              most charts want and the one a stale deck has drifted away from. */}
          {endsOnCurrent(grain, range, asOf) ? (
            <span className="whitespace-nowrap text-[10px] text-zinc-400">
              ends on the current {noun}
            </span>
          ) : (
            <button
              onClick={() => setEnd(currentCell(grain, asOf))}
              className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
            >
              to current {noun}
            </button>
          )}
        </div>

        {/* The presets stay, as a shortcut to a range rather than as the way
            ranges are said — one click still beats two date pickers. */}
        {question === 'range' || question === 'window' ? (
          <div className="flex flex-wrap items-center gap-1">
            {SPAN_PRESETS[grain].map((n) => (
              <Chip key={n} on={cells === n} onClick={() => setSpan(n)}>
                {`last ${n}`}
              </Chip>
            ))}
            <span className="ml-0.5 text-[10px] text-zinc-400">
              {cells === 0
                ? 'the range starts after it ends'
                : `${cells} ${noun}${cells === 1 ? '' : 's'}`}
            </span>
          </div>
        ) : null}

        {question === 'points' ? (
          <div className="flex items-center gap-2">
            <Segmented
              options={[
                { value: '2', label: 'two markers' },
                { value: '3', label: 'three' },
              ]}
              value={String(setup.markers)}
              onChange={(v) => onChange({ markers: Number(v) === 3 ? 3 : 2 })}
            />
            <span className="truncate text-[10px] text-zinc-400">{periods.join(' · ')}</span>
          </div>
        ) : null}

        {showFiscal ? (
          <Segmented
            options={[
              { value: 'calendar', label: 'Calendar' },
              { value: 'fiscal', label: 'Fiscal' },
            ]}
            value={fiscal ? 'fiscal' : 'calendar'}
            onChange={(v) => onChange({ fiscal: v === 'fiscal' })}
          />
        ) : null}

        {/* The one thing the pickers can't show: that the last period hasn't
            finished. A partial period drawn beside complete ones reads as a
            collapse, and the reader has no way to tell. */}
        {question !== 'window' && endsOnCurrent(grain, range, asOf) ? (
          <p className="text-[10px] leading-snug text-amber-600">
            The current {noun} is still running, so the last {question === 'moment' ? 'figure' : 'point'} will
            read low.{' '}
            <button
              onClick={() => setEnd(shiftCells(grain, currentCell(grain, asOf), -1))}
              className="underline decoration-dotted hover:text-amber-700"
            >
              End on the last complete {noun} instead
            </button>
          </p>
        ) : null}
      </div>
    </Field>
  );
}

/**
 * One end of a range.
 *
 * Three controls behind one component, chosen by grain: a date input for days
 * and weeks, the browser's own month input for months, and a list for quarters
 * and years, which have no native picker and which a date input would ask for at
 * the wrong precision. A week is a date input labelled as the week beginning,
 * because that is what a weekly axis means.
 */
function PeriodPicker({
  grain,
  value,
  fiscal,
  asOf,
  ariaLabel,
  onChange,
}: {
  grain: DateGrain;
  value: string;
  fiscal: boolean;
  asOf: string;
  ariaLabel: string;
  onChange: (iso: string) => void;
}) {
  const kind = pickerFor(grain);
  const cls =
    'rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700';
  // Hoisted above the branches: a hook inside one of them changes the hook
  // order the moment the grain changes, which is exactly what the grain control
  // does. Cheap enough to build for a grain that won't use it.
  const options = useMemo(() => cellOptions(grain, asOf, fiscal), [grain, asOf, fiscal]);

  if (kind === 'select') {
    return (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
      >
        {/* A range loaded from a saved chart can sit outside the window the
            list covers; its own value is added rather than silently snapping
            the chart to something the author didn't choose. */}
        {options.some((o) => o.value === value) ? null : (
          <option value={value}>{cellLabel(grain, value, fiscal)}</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (kind === 'month') {
    return (
      <input
        type="month"
        aria-label={ariaLabel}
        value={value.slice(0, 7)}
        onChange={(e) => (e.target.value ? onChange(`${e.target.value}-01`) : undefined)}
        className={cls}
      />
    );
  }

  return (
    <input
      type="date"
      aria-label={grain === 'week' ? `${ariaLabel} (week beginning)` : ariaLabel}
      title={grain === 'week' ? 'Any day in the week — it snaps to the Monday' : undefined}
      value={value}
      onChange={(e) => (e.target.value ? onChange(e.target.value) : undefined)}
      className={cls}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Measures and segments                                              */
/* ------------------------------------------------------------------ */

const measureOf = (setup: ChartSetup, slot: MeasureSlot): string | undefined =>
  slot.key === 'primary'
    ? setup.measure
    : slot.key === 'secondary'
      ? setup.secondaryMeasure
      : setup.sizeMeasure;

const patchMeasure = (slot: MeasureSlot, v: string | undefined): Partial<ChartSetup> =>
  slot.key === 'primary'
    ? { measure: v }
    : slot.key === 'secondary'
      ? { secondaryMeasure: v }
      : { sizeMeasure: v };

/**
 * The measure menu, grouped by what KIND of number each one is.
 *
 * The grouping is the warning most authors will actually read: seeing "ACUs per
 * merged PR" filed under Efficiency alongside the other ratios makes it obvious,
 * before anything is inserted, that it isn't a thing you stack.
 */
function MeasureField({
  slot,
  value,
  onChange,
}: {
  slot: MeasureSlot;
  value?: string;
  onChange: (v: string | undefined) => void;
}) {
  const free = value?.startsWith('free:') ?? false;
  const [typed, setTyped] = useState(free ? value!.slice(5) : '');

  const wanted = (m: MeasureDef) =>
    slot.wants === 'rate'
      ? m.unit === 'percent' || m.unit === 'ratio'
      : slot.wants === 'absolute'
        ? m.unit !== 'percent' && m.unit !== 'ratio'
        : true;

  return (
    <Field label={slot.label} hint={slot.hint}>
      <div className="space-y-1">
        <select
          value={free ? OTHER : (value ?? '')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) onChange(`free:${typed}`);
            else onChange(v || undefined);
          }}
          className="w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700"
        >
          <option value="">{slot.required ? 'Choose one…' : 'None'}</option>
          {MEASURE_GROUPS.map((group) => {
            const items = MEASURES.filter((m) => m.group === group && wanted(m));
            if (!items.length) return null;
            return (
              <optgroup key={group} label={group}>
                {items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
          <option value={OTHER}>Something else…</option>
        </select>

        {free ? (
          <input
            autoFocus
            value={typed}
            placeholder="e.g. Time to first review"
            onChange={(e) => {
              setTyped(e.target.value);
              onChange(`free:${e.target.value}`);
            }}
            className="w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-[11px] outline-none placeholder:text-zinc-400 focus:border-indigo-400 dark:border-zinc-700"
          />
        ) : null}
      </div>
    </Field>
  );
}

function SegmentField({
  slot,
  value,
  onChange,
}: {
  slot: SegmentSlot;
  value?: string;
  onChange: (v: string | undefined) => void;
}) {
  const free = value?.startsWith('free:') ?? false;
  const [typed, setTyped] = useState(free ? value!.slice(5) : '');
  const members = value && !free ? resolveSegment(value).members : [];

  return (
    <Field label={slot.label} hint={slot.hint}>
      <div className="space-y-1">
        <select
          value={free ? OTHER : (value ?? '')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) onChange(`free:${typed}`);
            else onChange(v || undefined);
          }}
          className="w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700"
        >
          <option value="">{slot.required ? 'Choose one…' : 'Nothing — one total'}</option>
          {SEGMENTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          <option value={OTHER}>Something else…</option>
        </select>

        {free ? (
          <input
            autoFocus
            value={typed}
            placeholder="e.g. vertical"
            onChange={(e) => {
              setTyped(e.target.value);
              onChange(`free:${e.target.value}`);
            }}
            className="w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-[11px] outline-none placeholder:text-zinc-400 focus:border-indigo-400 dark:border-zinc-700"
          />
        ) : null}

        {/* The members are placeholders and say so, because the alternative is
            an author discovering on the slide that "Customer A" was ours. */}
        {members.length ? (
          <p className="text-[10px] leading-snug text-zinc-400">
            {members.join(', ')} — rename them on the chart.
          </p>
        ) : null}
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Notes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Anything the form didn't ask.
 *
 * The fields above cover what a chart IS — the measure, the span, the cut — and
 * every one of them ends up as a label somebody can read back off the picture.
 * This covers what it can't: how to count the thing, which accounts to leave
 * out, that Q3 was a fourteen-week quarter. None of that is a label, so without
 * a field for it the note only ever existed in whatever message the author
 * remembered to send alongside the prompt — and half the time it didn't.
 *
 * It rides onto the chart with the brief and into the Devin prompt verbatim,
 * quoted as the author's own instructions.
 */
function NotesField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1.5">
        <label
          htmlFor="dd-chart-notes"
          className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
        >
          Notes for Devin
        </label>
        <span className="truncate text-[10px] text-zinc-400">
          optional — anything the fields above don&rsquo;t cover
        </span>
      </div>
      <textarea
        id="dd-chart-notes"
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. count a session as productive only if it merged a PR; exclude internal orgs; Q3 was a 14-week quarter"
        className="w-full resize-y rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-[11px] leading-relaxed outline-none placeholder:text-zinc-400 focus:border-indigo-400 dark:border-zinc-700"
      />
      {value.trim() ? (
        <p className="mt-1 text-[10px] leading-snug text-zinc-400">
          Carried onto the chart and quoted in the Devin prompt as your instructions — not as
          context to weigh up.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small controls                                                     */
/* ------------------------------------------------------------------ */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        <span className="truncate text-[10px] text-zinc-400">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-zinc-200 dark:border-zinc-700">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-1.5 py-0.5 text-[11px] font-medium capitalize transition ${
            value === o.value
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
        on
          ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}
