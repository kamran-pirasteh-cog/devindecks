'use client';

/**
 * Toasts — the app's confirmations for actions that change something and then
 * leave the screen looking almost the same.
 *
 * The rule for adding one: it fires for a *state change the user can't see the
 * result of*, and it names what changed. Filing a document into a folder makes
 * a card disappear from the current view with no other feedback; renaming one
 * doesn't need a toast, because the new name is right there.
 *
 * Anything reversible carries its own undo, which is why `action` exists — a
 * toast is the only place a one-click "actually, put that back" can live without
 * a confirmation dialog in front of every move.
 *
 * Bottom right, stacked newest-nearest-the-corner, auto-dismissed. The viewport
 * is `pointer-events-none` with the cards themselves clickable, so a toast in
 * the corner never eats a click meant for what's underneath it.
 *
 * The provider is mounted in the root layout, which is why "Created “X”" can be
 * raised by the picker on the dashboard and still be read in the editor it
 * navigates to: the layout — and so this state — survives the route change.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'default' | 'danger';

export interface ToastOptions {
  /** Reddens the accent, for the deletions that can't be walked back. */
  tone?: ToastTone;
  /** One-click reversal — "Undo", "Open", and nothing longer. */
  action?: { label: string; run: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
  message: string;
}

/**
 * How long a toast stays. Longer when it carries an action: an undo you can't
 * reach in time is worse than no undo, since it advertises a way back and then
 * takes it away.
 */
const PLAIN_MS = 4000;
const ACTION_MS = 7000;

type ToastFn = (message: string, options?: ToastOptions) => void;

// A no-op default rather than a throw: a component that raises a toast outside
// the provider should lose its confirmation, not its render.
const ToastContext = createContext<ToastFn>(() => {});

/** Raise a toast: `toast('Moved “Q3 QBR” to Clients', { action: … })`. */
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3">
      <path
        d="M3 3l6 6M9 3l-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.action ? ACTION_MS : PLAIN_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const danger = toast.tone === 'danger';

  return (
    <div
      // `status`, not `alert`: these confirm what just happened at the user's
      // own request, so they shouldn't interrupt a screen reader mid-sentence.
      role="status"
      className={`toast-in pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg px-3.5 py-2.5 text-xs shadow-lg ${
        danger
          ? 'bg-red-900 text-red-50 dark:bg-red-950'
          : 'bg-zinc-900 text-zinc-100 dark:bg-zinc-800 dark:ring-1 dark:ring-zinc-700'
      }`}
    >
      <span className="min-w-0 flex-1 py-0.5 leading-relaxed">{toast.message}</span>
      {toast.action ? (
        <button
          onClick={() => {
            toast.action!.run();
            onDismiss();
          }}
          className={`shrink-0 rounded px-1.5 py-0.5 font-medium underline-offset-2 hover:underline ${
            danger ? 'text-red-200 hover:text-white' : 'text-indigo-300 hover:text-indigo-200'
          }`}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        className={`mt-0.5 shrink-0 rounded p-0.5 ${
          danger ? 'text-red-300 hover:text-white' : 'text-zinc-400 hover:text-white'
        }`}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const push = useCallback<ToastFn>((message, options) => {
    const id = nextId.current++;
    // Newest last in state, and the viewport reverses them, so the newest sits
    // in the corner and the older ones step up the screen.
    setToasts((prev) => [...prev.slice(-2), { id, message, ...options }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
