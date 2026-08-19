'use client';

/**
 * The one list of what a deck can be exported as, and the one place that runs
 * an export.
 *
 * It exists because there are now two ways in: the editor header's Export
 * button and the "..." menu on a document in the shelf. Those must offer the
 * same formats — a deck you can only get as a .pptx from inside the editor is
 * a trap — so the list and the dispatch live here rather than in either menu.
 */
import type { Deck, DesignSystem } from '@/model';
import { downloadDeckPptx } from './pptx';
import { downloadDeckHtml } from './html';
import { exportDeckToPdf } from './pdf';

export const EXPORT_FORMATS = [
  { key: 'pptx', label: 'PowerPoint (.pptx)' },
  { key: 'pdf', label: 'PDF' },
  { key: 'html', label: 'HTML' },
] as const;

export type ExportKind = (typeof EXPORT_FORMATS)[number]['key'];

/**
 * PDF goes through the browser's print dialog rather than downloading, so it
 * resolves as soon as the dialog is raised — callers that toast "Exported"
 * should say something true for all three.
 */
export function runExport(kind: ExportKind, deck: Deck, ds: DesignSystem) {
  if (kind === 'pptx') return downloadDeckPptx(deck, ds);
  if (kind === 'pdf') return exportDeckToPdf(deck, ds);
  return downloadDeckHtml(deck, ds);
}
