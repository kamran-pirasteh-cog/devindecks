'use client';

/**
 * A report in the grid — deliberately the same object as a `DocCard`: same
 * frame, same thumbnail well, same hover lift, same "..." menu in the same
 * corner. What differs is the caption, which describes a delivery (cadence ·
 * recipients · channel) rather than a document.
 *
 * The thumbnail is the attached deck's first slide, so the two tabs show the
 * same picture for the same thing.
 */
import { useEffect, useRef, useState } from 'react';
import type { Deck } from '@/model';
import {
  FORMATS,
  FREQUENCIES,
  describeAsOf,
  describeSchedule,
  nextRunAt,
  type Report,
} from '@/reports/types';
import { Thumb } from './Thumb';
import { ChannelChip, StatusChip } from './ChannelBadge';
import { ConfirmDialog } from './ConfirmDialog';

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function whenNext(report: Report): string {
  const next = nextRunAt(report);
  if (!next) return report.status === 'paused' ? 'Paused' : 'Not scheduled';
  return `Next ${next.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}, ${next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function ReportCard({
  report,
  deck,
  placeholderDeck,
  onOpen,
  onToggleStatus,
  onDuplicate,
  onDelete,
  onRunNow,
  onSendTest,
}: {
  report: Report;
  /** The attached deck, or undefined if it was deleted out from under us. */
  deck?: Deck;
  /**
   * A deck to draw in the thumbnail well when there's no attached deck — used
   * by the Product Roadmap preview, which borrows the first of your own decks
   * so a card shows a real slide instead of an empty grey box. The caption
   * still says the deck is missing, so nothing here claims it's attached.
   */
  placeholderDeck?: Deck;
  onOpen: () => void;
  onToggleStatus: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Raise a run off-schedule — held for approval if the report requires it. */
  onRunNow: () => void;
  /** Raise a run that goes only to you, whatever the recipient list says. */
  onSendTest: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // The attached deck if there is one, else the borrowed placeholder.
  const thumbDeck = deck ?? placeholderDeck;
  const asOf = describeAsOf(report.dataRefreshedAt);
  const recipients = report.recipients.filter((r) => r.name.trim() || r.address.trim());
  const shown = recipients.slice(0, 2);
  const extra = recipients.length - shown.length;

  return (
    // Same z-lift as DocCard, for the same reason: the hover transform makes the
    // card a stacking context, so an open menu has to ride up with the card.
    <div
      onClick={onOpen}
      className={`group relative cursor-pointer rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 ${
        menuOpen ? 'z-20' : ''
      }`}
    >
      <div className="relative overflow-hidden rounded-t-lg border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
        {thumbDeck ? (
          <Thumb deck={thumbDeck} />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-zinc-50 text-[11px] text-zinc-400 dark:bg-zinc-950">
            No deck attached
          </div>
        )}
        {/* How old the numbers are, over the slide they're on. A clear pill, not
            a coloured one: this is a fact about the data, not a state of the
            report, and the status chip opposite already owns the colour. Inside
            the well (a `span`, so the well's `[&>div]` sizing rule skips it) so
            it can sit on the slide's bottom edge whatever height it renders. */}
        {asOf ? (
          <span
            title={`Data last refreshed ${new Date(report.dataRefreshedAt!).toLocaleString()}`}
            className="absolute bottom-2 left-2 rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-medium text-zinc-600 shadow-sm ring-1 ring-black/5 backdrop-blur-sm dark:bg-zinc-900/70 dark:text-zinc-300 dark:ring-white/10"
          >
            {asOf}
          </span>
        ) : null}
      </div>
      {/* A sibling of the thumbnail well, not a child of it: that well forces
          `w-full` onto every div inside so the slide fills the card, and the
          chip was being stretched to the full width by the same rule. Top-RIGHT
          because the slide's own logo usually sits top-left, and the ring keeps
          it legible over whatever the deck renders. */}
      <StatusChip
        status={report.status}
        label={
          report.status === 'active'
            ? (FREQUENCIES.find((f) => f.value === report.frequency)?.label ?? report.frequency)
            : undefined
        }
        className="absolute right-2 top-2 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
      />

      <div className="px-3 py-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
              {report.name || 'Untitled report'}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-zinc-400">
              {deck ? deck.title : 'Deck missing'} ·{' '}
              {FORMATS.find((f) => f.value === report.format)?.label ?? report.format} ·{' '}
              {describeSchedule(report)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {shown.length ? (
                shown.map((r) => (
                  <ChannelChip key={r.id} channel={r.channel} label={r.name || r.address} />
                ))
              ) : (
                <span className="text-[10px] italic text-zinc-400">No recipients yet</span>
              )}
              {extra > 0 ? (
                <span className="text-[10px] text-zinc-400">+{extra}</span>
              ) : null}
            </div>
            <div className="mt-1 text-[10px] text-zinc-400">
              {whenNext(report)}
              {report.lastSentAt ? ` · Last sent ${timeAgo(report.lastSentAt)}` : ''}
              {report.requiresApproval ? ' · Needs approval' : ''}
            </div>
          </div>

          <div className="relative ml-2 shrink-0" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="More"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 opacity-0 hover:bg-zinc-100 group-hover:opacity-100 dark:hover:bg-zinc-800"
            >
              •••
            </button>

            {menuOpen ? (
              <div
                role="menu"
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-7 z-10 w-48 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onOpen();
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
                >
                  Edit report
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onRunNow();
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
                >
                  Run now
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onSendTest();
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
                >
                  Send test run
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleStatus();
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
                >
                  {report.status === 'active' ? 'Pause schedule' : 'Activate schedule'}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDuplicate();
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
                >
                  Duplicate
                </button>
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDelete(true);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this report?"
          message={`“${report.name || 'Untitled report'}” and its schedule will be removed. The deck itself isn't touched.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
