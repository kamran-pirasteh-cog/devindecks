'use client';

/**
 * Design-system repository. The design system is the single source of brand
 * truth and it's IN FLUX, so the app reads the *active* system from here rather
 * than a hardcoded constant. Editing it in Admin bumps the version and reflows
 * every deck, because elements reference colors by token, not raw hex.
 *
 * localStorage today; swaps for the Playground DB in Phase 5.
 */
import { DEFAULT_DESIGN_SYSTEM, type DesignSystem } from '@/model';

const KEY = 'devindesign.ds.v1';

export function getActiveDesignSystem(): DesignSystem {
  if (typeof window === 'undefined') return DEFAULT_DESIGN_SYSTEM;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DesignSystem) : DEFAULT_DESIGN_SYSTEM;
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
