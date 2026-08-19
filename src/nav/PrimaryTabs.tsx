'use client';

/**
 * The app's top-level tab strip — Documents · Reports · Admin — shared by the
 * dashboard and /admin so moving between them never rearranges the navigation.
 *
 * Documents and Reports are two views of the dashboard route, so they're state
 * there and links back here from /admin; Admin is always its own route. Pass
 * `onSelect` when the caller owns that state (the dashboard), and leave it out
 * to get plain links (anywhere else).
 */
import Link from 'next/link';

export type PrimaryTab = 'documents' | 'reports' | 'admin';

const ROUTE_TABS: {
  value: PrimaryTab;
  label: string;
  href: string;
  /** Marks a tab whose section is previewable but not built yet. */
  comingSoon?: boolean;
}[] = [
  { value: 'documents', label: 'Documents', href: '/' },
  { value: 'reports', label: 'Reports', href: '/?tab=reports', comingSoon: true },
  { value: 'admin', label: 'Admin', href: '/admin' },
];

/**
 * The "Coming soon" flag, in blue rather than the muted grey the disabled
 * content uses — the tab is still reachable, so the label has to read as
 * information about what's inside, not as one more greyed-out thing.
 */
export function ComingSoonBadge() {
  return (
    <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
      Coming soon
    </span>
  );
}

const tabClass = (active: boolean) =>
  `-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium ${
    active
      ? 'border-indigo-500 text-zinc-900 dark:text-white'
      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
  }`;

export function PrimaryTabs({
  active,
  onSelect,
}: {
  active: PrimaryTab;
  onSelect?: (tab: 'documents' | 'reports') => void;
}) {
  return (
    <div className="flex gap-1 px-7">
      {ROUTE_TABS.map((t) =>
        onSelect && t.value !== 'admin' ? (
          <button
            key={t.value}
            onClick={() => onSelect(t.value as 'documents' | 'reports')}
            className={tabClass(active === t.value)}
          >
            {t.label}
            {t.comingSoon ? <ComingSoonBadge /> : null}
          </button>
        ) : (
          <Link key={t.value} href={t.href} className={tabClass(active === t.value)}>
            {t.label}
            {t.comingSoon ? <ComingSoonBadge /> : null}
          </Link>
        ),
      )}
    </div>
  );
}

/**
 * Second-level tabs, for a section that has its own areas (Admin). Deliberately
 * not underlined: the underline belongs to the strip above, and a second row of
 * it reads as two competing top levels.
 */
export function SubTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { value: T; label: string }[];
  active: T;
  onSelect: (tab: T) => void;
}) {
  return (
    <div className="flex gap-1 px-7 pb-2 pt-2">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onSelect(t.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            active === t.value
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-black'
              : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
