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
  /** The menu label. */
  label: string;
  /** Placeholder members, in the order they should be drawn. */
  members: string[];
}

export const SEGMENTS: SegmentDef[] = [
  {
    id: 'company',
    noun: 'company',
    label: 'Company',
    members: ['Company A', 'Company B', 'Company C'],
  },
  {
    id: 'department',
    noun: 'department',
    label: 'Department',
    members: ['Engineering', 'Go-to-market', 'G&A'],
  },
  {
    id: 'devin-org',
    noun: 'Devin org',
    label: 'Devin Org',
    members: ['Org A', 'Org B', 'Org C'],
  },
  {
    id: 'use-case',
    noun: 'use case',
    label: 'Use Case',
    members: ['Feature work', 'Bug fixes', 'Refactors', 'Migrations'],
  },
  {
    id: 'cohort',
    noun: 'cohort',
    label: 'Cohort',
    members: ['Cohort A', 'Cohort B', 'Cohort C'],
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
    label: Noun,
    members: ['A', 'B', 'C'].map((l) => `${Noun} ${l}`),
  };
}

/**
 * Any segment, catalogued or typed. Used by every caller that holds a segment
 * as a string and shouldn't care which of the two it is.
 */
export const resolveSegment = (id: string): SegmentDef =>
  segmentById(id) ?? freeSegment(id.replace(/^free:/, ''));
