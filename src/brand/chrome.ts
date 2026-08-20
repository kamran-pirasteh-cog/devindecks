/**
 * Our furniture, where theirs used to be.
 *
 * `restyle.ts` deleted the source deck's logo, footer and page numbers. This
 * file puts ours back. Three different mechanisms, and the differences are
 * deliberate:
 *
 *  - PAGE NUMBERS are not elements at all. `Deck.pageNumbers` is a boolean and
 *    every renderer draws the number from the slide's live index (see
 *    `model/pageNumbers.ts`). So "add page numbers" is one flag, and reordering
 *    slides renumbers them for free — which is exactly why the source deck's
 *    page numbers, which WERE elements, had to go.
 *
 *  - THE LOGO is a real element, because it has to be selectable, movable and
 *    replaceable. Its position comes from `ds.logo.placement[archetype]`.
 *
 *  - THE EYEBROW is left where it is. `restyle.ts` has already set it in the
 *    brand's mono face at caption size with caps on, which is what
 *    `editor/eyebrow.ts` builds — rebuilding it from scratch would discard the
 *    author's words to gain nothing.
 *
 * ── The placeholder ──────────────────────────────────────────────────────
 * A design system with no logo asset is the NORMAL starting state, not an error.
 * So when there's no `srcLight`/`srcDark` we place a visible dashed slot saying
 * "Logo", which the user can drop an image onto or click to upload. That is the
 * honest thing to render: a converted deck with a silent gap where the logo goes
 * looks finished and isn't, and one with no logo slot at all gives the user
 * nowhere to put theirs.
 */
import type { EMU, PictureElement, Rect, ShapeElement, Slide, SlideElement } from '@/model';
import { DEFAULT_MARGINS, inchesToEmu, resolveColor, token } from '@/model';
import type { SlideArchetype } from '@/model/archetype';
import { logoPlacementFor, type BrandLogo, type DesignSystem, type LogoPlacement } from '@/model/tokens';

/** Roles stamped on the chrome we add, so later passes can recognize it. */
export const LOGO_ROLE = 'brand.logo';
export const LOGO_PLACEHOLDER_ROLE = 'brand.logo.placeholder';

/** Gap between the logo and the margin it hangs off. */
const LOGO_INSET_IN = 0.08;

/** A hero lockup is this share of the slide width. */
const HERO_WIDTH_SHARE = 0.22;

/**
 * Where the logo goes, as a rect.
 *
 * Sized by HEIGHT and the asset's aspect ratio, never stretched — a squashed
 * logo is the single most recognizable sign that a deck was machine-processed.
 */
export function logoRect(
  placement: LogoPlacement,
  logo: BrandLogo,
  slideSize: { w: EMU; h: EMU },
): Rect | null {
  if (placement === 'none') return null;

  if (placement === 'title-hero') {
    const w = Math.round(slideSize.w * HERO_WIDTH_SHARE);
    const h = Math.round(w / Math.max(0.05, logo.aspect));
    return {
      x: Math.round((slideSize.w - w) / 2),
      // Sits in the lower third, clear of a centred headline.
      y: Math.round(slideSize.h * 0.72),
      w,
      h,
    };
  }

  const h = inchesToEmu(logo.heightIn);
  const w = Math.round(h * Math.max(0.05, logo.aspect));
  const inset = inchesToEmu(LOGO_INSET_IN);
  const left = DEFAULT_MARGINS.left + inset;
  const right = slideSize.w - DEFAULT_MARGINS.right - inset - w;
  const top = DEFAULT_MARGINS.top + inset;
  const bottom = slideSize.h - DEFAULT_MARGINS.bottom - inset - h;

  switch (placement) {
    case 'top-left':
      return { x: left, y: top, w, h };
    case 'top-right':
      return { x: right, y: top, w, h };
    case 'bottom-left':
      return { x: left, y: bottom, w, h };
    default:
      return { x: right, y: bottom, w, h };
  }
}

/**
 * Is the ground under this rect dark?
 *
 * Only the slide background and full-bleed panels are consulted. A logo landing
 * on a small chart or a photo is a collision the linter reports rather than
 * something to pick an ink for — inverting the mark because it happens to touch
 * a dark bar would be worse than flagging it.
 */
