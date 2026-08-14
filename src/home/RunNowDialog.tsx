'use client';

/**
 * "Run now" — send a report off-schedule, from the Documents tab.
 *
 * The button lives beside "New" because the question it answers ("can you send
 * that deck out today?") arrives while you're looking at documents, not while
 * you're administering schedules. The dialog is a list of the reports you
 * already have, grouped under the deck each one delivers, so the deck you're
 * thinking of is what you scan for.
 *
 * A run raised here obeys the report's approval setting: if it needs sign-off it
 * joins the queue on the Reports tab rather than going out, and the row says so
 * instead of claiming it sent.
 */
import { useEffect, useState } from 'react';
import type { Deck } from '@/model';
import { listReports } from '@/reports/repository';
import { createRun } from '@/reports/runs';
import { FORMATS, describeSchedule, type Report } from '@/reports/types';
import { DEFAULT_OWNER } from '@/docs/repository';
import { ChannelChip, StatusChip } from './ChannelBadge';
import { Thumb } from './Thumb';

type Outcome = 'sent' | 'pending';

export function RunNowDialog({
  decks,
  onClose,
  /** Something was raised — the Reports tab's queue needs to hear about it. */
  onRan,
}: {
  decks: Deck[];
  onClose: () => void;
  onRan?: () => void;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [query, setQuery] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  useEffect(() => setReports(listReports()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const deckById = new Map(decks.map((d) => [d.id, d]));

  const q = query.trim().toLowerCase();
  const visible = reports.filter((r) => {
    if (!q) return true;
    const title = r.deckId ? (deckById.get(r.deckId)?.title ?? '') : '';
    return r.name.toLowerCase().includes(q) || title.toLowerCase().includes(q);
  });

  const run = (report: Report) => {
    const created = createRun(report, 'manual', DEFAULT_OWNER);
    setOutcomes((o) => ({
      ...o,
      [report.id]: created.status === 'pending_approval' ? 'pending' : 'sent',
    }));
    onRan?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold">Run now</h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Send a report immediately, outside its schedule.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

        {reports.length > 4 ? (
          <div className="border-b border-zinc-200 px-5 py-2.5 dark:border-zinc-800">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports or decks…"
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-5 py-10 text-center text-xs text-zinc-400">
              {reports.length
                ? 'No reports match that.'
                : 'No reports yet — set one up on the Reports tab first.'}
            </p>
          ) : (
            <ul>
              {visible.map((r) => {
                const deck = r.deckId ? deckById.get(r.deckId) : undefined;
                const outcome = outcomes[r.id];
                const people = r.recipients.filter((p) => p.name.trim() || p.address.trim());
                const channels = [...new Set(people.map((p) => p.channel))];
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3 last:border-b-0 dark:border-zinc-800"
                  >
                    <div className="w-24 shrink-0 overflow-hidden rounded border border-zinc-200 dark:border-zinc-800 [&>div]:!w-full">
                      {deck ? (
                        <Thumb deck={deck} width={120} />
                      ) : (
                        <div className="aspect-video bg-zinc-50 dark:bg-zinc-950" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                          {r.name || 'Untitled report'}
                        </span>
                        <StatusChip status={r.status} />
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                        {deck?.title ?? 'Deck missing'} ·{' '}
                        {FORMATS.find((f) => f.value === r.format)?.label ?? r.format} ·{' '}
                        {describeSchedule(r)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {channels.map((c) => (
                          <ChannelChip key={c} channel={c} />
                        ))}
                        <span className="truncate text-[10px] text-zinc-400">
                          {people.length
                            ? `${people.length} recipient${people.length === 1 ? '' : 's'}`
                            : 'No recipients'}
                          {r.requiresApproval ? ' · needs approval' : ''}
                        </span>
                      </div>
                    </div>

                    {outcome ? (
                      <span
                        className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                          outcome === 'sent'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                        }`}
                      >
                        {outcome === 'sent' ? 'Sent' : 'Waiting for approval'}
                      </span>
                    ) : (
                      <button
                        onClick={() => run(r)}
                        disabled={!deck || !people.length}
                        title={
                          !deck
                            ? 'This report has no deck'
                            : !people.length
                              ? 'Add a recipient first'
                              : undefined
                        }
                        className="shrink-0 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
                      >
                        Run
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
