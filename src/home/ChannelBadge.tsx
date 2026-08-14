'use client';

/**
 * Channel + status chips, shared by the report card and the report editor so a
 * channel looks the same wherever it's mentioned. Colours are per-channel on
 * purpose: a glance at a card should say "this goes to Slack" without reading.
 */
import type { Channel, ReportStatus } from '@/reports/types';

const CHANNEL_STYLE: Record<Channel, { label: string; className: string }> = {
  email: {
    label: 'Email',
    className: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  },
  slack: {
    label: 'Slack',
    className: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
  },
  teams: {
    label: 'Teams',
    className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300',
  },
  drive: {
    label: 'Drive',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  },
};

export function ChannelIcon({ channel }: { channel: Channel }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 shrink-0">
      {channel === 'email' ? (
        <>
          <rect x="2" y="4" width="12" height="8" rx="1.2" {...common} />
          <path d="m2.5 5 5.5 3.8L13.5 5" {...common} />
        </>
      ) : channel === 'slack' ? (
        <>
          <path d="M6 2.5v7M10 6.5v7M2.5 10h7M6.5 6h7" {...common} />
        </>
      ) : channel === 'teams' ? (
        <>
          <circle cx="6" cy="5" r="2" {...common} />
          <path d="M2.5 13c0-2 1.6-3.4 3.5-3.4S9.5 11 9.5 13" {...common} />
          <path d="M11 6.2a1.7 1.7 0 1 0 .8 3.2M11.6 13c0-1.3-.4-2.3-1.1-3" {...common} />
        </>
      ) : (
        <>
          <path d="M6.2 2.6h3.6l3.7 6.4-1.8 3.2-3.6-6.4z" {...common} />
          <path d="M2.5 9 4.3 5.8M2.5 9h7.3l1.8 3.2H4.3z" {...common} />
        </>
      )}
    </svg>
  );
}

export function ChannelChip({ channel, label }: { channel: Channel; label?: string }) {
  const style = CHANNEL_STYLE[channel];
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${style.className}`}
    >
      <ChannelIcon channel={channel} />
      <span className="truncate">{label ?? style.label}</span>
    </span>
  );
}

const STATUS_STYLE: Record<ReportStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  paused: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  draft: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

export function StatusChip({ status }: { status: ReportStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[status]}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          status === 'active'
            ? 'bg-emerald-500'
            : status === 'paused'
              ? 'bg-amber-500'
              : 'bg-zinc-400'
        }`}
      />
      {status}
    </span>
  );
}
