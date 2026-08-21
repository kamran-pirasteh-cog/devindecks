'use client';

/**
 * The setup questions, asked again on a chart that already exists.
 *
 * The picker asks what a chart is OF before inserting it — the measure, the
 * timeframe, the cut — and until this existed those answers were a one-time
 * thing: reopening the chart got you a datasheet full of numbers and a formatting
 * row, with no way to say "same chart, two more quarters" or "actually this is
 * ARR" short of retyping every label in the grid. So the same form is here, over
 * the preview it changes, with the answers the chart was made from filled in.
 *
 * Two rules make it safe to offer on a chart somebody has already worked on, and
 * both live in `respecFromSetup`: an answer only ever rewrites LABELS, never the
 * figures in the sheet, and a title that was typed by hand stays typed by hand.
 *
 * Collapsed or expanded is remembered. Expanded is the honest default the first
 * time — the whole point is that the questions are visible rather than something
 * you have to know to look for — but a datasheet is mostly used for its numbers,
 * and once somebody folds this away it should stay folded.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ChartInstance } from '@/model';
import { chartOrientation } from '@/model';
import { useEditor } from '@/store/editorStore';
import { dsForChartVariant } from '@/charts/style';
import { layoutForChart } from '@/charts/layouts';
import {
  carrySetup,
  defaultSetup,
  formFor,
  setupIssues,
  type ChartSetup,
} from '@/charts/setupForm';
import { respecFromSetup, setupPeriods, setupSentence } from '@/charts/setupSpec';
import { NotesField, SetupFields, SetupIssues } from './setupFields';

const OPEN_KEY = 'devindesign.datasheet.setup.open';

export function ChartSetupBand({ chart }: { chart: ChartInstance }) {
  const ds = useEditor((s) => s.designSystem);
  const patchChart = useEditor((s) => s.patchChart);
  const deck = useEditor((s) => s.deck);
  const currentSlideId = useEditor((s) => s.currentSlideId);

  // Read on the way in rather than in an effect: this only ever renders inside
  // the panel's portal, which is client-side, so there is no server pass to
  // disagree with.
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(OPEN_KEY) !== 'false';
    } catch {
      // A blocked localStorage just means the default.
      return true;
    }
  });

  const toggle = () => {
    setOpen((was) => {
      try {
        window.localStorage.setItem(OPEN_KEY, String(!was));
      } catch {
        // As above.
      }
      return !was;
    });
  };

  /**
   * The day relative periods are counted back from, read once while the panel is
   * open: "to current quarter" and the partial-period warning have to agree with
   * each other, and a panel left open across midnight must not have them
   * disagree.
   */
  const [asOf] = useState(() => new Date().toISOString().slice(0, 10));

  const spec = chart.spec;

  /**
   * Which questions to ask — see `layoutForChart`. The stored layout wins while
   * it still describes the chart; a chart whose type has since been switched
   * gets the new type's questions with the old answers carried onto them.
   */
  const layout = useMemo(
    () => layoutForChart(spec.kind, 'stack' in spec ? spec.stack : undefined, spec.setup?.layoutId),
    [spec],
  );

  /**
   * The answers as they stand.
   *
   * A chart with no record — inserted blank, imported from a deck, or made
   * before the form existed — opens on the defaults rather than on nothing: the
   * fields have to show SOMETHING, and a default range is the one answer that is
   * a default rather than a guess about intent. Nothing is written to the chart
   * until an answer is actually given, so an untouched form leaves it alone.
   */
  const setup = useMemo<ChartSetup | null>(() => {
    if (!layout) return null;
    const record = spec.setup;
    if (!record) return defaultSetup(formFor(layout), asOf);
    return record.layoutId === layout.id
      ? record.answers
      : carrySetup(record.answers, layout, asOf);
  }, [layout, spec.setup, asOf]);

  // The deck's own knowledge of its subject, as the picker gathers it — a chart
  // named after the client keeps being named after the client when its measure
  // changes.
  const context = useMemo(() => {
    const slide = deck.slides.find((sl) => sl.id === currentSlideId);
    const title = slide?.elements.find(
      (e) => e.type === 'text' && (e.role === 'title' || e.role === 'heading'),
    );
    return {
      deckTitle: deck.title,
      deckTags: deck.tags,
      slideTitle:
        title?.type === 'text'
          ? title.body.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(' ')
          : undefined,
    };
  }, [deck, currentSlideId]);

  const apply = useCallback(
    (next: ChartSetup) => {
      if (!layout) return;
      patchChart(chart.id, (draft) =>
        Object.assign(
          draft,
          respecFromSetup(draft, layout, next, dsForChartVariant(ds, chart.variantId), {
            orientation: chartOrientation(draft),
            asOf,
            ...context,
          }),
        ),
      );
    },
    [chart.id, chart.variantId, context, ds, layout, patchChart, asOf],
  );

  // A kind with no layout on the picker's grid — a Mekko, a butterfly — has no
  // questions to ask about it, so the band isn't drawn at all rather than drawn
  // empty.
  if (!layout || !setup) return null;

  const issues = setupIssues(layout, setup);
  const sentence = setupSentence(layout, setup, setupPeriods(layout, setup));

  return (
    <div className="shrink-0 rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={toggle}
        title={open ? 'Hide the setup questions' : 'What this chart is of'}
        className="flex w-full items-baseline gap-1.5 px-2 py-1.5 text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Set up
        </span>
        {/* The sentence the answers amount to, so a folded band still says what
            the chart claims to be — and reads as the thing worth unfolding. */}
        <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500 dark:text-zinc-400">
          {sentence || 'Nothing chosen yet'}
        </span>
        <span className="text-[10px] text-zinc-400">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-2.5 border-t border-zinc-100 px-2 pb-2 pt-2 dark:border-zinc-800">
          <SetupFields layout={layout} setup={setup} asOf={asOf} onChange={apply} />
          <NotesField
            value={setup.notes ?? ''}
            onChange={(notes) => apply({ ...setup, notes })}
          />
          <SetupIssues issues={issues} />
          {/* Said once, plainly, because it is the question anybody with real
              numbers in the sheet will have about touching these fields. */}
          <p className="text-[10px] leading-snug text-zinc-400">
            Changing an answer relabels the chart. Your figures stay in the
            sheet.
          </p>
        </div>
      ) : null}
    </div>
  );
}
