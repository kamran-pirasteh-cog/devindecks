'use client';

/**
 * Reports preview — the same shape as Documents: a rail on the left, a search /
 * filter / sort toolbar, and a grid of cards. A report is a recurring delivery
 * of a deck, so each card shows the deck's own thumbnail; what's different is
 * the caption and the rail, which slices by schedule status rather than folder.
 *
 * The roll-up that used to live on this tab is now the strip of totals at the
 * top, so the numbers are still here without being the whole tab.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Deck } from '@/model';
import {
  deleteReport,
  draftReport,
  duplicateReport,
  listReports,
  markDataRefreshed,
  saveReport,
  seedIfFirstRun,
  setReportStatus,
} from '@/reports/repository';
import {
  STATUSES,
  nextRunAt,
  type Report,
  type ReportStatus,
} from '@/reports/types';
import { createRun, listPendingRuns, type ReportRun } from '@/reports/runs';
import { DEFAULT_OWNER } from '@/docs/repository';
import { ReportCard } from './ReportCard';
import { ReportEditor } from './ReportEditor';
import { PendingApprovals } from './PendingApprovals';

type Scope = { kind: 'all' } | { kind: 'status'; status: ReportStatus };

type SortBy = 'next' | 'updated' | 'name' | 'deck';

/** Sentinels for the "no owner set" / "no client tag" filter options. */
const NO_OWNER = '\u0000none';
const NO_CLIENT = '\u0000untagged';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'next', label: 'Next send' },
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name' },
  { value: 'deck', label: 'Deck' },
];

/** Same control as the Documents toolbar's, so the two rows match. */
function ToolbarSelect({
  label,
  value,
  onChange,
  active,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full appearance-none rounded-md border py-1.5 pl-2.5 pr-8 text-sm outline-none ${
          active
            ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-300'
            : 'border-zinc-200 bg-white text-zinc-600 focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
        }`}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 12 12"
        aria-hidden
        className={`pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 ${
          active ? 'text-indigo-500 dark:text-indigo-300' : 'text-zinc-400'
        }`}
      >
        <path
          d="M3 4.75 6 7.75 9 4.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** Rail row — matched to `FolderRail`'s, minus the drop targets. */
function Row({
  label,
  count,
  icon,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  icon: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pl-2 pr-2.5 text-left text-sm ${
        selected
          ? 'bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-zinc-400">{count}</span>
    </button>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M8 5v3.2l2 1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Dot({ status }: { status: ReportStatus }) {
  return (
    <span
      aria-hidden
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        status === 'active'
          ? 'bg-emerald-500'
          : status === 'paused'
            ? 'bg-amber-500'
            : 'bg-zinc-400'
      }`}
    />
  );
}

