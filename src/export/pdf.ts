'use client';

import type { Deck, DesignSystem } from '@/model';
import { buildDeckPrintHtml } from './htmlDoc';

/**
 * PDF "export" via the browser's native print-to-PDF: builds a print-styled
 * document (one slide per page, sized to the deck's exact aspect ratio) inside
 * a hidden iframe and calls its print(). An iframe (rather than window.open)
 * sidesteps popup blockers entirely, since no new window/tab is requested.
 */
export function exportDeckToPdf(deck: Deck, ds: DesignSystem) {
  const html = buildDeckPrintHtml(deck, ds);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    iframe.remove();
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.addEventListener('afterprint', cleanup);
    // Give web fonts/images inside the iframe a beat to paint before printing.
    setTimeout(() => {
      win.focus();
      win.print();
    }, 200);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    cleanup();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
}
