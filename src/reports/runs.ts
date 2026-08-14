'use client';

/**
 * Runs — one attempted delivery of a report.
 *
 * A run is what the schedule produces, and it's also what "Run now" and "Send
 * test" produce, so the three paths share one record and one history. Splitting
 * them would mean three near-identical shapes and an approvals queue that only
 * knew about one of them.
 *
 * A run snapshots its recipients, channel set and format at the moment it was
 * raised: editing the report afterwards must not rewrite what a pending
 * approval is being asked to approve.
 *
 * Nothing actually transmits — `markSent` is where the send-side integration
 * will hang once there is one.
 */
import { nanoid } from 'nanoid';
import type { Channel, Format, Report } from './types';

/** How the run was raised. Tests never go to the real recipient list. */
export type RunKind = 'scheduled' | 'manual' | 'test';

export type RunStatus = 'pending_approval' | 'sent' | 'declined';

export interface ReportRun {
  id: string;
  reportId: string;
  reportName: string;
  deckId?: string;
  kind: RunKind;
  status: RunStatus;
  format: Format;
  channels: Channel[];
  /** Display strings, snapshotted — "Exec staff (#exec-staff)". */
  recipients: string[];
  requestedBy?: string;
  approver?: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  sentAt?: string;
  /** Why it was declined, when someone said why. */
  reason?: string;
}

const KEY = 'devindesign.reportruns.v1';

type RunMap = Record<string, ReportRun>;

function read(): RunMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as RunMap;
  } catch {
    return {};
  }
}

function write(map: RunMap) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

const now = () => new Date().toISOString();

export function listRuns(): ReportRun[] {
  return Object.values(read()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The approvals queue: oldest first, because that's the one holding people up. */
export function listPendingRuns(): ReportRun[] {
  return Object.values(read())
    .filter((r) => r.status === 'pending_approval')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listRunsForReport(reportId: string): ReportRun[] {
  return listRuns().filter((r) => r.reportId === reportId);
}

export function describeRecipient(name: string, address: string): string {
  const n = name.trim();
  const a = address.trim();
  if (n && a) return `${n} (${a})`;
  return n || a || 'Unnamed recipient';
}

/**
 * Raise a run. A test, or a report that needs no sign-off, is sent on the spot;
 * anything else lands in the approvals queue.
 */
export function createRun(report: Report, kind: RunKind, requestedBy?: string): ReportRun {
  const holds = report.requiresApproval && kind !== 'test';
  const run: ReportRun = {
    id: `run-${nanoid(10)}`,
    reportId: report.id,
    reportName: report.name || 'Untitled report',
    deckId: report.deckId,
    kind,
    status: holds ? 'pending_approval' : 'sent',
    format: report.format,
    channels: [...new Set(report.recipients.map((r) => r.channel))],
    recipients:
      kind === 'test'
        ? [describeRecipient(requestedBy ?? 'You', 'test send')]
        : report.recipients.map((r) => describeRecipient(r.name, r.address)),
    requestedBy,
    approver: report.approver,
    createdAt: now(),
    sentAt: holds ? undefined : now(),
  };
  const map = read();
  map[run.id] = run;
  write(map);
  return run;
}

export function approveRun(id: string, by: string): void {
  const map = read();
  const run = map[id];
  if (!run || run.status !== 'pending_approval') return;
  // Approving IS sending here: there's no queue behind this yet, so a run that
  // sat waiting for a person goes out the moment they say yes.
  map[id] = { ...run, status: 'sent', decidedAt: now(), decidedBy: by, sentAt: now() };
  write(map);
}

export function declineRun(id: string, by: string, reason?: string): void {
  const map = read();
  const run = map[id];
  if (!run || run.status !== 'pending_approval') return;
  map[id] = { ...run, status: 'declined', decidedAt: now(), decidedBy: by, reason };
  write(map);
}

export function deleteRunsForReport(reportId: string): void {
  const map = read();
  for (const run of Object.values(map)) {
    if (run.reportId === reportId) delete map[run.id];
  }
  write(map);
}
