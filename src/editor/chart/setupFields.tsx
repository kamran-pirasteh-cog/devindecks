"use client";

/**
 * The setup questions themselves — one column of them, and nothing around it.
 *
 * Split out of `ChartSetupStep` because the questions are asked TWICE. Once
 * before a chart exists, in the picker, where the answers decide what gets
 * inserted; and again every time somebody opens the datasheet on a chart that
 * already does, where they decide what it gets relabelled to. Two copies of a
 * form this particular — a grain that re-snaps a range, a cut that clears its
 * own "which ones?", a partial period that warns about itself — would agree on
 * the day they were written and never again.
 *
 * What varies between the two callers is the frame: a preview and an Insert
 * button there, a live chart and no button here. That stays outside.
 *
 * The form is not the same for every chart, and `src/charts/setupForm.ts` is
 * where that lives — a scatter asks for two measures and no span, a pie for one
 * moment and exactly one cut, a Gantt for a window and nothing else.
 */
import { useState } from "react";
import { MEASURE_GROUPS, MEASURES, type MeasureDef } from "@/charts/measures";
import {
  SEGMENTS,
  namedMembers,
  resolveSegment,
  type SegmentDef,
} from "@/charts/segments";
import {
  GRAINS_FOR,
  SPAN_PRESETS,
  formFor,
  timeQuestionFor,
  withGrain,
  type ChartSetup,
  type MeasureSlot,
  type SegmentSlot,
  type SetupForm,
  type SetupIssue,
} from "@/charts/setupForm";
import { setupPeriods } from "@/charts/setupSpec";
import { PeriodPicker } from "./PeriodPicker";
import {
  cellCount,
  currentCell,
  endsOnCurrent,
  rangeEndingAt,
  shiftCells,
  snap,
} from "@/charts/periodRange";
import { layoutById, type ChartLayout } from "@/charts/layouts";
import { periodNoun } from "@/charts/intent";
import type { DateGrain } from "@/model";

/** The sentinel the selects use for "something not on the list". */
const OTHER = " other";

/**
 * Every question this layout asks, in the order it asks them.
 *
 * `onChange` gets the whole answer set, not a patch: the answers are read
 * together — a grain change moves the range, a new cut clears its members — and
 * a caller that had to merge patches would be a second place those rules live.
 */
