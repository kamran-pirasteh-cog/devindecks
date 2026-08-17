'use client';

/**
 * Design-system repository. The design system is the single source of brand
 * truth and it's IN FLUX, so the app reads the *active* system from here rather
 * than a hardcoded constant. Editing it in Admin bumps the version and reflows
 * every deck, because elements reference colors by token, not raw hex.
 *
 * localStorage today; swaps for the Playground DB in Phase 5.
 */
import {
  DEFAULT_DESIGN_SYSTEM,
  DEFAULT_PAGE_NUMBERS,
  LEGACY_COLOR_ALIASES,
  withChartStyleDefaults,
  type DesignSystem,
} from '@/model';

const KEY = 'devindesign.ds.v1';

function mapValues<T extends object, V>(obj: T, fn: (v: T[keyof T]) => V): { [K in keyof T]: V } {
  const out = {} as { [K in keyof T]: V };
  for (const k of Object.keys(obj) as (keyof T)[]) out[k] = fn(obj[k]);
  return out;
}

/**
 * A stored system was serialized against an older shape of the type, so any
 * section added since is missing from it. Backfill from the defaults rather
 * than letting `ds.pageNumbers.font` explode at render time.
 */
function withDefaults(ds: DesignSystem): DesignSystem {
  const retired = (id: string) =>
    id in LEGACY_COLOR_ALIASES && ds.colors.some((k) => k.id === LEGACY_COLOR_ALIASES[id]);
  return {
    ...ds,
    // The palette once carried two indistinguishable blacks; a system stored
    // before they collapsed still lists the retired one. Drop it here rather
    // than show Kamran a duplicate he can't meaningfully edit — elements still
    // pointing at it resolve through LEGACY_COLOR_ALIASES.
    colors: ds.colors.filter((c) => !retired(c.id)),
    // A role pointing at the dropped token has to be repointed, not just
    // aliased at render time: its `<select>` has no option for a token that
    // isn't in the palette, so it would silently display — and next save,
    // become — whichever colour happened to be first.
    type: mapValues(ds.type, (r) =>
      retired(r.colorToken) ? { ...r, colorToken: LEGACY_COLOR_ALIASES[r.colorToken] } : r,
    ),
    pageNumbers: { ...DEFAULT_PAGE_NUMBERS, ...ds.pageNumbers },
    // Deep, not shallow: a stored system predating the `chart` section would
    // otherwise survive this line and then crash on `ds.chart.axis.showX`.
    chart: withChartStyleDefaults(ds.chart),
  };
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
