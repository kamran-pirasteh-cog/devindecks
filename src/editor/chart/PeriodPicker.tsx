'use client';

/**
 * One end of a chart's period, picked in the panel's own hand.
 *
 * It used to be three native controls — a `date` input, a `month` input, a
 * `select` — and each one opened whatever calendar the browser happened to
 * ship: a grey nineties grid beside a panel of soft borders and indigo
 * accents, in the browser's own colours whatever theme the deck is in. Worse,
 * they asked the wrong question at two of the five grains: a month input
 * offers a month when a weekly axis wants a week, and a date input offers the
 * 14th when the axis is quarters.
 *
 * So one popover, and the grid inside it is the grain: days for days and
 * weeks, a year of months for months, a year of quarters for quarters, a
 * column of years for years. The button always reads as the axis label does —
 * `Q3'26`, `Jul 2026`, `w/c 13 Jul` — because that's the thing being chosen,
 * not the ISO date underneath it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cellLabel, cellOptions, currentCell, snap } from '@/charts/periodRange';
import {
  WEEKDAY_INITIALS,
  cellsInYear,
  monthDays,
  monthOf,
  monthTitle,
  shiftMonths,
  shiftYears,
} from '@/charts/periodGrid';
import { periodNoun } from '@/charts/intent';
import type { DateGrain } from '@/model';

/** Which grid a grain wants. Day and week share one; year has no year to page. */
type Grid = 'days' | 'cells' | 'years';

const gridFor = (grain: DateGrain): Grid =>
  grain === 'day' || grain === 'week'
    ? 'days'
    : grain === 'year'
      ? 'years'
      : 'cells';

const CELL =
  'rounded px-0 py-1 text-[11px] tabular-nums transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800';
const ON = 'bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-600';

