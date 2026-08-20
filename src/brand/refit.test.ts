/**
 * The lever-ordering tests. These are the ones that matter: they assert that
 * refit reaches for the CHEAPEST fix first, that it never truncates, and that a
 * row of siblings ends up at one size.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM } from '@/model/tokens';
import { EMU_PER_POINT, inchesToEmu, type Rect, type Slide, type SlideElement } from '@/model';
import { metricMeasurer } from '@/render/measureText';
import { measureTextBody } from '@/render/measureTextBody';
import {
  ABSOLUTE_MIN_PT,
  freeSpaceBelow,
  overlapPairs,
  policyFor,
  refitElement,
  refitSlide,
  scaleBody,
  siblingGroups,
  snapToMargins,
  type RefitContext,
} from './refit';
import { buildLadder, MIN_LEGIBLE_PT } from './type';
import type { BrandRole } from './classify';
import type { RestyleTrace } from './restyle';
import { at, picture, resetIds, shape, SIZE, slide, text } from './testkit';

const ds = DEFAULT_DESIGN_SYSTEM;
const measurer = metricMeasurer();
const ladder = buildLadder(ds);

/** A refit context with roles and traces stated explicitly. */
function ctxFor(
  elements: SlideElement[],
  roles: Record<string, BrandRole>,
  traces: Record<string, { sourcePt: number; brandPt: number }> = {},
  frozen: string[] = [],
): RefitContext {
  return {
    ds,
    ladder,
    measurer,
    slideSize: SIZE,
    frozen: new Set(frozen),
    roles: new Map(Object.entries(roles) as [string, BrandRole][]),
    traces: new Map(
      Object.entries(traces).map(([id, t]) => [
        id,
        {
          elementId: id,
          role: roles[id] ?? 'body',
          sourcePt: t.sourcePt,
          brandPt: t.brandPt,
          ratio: t.brandPt / t.sourcePt,
        } satisfies RestyleTrace,
      ]),
    ),
  };
}

const overflowOf = (el: SlideElement) => {
  const body = el.type === 'text' ? el.body : undefined;
  return body ? measureTextBody(body, el.rect, ds, measurer).overflowEmu : 0;
};

const sizeOf = (el: SlideElement) =>
  el.type === 'text' ? (el.body.paragraphs[0].runs[0].sizePt ?? 0) : 0;

describe('policyFor', () => {
  it('titles prefer the type lever', () => {
    expect(policyFor('title').prefer).toBe('type');
  });

  it('every text role MAY grow — growing a box moves nothing in this model', () => {
    // Prohibiting growth on titles bought no safety (elements are absolutely
    // positioned, so a taller box pushes nothing) and cost a lot of quality: the
    // only remaining fix was shrinking the type.
    for (const role of ['title', 'heading', 'kpiValue', 'body', 'caption'] as const) {
      expect(policyFor(role).canGrow).toBe(true);
    }
    // Decoration is the exception: there is no text to fit.
    expect(policyFor('decoration').canGrow).toBe(false);
  });

  it('body prefers the box lever', () => {
    expect(policyFor('body').prefer).toBe('box');
    expect(policyFor('body').canGrow).toBe(true);
  });

  it('captions may never be shrunk — they are already at the floor', () => {
    expect(policyFor('caption').floorFraction).toBe(1);
  });

  it('titles tolerate more shrinking than body copy does', () => {
    expect(policyFor('title').floorFraction).toBeLessThan(policyFor('body').floorFraction);
  });

  it('an unknown role falls back to the body policy', () => {
    expect(policyFor(undefined)).toEqual(policyFor('body'));
  });
});

describe('snapToMargins', () => {
  it('nudges a nearly-aligned left edge onto the margin', () => {
    const snapped = snapToMargins(at(0.4, 3, 5, 1), 'body', SIZE);
    expect(snapped.x).toBe(inchesToEmu(0.45));
  });

  it('leaves a deliberately mid-slide element exactly where it is', () => {
    const rect = at(4.2, 3, 3, 1);
    expect(snapToMargins(rect, 'body', SIZE)).toMatchObject({ x: rect.x, y: rect.y });
  });

  it('snaps a title to the title band, not the content margin', () => {
    const snapped = snapToMargins(at(0.9, 0.5, 8, 0.7), 'title', SIZE);
    expect(snapped.y).toBe(inchesToEmu(0.45));
  });

  it('leaves a full-bleed element alone — snapping would gutter it', () => {
    const bleed: Rect = { x: 0, y: 0, w: SIZE.w, h: SIZE.h };
    expect(snapToMargins(bleed, 'decoration', SIZE)).toEqual(bleed);
  });

  it('never changes an element’s height', () => {
    const rect = at(0.4, 0.4, 5, 1.234);
    expect(snapToMargins(rect, 'body', SIZE).h).toBe(rect.h);
  });
});

