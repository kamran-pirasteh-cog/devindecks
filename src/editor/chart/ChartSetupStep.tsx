"use client";

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
import { useMemo } from "react";
import { FitSlideView } from "@/render/FitSlideView";
import { setupIssues, type ChartSetup } from "@/charts/setupForm";
import { setupPeriods, setupSentence } from "@/charts/setupSpec";
import { NotesField, SetupFields, SetupIssues } from "./setupFields";
import type { ChartLayout } from "@/charts/layouts";
import { token, type DesignSystem, type SlideElement } from "@/model";

const PREVIEW_SLIDE = { w: 12_192_000, h: 6_858_000 };

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
  const issues = useMemo(() => setupIssues(layout, setup), [layout, setup]);
  const blocked = issues.some((i) => i.level === "blocker");
  const periods = useMemo(() => setupPeriods(layout, setup), [layout, setup]);

  return (
    <div>
      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Set up
        </span>
        {/* The chart you picked, and the way back to the grid, as one control:
            the name of the current choice IS the affordance for changing it,
            which is a pill everywhere else in this app and was a label with a
            separate "change" link only here. */}
        <button
          onClick={onBack}
          title="Pick a different chart"
          className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          {layout.name}
        </button>
      </div>

      {/* The questions in one column, the picture beside them in a column half
          the panel wide — the preview is the thing being decided, so it gets
          real size, but it stays next to the answers that change it rather than
          a scroll away below them. */}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <SetupFields
            layout={layout}
            setup={setup}
            asOf={asOf}
            onChange={onChange}
          />
        </div>

        <div className="w-[30rem] shrink-0">
          <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
            <FitSlideView
              slide={{
                id: `setup-${layout.id}`,
                elements,
                background: { kind: "solid", color: token("surface.base") },
              }}
              slideSize={PREVIEW_SLIDE}
              designSystem={ds}
            />
          </div>
          {/* The sentence the answers amount to. It is the same string that
              goes onto the chart as the author's brief and into the Devin
              prompt as what they asked for, so it is worth reading back. */}
          <p className="mt-1.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
            {setupSentence(layout, setup, periods) || "Nothing chosen yet."}
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
        <NotesField
          value={setup.notes ?? ""}
          onChange={(notes) => onChange({ ...setup, notes })}
        />
      </div>

      {/* Bottom right, where the button that ends a dialog belongs — and the
          last thing under the preview it acts on. The warnings sit at the far
          left of the same row: they are what the Insert button is waiting on,
          so they read next to it rather than paragraphs above it. */}
      <div className="mt-2.5 flex items-end gap-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
        {issues.length ? (
          <div className="min-w-0 flex-1">
            <SetupIssues issues={issues} />
          </div>
        ) : (
          <span className="flex-1" />
        )}
        <button
          onClick={onBlank}
          className="whitespace-nowrap rounded px-2 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Insert blank instead
        </button>
        <button
          onClick={onInsert}
          disabled={blocked}
          title={blocked ? "Answer the points in red first" : undefined}
          className="whitespace-nowrap rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          Insert this chart
        </button>
      </div>
    </div>
  );
}
