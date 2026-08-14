'use client';

/**
 * Pending approval — runs that are ready to go out and are waiting on a person.
 *
 * It sits above the report grid rather than behind a rail row: an approval is
 * something someone else is blocked on, so it has to be visible without being
 * navigated to. When the queue is empty the whole block is gone, so the tab
 * doesn't carry a permanent empty box.
 *
 * Each row shows the run's own snapshot — the recipients, channels and format
 * as they were when the run was raised — not the report's current settings,
 * which may have moved on since.
 */
import { useState } from 'react';
import type { Deck } from '@/model';
import { approveRun, declineRun, type ReportRun } from '@/reports/runs';
import { FORMATS } from '@/reports/types';
import { DEFAULT_OWNER } from '@/docs/repository';
import { ChannelChip } from './ChannelBadge';

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function PendingApprovals({
  runs,
  decks,
  onChange,
}: {
  runs: ReportRun[];
  decks: Deck[];
  onChange: () => void;
}) {
  // Which row is asking "why?". Declining without a reason is allowed — the
  // box is a prompt, not a gate.
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  if (!runs.length) return null;

  return (
    <section className="mb-5 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex items-center gap-2 border-b border-amber-200 px-4 py-2 dark:border-amber-500/30">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        <h2 className="text-xs font-semibold text-amber-900 dark:text-amber-200">
          Pending approval
        </h2>
        <span className="text-[11px] text-amber-700/70 dark:text-amber-300/60">
          {runs.length} run{runs.length === 1 ? '' : 's'} waiting to send
        </span>
      </div>

      <ul>
        {runs.map((run) => {
          const deck = run.deckId ? decks.find((d) => d.id === run.deckId) : undefined;
          const format = FORMATS.find((f) => f.value === run.format);
          return (
            <li
              key={run.id}
              className="border-t border-amber-100 px-4 py-2.5 first:border-t-0 dark:border-amber-500/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                    {run.reportName}
                    {run.kind === 'manual' ? (
                      <span className="ml-1.5 rounded bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-normal text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        Run now
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                    {deck?.title ?? 'Deck missing'} · {format?.label ?? run.format} · raised{' '}
                    {ago(run.createdAt)}
                    {run.approver ? ` · for ${run.approver}` : ''}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {run.channels.map((c) => (
                      <ChannelChip key={c} channel={c} />
                    ))}
                    <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {run.recipients.join(', ') || 'No recipients'}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => {
                      setDeclining(declining === run.id ? null : run.id);
                      setReason('');
                    }}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => {
                      approveRun(run.id, DEFAULT_OWNER);
                      onChange();
                    }}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Approve &amp; send
                  </button>
                </div>
              </div>

              {declining === run.id ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      declineRun(run.id, DEFAULT_OWNER, reason.trim() || undefined);
                      setDeclining(null);
                      onChange();
                    }}
                    placeholder="Why? (optional)"
                    className="flex-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    onClick={() => {
                      declineRun(run.id, DEFAULT_OWNER, reason.trim() || undefined);
                      setDeclining(null);
                      onChange();
                    }}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Decline run
                  </button>
                  <button
                    onClick={() => setDeclining(null)}
                    className="rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