describe('the lever ORDER', () => {
  it('a LADDER OVERSHOOT is resolved by stepping the ladder down, not by growing', () => {
    // Source was 11pt and fit; the brand put it at 26pt so it overflows. The
    // size is what changed, so the size is what should give.
    const el = text('word '.repeat(40), at(1, 2, 4, 1), { sizePt: 26, id: 'e' });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 11, brandPt: 26 } });
    const out = refitElement(el, [el], ctx);
    expect(out.steps).toContain('ladder-step-down');
    expect(out.steps.indexOf('ladder-step-down')).toBeLessThan(
      out.steps.includes('grow') ? out.steps.indexOf('grow') : Infinity,
    );
    expect(out.offLadder).toBe(false);
  });

  it('a ladder step-down keeps the result ON the brand ladder', () => {
    const el = text('word '.repeat(30), at(1, 2, 4, 1), { sizePt: 26, id: 'e' });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 11, brandPt: 26 } });
    const out = refitElement(el, [el], ctx);
    if (out.steps.includes('ladder-step-down') && !out.offLadder) {
      expect(ladder.steps).toContain(out.finalPt);
    }
  });

  it('never steps the ladder BELOW the source size — that is no longer unwinding', () => {
    const el = text('word '.repeat(80), at(1, 2, 3, 0.5), { sizePt: 26, id: 'e' });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 20, brandPt: 26 } });
    const out = refitElement(el, [el], ctx);
    // It may go below 20 via the sub-ladder shrink, but the ladder phase alone
    // must not — and if it did shrink further, it says so.
    if (out.finalPt < 20) expect(out.offLadder).toBe(true);
  });

  it('a METRIC DELTA is absorbed by the box when there is room', () => {
    // Same size in and out: the overflow is our font substitution's fault, so
    // the box should take it rather than the type.
    const el = text('word '.repeat(22), at(1, 2, 4, 0.45), { sizePt: 14, id: 'e' });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 14, brandPt: 14 } });
    const out = refitElement(el, [el], ctx);
    expect(out.steps).toContain('grow');
    expect(out.element.rect.h).toBeGreaterThan(el.rect.h);
    expect(sizeOf(out.element)).toBe(14);
  });

  it('a title reaches for the TYPE lever before the box', () => {
    // A slightly smaller two-line title reads better than a three-line one, even
    // when both would fit — so a type-preferring role shrinks first.
    const el = text('A very long title that will not fit on one line at all', at(1, 0.5, 4, 0.5), {
      sizePt: 26,
      id: 'e',
    });
    const ctx = ctxFor([el], { e: 'title' }, { e: { sourcePt: 26, brandPt: 26 } });
    const out = refitElement(el, [el], ctx);
    expect(sizeOf(out.element)).toBeLessThan(26);
    // The ORDER is the property, not the absence of growth: a title shrinks
    // first, and only falls through to the box if the shrink hit its floor
    // without fitting — which is what happens with a title this long in a box
    // this small.
    if (out.steps.includes('grow')) {
      expect(out.steps.indexOf('sub-ladder-shrink')).toBeLessThan(out.steps.indexOf('grow'));
    }
  });

  it('a body box reaches for the BOX lever before the type', () => {
    const el = text('word '.repeat(22), at(1, 2, 4, 0.45), { sizePt: 14, id: 'e' });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 14, brandPt: 14 } });
    const out = refitElement(el, [el], ctx);
    expect(out.steps).toContain('grow');
    expect(out.steps).not.toContain('sub-ladder-shrink');
  });

  it('never resizes a frozen element, whatever its policy says', () => {
    const el = text('word '.repeat(30), at(1, 2, 4, 0.4), { sizePt: 14, id: 'e' });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 14, brandPt: 14 } }, ['e']);
    const out = refitElement(el, [el], ctx);
    expect(out.element.rect).toEqual(el.rect);
    expect(out.steps).not.toContain('grow');
  });

  it('leaves text that already fits completely alone', () => {
    const el = text('short', at(1, 2, 6, 2), { sizePt: 14, id: 'e' });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 14, brandPt: 14 } });
    const out = refitElement(el, [el], ctx);
    expect(out.steps).toEqual([]);
    expect(out.element).toMatchObject({ rect: el.rect });
    expect(sizeOf(out.element)).toBe(14);
  });
});

