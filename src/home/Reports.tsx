'use client';

/**
 * Reports tab on the dashboard — a read-only roll-up of the documents that are
 * already in the repository (totals, then a breakdown per owner and per
 * client). Nothing here is stored or configurable: every number is derived
 * from the same `Deck[]` the Documents tab lists, so the two can never
 * disagree.
 */
import type { Deck } from '@/model';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Most recent of a set of ISO timestamps. */
const latest = (isos: string[]) => isos.reduce((a, b) => (a > b ? a : b));

type Row = { key: string; label: string; italic?: boolean; docs: number; slides: number; last: string };

/** Group decks by a caption, dropping groups whose caption is empty. */
function group(docs: Deck[], captions: (d: Deck) => string[], unset: string): Row[] {
  const rows = new Map<string, Deck[]>();
  docs.forEach((d) => {
    const keys = captions(d);
    (keys.length ? keys : ['']).forEach((k) => {
      const bucket = rows.get(k);
      if (bucket) bucket.push(d);
      else rows.set(k, [d]);
    });
  });
  return [...rows.entries()]
    .map(([key, decks]) => ({
      key,
      label: key || unset,
      italic: !key,
      docs: decks.length,
      slides: decks.reduce((n, d) => n + d.slides.length, 0),
      last: latest(decks.map((d) => d.updatedAt)),
    }))
    .sort((a, b) => b.docs - a.docs || a.label.localeCompare(b.label));
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
    </div>
  );
}

function Table({ title, rows, unit }: { title: string; rows: Row[]; unit: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
        {title}
      </div>
      {rows.length ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-zinc-400">
              <th className="px-4 py-1.5 text-left font-medium">{unit}</th>
              <th className="px-4 py-1.5 text-right font-medium">Docs</th>
              <th className="px-4 py-1.5 text-right font-medium">Slides</th>
              <th className="px-4 py-1.5 text-right font-medium">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-zinc-100 dark:border-zinc-800">
                <td
                  className={`px-4 py-1.5 text-zinc-700 dark:text-zinc-200 ${
                    r.italic ? 'italic text-zinc-400 dark:text-zinc-500' : ''
                  }`}
                >
                  {r.label}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {r.docs}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {r.slides}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums text-zinc-400">
                  {fmtDate(r.last)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-4 py-4 text-xs text-zinc-400">Nothing to report yet.</div>
      )}
    </div>
  );
}

export function Reports({ docs }: { docs: Deck[] }) {
  if (!docs.length) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-400 dark:border-zinc-700">
        No documents to report on yet.
      </div>
    );
  }

  const slides = docs.reduce((n, d) => n + d.slides.length, 0);
  const owners = new Set(docs.map((d) => d.owner).filter(Boolean));
  const clients = new Set(docs.flatMap((d) => d.tags ?? []));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Documents" value={docs.length} />
        <Stat label="Slides" value={slides} />
        <Stat label="Owners" value={owners.size} />
        <Stat label="Clients" value={clients.size} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Table
          title="By owner"
          unit="Owner"
          rows={group(docs, (d) => (d.owner ? [d.owner] : []), 'Unassigned')}
        />
        <Table
          title="By client"
          unit="Client"
          rows={group(docs, (d) => d.tags ?? [], 'Untagged')}
        />
      </div>
    </div>
  );
}
