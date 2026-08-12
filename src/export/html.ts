'use client';

import type { Deck, DesignSystem } from '@/model';
import { buildDeckHtml, deckFileBaseName } from './htmlDoc';

/** Export the deck as a self-contained, shareable HTML file. */
export function downloadDeckHtml(deck: Deck, ds: DesignSystem) {
  const html = buildDeckHtml(deck, ds);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deckFileBaseName(deck)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
