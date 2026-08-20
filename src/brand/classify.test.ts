import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM } from '@/model/tokens';
import {
  AMBIGUOUS,
  buildRoleMap,
  classifyElement,
  classifySlide,
  isChromeRole,
  typeRoleFor,
} from './classify';
import { surveyDeck } from './survey';
import { at, picture, resetIds, shape, SIZE, slide, sourceDeck, text } from './testkit';
import type { Slide } from '@/model';

const ds = DEFAULT_DESIGN_SYSTEM;
const prep = (slides: Slide[]) => {
  const survey = surveyDeck(slides, SIZE, ds);
  return { survey, roles: buildRoleMap(survey) };
};

/** The role assigned to the element with this id, on this slide. */
const roleOn = (slides: Slide[], slideIndex: number, elementId: string) => {
  const { survey, roles } = prep(slides);
  const el = slides[slideIndex].elements.find((e) => e.id === elementId)!;
  return classifyElement(el, survey, roles, ds);
};

describe('typeRoleFor', () => {
  it('maps the six built-ins to themselves', () => {
    for (const r of ['title', 'subtitle', 'heading', 'body', 'caption', 'kpiValue'] as const) {
      expect(typeRoleFor(r)).toBe(r);
    }
  });

  it('sets eyebrows and chrome text at caption size', () => {
    expect(typeRoleFor('eyebrow')).toBe('caption');
    expect(typeRoleFor('chrome.footer')).toBe('caption');
  });
});

describe('isChromeRole', () => {
  it('recognizes exactly the three chrome roles', () => {
    expect(isChromeRole('chrome.logo')).toBe(true);
    expect(isChromeRole('chrome.pageNumber')).toBe(true);
    expect(isChromeRole('chrome.footer')).toBe(true);
    expect(isChromeRole('body')).toBe(false);
    expect(isChromeRole(undefined)).toBe(false);
  });
});

describe('buildRoleMap — the deck-wide agreement', () => {
  it('gives the deck’s largest title-band size the title role', () => {
    const { roles } = prep(sourceDeck(6));
    // 40pt is the title slide's headline; 28pt the section headings.
    expect(roles.bySize.get(40)).toBe('title');
  });

  it('gives footer-band sizes the caption role whatever their rank', () => {
    const { roles } = prep(sourceDeck(6));
    expect(roles.bySize.get(9)).toBe('caption');
  });

  it('assigns exactly one role per size — the consistency guarantee', () => {
    const { survey, roles } = prep(sourceDeck(8));
    for (const stat of survey.sizes) expect(roles.bySize.has(stat.sizePt)).toBe(true);
    // A Map cannot hold two values for a key, so this is structural — but assert
    // the count so a future refactor to an array of pairs can't break it.
    expect(roles.bySize.size).toBe(new Set(survey.sizes.map((s) => s.sizePt)).size);
  });

  it('is stable under slide reordering', () => {
    const slides = sourceDeck(6);
    const forward = prep(slides).roles;
    const reversed = prep([...slides].reverse()).roles;
    expect([...reversed.bySize.entries()].sort()).toEqual([...forward.bySize.entries()].sort());
  });

  it('calls the largest size a KPI when it lives in the content area, not a title', () => {
    // A metrics slide's 44pt numbers are the biggest type in the deck but they
    // are not titles, and blowing them up as titles would be wrong.
    const slides = [
      slide([
        text('Performance', at(0.9, 0.5, 8, 0.6), { sizePt: 20 }),
        text('42%', at(1, 3, 2, 1), { sizePt: 44 }),
        text('$1.2M', at(4, 3, 2, 1), { sizePt: 44 }),
      ]),
    ];
    expect(prep(slides).roles.bySize.get(44)).toBe('kpiValue');
  });
});

describe('classifyElement — chrome takes priority', () => {
  it('marks the repeated footer logo as chrome.logo', () => {
    const slides = sourceDeck(6);
    const logo = slides[1].elements.find((e) => e.type === 'picture')!;
    expect(roleOn(slides, 1, logo.id).role).toBe('chrome.logo');
  });

  it('marks the page number as chrome.pageNumber', () => {
    const slides = sourceDeck(6);
    const { survey } = prep(slides);
    const pn = slides[1].elements.find((e) => survey.pageNumberElementIds.includes(e.id))!;
    expect(roleOn(slides, 1, pn.id).role).toBe('chrome.pageNumber');
  });

  it('marks the repeated confidentiality line as chrome.footer', () => {
    const slides = sourceDeck(6);
    const footer = slides[1].elements.find((e) =>
      e.type === 'text' && JSON.stringify(e.body).includes('Confidential'),
    )!;
    expect(roleOn(slides, 1, footer.id).role).toBe('chrome.footer');
  });
});

