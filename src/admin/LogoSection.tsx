'use client';

/**
 * The brand's mark, and where it goes.
 *
 * The deliberate sibling of `PageNumbersSection`: both describe a piece of slide
 * chrome the brand owns rather than any individual deck, both ride the design
 * system's own Save/Publish cycle, and neither exists as an element anyone can
 * accidentally delete from one slide.
 *
 * The difference is that a logo is an ASSET, so this panel has to accept a file
 * — and has to make sense before one has been supplied. That "no logo yet" state
 * is the normal starting state, not an error: `ds.logo` stays undefined, brand
 * conversion draws a visible dashed placeholder on every slide that wants a
 * mark, and the placeholder is itself the upload affordance. Nothing here shows
 * a converted deck as finished when its logo is still missing.
 *
 * Two marks rather than one, light-ground and dark-ground. The same logo in two
 * inks, not two logos: a section divider on a black ground and a content slide
 * on white both need the mark, and a single asset can only be right on one of
 * them.
 */
import { useRef, useState } from 'react';
import {
  DEFAULT_BRAND_LOGO,
  LOGO_PLACEMENTS,
  type BrandLogo,
  type LogoPlacement,
} from '@/model/tokens';
import type { SlideArchetype } from '@/model/archetype';

const ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,.png,.jpg,.jpeg,.svg,.webp';

/** Rendered heights that make sense for a mark, in inches. */
const HEIGHT_CHOICES = [0.2, 0.24, 0.28, 0.32, 0.4, 0.5];

const PLACEMENT_LABELS: Record<LogoPlacement, string> = {
  none: 'No logo',
  'title-hero': 'Large, centred',
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

/**
 * The archetypes worth giving their own rule.
 *
 * Not all eleven: `dense`, `other` and most content kinds all want the same
 * corner mark, and eleven dropdowns would present a set of decisions nobody
 * actually needs to make. These four are the ones where the answer genuinely
 * differs, and everything else follows `default`.
 */
const TUNED_ARCHETYPES: SlideArchetype[] = ['title', 'section', 'image', 'chart'];

/** Read an image file as a data URL, and measure its aspect ratio. */
async function readAsset(file: File): Promise<{ src: string; aspect: number }> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
  // The aspect ratio is measured ONCE, here, and stored — layout has to reserve
  // the right width without loading the image (it runs in tests, in SSR and in
  // the CLI validator, none of which have an <img>).
  const aspect = await new Promise<number>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight));
    // An SVG with no intrinsic size gives 0×0; square is the safe assumption.
    img.onerror = () => resolve(1);
    img.src = src;
  });
  return { src, aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1 };
}