export function Reports({
  docs,
  /** Bumped by the header's "New report" — a change opens the sheet. */
  newSignal = 0,
  /** Bumped when a run is raised elsewhere (the Documents tab's "Run now"). */
  runsSignal = 0,
}: {
  docs: Deck[];
  newSignal?: number;
  runsSignal?: number;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [deckFilter, setDeckFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('next');
  const [editing, setEditing] = useState<Report | null>(null);
  const [pending, setPending] = useState<ReportRun[]>([]);
  // Confirmation for the actions that raise a run from a card menu — those are
  // one-click and otherwise silent, so they need to say what they did.
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () => {
    setReports(listReports());
    setPending(listPendingRuns());
  };

  /** Raise a run and say where it went. Shared by "Run now" and "Send test". */
  const raise = (report: Report, kind: 'manual' | 'test') => {
    const run = createRun(report, kind, DEFAULT_OWNER);
    // Raising a run is the moment the numbers get pulled, so the "as of" moves
    // with it — including for a test, which reads the same live data.
    markDataRefreshed(report.id);
    setToast(
      kind === 'test'
        ? `Test run of “${report.name}” sent to you.`
        : run.status === 'pending_approval'
          ? `“${report.name}” is waiting for approval below.`
          : `“${report.name}” sent to ${run.recipients.length} recipient${
              run.recipients.length === 1 ? '' : 's'
            }.`,
    );
    refresh();
  };

  useEffect(() => {
    seedIfFirstRun();
    refresh();
  }, []);

  // Skipped on the first render: the initial value isn't a request to create.
  useEffect(() => {
    if (newSignal > 0) setEditing(draftReport(docs[0]?.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSignal]);

  useEffect(() => {
    if (runsSignal > 0) setPending(listPendingRuns());
  }, [runsSignal]);

  const deckById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);

  const counts = useMemo(() => {
    const out: Record<ReportStatus, number> = { active: 0, paused: 0, draft: 0 };
    for (const r of reports) out[r.status] += 1;
    return out;
  }, [reports]);

  /**
   * A report has no client of its own: it inherits the tags of the deck it
   * delivers, so filtering by client here means the same thing it does on the
   * Documents tab.
   */
  const clientsOf = (r: Report) => (r.deckId ? (deckById.get(r.deckId)?.tags ?? []) : []);

  const allOwners = useMemo(() => {
    const set = new Set<string>();
    for (const r of reports) if (r.owner?.trim()) set.add(r.owner.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [reports]);

  const allClients = useMemo(() => {
    const set = new Set<string>();
    for (const r of reports) {
      const deck = r.deckId ? deckById.get(r.deckId) : undefined;
      for (const t of deck?.tags ?? []) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [reports, deckById]);

  const hasUnowned = reports.some((r) => !r.owner?.trim());
  const hasUntagged = reports.some((r) => clientsOf(r).length === 0);

  const hasFilters = Boolean(query || deckFilter || ownerFilter || clientFilter);
  const clearFilters = () => {
    setQuery('');
    setDeckFilter('');
    setOwnerFilter('');
    setClientFilter('');
  };

  // Escape clears the filters, matching the Documents tab — but not while the
  // sheet is up, where Escape means "close the sheet".
  useEffect(() => {
    if (editing || !hasFilters) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      clearFilters();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, hasFilters]);

  const visible = reports
    .filter((r) => {
      if (scope.kind === 'status' && r.status !== scope.status) return false;
      if (deckFilter && r.deckId !== deckFilter) return false;
      if (ownerFilter === NO_OWNER) {
        if (r.owner?.trim()) return false;
      } else if (ownerFilter && r.owner?.trim() !== ownerFilter) return false;
      const clients = clientsOf(r);
      if (clientFilter === NO_CLIENT) {
        if (clients.length) return false;
      } else if (clientFilter && !clients.includes(clientFilter)) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const deckTitle = r.deckId ? (deckById.get(r.deckId)?.title ?? '') : '';
      return (
        r.name.toLowerCase().includes(q) ||
        deckTitle.toLowerCase().includes(q) ||
        r.recipients.some(
          (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
        )
      );
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
      if (sortBy === 'deck') {
        const da = a.deckId ? (deckById.get(a.deckId)?.title ?? '') : '';
        const db = b.deckId ? (deckById.get(b.deckId)?.title ?? '') : '';
        return da.localeCompare(db) || a.name.localeCompare(b.name);
      }
      // Next send: scheduled runs first, in order; everything unscheduled after.
      const na = nextRunAt(a)?.getTime();
      const nb = nextRunAt(b)?.getTime();
      if (na && nb) return na - nb;
      if (na) return -1;
      if (nb) return 1;
      return a.name.localeCompare(b.name);
    });

  const usedDeckIds = new Set(reports.map((r) => r.deckId).filter(Boolean));

  return (
    <div>
      {/*
       * Reports aren't shipped yet, so this is a preview: the real layout is on
       * show, in its own colours, and inert. It renders inside the "Coming
       * soon" dialog, which supplies the heading and the explanation — so
       * there's no notice of its own here.
       *
       * It's shown undimmed because the point of the preview is the design;
       * `inert` is what keeps it honest, and it does so on its own. Opacity
       * would leave every control clickable and keyboard-reachable anyway, so
       * dropping it costs nothing: nobody can schedule a send from here.
       */}
      <div inert className="pointer-events-none select-none">
        <PendingApprovals runs={pending} decks={docs} onChange={refresh} />

        {toast ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            {toast}
            <button
              onClick={() => setToast(null)}
              title="Dismiss"
              className="shrink-0 rounded px-1 text-emerald-600 hover:text-emerald-900 dark:text-emerald-400"
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="flex items-start gap-6">
          <nav aria-label="Report status" className="w-56 shrink-0">
            <Row
              label="All reports"
              count={reports.length}
              icon={<ClockIcon />}
              selected={scope.kind === 'all'}
              onSelect={() => setScope({ kind: 'all' })}
            />
            <div className="mt-4 mb-1 pl-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Status
            </div>
            <div className="space-y-0.5">
              {STATUSES.map((s) => (
                <Row
                  key={s.value}
                  label={s.label}
                  count={counts[s.value]}
                  icon={<Dot status={s.value} />}
                  selected={scope.kind === 'status' && scope.status === s.value}
                  onSelect={() => setScope({ kind: 'status', status: s.value })}
                />
              ))}
            </div>
          </nav>

          <div className="min-w-0 flex-1">
            {scope.kind !== 'all' ? (
              <h2 className="mb-3 text-sm font-medium capitalize text-zinc-700 dark:text-zinc-200">
                {scope.status}
              </h2>
            ) : null}

            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex items-center gap-2">
                <div className="relative w-72">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search reports…"
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 pr-7 text-sm outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  {query ? (
                    <button
                      onClick={() => setQuery('')}
                      title="Clear search"
                      className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <ToolbarSelect
                  label="Filter by deck"
                  value={deckFilter}
                  onChange={setDeckFilter}
                  active={Boolean(deckFilter)}
                >
                  <option value="">All decks</option>
                  {docs
                    .filter((d) => usedDeckIds.has(d.id))
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                </ToolbarSelect>
                <ToolbarSelect
                  label="Filter by owner"
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  active={Boolean(ownerFilter)}
                >
                  <option value="">All owners</option>
                  {allOwners.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  {hasUnowned ? <option value={NO_OWNER}>Unassigned</option> : null}
                </ToolbarSelect>
                <ToolbarSelect
                  label="Filter by client"
                  value={clientFilter}
                  onChange={setClientFilter}
                  active={Boolean(clientFilter)}
                >
                  <option value="">All clients</option>
                  {allClients.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  {hasUntagged ? <option value={NO_CLIENT}>Untagged</option> : null}
                </ToolbarSelect>
                {hasFilters ? (
                  <button
                    onClick={clearFilters}
                    title="Clear filters (Esc)"
                    className="shrink-0 rounded px-1 text-xs font-medium text-red-500 hover:text-red-600 hover:underline dark:text-red-400 dark:hover:text-red-300"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
                Sort by
                <ToolbarSelect
                  label="Sort by"
                  value={sortBy}
                  onChange={(v) => setSortBy(v as SortBy)}
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </ToolbarSelect>
              </label>
            </div>

            {visible.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
                <p className="text-sm text-zinc-400">
                  {hasFilters
                    ? 'No reports match your search.'
                    : scope.kind === 'all'
                      ? 'No reports yet. Create one to send a deck on a schedule.'
                      : `Nothing ${scope.status} right now.`}
                </p>
                {!hasFilters && scope.kind === 'all' ? (
                  <button
                    onClick={() => setEditing(draftReport(docs[0]?.id))}
                    className="mt-3 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-black"
                  >
                    New report
                  </button>
                ) : null}
              </div>
            ) : (
              // Two up, always: this grid only renders inside the Product
              // Roadmap preview, where an auto-fill track stretched a single
              // card across the whole dialog. A fixed pair keeps the cards
              // (and their slide thumbnails) small enough to read as a grid.
              <div className="grid gap-3 sm:grid-cols-2">
                {visible.map((r) => (
                  <ReportCard
                    key={r.id}
                    report={r}
                    deck={r.deckId ? deckById.get(r.deckId) : undefined}
                    placeholderDeck={docs[0]}
                    onOpen={() => setEditing(r)}
                    onToggleStatus={() => {
                      setReportStatus(r.id, r.status === 'active' ? 'paused' : 'active');
                      refresh();
                    }}
                    onDuplicate={() => {
                      duplicateReport(r.id);
                      refresh();
                    }}
                    onDelete={() => {
                      deleteReport(r.id);
                      refresh();
                    }}
                    onRunNow={() => raise(r, 'manual')}
                    onSendTest={() => raise(r, 'test')}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {editing ? (
          <ReportEditor
            report={editing}
            decks={docs}
            onClose={() => setEditing(null)}
            onSave={(r) => {
              saveReport(r);
              setEditing(null);
              refresh();
            }}
            onRunsChange={refresh}
          />
        ) : null}
      </div>
    </div>
  );
}
