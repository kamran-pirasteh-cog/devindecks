/**
 * The things a measure can be broken down BY, as the setup step offers them.
 *
 * Deliberately short. This is a menu someone reads top to bottom while deciding,
 * and every cut on it that nobody picks is a line they had to read past — so it
 * holds the handful of cuts these decks are actually built on, and everything
 * else arrives through `freeSegment` as typed text, which is a first-class
 * answer rather than a fallback.
 *
 * Not the same list as the one `readBrief` matches against a typed sentence, and
 * that isn't an oversight: a sentence saying "ARR by region" should still be
 * understood as a region cut, because reading words somebody wrote costs nothing
 * and refusing to is just a worse parser. Offering thirteen cuts in a dropdown
 * is a different question from recognising thirteen in prose. See `DIMENSIONS`
 * in `intent.ts` for that vocabulary.
 *
 * `members` are PLACEHOLDERS with a house convention behind them: the one cut we
 * know the real membership of (departments) gets its real names, and the ones we
 * can't know get lettered stand-ins that read as stand-ins. An invented company
 * name on a client slide is worse than an obvious blank.
 */

export interface SegmentDef {
  id: string;
  /**
   * The noun as it prints in a title: "by department". Singular, and lowercase
   * unless it is a proper name — "by Devin org" is capitalised because the
   * thing is.
   */
  noun: string;
  /** The plural, for asking "which departments?". */
  plural: string;
  /** The menu label. */
  label: string;
  /** Placeholder members, in the order they should be drawn. */
  members: string[];
  /**
   * What a real answer to "which ones?" looks like for this cut, shown as the
   * field's placeholder. Not a default and never used as members — a suggestion
   * that got saved because nobody typed over it is the invented company name
   * this file's header is about.
   */
  examples: string;
}

export const SEGMENTS: SegmentDef[] = [
  {
    id: 'company',
    noun: 'company',
    plural: 'companies',
    label: 'Company',
    members: ['Company A', 'Company B', 'Company C'],
    examples: 'name them, or say which ones to include',
  },
  {
    id: 'department',
    noun: 'department',
    plural: 'departments',
    label: 'Department',
    members: ['Engineering', 'Go-to-market', 'G&A'],
    examples: 'e.g. Engineering, Go-to-market, G&A',
  },
  {
    id: 'devin-org',
    noun: 'Devin org',
    plural: 'Devin orgs',
    label: 'Devin Org',
    members: ['Org A', 'Org B', 'Org C'],
    examples: 'name the orgs, or say which ones to include',
  },
  {
    id: 'use-case',
    noun: 'use case',
    plural: 'use cases',
    label: 'Use Case',
    members: ['Feature work', 'Bug fixes', 'Refactors', 'Migrations'],
    examples: 'e.g. Feature work, Bug fixes, Migrations',
  },
  {
    id: 'cohort',
    noun: 'cohort',
    plural: 'cohorts',
    label: 'Cohort',
    members: ['Cohort A', 'Cohort B', 'Cohort C'],
    examples: 'e.g. FY24 signups, FY25 signups',
  },
];

export const segmentById = (id: string): SegmentDef | undefined =>
  SEGMENTS.find((s) => s.id === id);

/**
 * A cut the author typed in themselves. The noun is what they wrote, and the
 * members are lettered off it — we have no idea what a "vertical" contains, and
 * guessing is how a chart ends up asserting something nobody said.
 */
export function freeSegment(noun: string): SegmentDef {
  const clean = noun.trim().toLowerCase();
  const Noun = clean.charAt(0).toUpperCase() + clean.slice(1);
  return {
    id: `free:${clean}`,
    noun: clean,
    plural: pluralOf(clean),
    label: Noun,
    members: ['A', 'B', 'C'].map((l) => `${Noun} ${l}`),
    examples: 'name them, or say which ones to include',
  };
}

/**
 * The plural of a typed noun, well enough to ask a question with.
 *
 * Naive on purpose: this only ever reaches a field label — "which verticals?" —
 * so the cost of getting an irregular noun wrong is a slightly odd question,
 * and the cost of a real inflection table is a real inflection table.
 */
export function pluralOf(noun: string): string {
  const n = noun.trim();
  if (!n) return n;
  if (/(?:[^aeiou])y$/i.test(n)) return `${n.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(n)) return `${n}es`;
  return `${n}s`;
}

/**
 * Any segment, catalogued or typed. Used by every caller that holds a segment
 * as a string and shouldn't care which of the two it is.
 */
export const resolveSegment = (id: string): SegmentDef =>
  segmentById(id) ?? freeSegment(id.replace(/^free:/, ''));

/* ------------------------------------------------------------------ */
/* Which ones                                                         */
/* ------------------------------------------------------------------ */

/**
 * Words that open an INSTRUCTION rather than a list. "Engineering, GTM" names
 * the members; "exclude G&A, and internal orgs" is a rule about them, and
 * reading it as two department names would print "Exclude G&A" on an axis.
 */
const INSTRUCTING = /^(?:all|any|every|exclude|excluding|include|including|just|only|omit|drop|ignore|use|split|group|rename|whichever|top|bottom|the top|the bottom)\b/i;

/**
 * The author's answer to "which ones?", read as a list of members — or not read
 * at all.
 *
 * Both outcomes are useful, which is why this returns an empty list rather than
 * guessing. A list becomes the chart's labels, so the placeholders never reach
 * the slide; anything else stays prose and rides into the Devin prompt as the
 * author's scope for the cut, which is the more common answer to "which
 * departments?" ("only the ones over 100 ACUs") and is not something an axis
 * could ever carry.
 *
 * The rule for "this is a list": two or more COMMA-separated items, each short
 * enough to be a name rather than a sentence, and none of them opening with a
 * word that instructs. Only commas — "and" and "&" both live inside real names
 * ("Research and Development", "G&A"), and splitting on them turns one
 * department into two.
 */
export function namedMembers(which: string | undefined): string[] {
  const text = which?.trim();
  if (!text || INSTRUCTING.test(text)) return [];
  const items = text
    .split(/\s*[,;\n]\s*/)
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter(Boolean);
  if (items.length < 2) return [];
  // Four words is where a member name stops being a name. "Go-to-market" is
  // one; "the accounts we closed last quarter" is a description of a filter.
  if (items.some((i) => i.split(/\s+/).length > 4 || INSTRUCTING.test(i))) return [];
  return items;
}

/**
 * A segment as this chart's author left it: the catalogued cut, with its
 * placeholder members replaced by the ones they named, where they named any.
 *
 * Every caller that draws or counts members goes through here, so a cut whose
 * members were typed is counted as typed — eight named slices trip the "past
 * where a pie reads" note exactly as eight catalogued ones would.
 */
export function segmentWith(id: string, which?: string): SegmentDef {
  const def = resolveSegment(id);
  const named = namedMembers(which);
  return named.length ? { ...def, members: named } : def;
}