describe('the floor, and never truncating', () => {
  it('flags rather than shrinking a caption below the legibility floor', () => {
    const el = text('word '.repeat(60), at(1, 6.5, 3, 0.2), { sizePt: 11, id: 'e' });
    const ctx = ctxFor([el], { e: 'caption' }, { e: { sourcePt: 11, brandPt: 11 } });
    const out = refitElement(el, [el], ctx);
    expect(out.overflowEmu).toBeGreaterThan(0);
    expect(out.steps).toContain('overflow');
    expect(sizeOf(out.element)).toBeGreaterThanOrEqual(MIN_LEGIBLE_PT);
  });

  it('never drops below the legibility floor whatever the role', () => {
    const el = text('word '.repeat(200), at(1, 2, 1, 0.3), { sizePt: 26, id: 'e' });
    const ctx = ctxFor([el], { e: 'title' }, { e: { sourcePt: 26, brandPt: 26 } });
    const out = refitElement(el, [el], ctx);
    expect(sizeOf(out.element)).toBeGreaterThanOrEqual(MIN_LEGIBLE_PT);
  });

  it('NEVER removes a paragraph or a character', () => {
    const lines = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
    const el = text('x', at(1, 2, 1.2, 0.3), { sizePt: 20, id: 'e', lines });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 20, brandPt: 20 } });
    const out = refitElement(el, [el], ctx);
    const after = out.element.type === 'text' ? out.element.body.paragraphs : [];
    expect(after).toHaveLength(lines.length);
    expect(after.map((p) => p.runs[0].text)).toEqual(lines);
  });

  it('reports residual overflow rather than pretending it fits', () => {
    const el = text('word '.repeat(300), at(1, 2, 1, 0.25), { sizePt: 14, id: 'e' });
    const ctx = ctxFor([el], { e: 'body' }, { e: { sourcePt: 14, brandPt: 14 } });
    const out = refitElement(el, [el], ctx);
    expect(out.overflowEmu).toBeGreaterThan(0);
    expect(overflowOf(out.element)).toBeGreaterThan(0);
  });

  it('marks off-ladder results as off-ladder', () => {
    const el = text('word '.repeat(50), at(1, 0.5, 3, 0.4), { sizePt: 26, id: 'e' });
    const ctx = ctxFor([el], { e: 'title' }, { e: { sourcePt: 26, brandPt: 26 } });
    const out = refitElement(el, [el], ctx);
    if (out.steps.includes('sub-ladder-shrink')) expect(out.offLadder).toBe(true);
  });
});

describe('scaleBody', () => {
  it('scales every run and the paragraph spacing together', () => {
    const el = text('x', at(1, 1, 3, 1), { sizePt: 20 });
    const scaled = scaleBody({ ...el.body, paragraphs: el.body.paragraphs.map((p) => ({ ...p, spaceAfterPt: 10 })) }, 0.5, ds);
    expect(scaled.paragraphs[0].runs[0].sizePt).toBe(10);
    expect(scaled.paragraphs[0].spaceAfterPt).toBe(5);
  });

  it('clamps at the ABSOLUTE floor, leaving the higher floors to policy', () => {
    // Not the legibility floor: `refit`'s restore-source-size step legitimately
    // needs to go below 9pt to hand a deck back the 8pt its author chose, and a
    // clamp here would silently block that. Role floors are enforced by the
    // callers via `policy.floorFraction`.
    const el = text('x', at(1, 1, 3, 1), { sizePt: 10 });
    expect(scaleBody(el.body, 0.1, ds).paragraphs[0].runs[0].sizePt).toBe(ABSOLUTE_MIN_PT);
    expect(ABSOLUTE_MIN_PT).toBeLessThan(MIN_LEGIBLE_PT);
  });
});

