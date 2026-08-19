/**
 * "just now" / "12m ago" / "3h ago" / "5d ago", then a plain date once a week
 * has passed — past that, the exact day is more use than a growing day count.
 *
 * Lifted out of `DocCard` when the document table started needing the same
 * wording: two views of the same shelf disagreeing about how old a deck is
 * would be worse than either wording on its own.
 */
export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