export function LogoSection({
  logo,
  onChange,
}: {
  logo: BrandLogo | undefined;
  /** `undefined` clears the logo entirely, back to the placeholder state. */
  onChange: (next: BrandLogo | undefined) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const lightRef = useRef<HTMLInputElement>(null);
  const darkRef = useRef<HTMLInputElement>(null);

  /** Edit the logo, creating it from defaults if this is the first change. */
  const patch = (next: Partial<BrandLogo>) =>
    onChange({ ...DEFAULT_BRAND_LOGO, ...logo, ...next });

  const upload = async (file: File, slot: 'srcLight' | 'srcDark') => {
    setError(null);
    try {
      const { src, aspect } = await readAsset(file);
      // The aspect comes from the light mark, which is the one layout sizes
      // against; a dark variant of the same logo has the same proportions.
      patch(slot === 'srcLight' ? { srcLight: src, aspect } : { srcDark: src });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const placementOf = (archetype: SlideArchetype): LogoPlacement =>
    logo?.placement[archetype] ?? logo?.placement.default ?? DEFAULT_BRAND_LOGO.placement.default;

  const select =
    'rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold">Brand logo</h3>
        {logo ? (
          <button
            onClick={() => onChange(undefined)}
            className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Remove
          </button>
        ) : null}
      </div>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Placed on every slide whose kind asks for it, and stripped from uploaded
        decks along with their own branding. Until a mark is set here, converted
        decks show a placeholder you can drop an image onto.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <AssetSlot
          label="On light backgrounds"
          src={logo?.srcLight}
          dark={false}
          onPick={() => lightRef.current?.click()}
          onClear={() => patch({ srcLight: undefined })}
        />
        <AssetSlot
          label="On dark backgrounds"
          src={logo?.srcDark}
          dark
          onPick={() => darkRef.current?.click()}
          onClear={() => patch({ srcDark: undefined })}
          hint={logo?.srcLight && !logo?.srcDark ? 'Falls back to the light mark' : undefined}
        />
      </div>

      <input
        ref={lightRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file, 'srcLight');
        }}
      />
      <input
        ref={darkRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file, 'srcDark');
        }}
      />

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium">Height</span>
          <select
            value={logo?.heightIn ?? DEFAULT_BRAND_LOGO.heightIn}
            onChange={(e) => patch({ heightIn: Number(e.target.value) })}
            className={`mt-1 w-full ${select}`}
          >
            {HEIGHT_CHOICES.map((h) => (
              <option key={h} value={h}>
                {h}″
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] text-zinc-400">
            Width follows the image — a logo is never stretched.
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium">Everywhere else</span>
          <select
            value={logo?.placement.default ?? DEFAULT_BRAND_LOGO.placement.default}
            onChange={(e) =>
              patch({
                placement: {
                  ...DEFAULT_BRAND_LOGO.placement,
                  ...logo?.placement,
                  default: e.target.value as LogoPlacement,
                },
              })
            }
            className={`mt-1 w-full ${select}`}
          >
            {LOGO_PLACEMENTS.map((p) => (
              <option key={p} value={p}>
                {PLACEMENT_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <span className="text-xs font-medium">Per kind of slide</span>
        <p className="mb-2 mt-0.5 text-[10px] text-zinc-400">
          A title slide usually wears the mark differently from a content slide,
          and a full-bleed image has nowhere safe to put it.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TUNED_ARCHETYPES.map((archetype) => (
            <label key={archetype} className="flex items-center justify-between gap-2">
              <span className="text-xs capitalize text-zinc-600 dark:text-zinc-300">
                {archetype}
              </span>
              <select
                value={placementOf(archetype)}
                onChange={(e) =>
                  patch({
                    placement: {
                      ...DEFAULT_BRAND_LOGO.placement,
                      ...logo?.placement,
                      [archetype]: e.target.value as LogoPlacement,
                    },
                  })
                }
                className={select}
              >
                {LOGO_PLACEMENTS.map((p) => (
                  <option key={p} value={p}>
                    {PLACEMENT_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * One asset slot, previewed on the ground it's for.
 *
 * The dark slot has a dark preview and the light slot a light one, so a mark
 * uploaded into the wrong slot is obvious on sight rather than three slides into
 * a converted deck.
 */
function AssetSlot({
  label,
  src,
  dark,
  hint,
  onPick,
  onClear,
}: {
  label: string;
  src: string | undefined;
  dark: boolean;
  hint?: string;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        {src ? (
          <button
            onClick={onClear}
            className="text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Clear
          </button>
        ) : null}
      </div>
      <button
        onClick={onPick}
        className={`flex h-20 w-full items-center justify-center rounded-md border px-3 transition ${
          src
            ? 'border-zinc-200 dark:border-zinc-700'
            : 'border-dashed border-zinc-300 hover:border-indigo-400 dark:border-zinc-600'
        } ${dark ? 'bg-zinc-900' : 'bg-white'}`}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="max-h-12 max-w-full object-contain" />
        ) : (
          <span className={`text-[11px] ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            Click to upload
          </span>
        )}
      </button>
      {hint ? <p className="mt-1 text-[10px] text-zinc-400">{hint}</p> : null}
    </div>
  );
}
