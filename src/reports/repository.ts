'use client';

/**
 * Reports repository — the same persistence seam as `docs/repository.ts`:
 * localStorage today, the Playground database later, with every call site
 * going through this interface so the swap doesn't touch the UI.
 */
import { nanoid } from 'nanoid';
import { DEFAULT_OWNER, listDocs } from '@/docs/repository';
import { createRun, deleteRunsForReport } from './runs';
import type { Channel, Recipient, Report, ReportStatus } from './types';

const KEY = 'devindesign.reports.v1';
const SEED_KEY = 'devindesign.reports.seeded.v1';

type ReportMap = Record<string, Report>;

function read(): ReportMap {
  if (typeof window === 'undefined') return {};
  try {
    const map = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as ReportMap;
    // Reports written before `dataRefreshedAt` existed fall back to their last
    // send, then to creation. Both are real moments the data was pulled, so the
    // "as of" pill stays honest on old records instead of going blank.
    for (const r of Object.values(map)) {
      if (!r.dataRefreshedAt) r.dataRefreshedAt = r.lastSentAt ?? r.createdAt;
    }
    return map;
  } catch {
    return {};
  }
}

function write(map: ReportMap) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

const now = () => new Date().toISOString();

/** Every report, most recently updated first — the grid's default order. */
export function listReports(): Report[] {
  return Object.values(read()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getReport(id: string): Report | null {
  return read()[id] ?? null;
}

/** A blank report, unsaved — what the New report sheet opens on. */
export function draftReport(deckId?: string): Report {
  const ts = now();
  return {
    id: `rpt-${nanoid(10)}`,
    name: '',
    deckId,
    status: 'draft',
    frequency: 'weekly',
    dayOfWeek: 1,
    dayOfMonth: 1,
    timeOfDay: '09:00',
    recipients: [],
    format: 'pdf',
    requiresApproval: false,
    skipIfUnchanged: false,
    includeComments: false,
    owner: DEFAULT_OWNER,
    createdAt: ts,
    updatedAt: ts,
    dataRefreshedAt: ts,
  };
}

/**
 * Stamp a fresh data pull. Called wherever a run is raised — a run is the only
 * thing that re-reads the numbers, so "as of" and "what went out" can't drift.
 */
export function markDataRefreshed(id: string, at = now()): void {
  const map = read();
  if (!map[id]) return;
  // `updatedAt` is left alone on purpose: a scheduled refresh isn't an edit, and
  // bumping it would shuffle the grid's default order every time one fires.
  map[id] = { ...map[id], dataRefreshedAt: at };
  write(map);
}

export function saveReport(report: Report): Report {
  const map = read();
  const saved = { ...report, updatedAt: now() };
  map[saved.id] = saved;
  write(map);
  return saved;
}

export function deleteReport(id: string): void {
  const map = read();
  delete map[id];
  write(map);
  // The history goes with it: a run that outlived its report would sit in the
  // approvals queue asking someone to approve a send that can't happen.
  deleteRunsForReport(id);
}

export function setReportStatus(id: string, status: ReportStatus): void {
  const map = read();
  if (!map[id]) return;
  map[id] = { ...map[id], status, updatedAt: now() };
  write(map);
}

/** Copy, with a fresh id and a "Copy of" name — mirrors `duplicateDoc`. */
export function duplicateReport(id: string): Report | null {
  const src = getReport(id);
  if (!src) return null;
  return saveReport({
    ...structuredClone(src),
    id: `rpt-${nanoid(10)}`,
    name: suggestCopyName(src.name),
    // A duplicate never inherits "live": you'd otherwise double every send the
    // moment you copied a schedule to tweak it.
    status: 'paused',
    lastSentAt: undefined,
    createdAt: now(),
  });
}

export function isNameAvailable(name: string, excludeId?: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return !listReports().some((r) => r.id !== excludeId && r.name.trim().toLowerCase() === n);
}

export function suggestCopyName(base: string): string {
  let candidate = `Copy of ${base}`;
  let n = 2;
  while (!isNameAvailable(candidate)) {
    candidate = `Copy of ${base} (${n})`;
    n += 1;
  }
  return candidate;
}

export function newRecipient(channel: Channel = 'email'): Recipient {
  return { id: `rcp-${nanoid(6)}`, name: '', address: '', channel };
}

/** Distinct recipient names across every report, for the People filter. */
export function listAllRecipients(): string[] {
  const set = new Set<string>();
  for (const r of listReports()) {
    for (const p of r.recipients) if (p.name.trim()) set.add(p.name.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Seed two example reports on first run, pointed at whatever decks exist, so
 * the tab shows the shape of the thing instead of an empty grid.
 */
export function seedIfFirstRun(): void {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem(SEED_KEY)) return;
  window.localStorage.setItem(SEED_KEY, '1');
  if (Object.keys(read()).length) return;

  const decks = listDocs();
  if (!decks.length) return;
  const [first, second] = decks;

  const weekly = saveReport({
    ...draftReport(first.id),
    name: `${first.title} — weekly send`,
    status: 'active',
    frequency: 'weekly',
    dayOfWeek: 1,
    timeOfDay: '09:00',
    format: 'pdf',
    recipients: [
      { id: `rcp-${nanoid(6)}`, name: 'Exec staff', address: '#exec-staff', channel: 'slack' },
      { id: `rcp-${nanoid(6)}`, name: 'Dana Whitfield', address: 'dana@acme.com', channel: 'email' },
    ],
    requiresApproval: true,
    approver: DEFAULT_OWNER,
    note: 'Goes out before the Monday leadership sync.',
  });

  saveReport({
    ...draftReport((second ?? first).id),
    name: `${(second ?? first).title} — monthly readout`,
    status: 'paused',
    frequency: 'monthly',
    dayOfMonth: 1,
    timeOfDay: '08:30',
    format: 'pptx',
    recipients: [
      { id: `rcp-${nanoid(6)}`, name: 'Board list', address: 'board@acme.com', channel: 'email' },
    ],
    requiresApproval: false,
    // Paused since before the last cycle, so its numbers are visibly stale —
    // which is the case the "as of" pill exists to make obvious.
    dataRefreshedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
  });

  // One run already waiting on a person, so the approvals queue on the tab
  // shows what it's for instead of an empty box.
  createRun(weekly, 'scheduled', DEFAULT_OWNER);
}
