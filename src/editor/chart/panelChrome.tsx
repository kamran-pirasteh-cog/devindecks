'use client';

/**
 * The primitives every row of the chart part panel is built from.
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

/** A control that sits BESIDE another and states its own width. */
export const FIELD_NARROW = `${FIELD} w-16 shrink-0`;

/**
 * A label and its controls.
 *
 * The right-hand column WRAPS. A row of glyph buttons — five markers, three
 * dashes, a sentence on a button — is wider than 236px more often than not, and
 * the panel scrolls vertically, which makes the browser resolve its horizontal
 * overflow to `auto` too: one long row used to hand the whole panel a
 * horizontal scrollbar and cut the row it came from in half. Wrapping keeps
 * every control reachable at the cost of a second line.
 */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-14 shrink-0 pt-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

/**
 * A hairline between two groups of rows.
 *
 * Ten rows of the same weight read as a list of thirty controls; the same ten
 * split into "the mark", "its number" and "how that number is set" read as
 * three decisions. Cheaper than headings, which would double the panel's height.
 */
export function Divider() {
  return <div className="-mx-2 border-t border-zinc-100 dark:border-zinc-800" />;
}

/** A toggle or a one-shot action, sized to sit in a `Row`. */
export function MiniButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`h-6 shrink-0 rounded px-1.5 text-[11px] leading-none ${
        active
          ? 'bg-indigo-600 text-white'
          : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}
