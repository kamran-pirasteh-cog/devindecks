/**
 * Reports — a recurring delivery of a deck.
 *
 * A report is deliberately NOT a copy of a deck: it points at one by id and
 * carries only the delivery around it (when it goes out, who gets it, over
 * which channel, and who has to sign it off first). That keeps the deck the
 * single source of truth for content, so editing the deck changes what the next
 * send contains without touching the report.
 */

export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

export type Channel = 'email' | 'slack' | 'teams' | 'drive';

export type ReportStatus = 'active' | 'paused' | 'draft';

/** What the deck is turned into before it goes out. */
export type Format = 'pptx' | 'pdf' | 'html';

/** Who a send goes to. `address` is the mailbox / channel / folder path. */
export interface Recipient {
  id: string;
  name: string;
  address: string;
  channel: Channel;
}

export interface Report {
  id: string;
  name: string;
  /** The deck this delivers. Dangling ids are tolerated — see `Reports`. */
  deckId?: string;
  status: ReportStatus;
  frequency: Frequency;
  /** 0–6, Sunday-first. Used by weekly/biweekly. */
  dayOfWeek: number;
  /** 1–28. Used by monthly/quarterly. */
  dayOfMonth: number;
  /** 24h "HH:MM" — the local send time. */
  timeOfDay: string;
  recipients: Recipient[];
  /** What the deck is converted to for the send. */
  format: Format;
  /** Nobody sends until this person approves the run. */
  requiresApproval: boolean;
  approver?: string;
  /**
   * Skip a run whose deck hasn't changed since the last send — the difference
   * between a schedule and a nag.
   */
  skipIfUnchanged?: boolean;
  /** Attach the deck's open comment threads to the send. */
  includeComments?: boolean;
  owner?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  lastSentAt?: string;
}

export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

export const CHANNELS: { value: Channel; label: string; hint: string }[] = [
  { value: 'email', label: 'Email', hint: 'name@company.com' },
  { value: 'slack', label: 'Slack', hint: '#channel or @person' },
  { value: 'teams', label: 'Teams', hint: 'Team · channel' },
  { value: 'drive', label: 'Drive', hint: '/Shared/Reports' },
];

export const FORMATS: { value: Format; label: string; hint: string }[] = [
  { value: 'pptx', label: 'PowerPoint', hint: '.pptx — editable' },
  { value: 'pdf', label: 'PDF', hint: 'fixed layout, prints clean' },
  { value: 'html', label: 'Web page', hint: 'opens in a browser, no download' },
];

export const STATUSES: { value: ReportStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'draft', label: 'Draft' },
];

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ordinal = (n: number) => {
  const rem = n % 10;
  const teen = n % 100;
  if (rem === 1 && teen !== 11) return `${n}st`;
  if (rem === 2 && teen !== 12) return `${n}nd`;
  if (rem === 3 && teen !== 13) return `${n}rd`;
  return `${n}th`;
};

/** "9:00 AM" from "09:00", in whatever the viewer's locale calls it. */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** One-line English for the cadence — the phrase every card and row shows. */
export function describeSchedule(r: Report): string {
  const at = `at ${formatTime(r.timeOfDay)}`;
  switch (r.frequency) {
    case 'daily':
      return `Every weekday ${at}`;
    case 'weekly':
      return `Every ${DAY_NAMES[r.dayOfWeek]} ${at}`;
    case 'biweekly':
      return `Every other ${DAY_NAMES[r.dayOfWeek]} ${at}`;
    case 'monthly':
      return `Monthly on the ${ordinal(r.dayOfMonth)} ${at}`;
    case 'quarterly':
      return `Quarterly on the ${ordinal(r.dayOfMonth)} ${at}`;
  }
}

/**
 * The next scheduled send, or null while the report is paused or a draft.
 *
 * Approximate on purpose: biweekly lands on the next matching weekday rather
 * than tracking a real anchor date, and quarterly steps to the next quarter
 * month. Good enough for a schedule preview, and nothing downstream fires on it.
 */
export function nextRunAt(r: Report, from = new Date()): Date | null {
  if (r.status !== 'active') return null;
  const [h, m] = r.timeOfDay.split(':').map(Number);
  const at = (d: Date) => {
    const out = new Date(d);
    out.setHours(h || 0, m || 0, 0, 0);
    return out;
  };

  if (r.frequency === 'daily') {
    const d = at(from);
    if (d <= from) d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d;
  }

  if (r.frequency === 'weekly' || r.frequency === 'biweekly') {
    const d = at(from);
    let delta = (r.dayOfWeek - d.getDay() + 7) % 7;
    if (delta === 0 && d <= from) delta = 7;
    d.setDate(d.getDate() + delta);
    if (r.frequency === 'biweekly' && delta < 7) d.setDate(d.getDate() + 7);
    return d;
  }

  const step = r.frequency === 'quarterly' ? 3 : 1;
  const d = at(new Date(from.getFullYear(), from.getMonth(), r.dayOfMonth));
  if (d <= from) d.setMonth(d.getMonth() + step);
  return d;
}
