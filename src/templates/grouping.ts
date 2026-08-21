/**
 * How templates divide up between folders.
 *
 * One rule, in one place, because three surfaces have to agree about it: the
 * rail's badges in Admin, the shelf that the rail's selection scopes, and the
 * folder groups in the new-document picker. If they disagreed, a template would
 * be counted in a folder it isn't shown in — the sort of drift that reads as a
 * lost template.
 *
 * The rule is that **a folder id nothing answers to counts as unfiled**. Folders
 * are deletable, and `unfileTemplateFolder` clears the ids of everything in one
 * on the way out — but that's a write, and a write can be interrupted, raced by
 * another tab, or predate this code. Treating a dangling id as unfiled means the
 * worst case is a template in the wrong bucket rather than a template in no
 * bucket, invisible everywhere.
 *
 * Kept free of React and of the repository — which is a `'use client'` module
 * that reaches for `localStorage` on import — so this is the part unit tests can
 * hold, the same split `sortTemplates.ts` makes.
 */

/** The fields of a stored template this module needs. Structural on purpose. */
export interface FileableTemplate {
  folderId?: string;
}

/** The fields of a folder this module needs. */
export interface NamedFolder {
  id: string;
  name: string;
}

/** The key unfiled templates are counted and grouped under. */
export const UNFILED_KEY = '';

/**
 * Which bucket this template belongs to: its folder's id, or `UNFILED_KEY` if it
 * has none or names one that isn't in `folders`.
 */
export function bucketFor(template: FileableTemplate, folderIds: ReadonlySet<string>): string {
  if (!template.folderId) return UNFILED_KEY;
  return folderIds.has(template.folderId) ? template.folderId : UNFILED_KEY;
}

/**
 * Counts by folder id, for the rail's badges.
 *
 * Every folder gets an entry even at zero — the rail shows a badge on every row,
 * and an empty folder reading blank rather than 0 looks broken. The unfiled tally
 * is always present too, under `UNFILED_KEY`, so the caller can decide whether an
 * Unfiled row is worth showing.
 */
export function countTemplatesByFolder(
  templates: readonly FileableTemplate[],
  folders: readonly NamedFolder[],
): Record<string, number> {
  const counts: Record<string, number> = { [UNFILED_KEY]: 0 };
  for (const f of folders) counts[f.id] = 0;
  const ids = new Set(folders.map((f) => f.id));
  for (const t of templates) counts[bucketFor(t, ids)] += 1;
  return counts;
}

/** Just the templates in one scope — what the rail's selection narrows the shelf to. */
export function templatesInFolder<T extends FileableTemplate>(
  templates: readonly T[],
  folders: readonly NamedFolder[],
  /** A folder id, or `null` for the unfiled ones. */
  folderId: string | null,
): T[] {
  const ids = new Set(folders.map((f) => f.id));
  const want = folderId ?? UNFILED_KEY;
  return templates.filter((t) => bucketFor(t, ids) === want);
}

export interface TemplateGroup<T> {
  /** The folder's id, or `UNFILED_KEY` for the trailing unfiled group. */
  key: string;
  label: string;
  items: T[];
}

/**
 * Templates as folder groups, in the folders' own order, for the new-document
 * picker.
 *
 * Two rules that the Admin shelf deliberately does NOT share:
 *
 * - **An empty folder is dropped.** It's a real place in Admin — somewhere to
 *   drop a template into — but here it would be a heading over nothing.
 * - **Unfiled templates come last, under `unfiledLabel`.** They're still on
 *   offer: a template must never become unstartable because nobody got round to
 *   filing it.
 */
export function groupTemplatesByFolder<T extends FileableTemplate>(
  templates: readonly T[],
  folders: readonly NamedFolder[],
  unfiledLabel = 'Other',
): TemplateGroup<T>[] {
  const ids = new Set(folders.map((f) => f.id));
  const groups: TemplateGroup<T>[] = [];
  for (const f of folders) {
    const items = templates.filter((t) => bucketFor(t, ids) === f.id);
    if (items.length) groups.push({ key: f.id, label: f.name, items });
  }
  const unfiled = templates.filter((t) => bucketFor(t, ids) === UNFILED_KEY);
  if (unfiled.length) groups.push({ key: UNFILED_KEY, label: unfiledLabel, items: unfiled });
  return groups;
}