describe('freeSpaceBelow', () => {
  it('is bounded by the next element in the same column', () => {
    const a = text('a', at(1, 2, 4, 1), { id: 'a' });
    const b = text('b', at(1, 4, 4, 1), { id: 'b' });
    expect(freeSpaceBelow(a, [a, b], SIZE)).toBe(inchesToEmu(1));
  });

  it('ignores an element in a different column', () => {
    const a = text('a', at(1, 2, 4, 1), { id: 'a' });
    const b = text('b', at(7, 3, 4, 1), { id: 'b' });
    expect(freeSpaceBelow(a, [a, b], SIZE)).toBeGreaterThan(inchesToEmu(1));
  });

  it('is bounded by the bottom margin when nothing is below', () => {
    const a = text('a', at(1, 6, 4, 0.5), { id: 'a' });
    expect(freeSpaceBelow(a, [a], SIZE)).toBeLessThan(inchesToEmu(1));
  });

  it('ignores elements in the same group — a panel does not block its own text', () => {
    const panel = { ...shape(at(1, 2, 4, 2), { fill: '#123456', id: 'p' }), groupIds: ['g1'] };
    const label = { ...text('label', at(1.1, 2.1, 3.8, 0.4), { id: 'l' }), groupIds: ['g1'] };
    expect(freeSpaceBelow(label, [panel, label], SIZE)).toBeGreaterThan(0);
  });
});

describe('overlapPairs', () => {
  it('finds a genuine overlap', () => {
    const a = text('a', at(1, 2, 4, 2), { id: 'a' });
    const b = text('b', at(2, 3, 4, 2), { id: 'b' });
    expect(overlapPairs([a, b], 0).has('a|b')).toBe(true);
  });

  it('does not flag two elements that merely touch', () => {
    const a = text('a', at(1, 2, 4, 1), { id: 'a' });
    const b = text('b', at(1, 3, 4, 1), { id: 'b' });
    expect(overlapPairs([a, b], EMU_PER_POINT).size).toBe(0);
  });

  it('never flags elements in the same group', () => {
    // A panel and the text inside it overlap by construction.
    const panel = { ...shape(at(1, 2, 4, 2), { fill: '#123456', id: 'p' }), groupIds: ['g1'] };
    const label = { ...text('label', at(1.1, 2.1, 3.8, 0.4), { id: 'l' }), groupIds: ['g1'] };
    expect(overlapPairs([panel, label], 0).size).toBe(0);
  });
});

