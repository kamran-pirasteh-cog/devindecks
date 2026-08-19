/**
 * The seam between the org-owned repositories and wherever their bytes
 * actually live.
 *
 * Today that's localStorage — one browser, one person, no network. In
 * Playground it has to be a shared store, because "the admin's copy of the
 * brand" and "everyone's copy of the brand" are supposed to be the same
 * object. Every repository that Admin writes and everyone else reads goes
 * through this interface so that swap is a new adapter rather than a rewrite
 * of six files.
 *
 * The asymmetry in the interface is deliberate and load-bearing:
 *
 * - **Writes are async.** They always were, really — localStorage just hid it.
 * - **Reads have a sync fast path, `loadSync`, that only a local adapter can
 *   offer.** Every existing call site (`listLayouts()`, `getActiveDesignSystem()`,
 *   ~50 of them) is synchronous, and they are synchronous because they're
 *   called during render. A remote adapter can't answer synchronously, so it
 *   omits `loadSync` and the app hydrates once at boot instead — see
 *   `collection.ts`. That's the whole reason this isn't just `Promise`
 *   everywhere: it keeps the localStorage path behaving exactly as it does
 *   now while the remote path becomes possible.
 */
export interface StoreAdapter {
  /** Read a collection's serialized contents. `null` = nothing stored yet. */
  load(key: string): Promise<string | null>;
  /**
   * The same read, synchronously, for adapters that can. Its absence is how a
   * collection knows it must be hydrated before it can serve reads.
   */
  loadSync?(key: string): string | null;
  save(key: string, value: string): Promise<void>;
}

/**
 * Backed by `window.localStorage`, which is where all sixteen collections live
 * today.
 *
 * On the server there is no storage at all, so every read is empty and every
 * write is dropped. That's the existing behaviour of all six repositories —
 * they each open with `if (typeof window === 'undefined') return {}` — kept
 * in one place instead of six.
 */
export const localStorageAdapter: StoreAdapter = {
  loadSync(key) {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async load(key) {
    return localStorageAdapter.loadSync!(key);
  },
  async save(key, value) {
    if (typeof window === 'undefined') return;
    // Quota failures must not be swallowed: the artifact library is one 4MB
    // upload away from one, and silently dropping the write would show the
    // user a saved asset that vanishes on reload.
    window.localStorage.setItem(key, value);
  },
};

/** An in-process adapter, for tests and for the SSR pass. */
export function memoryAdapter(seed: Record<string, string> = {}): StoreAdapter {
  const mem = new Map(Object.entries(seed));
  return {
    loadSync: (key) => mem.get(key) ?? null,
    async load(key) {
      return mem.get(key) ?? null;
    },
    async save(key, value) {
      mem.set(key, value);
    },
  };
}