export function groundIsDark(slide: Slide, rect: Rect, ds: DesignSystem, slideSize: { w: EMU; h: EMU }): boolean {
  const covering = slide.elements.filter(
    (el) =>
      el.type === 'shape' &&
      el.fill?.kind === 'solid' &&
      el.rect.x <= rect.x &&
      el.rect.y <= rect.y &&
      el.rect.x + el.rect.w >= rect.x + rect.w &&
      el.rect.y + el.rect.h >= rect.y + rect.h &&
      // Only something substantial counts as the ground.
      el.rect.w * el.rect.h > slideSize.w * slideSize.h * 0.25,
  ) as ShapeElement[];

  const groundFill =
    covering.length > 0
      ? covering[covering.length - 1].fill
      : slide.background;

  if (!groundFill || groundFill.kind !== 'solid') return false;
  return luminance(resolveColor(groundFill.color, ds)) < 0.45;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 1;
  const chan = (i: number) => {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}

export interface ChromeResult {
  slide: Slide;
  /** True when a placeholder was drawn because the brand has no logo asset. */
  placeholder: boolean;
  /** The rect the logo took, for the linter's collision check. */
  logoRect: Rect | null;
}

/**
 * The placeholder slot: a dashed outline and the word "Logo".
 *
 * A shape rather than a picture, because there is no image to show — and it
 * carries its own text so it reads as an invitation rather than as a stray
 * rectangle somebody forgot to delete. `LOGO_PLACEHOLDER_ROLE` is what the
 * editor hangs the click-to-upload and drop-to-replace handlers off.
 */
export function logoPlaceholder(rect: Rect, ds: DesignSystem, id: string): ShapeElement {
  return {
    id,
    type: 'shape',
    role: LOGO_PLACEHOLDER_ROLE,
    name: 'Logo',
    preset: 'rect',
    rect,
    fill: { kind: 'none' },
    outline: { color: token('line.default'), widthEmu: 9525, dash: 'dash' },
    body: {
      paragraphs: [
        {
          runs: [
            {
              text: 'Logo',
              font: ds.fonts.mono,
              // Deliberately small: the slot must read as scaffolding, not as
              // a design element somebody chose.
              sizePt: Math.max(8, Math.round(ds.type.caption.sizePt * 0.8)),
              caps: true,
              color: token('ink.muted'),
            },
          ],
          align: 'center',
        },
      ],
      anchor: 'middle',
      autofit: 'none',
    },
  };
}

/**
 * Add the brand's chrome to one slide.
 *
 * Returns the slide unchanged when the archetype's placement is `none` — a
 * section divider is deliberately bare, and full-bleed artwork has nowhere safe
 * for a mark.
 */
export function addChrome(
  slide: Slide,
  archetype: SlideArchetype,
  ds: DesignSystem,
  slideSize: { w: EMU; h: EMU },
  newId: (prefix: string) => string,
): ChromeResult {
  const logo = ds.logo;
  const placement = logoPlacementFor(logo, archetype);
  if (!logo || placement === 'none') {
    return { slide, placeholder: false, logoRect: null };
  }

  const rect = logoRect(placement, logo, slideSize);
  if (!rect) return { slide, placeholder: false, logoRect: null };

  const dark = groundIsDark(slide, rect, ds, slideSize);
  // The dark-ground mark when the ground is dark and we have one; otherwise
  // whichever single mark the brand supplied.
  const src = dark ? (logo.srcDark ?? logo.srcLight) : (logo.srcLight ?? logo.srcDark);

  const element: SlideElement = src
    ? ({
        id: newId('picture'),
        type: 'picture',
        role: LOGO_ROLE,
        name: 'Logo',
        rect,
        src,
      } satisfies PictureElement)
    : logoPlaceholder(rect, ds, newId('shape'));

  return {
    // Appended, so the mark sits above the slide's own content rather than
    // under a panel that would hide it.
    slide: { ...slide, elements: [...slide.elements, element] },
    placeholder: src === undefined,
    logoRect: rect,
  };
}

/** Was this element added by `addChrome`? */
export const isBrandChrome = (el: SlideElement): boolean =>
  el.role === LOGO_ROLE || el.role === LOGO_PLACEHOLDER_ROLE;