describe('classifyElement — local overrides', () => {
  it('reads a short all-caps line as an eyebrow even at body size', () => {
    resetIds();
    const kicker = text('WHY NOW', at(0.9, 0.5, 3, 0.3), { sizePt: 14, caps: true, id: 'k1' });
    const slides = [slide([kicker, text('body copy here', at(0.9, 2, 5, 2), { sizePt: 14 })])];
    expect(roleOn(slides, 0, 'k1').role).toBe('eyebrow');
  });

  it('reads a large bare number as a KPI', () => {
    const slides = [
      slide([
        text('Revenue', at(0.9, 0.5, 5, 0.5), { sizePt: 14 }),
        text('$4.2M', at(1, 3, 2, 1), { sizePt: 44, id: 'kpi' }),
      ]),
    ];
    expect(roleOn(slides, 0, 'kpi').role).toBe('kpiValue');
  });

  it('does NOT read a small number as a KPI', () => {
    // A 10pt "12" is a table cell or a footnote marker, not a headline stat.
    const slides = [
      slide([
        text('lots of body copy here to set the scale', at(0.9, 2, 5, 2), { sizePt: 14 }),
        text('12', at(1, 5, 0.4, 0.2), { sizePt: 10, id: 'cell' }),
      ]),
    ];
    expect(roleOn(slides, 0, 'cell').role).not.toBe('kpiValue');
  });

  it('reads bulleted text as body however large it is set', () => {
    const slides = [
      slide([
        text('x', at(0.9, 0.5, 5, 0.5), { sizePt: 30 }),
        text('point', at(0.9, 2, 5, 2), { sizePt: 30, bullet: 'bullet', id: 'bul' }),
      ]),
    ];
    expect(roleOn(slides, 0, 'bul').role).toBe('body');
  });

  it('reads a picture as decoration', () => {
    const slides = [slide([picture('data:X', at(1, 1, 3, 3), { id: 'pic' })])];
    expect(roleOn(slides, 0, 'pic').role).toBe('decoration');
  });

  it('reads an unfilled shape with no text as decoration', () => {
    const slides = [slide([shape(at(1, 1, 3, 0.02), { id: 'rule' })])];
    expect(roleOn(slides, 0, 'rule').role).toBe('decoration');
  });

  it('flags low confidence when size and position disagree', () => {
    // A title-sized line sitting down in the content area: the deck-wide table
    // says title, the position says otherwise. Assign, but say it is uncertain.
    const slides = [
      slide([
        text('Big Heading Up Top', at(0.9, 0.5, 8, 0.7), { sizePt: 32 }),
        text('supporting', at(0.9, 1.4, 5, 0.4), { sizePt: 14 }),
      ]),
      slide([text('Stray Big Line', at(0.9, 4.5, 8, 0.7), { sizePt: 32, id: 'stray' })]),
    ];
    const got = roleOn(slides, 1, 'stray');
    expect(got.confidence).toBeLessThanOrEqual(AMBIGUOUS);
    expect(got.reason).toContain('band');
  });

  it('every element on every slide gets a role — assignment is total', () => {
    const slides = sourceDeck(8);
    const { survey, roles } = prep(slides);
    for (const s of slides) {
      const c = classifySlide(s, survey, roles, ds);
      for (const el of s.elements) expect(c.roles.has(el.id)).toBe(true);
    }
  });
});

describe('classifySlide — archetypes', () => {
  const archetypeOf = (s: Slide, all: Slide[] = [s]) => {
    const { survey, roles } = prep(all);
    return classifySlide(s, survey, roles, ds).archetype;
  };

  it('a big line plus a subtitle is a title slide', () => {
    const slides = sourceDeck(6);
    expect(archetypeOf(slides[0], slides)).toBe('title');
  });

  it('a big line with nothing under it is a section divider', () => {
    const slides = [
      slide([text('Part Two', at(0.9, 0.6, 8, 1), { sizePt: 40 })]),
      ...sourceDeck(4).slice(1),
    ];
    expect(archetypeOf(slides[0], slides)).toBe('section');
  });

  it('three or more stats is a metrics slide', () => {
    const s = slide([
      text('Highlights', at(0.9, 0.5, 8, 0.6), { sizePt: 20 }),
      text('42%', at(1, 3, 2, 1), { sizePt: 44 }),
      text('$1.2M', at(4, 3, 2, 1), { sizePt: 44 }),
      text('3.1x', at(7, 3, 2, 1), { sizePt: 44 }),
    ]);
    expect(archetypeOf(s)).toBe('metrics');
  });

  it('bulleted content is a list', () => {
    const s = slide([
      text('Agenda', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
      text('x', at(0.9, 2, 6, 3), {
        sizePt: 14,
        bullet: 'bullet',
        lines: ['One', 'Two', 'Three'],
      }),
    ]);
    expect(archetypeOf(s)).toBe('list');
  });

  it('a full-bleed picture is an image slide', () => {
    const s = slide([picture('data:X', { x: 0, y: 0, w: SIZE.w, h: SIZE.h })]);
    expect(archetypeOf(s)).toBe('image');
  });

  it('a slide with a chart is a chart slide, whatever else is on it', () => {
    const s: Slide = {
      ...slide([
        text('Revenue by quarter', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
        text('some supporting copy', at(0.9, 6, 6, 0.4), { sizePt: 12 }),
      ]),
      charts: [{ id: 'c1', groupId: 'g1', frame: at(1, 1.6, 10, 4), spec: {} as never }],
    };
    expect(archetypeOf(s)).toBe('chart');
  });

  it('repeated same-shape columns is a comparison', () => {
    const s = slide([
      text('Before vs after', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
      text('Before column of copy', at(0.9, 2, 5, 2.5), { sizePt: 14 }),
      text('After column of copy', at(6.5, 2, 5, 2.5), { sizePt: 14 }),
    ]);
    expect(archetypeOf(s)).toBe('comparison');
  });

  it('a lot of body copy is dense', () => {
    const s = slide([
      text('Detail', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
      text('x', at(0.9, 1.6, 11, 5), { sizePt: 12, lines: [ 'word '.repeat(250) ] }),
    ]);
    expect(archetypeOf(s)).toBe('dense');
  });

  it('gives every classification a reason', () => {
    const slides = sourceDeck(6);
    const { survey, roles } = prep(slides);
    for (const s of slides) {
      expect(classifySlide(s, survey, roles, ds).reason.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    const slides = sourceDeck(6);
    const { survey, roles } = prep(slides);
    const a = classifySlide(slides[1], survey, roles, ds);
    const b = classifySlide(slides[1], survey, roles, ds);
    expect({ ...a, roles: [...a.roles] }).toEqual({ ...b, roles: [...b.roles] });
  });
});