export function PeriodPicker({
  grain,
  value,
  asOf,
  ariaLabel,
  onChange,
}: {
  grain: DateGrain;
  value: string;
  asOf: string;
  ariaLabel: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  /**
   * The month or year on show, which is not the selection: paging to August to
   * look at it must not change the chart, and only a click does.
   */
  const [view, setView] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  // Reopening lands on the selection rather than wherever the last session
  // wandered to, and a grain change moves the selection out from under a view
  // that no longer contains it.
  useEffect(() => setView(value), [value, grain]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // Deferred: the click that opened this would otherwise close it again.
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      clearTimeout(t);
    };
  }, [open]);

  const grid = gridFor(grain);
  const noun = periodNoun(grain);
  const selected = snap(grain, value);
  const commit = (iso: string) => {
    onChange(snap(grain, iso));
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
          open
            ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/40'
            : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
        }`}
      >
        {cellLabel(grain, value)}
        <svg viewBox="0 0 8 5" className="h-[5px] w-2 fill-current opacity-50" aria-hidden>
          <path d="M0 0h8L4 5z" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-30 mt-1 w-[196px] rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {/* Years have nothing to page: the whole list fits, and arrows over
              it would be a control that only ever scrolls. */}
          {grid === 'years' ? null : (
            <div className="mb-1.5 flex items-center justify-between">
              <Step
                label={grid === 'days' ? 'Previous month' : 'Previous year'}
                onClick={() => setView(grid === 'days' ? shiftMonths(view, -1) : shiftYears(view, -1))}
                back
              />
              <span className="text-[11px] font-medium tabular-nums">
                {grid === 'days' ? monthTitle(view) : monthOf(view).year}
              </span>
              <Step
                label={grid === 'days' ? 'Next month' : 'Next year'}
                onClick={() => setView(grid === 'days' ? shiftMonths(view, 1) : shiftYears(view, 1))}
              />
            </div>
          )}

          {grid === 'days' ? (
            <DayGrid grain={grain} view={view} selected={selected} asOf={asOf} onPick={commit} />
          ) : grid === 'cells' ? (
            <CellGrid grain={grain} view={view} selected={selected} asOf={asOf} onPick={commit} />
          ) : (
            <YearList grain={grain} selected={selected} asOf={asOf} onPick={commit} />
          )}

          <div className="mt-1.5 flex items-center justify-between border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
            {/* A week is chosen by any day in it, which is not obvious from a
                grid of days with a whole row lit up. */}
            <span className="text-[10px] text-zinc-400">
              {grain === 'week' ? 'any day in the week' : cellLabel(grain, selected)}
            </span>
            <button
              type="button"
              onClick={() => commit(currentCell(grain, asOf))}
              className="rounded px-1 py-0.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
            >
              this {noun}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One of the header's paging arrows. */
function Step({ label, onClick, back }: { label: string; onClick: () => void; back?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      <svg viewBox="0 0 6 10" className="h-2.5 w-1.5 fill-current" aria-hidden>
        <path d={back ? 'M6 0 1 5l5 5z' : 'M0 0l5 5-5 5z'} />
      </svg>
    </button>
  );
}

/**
 * Six weeks of days, for a daily or weekly axis.
 *
 * At week grain the whole week lights up rather than the one day clicked: the
 * range covers the week, and a single lit Monday would suggest the chart starts
 * mid-week when it doesn't.
 */
function DayGrid({
  grain,
  view,
  selected,
  asOf,
  onPick,
}: {
  grain: DateGrain;
  view: string;
  selected: string;
  asOf: string;
  onPick: (iso: string) => void;
}) {
  const days = useMemo(() => monthDays(view), [view]);
  const today = currentCell('day', asOf);
  return (
    <div>
      <div className="mb-0.5 grid grid-cols-7">
        {WEEKDAY_INITIALS.map((d, i) => (
          <span key={i} className="text-center text-[9px] font-medium text-zinc-400">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((d) => {
          const on = snap(grain, d.iso) === selected;
          return (
            <button
              key={d.iso}
              type="button"
              aria-label={d.iso}
              aria-current={on ? 'date' : undefined}
              onClick={() => onPick(d.iso)}
              className={`${CELL} ${
                on
                  ? ON
                  : d.inMonth
                    ? 'text-zinc-700 dark:text-zinc-200'
                    : 'text-zinc-300 dark:text-zinc-600'
              } ${!on && d.iso === today ? 'font-semibold text-indigo-600 dark:text-indigo-400' : ''}`}
            >
              {d.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A year of months, quarters or halves — the grains a native input can't ask for. */
function CellGrid({
  grain,
  view,
  selected,
  asOf,
  onPick,
}: {
  grain: DateGrain;
  view: string;
  selected: string;
  asOf: string;
  onPick: (iso: string) => void;
}) {
  const kind = grain === 'month' ? 'month' : grain === 'quarter' ? 'quarter' : 'half';
  const cells = useMemo(() => cellsInYear(kind, view), [kind, view]);
  const current = currentCell(grain, asOf);
  return (
    <div className={`grid gap-0.5 ${kind === 'month' ? 'grid-cols-4' : 'grid-cols-2'}`}>
      {cells.map((iso) => {
        const on = iso === selected;
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onPick(iso)}
            className={`${CELL} px-1 ${
              on
                ? ON
                : iso === current
                  ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                  : 'text-zinc-700 dark:text-zinc-200'
            }`}
          >
            {cellLabel(grain, iso)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The years, in one scrollable column.
 *
 * A range saved years outside the window still shows: its own value is added
 * rather than the chart silently snapping to something the author never chose.
 */
function YearList({
  grain,
  selected,
  asOf,
  onPick,
}: {
  grain: DateGrain;
  selected: string;
  asOf: string;
  onPick: (iso: string) => void;
}) {
  const options = useMemo(() => {
    const opts = cellOptions(grain, asOf);
    return opts.some((o) => o.value === selected)
      ? opts
      : [{ value: selected, label: cellLabel(grain, selected) }, ...opts];
  }, [grain, asOf, selected]);
  const current = currentCell(grain, asOf);
  return (
    <div className="grid max-h-44 grid-cols-3 gap-0.5 overflow-y-auto">
      {options.map((o) => {
        const on = o.value === selected;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onPick(o.value)}
            className={`${CELL} px-1 ${
              on
                ? ON
                : o.value === current
                  ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                  : 'text-zinc-700 dark:text-zinc-200'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
