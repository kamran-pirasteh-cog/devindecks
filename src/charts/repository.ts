'use client';

/**
 * Chart-template repository.
 *
 * Mirrors `templates/repository.ts` one-for-one, including the seeding rule
 * that matters: built-ins are re-ensured on EVERY load, keyed by id, rather
 * than behind a one-shot flag. That way a newly shipped template appears for
 * existing users without wiping anything they've edited.
 *
 * localStorage today; the same seam as every other repository here.
 */
import { nanoid } from 'nanoid';
import {
  DEFAULT_CHART_STYLE,
  defaultChartSpec,
  type ChartSpec,
  type ChartStyle,
  type DeepPartial,
} from '@/model';
import { CHART_TEMPLATES, type ChartTemplateCategory } from './registry';
import type { ChartResearchHints } from './research';

const KEY = 'devindesign.charts.v1';

export interface StoredChartTemplate {
  id: string;
  name: string;
  description: string;
  category: ChartTemplateCategory;
  order?: number;
  /** The complete archetype, placeholder data included. */
  spec: ChartSpec;
  /** Deviations from the design system's base chart style. */
  styleOverrides?: DeepPartial<ChartStyle>;
  /** Bumped on every save; instances compare against it to detect drift. */
  version: number;
  research?: ChartResearchHints;
  createdAt: string;
  updatedAt: string;
}

type TemplateMap = Record<string, StoredChartTemplate>;

function read(): TemplateMap {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as TemplateMap;
  } catch {
    return {};
  }
}

function write(map: TemplateMap) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

const now = () => new Date().toISOString();

/**
 * Idempotent, and safe to call on every load.
 *
 * `style` is the brand's chart style. A template's spec pins the values Admin
 * calls "defaults for new charts" — legend, data labels, gaps, number format —
 * and those pinned values win at compile time, so seeding without the brand's
 * style is what left the template grid showing house defaults no matter what
 * Admin said.
 */
export function seedChartTemplatesIfFirstRun(style: ChartStyle = DEFAULT_CHART_STYLE): void {
  if (typeof window === 'undefined') return;
  const map = read();
  let changed = false;
  for (const t of CHART_TEMPLATES) {
    if (map[t.id]) continue;
    const ts = now();
    map[t.id] = {
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      order: t.order,
      spec: t.buildSpec(style),
      styleOverrides: t.styleOverrides,
      research: t.research,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    changed = true;
  }
  if (changed) write(map);
}

export function listChartTemplates(): StoredChartTemplate[] {
  return Object.values(read()).sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name),
  );
}

export const getChartTemplate = (id: string): StoredChartTemplate | null => read()[id] ?? null;

export function createChartTemplate(opts: {
  name: string;
  description?: string;
  category?: ChartTemplateCategory;
  spec?: ChartSpec;
  style?: ChartStyle;
}): StoredChartTemplate {
  const ts = now();
  const template: StoredChartTemplate = {
    id: `chart.custom-${nanoid(8)}`,
    name: opts.name,
    description: opts.description ?? '',
    category: opts.category ?? 'Custom',
    spec: opts.spec ?? defaultChartSpec('column', 'stacked', opts.style ?? DEFAULT_CHART_STYLE),
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };
  const map = read();
  map[template.id] = template;
  write(map);
  return template;
}

export function updateChartTemplateMeta(
  id: string,
  patch: Partial<Pick<StoredChartTemplate, 'name' | 'description' | 'category' | 'research'>>,
): void {
  const map = read();
  if (!map[id]) return;
  // Metadata isn't the template's shape, so it doesn't bump `version` — an
  // instance shouldn't report drift because someone fixed a typo in a name.
  map[id] = { ...map[id], ...patch, updatedAt: now() };
  write(map);
}

/** Save the archetype itself. Bumps `version`, which is what drift keys off. */
export function saveChartTemplateSpec(
  id: string,
  spec: ChartSpec,
  styleOverrides?: DeepPartial<ChartStyle>,
): void {
  const map = read();
  if (!map[id]) return;
  map[id] = {
    ...map[id],
    spec,
    styleOverrides,
    version: map[id].version + 1,
    updatedAt: now(),
  };
  write(map);
}

export function duplicateChartTemplate(id: string, name?: string): StoredChartTemplate | null {
  const src = read()[id];
  if (!src) return null;
  const ts = now();
  const copy: StoredChartTemplate = {
    ...structuredClone(src),
    id: `chart.custom-${nanoid(8)}`,
    name: name ?? suggestCopyName(src.name),
    category: 'Custom',
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };
  const map = read();
  map[copy.id] = copy;
  write(map);
  return copy;
}

export function deleteChartTemplate(id: string): void {
  const map = read();
  delete map[id];
  write(map);
}

export function isNameAvailable(name: string, excludeId?: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return !listChartTemplates().some((t) => t.id !== excludeId && t.name.trim().toLowerCase() === n);
}

export function suggestCopyName(base: string): string {
  let candidate = `Copy of ${base}`;
  let i = 2;
  while (!isNameAvailable(candidate)) {
    candidate = `Copy of ${base} (${i})`;
    i += 1;
  }
  return candidate;
}

/**
 * Restore every built-in to its shipped state, leaving custom ones alone.
 *
 * "Shipped state" is resolved against the brand, not against the house
 * defaults — this is also the way to pull existing templates back in line
 * after the chart style changes.
 */
export function resetBuiltInChartTemplates(style: ChartStyle = DEFAULT_CHART_STYLE): void {
  const map = read();
  for (const t of CHART_TEMPLATES) {
    const ts = now();
    map[t.id] = {
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      order: t.order,
      spec: t.buildSpec(style),
      styleOverrides: t.styleOverrides,
      research: t.research,
      version: (map[t.id]?.version ?? 0) + 1,
      createdAt: map[t.id]?.createdAt ?? ts,
      updatedAt: ts,
    };
  }
  write(map);
}
