/**
 * Where a slide came from, and whether its master has moved since.
 *
 * The deliberate twin of `charts/provenance.ts`, down to the rule that matters
 * most: **reapplying a master never rewrites the author's content.** For a
 * chart that meant the numbers; for a slide it means the characters someone
 * typed. A "reapply layout" that silently restored the master's placeholder
 * copy over a client deck is the catastrophe this file exists to not be.
 *
 * Why this is needed at all: a layout is COPIED onto a deck at insert time
 * (`getLayoutSlide` clones it with fresh element ids), so an admin editing the
 * master afterwards changes nothing about the hundreds of slides already made
 * from it. Provenance is the thread back — `Slide.layoutId`/`layoutVersion`
 * for "which master, at what version", and `SlideElement.layoutElementId` for
 * "which element of it", since the element ids themselves were regenerated on
 * the way in.
 */
import type { Slide, SlideElement } from '@/model';
import type { StoredLayout } from './layoutRepository';
import type { StoredTemplate } from './repository';

export interface LayoutDrift {
  /** The master layout has been re-saved since this slide was made from it. */
  layoutStale: boolean;
}

export function layoutDrift(slide: Slide, layout?: StoredLayout | null): LayoutDrift {
  if (!layout || !slide.layoutId) return { layoutStale: false };
  return {
    layoutStale: slide.layoutId === layout.id && slide.layoutVersion !== layout.version,
  };
}

/** Has this deck's source template moved since the deck was created from it? */
export function templateDrift(
  deck: { deckTemplateId?: string; deckTemplateVersion?: number },
  template?: StoredTemplate | null,
): boolean {
  if (!template || !deck.deckTemplateId) return false;
  return deck.deckTemplateId === template.id && deck.deckTemplateVersion !== template.version;
}

/**
 * Tie a freshly-instantiated slide back to the layout it came from.
 *
 * Called on the way OUT of the repository (see `getLayoutSlide`), after ids
 * have been regenerated — `layoutElementId` records the master's original id
 * so the two can be matched again later.
 */
export function stampLayoutProvenance(slide: Slide, layout: StoredLayout, masters: Slide): Slide {
  // Element order survives `freshIds`, so position is a sound pairing between
  // the clone and the master it was cloned from. Zipping beats matching on the
  // regenerated ids, which by definition no longer correspond.
  return {
    ...slide,
    layoutId: layout.id,
    layoutVersion: layout.version,
    elements: slide.elements.map((el, i) => {
      const master = masters.elements[i];
      return master ? { ...el, layoutElementId: master.id } : el;
    }),
  };
}

export interface ReapplyOptions {
  /**
   * Also adopt the master's TEXT FORMATTING — font, size, colour, alignment,
   * bullets — while keeping the author's actual characters.
   *
   * Off by default, and separate for the same reason `adoptTemplateSpec` is on
   * the chart side: an author who deliberately bumped a heading up two points
   * shouldn't lose that to a master whose margins happened to change.
   */
  adoptTextFormatting?: boolean;
}

/**
 * Bring a slide back in line with its master layout.
 *
 * Three rules, in priority order:
 *
 * 1. **Author content is never destroyed.** Text bodies are preserved
 *    wholesale by default; elements the author added (no `layoutElementId`)
 *    are left exactly as they are.
 * 2. **Geometry and non-text styling follow the master** — position, size,
 *    rotation, fill, outline. That's what "the master moved" usually means.
 * 3. **Elements added to the master since are appended**, so a layout that
 *    grew a footer propagates it rather than silently dropping it.
 *
 * An element deleted from the master is deliberately NOT deleted here: it may
 * be carrying content, and removing it is not a decision this function gets to
 * make on the author's behalf.
 */
export function reapplyLayout(
  slide: Slide,
  layout: StoredLayout,
  opts: ReapplyOptions = {},
): Slide {
  const masters = new Map(layout.slide.elements.map((el) => [el.id, el]));
  const claimed = new Set<string>();

  const elements = slide.elements.map((el) => {
    const master = el.layoutElementId ? masters.get(el.layoutElementId) : undefined;
    if (!master) return el; // author's own — untouched
    const adopted = adoptFromMaster(el, master, opts);
    // Only a master that was actually applied counts as claimed. One that was
    // declined (a changed type) has to stay unclaimed so the append pass still
    // brings it across — otherwise editing an element's type in a master would
    // quietly drop it from every slide made from that master.
    if (adopted) claimed.add(master.id);
    return adopted ?? el;
  });

  // Whatever the master gained since this slide was made.
  for (const master of layout.slide.elements) {
    if (claimed.has(master.id)) continue;
    elements.push({ ...structuredClone(master), layoutElementId: master.id });
  }

  return {
    ...slide,
    background: layout.slide.background,
    layoutId: layout.id,
    layoutVersion: layout.version,
    elements,
  };
}

/**
 * Take the master's presentation, keep the author's words.
 *
 * Spelled out field by field rather than as a spread of the master with the
 * body added back: a spread would silently adopt every field added to the
 * element types in future, which is precisely the class of change that should
 * have to be considered here first.
 */
function adoptFromMaster(
  el: SlideElement,
  master: SlideElement,
  opts: ReapplyOptions,
): SlideElement | null {
  // A master that changed type isn't a restyle of this element, it's a
  // different element. Decline it — the caller leaves the author's element
  // alone and lets the master's own copy arrive through the append pass.
  if (master.type !== el.type) return null;

  const next = {
    ...el,
    rect: master.rect,
    rotation: master.rotation,
    flipH: master.flipH,
    flipV: master.flipV,
    role: master.role,
  } as SlideElement;

  if ('fill' in master && 'fill' in next) next.fill = master.fill;
  if ('outline' in master && 'outline' in next) next.outline = master.outline;
  if (next.type === 'shape' && master.type === 'shape') next.preset = master.preset;

  if (opts.adoptTextFormatting) {
    const body = 'body' in next ? next.body : undefined;
    const masterBody = 'body' in master ? master.body : undefined;
    if (body && masterBody && 'body' in next) {
      next.body = mergeTextFormatting(body, masterBody);
    }
  }

  return next;
}

/**
 * The master's typography over the author's characters.
 *
 * Paragraphs are zipped by index; the author's text is authoritative for the
 * COUNT of paragraphs and runs (a master with one placeholder line can't be
 * allowed to truncate three real ones), and the master supplies formatting for
 * as far as it reaches. Past that, the author's own formatting stands.
 */
function mergeTextFormatting<B extends { paragraphs: unknown[] }>(body: B, master: B): B {
  type Para = { runs?: { text?: string }[] };
  const masterParas = master.paragraphs as Para[];

  return {
    ...master,
    paragraphs: (body.paragraphs as Para[]).map((para, i) => {
      const mp = masterParas[Math.min(i, masterParas.length - 1)];
      if (!mp) return para;
      const masterRuns = mp.runs ?? [];
      return {
        ...mp,
        runs: (para.runs ?? []).map((run, j) => ({
          ...(masterRuns[Math.min(j, masterRuns.length - 1)] ?? {}),
          text: run.text,
        })),
      };
    }),
  } as B;
}
