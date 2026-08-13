/**
 * Comment threads — Google Slides' discussion layer.
 *
 * Deliberately NOT part of the `Deck` model: a comment is a conversation about
 * the document, not content of it. Keeping it out means (a) undo/redo can't
 * swallow a comment somebody just posted, (b) export stays a pure function of
 * the deck, and (c) the constrained-OOXML guarantee in `model/types.ts` is
 * untouched by a feature that never has to survive a round-trip to PowerPoint.
 */

export interface CommentEntry {
  id: string;
  /** Display name of whoever wrote it (free text until there's real auth). */
  author: string;
  body: string;
  createdAt: string;
  editedAt?: string;
}

export interface CommentThread {
  id: string;
  slideId: string;
  /**
   * The object this thread is pinned to. Unset means the thread is about the
   * slide as a whole — Google Slides' "comment with nothing selected".
   */
  elementId?: string;
  resolved: boolean;
  createdAt: string;
  /** `comments[0]` opens the thread; everything after it is a reply. */
  comments: CommentEntry[];
}

/** Threads on one slide, newest last, optionally including resolved ones. */
export function threadsForSlide(
  threads: CommentThread[],
  slideId: string,
  includeResolved: boolean,
): CommentThread[] {
  return threads.filter(
    (t) => t.slideId === slideId && (includeResolved || !t.resolved),
  );
}

/** Open-thread count per slide id — what the filmstrip badges read. */
export function unresolvedCounts(threads: CommentThread[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of threads) {
    if (t.resolved) continue;
    counts[t.slideId] = (counts[t.slideId] ?? 0) + 1;
  }
  return counts;
}
