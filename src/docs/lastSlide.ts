'use client';

/**
 * Where you were in each deck — remembered across reloads.
 *
 * Opening a deck used to always land on slide 1, so a refresh (or a crash, or
 * following a link back in) lost your place in a fifty-slide deck. This keeps
 * one slide id per document, written as you move through the filmstrip and read
 * back when the deck loads.
 *
 * Same persistence seam as `docs/repository.ts` and `docs/folders.ts`:
 * localStorage today. It's view state, not document content, so it lives apart
 * from the deck bytes — a stale id is harmless (`loadDeck` falls back to the
 * first slide when the remembered one is gone).
 */
const KEY = 'devindesign.lastslide.v1';

type SlideMap = Record<string, string>;

function read(): SlideMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as SlideMap;
  } catch {
    return {};
  }
}

/** The slide last viewed in `deckId`, or null if we've never seen it. */
export function getLastSlide(deckId: string): string | null {
  return read()[deckId] ?? null;
}

export function rememberLastSlide(deckId: string, slideId: string): void {
  if (typeof window === 'undefined' || !slideId) return;
  const map = read();
  if (map[deckId] === slideId) return;
  map[deckId] = slideId;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

/** Drop a deck's entry — for when the document itself is deleted. */
export function forgetLastSlide(deckId: string): void {
  if (typeof window === 'undefined') return;
  const map = read();
  if (!(deckId in map)) return;
  delete map[deckId];
  window.localStorage.setItem(KEY, JSON.stringify(map));
}
