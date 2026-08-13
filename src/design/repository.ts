'use client';

/**
 * Design-system repository. The design system is the single source of brand
 * truth and it's IN FLUX, so the app reads the *active* system from here rather
 * than a hardcoded constant. Editing it in Admin bumps the version and reflows
 * every deck, because elements reference colors by token, not raw hex.
 *
 * localStorage today; swaps for the Playground DB in Phase 5.
 */
import { DEFAULT_DESIGN_SYSTEM, DEFAULT_PAGE_NUMBERS, type DesignSystem } from '@/model';

const KEY = 'devindesign.ds.v1';

/**
 * A stored system was serialized against an older shape of the type, so any
 * section added since is missing from it. Backfill from the defaults rather
 * than letting `ds.pageNumbers.font` explode at render time.
 */
function withDefaults(ds: DesignSystem): DesignSystem {
  return { ...ds, pageNumbers: { ...DEFAULT_PAGE_NUMBERS, ...ds.pageNumbers } };
}

export function getActiveDesignSystem(): DesignSystem {
  if (typeof window === 'undefined') return DEFAULT_DESIGN_SYSTEM;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? withDefaults(JSON.parse(raw) as DesignSystem) : DEFAULT_DESIGN_SYSTEM;
  } catch {
    return DEFAULT_DESIGN_SYSTEM;
  }
}

/** Persist an edited design system, bumping version + timestamp. */
export function saveDesignSystem(ds: DesignSystem): DesignSystem {
  const next: DesignSystem = {
    ...ds,
    version: ds.version + 1,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  }
  return next;
}

export function resetDesignSystem(): DesignSystem {
  if (typeof window !== 'undefined') window.localStorage.removeItem(KEY);
  return DEFAULT_DESIGN_SYSTEM;
}