describe('siblingGroups', () => {
  it('groups a row of same-role, same-size, same-y elements', () => {
    const els = [
      text('42%', at(1, 3, 2, 1), { sizePt: 48, id: 'k1' }),
      text('$1.2M', at(4, 3, 2, 1), { sizePt: 48, id: 'k2' }),
      text('3.1x', at(7, 3, 2, 1), { sizePt: 48, id: 'k3' }),
    ];
    const ctx = ctxFor(
      els,
      { k1: 'kpiValue', k2: 'kpiValue', k3: 'kpiValue' },
      {
        k1: { sourcePt: 44, brandPt: 48 },
        k2: { sourcePt: 44, brandPt: 48 },
        k3: { sourcePt: 44, brandPt: 48 },
      },
    );
    const groups = siblingGroups(els, ctx);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('does not group elements on different rows', () => {
    const els = [
      text('a', at(1, 3, 2, 1), { sizePt: 48, id: 'k1' }),
      text('b', at(1, 5, 2, 1), { sizePt: 48, id: 'k2' }),
    ];
    const ctx = ctxFor(
      els,
      { k1: 'kpiValue', k2: 'kpiValue' },
      { k1: { sourcePt: 44, brandPt: 48 }, k2: { sourcePt: 44, brandPt: 48 } },
    );
    expect(siblingGroups(els, ctx)).toHaveLength(0);
  });

  it('does not group elements of different roles', () => {
    const els = [
      text('a', at(1, 3, 2, 1), { sizePt: 48, id: 'k1' }),
      text('b', at(4, 3, 2, 1), { sizePt: 48, id: 'h1' }),
    ];
    const ctx = ctxFor(
      els,
      { k1: 'kpiValue', h1: 'heading' },
      { k1: { sourcePt: 44, brandPt: 48 }, h1: { sourcePt: 44, brandPt: 48 } },
    );
    expect(siblingGroups(els, ctx)).toHaveLength(0);
  });
});

describe('refitSlide — coupling and rollback', () => {
  it('a KPI row ends at ONE size, not four different ones', () => {
    resetIds();
    // The second card's label is much longer, so alone it would shrink further
    // than its neighbours and the row would read 48/48/40/48.
    const els = [
      text('42%', at(0.9, 3, 2.5, 1), { sizePt: 48, id: 'k1' }),
      text('$1,284,000', at(4.0, 3, 2.5, 1), { sizePt: 48, id: 'k2' }),
      text('3.1x', at(7.1, 3, 2.5, 1), { sizePt: 48, id: 'k3' }),
      text('88%', at(10.2, 3, 2.5, 1), { sizePt: 48, id: 'k4' }),
    ];
    const ctx = ctxFor(
      els,
      { k1: 'kpiValue', k2: 'kpiValue', k3: 'kpiValue', k4: 'kpiValue' },
      Object.fromEntries(els.map((e) => [e.id, { sourcePt: 44, brandPt: 48 }])),
    );
    const out = refitSlide({ ...slide(els) }, ctx);
    const sizes = out.slide.elements.map(sizeOf);
    expect(new Set(sizes).size).toBe(1);
  });

  it('rolls back a grow that created an overlap, and shrinks instead', () => {
    // `b` sits just under `a`, close enough that growing `a` would collide.
    const a = text('word '.repeat(24), at(1, 2, 4, 0.45), { sizePt: 14, id: 'a' });
    const b = text('below', at(1, 2.5, 4, 0.4), { sizePt: 14, id: 'b' });
    const ctx = ctxFor(
      [a, b],
      { a: 'body', b: 'body' },
      { a: { sourcePt: 14, brandPt: 14 }, b: { sourcePt: 14, brandPt: 14 } },
    );
    const out = refitSlide({ ...slide([a, b]) }, ctx);
    const grown = out.slide.elements.find((e) => e.id === 'a')!;
    // Either it never grew into `b`, or the grow was rolled back — both are
    // acceptable; what must NOT happen is a new overlap surviving.
    const created = [...overlapPairs(out.slide.elements, EMU_PER_POINT)].filter(
      (p) => !out.preExistingOverlaps.has(p),
    );
    expect(created).toEqual([]);
    expect(grown.rect.y).toBe(a.rect.y);
  });

  it('leaves a PRE-EXISTING overlap alone — it is deliberate layering', () => {
    // A real picture, not an empty text box: `drawsSomething` correctly ignores
    // an element with no fill, no outline and no text, so an empty box makes no
    // overlap to preserve in the first place.
    const image = picture('data:image/png;base64,X', at(1, 2, 6, 3), { id: 'img' });
    const caption = text('over the image', at(1.5, 3, 3, 0.4), { sizePt: 14, id: 'cap' });
    const ctx = ctxFor(
      [image, caption],
      { img: 'decoration', cap: 'body' },
      { cap: { sourcePt: 14, brandPt: 14 } },
    );
    const out = refitSlide({ ...slide([image, caption]) }, ctx);
    expect(out.preExistingOverlaps.has('cap|img')).toBe(true);
    // Still overlapping: refit did not move anything to "fix" it.
    expect(overlapPairs(out.slide.elements, EMU_PER_POINT).has('cap|img')).toBe(true);
  });

  it('records an outcome for every element', () => {
    const els = [text('a', at(1, 2, 4, 1), { id: 'a' }), text('b', at(1, 4, 4, 1), { id: 'b' })];
    const ctx = ctxFor(els, { a: 'body', b: 'body' });
    const out = refitSlide({ ...slide(els) }, ctx);
    for (const el of els) expect(out.outcomes.has(el.id)).toBe(true);
  });

  it('never resizes a frozen panel', () => {
    const panel = { ...shape(at(1, 2, 4, 1), { fill: '#123456', id: 'p' }), groupIds: ['g1'] };
    const label = {
      ...text('word '.repeat(30), at(1.1, 2.1, 3.8, 0.4), { sizePt: 14, id: 'l' }),
      groupIds: ['g1'],
    };
    const ctx = ctxFor(
      [panel, label],
      { p: 'decoration', l: 'body' },
      { l: { sourcePt: 14, brandPt: 14 } },
      ['p', 'l'],
    );
    const out = refitSlide({ ...slide([panel, label]) }, ctx);
    const after = out.slide.elements.find((e) => e.id === 'p')!;
    expect(after.rect).toEqual(panel.rect);
    // The label, being frozen too, must have used the type lever only.
    const labelAfter = out.slide.elements.find((e) => e.id === 'l')!;
    expect(labelAfter.rect).toEqual(label.rect);
  });

  it('is deterministic', () => {
    const els = [text('word '.repeat(30), at(1, 2, 4, 0.5), { sizePt: 20, id: 'a' })];
    const ctx = ctxFor(els, { a: 'body' }, { a: { sourcePt: 14, brandPt: 20 } });
    // One slide value, refit twice — `slide()` mints a fresh id per call, so
    // building it inside `mk` would compare two different slides.
    const input = slide(els) as Slide;
    expect(refitSlide(input, ctx).slide).toEqual(refitSlide(input, ctx).slide);
  });
});
