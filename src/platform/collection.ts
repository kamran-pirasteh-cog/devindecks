/**
 * A keyed collection held in memory and flushed to a `StoreAdapter`.
 *
 * This is what lets the six org-owned repositories keep their synchronous
 * public APIs while their storage becomes a network round-trip. The trick is
 * that reads never go to the adapter at all: they're served from a snapshot
 * held in memory, hydrated once. Writes mutate that snapshot immediately —
 * so the UI updates on the same tick, as it does today — and are flushed
 * behind it.
 *
 * What that buys, concretely: `listLayouts()` stays `(): StoredLayout[]`, and
 * the ~50 call sites in the editor and Admin don't grow an `await`.
 *
 * What it costs, and what a Playground adapter has to answer for:
 *
 * - **Flushes are last-write-wins over the whole collection.** Fine for one
 *   browser; not fine for two admins in Admin at once. A remote adapter needs
 *   per-entity writes with an `updatedAt` precondition, and this is the seam
 *   where that goes.
 * - **A write is acknowledged before it lands.** `onFlushError` is how a
 *   failure gets back to the user rather than disappearing — the quota error
 *   the artifact library already surfaces has to keep surfacing.
 */
import type { StoreAdapter } from './store';

export interface Collection<T> {
  /**
   * Load from the adapter. Idempotent and memoized — calling it from several
   * components on the same boot does one read.
   */
  hydrate(): Promise<void>;
  /** Whether a read will be answered from real data rather than an empty map. */
  isHydrated(): boolean;
  /** The current contents. Synchronous, by design — see the file header. */
  snapshot(): Record<string, T>;
  /**
   * Apply a change and schedule a flush. The mutation runs against a copy, so
   * a caller that throws midway doesn't leave a half-applied snapshot behind.
   */
  mutate(fn: (map: Record<string, T>) => void): void;
  /** Replace the contents wholesale. */
  replace(map: Record<string, T>): void;
  subscribe(listener: () => void): () => void;
  /** Resolves when every pending write has landed. Tests and unload hooks. */
  flushed(): Promise<void>;
}

export interface CollectionOptions<T> {
  /**
   * Run over freshly-loaded contents before anything reads them — the place
   * for backfilling fields added since the data was written. Repositories
   * already do this inline (`withDefaults`, the `version` backfills); this is
   * where that belongs once they hydrate rather than parse-per-read.
   */
  migrate?: (map: Record<string, T>) => Record<string, T>;
  /** Where a failed flush goes. Defaults to rethrowing on the microtask queue. */
  onFlushError?: (err: unknown, key: string) => void;
}

export function defineCollection<T>(
  key: string,
  adapter: StoreAdapter,
  opts: CollectionOptions<T> = {},
): Collection<T> {
  const migrate = opts.migrate ?? ((m: Record<string, T>) => m);
  let cache: Record<string, T> | null = null;
  let hydrating: Promise<void> | null = null;
  // Flushes are chained rather than fired in parallel: two overlapping writes
  // of the same collection can otherwise land out of order, and the older one
  // wins permanently.
  let flushChain: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const parse = (raw: string | null): Record<string, T> => {
    if (!raw) return {};
    try {
      return migrate(JSON.parse(raw) as Record<string, T>);
    } catch {
      // Corrupt storage reads as empty, exactly as it does today. Throwing
      // here would take the whole app down over one bad key.
      return {};
    }
  };

  const notify = () => {
    for (const l of listeners) l();
  };

  const flush = () => {
    const value = JSON.stringify(cache ?? {});
    flushChain = flushChain.then(() =>
      adapter.save(key, value).catch((err) => {
        if (opts.onFlushError) opts.onFlushError(err, key);
        else queueMicrotask(() => { throw err; });
      }),
    );
  };

  /**
   * Serve a read. With a sync-capable adapter this self-hydrates on first
   * touch, which is what keeps the current localStorage behaviour identical.
   * Without one, an un-hydrated read is empty rather than blocking — the
   * caller is mid-render and has nothing to block on.
   */
  const ensure = (): Record<string, T> => {
    if (cache) return cache;
    if (adapter.loadSync) cache = parse(adapter.loadSync(key));
    return cache ?? {};
  };

  return {
    hydrate() {
      if (!hydrating) {
        hydrating = adapter.load(key).then((raw) => {
          cache = parse(raw);
          notify();
        });
      }
      return hydrating;
    },
    isHydrated: () => cache !== null,
    snapshot: () => ensure(),
    mutate(fn) {
      const next = { ...ensure() };
      fn(next);
      cache = next;
      notify();
      flush();
    },
    replace(map) {
      cache = map;
      notify();
      flush();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flushed: () => flushChain,
  };
}
