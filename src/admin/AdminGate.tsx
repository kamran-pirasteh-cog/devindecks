'use client';

/**
 * Password prompt in front of everything under /admin — the tab itself and the
 * layout / chart-template editors it links into.
 *
 * Mounted from `src/app/admin/layout.tsx`, so a deep link to an editor lands
 * here too rather than slipping past the tab. See `auth.ts` for what this lock
 * is and isn't.
 */
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  isAdminPassword,
  isAdminUnlocked,
  isAdminUnlockedOnServer,
  setAdminUnlocked,
  subscribeAdminUnlocked,
} from './auth';

export function AdminGate({ children }: { children: React.ReactNode }) {
  // Read through the store, not straight from sessionStorage: the server
  // render can't see it, and this is the hook that re-reads after hydration
  // without hydrating unlocked contents under locked markup.
  const unlocked = useSyncExternalStore(
    subscribeAdminUnlocked,
    isAdminUnlocked,
    isAdminUnlockedOnServer,
  );
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminPassword(password)) {
      setWrong(true);
      setPassword('');
      return;
    }
    setAdminUnlocked(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-black">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10"
      >
        <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Admin
        </h1>
        <input
          type="password"
          value={password}
          autoFocus
          aria-label="Admin password"
          aria-invalid={wrong || undefined}
          placeholder="Password"
          onChange={(e) => {
            setPassword(e.target.value);
            setWrong(false);
          }}
          className={`mt-4 w-full rounded-md border bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:bg-zinc-950 dark:text-zinc-100 ${
            wrong ? 'border-red-500' : 'border-zinc-300 dark:border-zinc-700'
          }`}
        />
        {wrong ? (
          <p role="alert" className="mt-2 text-[12px] text-red-600 dark:text-red-400">
            That&rsquo;s not the password.
          </p>
        ) : null}

        <button
          type="submit"
          className="mt-4 w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Unlock
        </button>
        <Link
          href="/"
          className="mt-3 block text-center text-[12px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Back to Documents
        </Link>
      </form>
    </div>
  );
}
