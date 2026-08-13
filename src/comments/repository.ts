'use client';

/**
 * Comments repository — the same persistence seam as `docs/repository.ts`, kept
 * in its own store keyed by document id. Separate from the deck blob on
 * purpose: comments change on a different rhythm to slide content (and, later,
 * with different access rules), so they shouldn't ride along with every autosave
 * of the deck.
 */
import type { CommentThread } from './types';

const KEY = 'devindesign.comments.v1';

type ThreadMap = Record<string, CommentThread[]>;

function read(): ThreadMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as ThreadMap;
  } catch {
    return {};
  }
}

function write(map: ThreadMap) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

export function getThreads(docId: string): CommentThread[] {
  return read()[docId] ?? [];
}

export function saveThreads(docId: string, threads: CommentThread[]): void {
  const map = read();
  if (threads.length) map[docId] = threads;
  else delete map[docId];
  write(map);
}

/** Drop a document's discussion for good — called when the doc itself is purged. */
export function purgeThreads(docId: string): void {
  const map = read();
  if (!(docId in map)) return;
  delete map[docId];
  write(map);
}

/**
 * Carry a discussion onto a copy of a document, with fresh ids and a slide/
 * element id map, so "duplicate" doesn't silently drop the conversation.
 */
export function copyThreads(
  fromDocId: string,
  toDocId: string,
  remap: { slides: Record<string, string>; elements: Record<string, string> },
): void {
  const source = getThreads(fromDocId);
  if (!source.length) return;
  const copies = source.flatMap<CommentThread>((t) => {
    const slideId = remap.slides[t.slideId];
    if (!slideId) return [];
    // A thread whose object didn't make it across becomes a slide-level one
    // rather than a dangling pin.
    const elementId = t.elementId ? remap.elements[t.elementId] : undefined;
    return [{ ...t, id: `ct-${slideId}-${t.id}`, slideId, elementId }];
  });
  saveThreads(toDocId, copies);
}
