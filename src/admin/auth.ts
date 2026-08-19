/**
 * The admin password gate's non-React half.
 *
 * This is a soft lock, not security: the password lives in the bundle and the
 * unlock flag lives in the browser, so anyone who wants past it can get past
 * it. It exists so the control room isn't one stray click away for whoever is
 * driving a demo — the real gate is the template-admin Okta group in
 * Playground (see the note at the top of `Admin.tsx`).
 *
 * The unlocked flag is exposed as a subscribable store rather than a plain
 * read, so the gate can pick it up with `useSyncExternalStore`: the server
 * render can't see sessionStorage, and that hook is the one that resolves the
 * difference after hydration instead of papering over it.
 */
const PASSWORD = 'ccc';

/** Session-scoped on purpose: closing the tab re-locks Admin. */
export const ADMIN_UNLOCK_KEY = 'devindecks.adminUnlocked';

export function isAdminPassword(input: string): boolean {
  return input.trim() === PASSWORD;
}

const listeners = new Set<() => void>();

export function subscribeAdminUnlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isAdminUnlocked(): boolean {
  return window.sessionStorage.getItem(ADMIN_UNLOCK_KEY) === '1';
}

/** Server snapshot: locked, always — there's nothing to read there. */
export function isAdminUnlockedOnServer(): boolean {
  return false;
}

export function setAdminUnlocked(unlocked: boolean): void {
  if (unlocked) window.sessionStorage.setItem(ADMIN_UNLOCK_KEY, '1');
  else window.sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
  for (const listener of listeners) listener();
}
