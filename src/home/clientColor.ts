/**
 * A stable colour per client name, so "Wayfair" is the same hue on every card
 * it appears on and two clients side by side read as two clients. Derived from
 * the name rather than stored: tags are free text with no record of their own,
 * and a hash keeps the mapping consistent across reloads and devices.
 */
const CLIENT_PALETTE = [
  {
    pill: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
    remove: 'text-sky-500 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-100',
  },
  {
    pill: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
    remove:
      'text-emerald-500 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-100',
  },
  {
    pill: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200',
    remove:
      'text-violet-500 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-100',
  },
  {
    pill: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
    remove: 'text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-100',
  },
  {
    pill: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200',
    remove: 'text-rose-500 hover:text-rose-900 dark:text-rose-400 dark:hover:text-rose-100',
  },
  {
    pill: 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-200',
    remove: 'text-teal-500 hover:text-teal-900 dark:text-teal-400 dark:hover:text-teal-100',
  },
  {
    pill: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200',
    remove:
      'text-indigo-500 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-100',
  },
  {
    pill: 'bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-200',
    remove:
      'text-orange-600 hover:text-orange-900 dark:text-orange-400 dark:hover:text-orange-100',
  },
];

/** Case- and space-insensitive, so "Wayfair" and "wayfair " share a colour. */
export function clientColor(name: string) {
  const key = name.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100000007;
  return CLIENT_PALETTE[hash % CLIENT_PALETTE.length];
}
