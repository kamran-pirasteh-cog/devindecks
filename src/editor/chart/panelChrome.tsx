'use client';

/**
 * The two primitives every row of the chart part panel is built from.
 *
 * They lived inside `ChartPartPopover` until a second file needed to render a
 * row into it — `NumberFormatRows`. Importing them back out of the popover
 * would be a cycle, and re-declaring the same classes in the other file is how
 * two panels drift into looking like two panels. So they sit here, owned by
 * neither.
 */

/** One control, full width of the panel's right-hand column. */
export const FIELD =
  'h-6 w-full min-w-0 rounded border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}
