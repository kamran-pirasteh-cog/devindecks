'use client';

/**
 * Design-system repository. The design system is the single source of brand
 * truth and it's IN FLUX, so the app reads the *active* system from here rather
 * than a hardcoded constant. Publishing it in Admin bumps the version and
 * reflows every deck, because elements reference colors by token, not raw hex.
 *
 * **Two copies, deliberately: a PUBLISHED one and a DRAFT.**
 *
 * That split doesn't matter while the store is one person's browser, which is
 * why it didn't exist before — every save bumped `version` and only that
 * browser noticed. It matters enormously once the store is shared and one
 * copy is the whole company's brand: an admin nudging a colour would otherwise
 * mark every deck in the org stale on each keystroke-save, and the staleness
 * badge people are supposed to act on becomes noise they learn to ignore.
 *
 * So: editing writes the draft and bumps nothing. `publishDesignSystem` is the
 * single deliberate act that bumps `version`, and decks only ever render
 * against the published copy.
 *
 * Storage runs through `platform/collection`, so the localStorage backing here
 * becomes a Playground-backed adapter without this file changing.
 */
import { defineCollection } from '@/platform/collection';
import { localStorageAdapter } from '@/platform/store';
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

/**
 * The two copies live under the original key so an existing browser keeps its
 * brand — see `migrate` for the shape change that made that non-trivial.
 */
type DesignSlot = 'published' | 'draft';

const collection = defineCollection<DesignSystem>(KEY, localStorageAdapter, {
  migrate: (map) => {
    // Before drafts, this key held a bare DesignSystem rather than a
    // slot map. Reading one of those as a slot map yields nonsense keys
    // ('colors', 'fonts', ...) and a lost brand, so detect and wrap it.
    const legacy = map as unknown as Partial<DesignSystem>;
    if (legacy.colors && legacy.type) {
      return { published: legacy as DesignSystem };
    }
    return map;
  },
});

const read = (slot: DesignSlot): DesignSystem | null => {
  const stored = collection.snapshot()[slot];
  return stored ? withDefaults(stored) : null;
};

const put = (slot: DesignSlot, ds: DesignSystem | undefined) =>
  collection.mutate((map) => {
    if (ds) map[slot] = ds;
    else delete map[slot];
  });

/** Hydrate from the adapter. Only needed once the adapter is a remote one. */
export const hydrateDesignSystem = () => collection.hydrate();

/**
 * What every deck renders against. Never the draft — an admin mid-edit must
 * not be able to restyle a deck someone else is presenting.
 */
export function getActiveDesignSystem(): DesignSystem {
  return read('published') ?? DEFAULT_DESIGN_SYSTEM;
}

/** What Admin edits: the draft if one is open, otherwise today's published copy. */
export function getDraftDesignSystem(): DesignSystem {
  return read('draft') ?? getActiveDesignSystem();
}

/** Is there unpublished work? Drives the "draft" badge and the publish button. */
export function hasDesignDraft(): boolean {
  return collection.snapshot().draft !== undefined;
}

/**
 * Persist an in-progress edit. Deliberately does NOT bump `version`: nothing
 * outside Admin can see a draft, so nothing has drifted from anything.
 */
export function saveDesignDraft(ds: DesignSystem): DesignSystem {
  const next: DesignSystem = { ...ds, updatedAt: new Date().toISOString() };
  put('draft', next);
  return next;
}

/**
 * Promote the draft to the live brand. The one operation that bumps `version`,
 * which is what makes every deck built on the previous one report as stale.
 */
export function publishDesignSystem(ds?: DesignSystem): DesignSystem {
  const source = ds ?? getDraftDesignSystem();
  const active = getActiveDesignSystem();
  const next: DesignSystem = {
    ...source,
    // A publish that changes nothing a deck can see keeps the version it had.
    // Otherwise retyping a preview's dummy numbers — Admin scaffolding no deck
    // reads — reports every deck in the org as built on a stale brand.
    version: affectsDecks(active, source) ? active.version + 1 : active.version,
    updatedAt: new Date().toISOString(),
  };
  collection.mutate((map) => {
    map.published = next;
    delete map.draft;
  });
  return next;
}

/**
 * Does this draft differ from the live brand in any way a deck renders?
 *
 * Compares by value, ignoring the two fields that are not brand truth:
 * `updatedAt` (a timestamp, different on every save) and `previewData` (Admin's
 * own dummy numbers). Structural equality is the right test here — a design
 * system is plain JSON with a stable field order, and the alternative is a
 * hand-maintained list of every field that matters, which drifts the first time
 * one is added.
 */
function affectsDecks(active: DesignSystem, next: DesignSystem): boolean {
  const strip = ({ updatedAt: _u, previewData: _p, version: _v, ...rest }: DesignSystem) => rest;
  return JSON.stringify(strip(active)) !== JSON.stringify(strip(next));
}

/** Throw the draft away and go back to what's live. */
export function discardDesignDraft(): DesignSystem {
  put('draft', undefined);
  return getActiveDesignSystem();
}

/** Back to the house brand, draft and all. */
export function resetDesignSystem(): DesignSystem {
  collection.replace({});
  return DEFAULT_DESIGN_SYSTEM;
}