export function SetupFields({
  layout,
  setup,
  asOf,
  onChange,
}: {
  layout: ChartLayout;
  setup: ChartSetup;
  /** The day relative periods are counted back from. */
  asOf: string;
  onChange: (next: ChartSetup) => void;
}) {
  const form = formFor(layout);
  const periods = setupPeriods(layout, setup);
  const set = (patch: Partial<ChartSetup>) => onChange({ ...setup, ...patch });

  return (
    <div className="space-y-2.5">
      {form.measures.map((slot) => (
        <MeasureField
          key={slot.key}
          slot={slot}
          value={measureOf(setup, slot)}
          onChange={(v) => set(patchMeasure(slot, v))}
        />
      ))}

      {form.axis === "either" ? (
        <Field label="Across the bottom" hint="what the reader scans along">
          <Segmented
            options={[
              // No grain in the label — the grain picker sits directly
              // below, and naming it twice reads as two questions.
              { value: "time", label: "Time" },
              { value: "segment", label: "A category" },
            ]}
            value={setup.axis}
            onChange={(v) => set({ axis: v as "time" | "segment" })}
          />
        </Field>
      ) : null}

      <TimeFields
        form={form}
        setup={setup}
        periods={periods}
        asOf={asOf}
        onChange={set}
      />

      {form.segments
        // On a categorical chart with time along the bottom the first cut
        // has nowhere to go — the periods are already the columns — so the
        // question is dropped rather than shown and quietly ignored.
        .filter(
          (slot) =>
            !(
              form.axis === "either" &&
              setup.axis === "time" &&
              slot.key === "primary"
            ),
        )
        .map((slot) => (
          <SegmentField
            key={slot.key}
            slot={slot}
            value={slot.key === "primary" ? setup.segment : setup.segment2}
            which={slot.key === "primary" ? setup.which : setup.which2}
            onChange={(v) =>
              // The "which ones?" answer belongs to the cut that was
              // chosen, so changing the cut clears it — "Engineering,
              // Go-to-market" is not an answer about cohorts.
              set(
                slot.key === "primary"
                  ? { segment: v, which: undefined }
                  : { segment2: v, which2: undefined },
              )
            }
            onWhich={(v) =>
              set(slot.key === "primary" ? { which: v } : { which2: v })
            }
          />
        ))}
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
  const { grain, range } = setup;
  const cells = cellCount(grain, range);
  const noun = periodNoun(grain);

  // A moment has one end, and showing the reader two boxes that must agree is
  // two ways to say one thing.
  const onlyEnd = question === "moment";

  const label =
    question === "range"
      ? "Timeframe"
      : question === "moment"
        ? "As of"
        : question === "endpoints"
          ? "From and to"
          : question === "points"
            ? "Moments to compare"
            : "Window";

  const hint =
    question === "moment"
      ? "the single period this chart is at"
      : question === "endpoints"
        ? "the two totals the bridge runs between"
        : question === "points"
          ? "the ends of the comparison"
          : question === "window"
            ? "the span the bars sit inside"
            : "the unit of time, then the two ends";

  /** Both ends re-snapped when the grain changes — see `withGrain`. */
  const setGrain = (next: DateGrain) =>
    onChange(withGrain(setup, next, question));

  /**
   * A preset means what it says: the last N periods, counted back from the one
   * in progress. On a range that had drifted into the past it moves the END
   * too — "last 6 months" on a range ending in January is not six months
   * ending in January, and quietly counting back from January would put a
   * chip labelled "last 6" on a chart that shows something else.
   */
  const setSpan = (n: number) =>
    onChange({ range: rangeEndingAt(grain, currentCell(grain, asOf), n) });

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
          options={grains.map((g) => ({
            value: g,
            label: `${periodNoun(g)}s`,
          }))}
          value={grain}
          onChange={(v) => setGrain(v as DateGrain)}
        />

        <div className="flex items-center gap-1.5">
          {onlyEnd ? null : (
            <>
              <PeriodPicker
                grain={grain}
                value={range.from}
                asOf={asOf}
                ariaLabel="Start of the range"
                onChange={(iso) =>
                  onChange({ range: { ...range, from: snap(grain, iso) } })
                }
              />
              <span className="text-[10px] text-zinc-400">to</span>
            </>
          )}
          <PeriodPicker
            grain={grain}
            value={range.to}
            asOf={asOf}
            ariaLabel={
              onlyEnd ? "The period this chart is at" : "End of the range"
            }
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
            ranges are said — one click still beats two date pickers.

            They are offered at every grain and from any range, including one
            that has drifted into the past: "last 6 months" is exactly the
            thing an author with a stale range wants one click to. What keeps
            the word "last" honest is that the chip SETS the end to the period
            in progress, and lights up only for a range that ends there — so a
            historical range shows the chips unlit, and clicking one makes the
            label true rather than describing a range it doesn't fit. */}
        {question === "range" || question === "window" ? (
          <div className="flex flex-wrap items-center gap-1">
            {SPAN_PRESETS[grain].map((n) => (
              <Chip
                key={n}
                on={cells === n && endsOnCurrent(grain, range, asOf)}
                onClick={() => setSpan(n)}
              >
                {`last ${n}`}
              </Chip>
            ))}
            <span className="ml-0.5 text-[10px] text-zinc-400">
              {cells === 0
                ? "the range starts after it ends"
                : `${cells} ${noun}${cells === 1 ? "" : "s"}`}
            </span>
          </div>
        ) : null}

        {question === "points" ? (
          <div className="flex items-center gap-2">
            <Segmented
              options={[
                { value: "2", label: "two markers" },
                { value: "3", label: "three" },
              ]}
              value={String(setup.markers)}
              onChange={(v) => onChange({ markers: Number(v) === 3 ? 3 : 2 })}
            />
            <span className="truncate text-[10px] text-zinc-400">
              {periods.join(" · ")}
            </span>
          </div>
        ) : null}

        {/* The one thing the pickers can't show: that the last period hasn't
            finished. A partial period drawn beside complete ones reads as a
            collapse, and the reader has no way to tell. */}
        {question !== "window" && endsOnCurrent(grain, range, asOf) ? (
          <p className="text-[10px] leading-snug text-amber-600">
            The current {noun} is still running, so the last{" "}
            {question === "moment" ? "figure" : "point"} will read low.{" "}
            <button
              onClick={() =>
                setEnd(shiftCells(grain, currentCell(grain, asOf), -1))
              }
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

/* ------------------------------------------------------------------ */
/* Measures and segments                                              */
/* ------------------------------------------------------------------ */

const measureOf = (setup: ChartSetup, slot: MeasureSlot): string | undefined =>
  slot.key === "primary"
    ? setup.measure
    : slot.key === "secondary"
      ? setup.secondaryMeasure
      : setup.sizeMeasure;

const patchMeasure = (
  slot: MeasureSlot,
  v: string | undefined,
): Partial<ChartSetup> =>
  slot.key === "primary"
    ? { measure: v }
    : slot.key === "secondary"
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
  const free = value?.startsWith("free:") ?? false;
  const [typed, setTyped] = useState(free ? value!.slice(5) : "");

  const wanted = (m: MeasureDef) =>
    slot.wants === "rate"
      ? m.unit === "percent" || m.unit === "ratio"
      : slot.wants === "absolute"
        ? m.unit !== "percent" && m.unit !== "ratio"
        : true;

  return (
    // No hint beside the label: the menu directly under it is the explanation,
    // and the hint text is still the wording of the blocker when the slot is
    // left empty, which is where it is actually needed.
    <Field label={slot.label}>
      <div className="space-y-1">
        <select
          value={free ? OTHER : (value ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) onChange(`free:${typed}`);
            else onChange(v || undefined);
          }}
          className="w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700"
        >
          <option value="">{slot.required ? "Choose one…" : "None"}</option>
          {MEASURE_GROUPS.map((group) => {
            const items = MEASURES.filter(
              (m) => m.group === group && wanted(m),
            );
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
  which,
  onChange,
  onWhich,
}: {
  slot: SegmentSlot;
  value?: string;
  which?: string;
  onChange: (v: string | undefined) => void;
  onWhich: (v: string | undefined) => void;
}) {
  const free = value?.startsWith("free:") ?? false;
  const [typed, setTyped] = useState(free ? value!.slice(5) : "");
  const cut = value ? resolveSegment(value) : undefined;

  return (
    // No hint beside the label, as in `MeasureField`.
    <Field label={slot.label}>
      <div className="space-y-1">
        <select
          value={free ? OTHER : (value ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) onChange(`free:${typed}`);
            else onChange(v || undefined);
          }}
          className="w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700"
        >
          <option value="">
            {slot.required ? "Choose one…" : "Nothing — one total"}
          </option>
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

        {cut ? (
          <WhichField cut={cut} value={which ?? ""} onChange={onWhich} />
        ) : null}
      </div>
    </Field>
  );
}

/**
 * Which ones — the question a cut leaves open.
 *
 * Choosing "department" says what KIND of thing divides the chart and nothing
 * about which of them, and the members underneath are ours: three lettered
 * stand-ins, or the one real list we happen to know. Every author knew the
 * answer at the moment they picked the cut, and without somewhere to put it the
 * knowledge went into a Slack message, or nowhere.
 *
 * Read two ways, and it tells the author which one it took — see
 * `namedMembers`. A comma-separated list IS the members, so the chart is
 * labelled with the real names before it is inserted; anything else is prose
 * about the scope ("only the orgs over 100 ACUs"), which no axis could carry,
 * and it rides into the Devin prompt inside the brief.
 */
function WhichField({
  cut,
  value,
  onChange,
}: {
  cut: SegmentDef;
  value: string;
  onChange: (v: string | undefined) => void;
}) {
  const named = namedMembers(value);
  const id = `dd-which-${cut.id}`;

  return (
    <div className="pt-0.5">
      <label
        htmlFor={id}
        className="mb-0.5 block text-[10px] text-zinc-500 dark:text-zinc-400"
      >
        Which {cut.plural}? <span className="text-zinc-400">optional</span>
      </label>
      <input
        id={id}
        value={value}
        placeholder={cut.examples}
        onChange={(e) =>
          onChange(e.target.value.trim() ? e.target.value : undefined)
        }
        className="w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-[11px] outline-none placeholder:text-zinc-400 focus:border-indigo-400 dark:border-zinc-700"
      />
      {/* The members are placeholders and say so, because the alternative is
          an author discovering on the slide that "Customer A" was ours. */}
      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
        {named.length ? (
          <>
            {named.join(", ")} — {named.length} of them, on the chart exactly as
            typed.
          </>
        ) : value.trim() ? (
          <>
            Read as scope, not as names — carried into the Devin prompt.
            Separate names with commas to label the chart with them.
          </>
        ) : (
          <>
            {cut.members.join(", ")} — placeholders. Name them here and they go
            straight onto the chart.
          </>
        )}
      </p>
    </div>
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
export function NotesField({
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
          Carried onto the chart and quoted in the Devin prompt as your
          instructions — not as context to weigh up.
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
  /** Left off where the control below is self-explaining. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        {hint ? (
          <span className="truncate text-[10px] text-zinc-400">{hint}</span>
        ) : null}
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
              ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
          ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Warnings                                                           */
/* ------------------------------------------------------------------ */

/**
 * What is wrong with these answers, worst first — shown, never enforced away.
 *
 * A blocker names a chart that would state something untrue (a stack of
 * averages) and is what the picker's Insert button waits on; a note is taste.
 * The datasheet has no button to hold, so there the same list is simply the
 * truth about the chart currently on the slide, which is worth saying either
 * way.
 */
export function SetupIssues({ issues }: { issues: SetupIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1">
      {issues.map((issue) => (
        <li
          key={issue.text}
          className={`text-[10px] leading-snug ${
            issue.level === "blocker" ? "text-red-600" : "text-amber-600"
          }`}
        >
          {issue.text}
          {issue.insteadId && layoutById(issue.insteadId) ? (
            <span className="text-zinc-400">
              {" "}
              A {layoutById(issue.insteadId)!.name.toLowerCase()} doesn&rsquo;t
              have this problem.
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
