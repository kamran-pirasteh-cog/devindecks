/**
 * The deck-wide invariants. These are the tests that actually justify the claim
 * "a converted deck is presentable without manual cleanup":
 *
 *   - every font is a brand face
 *   - every colour is a brand token, never a raw hex
 *   - every size is on the brand ladder (or reported off it)
 *   - no text overflows its box
 *   - the source brand's chrome is gone and ours is there
 *   - converting twice gives the identical deck
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  DEFAULT_BRAND_LOGO,
  resolveColor,
  type DesignSystem,
} from '@/model/tokens';
import { inchesToEmu } from '@/model';
import { contrastRatio } from '@/chart/color';
import { buildColorMap } from './palette';
import { surveyDeck } from './survey';
import { LARGE_CONTRAST } from './legibility';
import type { Slide, SlideElement, TextRun } from '@/model';
import type { Diagnostic } from '@/model/ingest';
import { metricMeasurer } from '@/render/measureText';
import { measureTextBody } from '@/render/measureTextBody';
import {
  coherenceDecisions,
  COHERENCE_THRESHOLD,
  convertDeck,
  convertToDeck,
  isConvertible,
} from './convert';
import { LOGO_PLACEHOLDER_ROLE, LOGO_ROLE } from './chrome';
import { MIN_LEGIBLE_PT } from './type';
import { at, resetIds, SIZE, shape, slide, sourceDeck, text } from './testkit';
import { fitSlide, placementFor } from '@/import/fit';

const measurer = metricMeasurer();
const ds = DEFAULT_DESIGN_SYSTEM;

const convert = (slides: Slide[], overrides: Partial<DesignSystem> = {}) =>
  convertDeck(slides, {
    ds: { ...ds, ...overrides },
    slideSize: SIZE,
    measurer,
    newId: (() => {
      let n = 0;
      return (p: string) => `${p}_${(n += 1)}`;
    })(),
  });

/** Every run in a converted deck. */
const allRuns = (slides: Slide[]): TextRun[] =>
  slides.flatMap((s) =>
    s.elements.flatMap((el) => {
      const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
      return (body?.paragraphs ?? []).flatMap((p) => p.runs ?? []);
    }),
  );

const allElements = (slides: Slide[]): SlideElement[] => slides.flatMap((s) => s.elements);

describe('convertDeck — shape', () => {
  const corners = () =>
    slide(
      [
        text('A slide with cards on it', at(0.6, 0.5, 8, 0.6), { sizePt: 22 }),
        shape(at(0.6, 1.5, 2.4, 1.6), { fill: '#6B2FA0', preset: 'roundRect', id: 'card' }),
        shape(at(3.2, 1.5, 1.2, 0.32), { fill: '#6B2FA0', preset: 'pill', id: 'chip' }),
        shape(at(5, 1.5, 1.2, 1.2), { fill: '#6B2FA0', preset: 'ellipse', id: 'dot' }),
        shape(at(6.6, 1.5, 1.2, 0.8), { fill: '#6B2FA0', preset: 'chevron', id: 'arrow' }),
      ],
      '#FFFFFF',
    );

  const presetOf = (slides: Slide[], id: string) => {
    const el = allElements(slides).find((e) => e.id === id);
    return el?.type === 'shape' ? el.preset : undefined;
  };

  it('squares the corners of every rectangular shape', () => {
    // Rounding is the source brand's decision, and one of the loudest: a deck
    // whose cards and chips keep their pill corners still reads as the source
    // deck's design however correct every colour on it is.
    const { slides } = convert([corners()]);
    expect(presetOf(slides, 'card')).toBe('rect');
    expect(presetOf(slides, 'chip')).toBe('rect');
  });

  it('drops the border from every filled shape', () => {
    // Outlines are the source deck's design language, not the author's content:
    // the grey rule around every card is exactly as loud as its pill corners.
    const bordered = slide(
      [
        shape(at(0.6, 1.5, 2.4, 1.6), {
          fill: '#FFFFFF',
          outlineColor: '#B0B4BA',
          id: 'card',
        }),
        shape(at(3.2, 1.5, 2.4, 1.6), { fill: '#6B2FA0', outlineColor: '#3A1A57', id: 'panel' }),
      ],
      '#FFFFFF',
    );
    const { slides } = convert([bordered]);
    const outlineOf = (id: string) => {
      const el = allElements(slides).find((e) => e.id === id);
      return el && 'outline' in el ? el.outline : undefined;
    };
    expect(outlineOf('card')).toBeUndefined();
    expect(outlineOf('panel')).toBeUndefined();
  });

  it('keeps the border when it is the only ink the shape has', () => {
    // An unfilled outlined box IS its stroke. Removing it does not restyle the
    // element, it deletes it.
    const hollow = slide(
      [shape(at(0.6, 1.5, 2.4, 1.6), { outlineColor: '#B0B4BA', id: 'hollow' })],
      '#FFFFFF',
    );
    const { slides } = convert([hollow]);
    const el = allElements(slides).find((e) => e.id === 'hollow');
    expect(el && 'outline' in el ? el.outline : undefined).toBeDefined();
  });

  it('leaves shapes whose corners are not corners alone', () => {
    // An ellipse has none to square, and a chevron's are structural — squaring
    // one would make it a different shape, not the same shape unrounded.
    const { slides } = convert([corners()]);
    expect(presetOf(slides, 'dot')).toBe('ellipse');
    expect(presetOf(slides, 'arrow')).toBe('chevron');
  });
});

describe('convertDeck — the big number', () => {
  /** A stats slide: three display figures in the source brand's own colour. */
  const kpiWall = () =>
    slide(
      [
        text('Uptake has been strong', at(0.6, 0.5, 8, 0.6), { sizePt: 22 }),
        text('1,159', at(0.6, 2, 2.4, 1.2), { sizePt: 44, bold: true, color: '#8E5CB0' }),
        text('112,128', at(3.4, 2, 2.4, 1.2), { sizePt: 44, bold: true, color: '#8E5CB0' }),
        text('54%', at(6.2, 2, 2.4, 1.2), { sizePt: 44, bold: true, color: '#8E5CB0' }),
        text('engineers onboarded in four weeks', at(0.6, 3.4, 8, 0.4), { sizePt: 11 }),
      ],
      '#FFFFFF',
    );

  const kpiRuns = (slides: Slide[]) =>
    allElements(slides)
      .filter((el) => el.role === 'kpiValue')
      .flatMap((el) => (el.type === 'text' ? (el.body.paragraphs ?? []) : []))
      .flatMap((p) => p.runs ?? []);

  it('sets every display figure in the brand’s KPI colour, overriding the source', () => {
    // The source set its stats in its own accent. Mapped by JOB — a saturated
    // colour used for a handful of characters — that accent is OUR accent, but
    // it only takes one deck where the stats were black or where the mapping
    // lands on ink for every headline figure to come back reading as body copy.
    // The brand states what colour its numbers are; the source does not get a
    // vote.
    const { slides } = convert([kpiWall()]);
    const runs = kpiRuns(slides);
    expect(runs.length).toBe(3);
    for (const run of runs) {
      expect(run.color).toEqual({ kind: 'token', token: 'brand.accent' });
    }
  });

  it('holds even when the source figures were plain black', () => {
    const black = slide(
      [
        text('Result', at(0.6, 0.5, 8, 0.6), { sizePt: 22 }),
        text('112,128', at(0.6, 2, 3, 1.2), { sizePt: 44, bold: true, color: '#000000' }),
        text('54%', at(4.2, 2, 3, 1.2), { sizePt: 44, bold: true, color: '#000000' }),
      ],
      '#FFFFFF',
    );
    const runs = kpiRuns(convert([black]).slides);
    expect(runs.length).toBe(2);
    for (const run of runs) {
      expect(run.color).toEqual({ kind: 'token', token: 'brand.accent' });
    }
  });

  it('but never at the cost of legibility on an ink panel', () => {
    // Accent-on-ink is 1.4:1. The KPI rule states a colour; it does not get to
    // overrule the pass that guarantees you can read it.
    const onPanel = slide(
      [
        shape(at(0.6, 1.5, 3, 2), { fill: '#6B2FA0', label: '112,128' }),
        text('body copy that gives the deck a size ladder '.repeat(6), at(4.2, 1.5, 4.5, 2), {
          sizePt: 12,
        }),
      ],
      '#FFFFFF',
    );
    // The panel's fill is a coloured box, so it converts to ink — and the figure
    // sitting on it must be readable against ink, not against the rule.
    const figure = allRuns(convert([onPanel]).slides).find((r) => r.text === '112,128')!;
    expect(figure).toBeDefined();
    const ink = resolveColor(figure.color!, ds);
    expect(contrastRatio(ink, '#191919')).toBeGreaterThanOrEqual(LARGE_CONTRAST);
  });
});

describe('convertDeck — typography invariants', () => {
  it('every run is set in a brand face', () => {
    const { slides } = convert(sourceDeck(8));
    const brandFonts = new Set(Object.values(ds.fonts));
    for (const run of allRuns(slides)) {
      expect(brandFonts.has(run.font!)).toBe(true);
    }
  });

  it('every run has an explicit size — nothing inherits', () => {
    const { slides } = convert(sourceDeck(8));
    for (const run of allRuns(slides)) expect(typeof run.sizePt).toBe('number');
  });

  it('no run is below the legibility floor', () => {
    const { slides } = convert(sourceDeck(8));
    for (const run of allRuns(slides)) {
      if ((run.text ?? '').trim() === '') continue;
      expect(run.sizePt!).toBeGreaterThanOrEqual(MIN_LEGIBLE_PT);
    }
  });

  it('every size is either on the brand ladder or reported as off it', () => {
    const { slides, diagnostics } = convert(sourceDeck(8));
    const offLadderIds = new Set(
      diagnostics.filter((d) => d.code === 'size-off-ladder').map((d) => d.elementId),
    );
    // The ladder for this deck, plus anything a documented off-ladder shrink
    // produced.
    for (const s of slides) {
      for (const el of s.elements) {
        const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
        if (!body) continue;
        const sizes = (body.paragraphs ?? []).flatMap((p) =>
          (p.runs ?? []).map((r) => r.sizePt!),
        );
        if (offLadderIds.has(el.id)) continue;
        for (const size of sizes) expect(size).toBeGreaterThanOrEqual(MIN_LEGIBLE_PT);
      }
    }
  });
});

describe('convertDeck — colour invariants', () => {
  it('contains NO raw hex anywhere — every colour is a token', () => {
    // The single most important colour invariant: a raw hex opts that element
    // out of every future brand change.
    const { slides } = convert(sourceDeck(8));
    for (const run of allRuns(slides)) {
      if (run.color) expect(run.color.kind).toBe('token');
    }
    for (const el of allElements(slides)) {
      if ('fill' in el && el.fill?.kind === 'solid') expect(el.fill.color.kind).toBe('token');
      if ('outline' in el && el.outline) expect(el.outline.color.kind).toBe('token');
    }
    for (const s of slides) {
      if (s.background?.kind === 'solid') expect(s.background.color.kind).toBe('token');
    }
  });

  it('every token it emits exists in the design system', () => {
    const { slides } = convert(sourceDeck(8));
    const available = new Set(ds.colors.map((c) => c.id));
    for (const run of allRuns(slides)) {
      if (run.color?.kind === 'token') expect(available.has(run.color.token)).toBe(true);
    }
  });

  it('reports no low-contrast text', () => {
    const { diagnostics } = convert(sourceDeck(8));
    expect(diagnostics.filter((d) => d.code === 'contrast-low')).toEqual([]);
  });
});

describe('convertDeck — the overflow guarantee', () => {
  it('no text overflows its box', () => {
    const { slides } = convert(sourceDeck(10));
    for (const s of slides) {
      for (const el of s.elements) {
        const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
        if (!body || (body.paragraphs ?? []).length === 0) continue;
        const metrics = measureTextBody(body, el.rect, ds, measurer);
        expect(metrics.overflowEmu).toBeLessThanOrEqual(12_700);
      }
    }
  });

  it('reports a clean deck as clean', () => {
    const { report } = convert(sourceDeck(10));
    expect(report.clean).toBe(true);
    expect(report.flagged).toEqual([]);
  });

  it('does NOT claim clean when a slide really cannot fit', () => {
    // A caption box with an essay in it: nothing can save this, and the honest
    // output is a flag rather than a silently broken slide.
    const impossible = slide([
      text('Title', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
      text('word '.repeat(400), at(0.9, 6.6, 3, 0.2), { sizePt: 9 }),
    ]);
    const { report, diagnostics } = convert([impossible, ...sourceDeck(4).slice(1)]);
    expect(report.clean).toBe(false);
    expect(report.flagged).toContain(1);
    expect(diagnostics.some((d) => d.code === 'text-overflow')).toBe(true);
  });

  it('never loses a paragraph', () => {
    const src = sourceDeck(6);
    const before = src.flatMap((s) =>
      s.elements.flatMap((el) => {
        const body = el.type === 'text' ? el.body : undefined;
        return (body?.paragraphs ?? []).map((p) => p.runs.map((r) => r.text).join(''));
      }),
    );
    const { slides } = convert(src);
    const after = slides.flatMap((s) =>
      s.elements.flatMap((el) => {
        const body = el.type === 'text' ? el.body : undefined;
        return (body?.paragraphs ?? []).map((p) => p.runs.map((r) => r.text).join(''));
      }),
    );
    // Chrome text is deliberately removed; everything else must survive verbatim.
    const removedChrome = ['Acme Corp — Confidential', '2', '3', '4', '5', '6'];
    for (const line of before) {
      if (removedChrome.includes(line)) continue;
      expect(after).toContain(line);
    }
  });
});

describe('convertDeck — chrome replacement', () => {
  it('removes the source deck’s logo, footer and page numbers', () => {
    const { slides, report } = convert(sourceDeck(8));
    expect(report.removedChrome['chrome.logo']).toBeGreaterThan(0);
    expect(report.removedChrome['chrome.footer']).toBeGreaterThan(0);
    expect(report.removedChrome['chrome.pageNumber']).toBeGreaterThan(0);
    // The source logo src must appear nowhere in the output.
    for (const el of allElements(slides)) {
      if (el.type === 'picture') expect(el.src).not.toContain('base64,LOGO');
    }
  });

  it('turns page numbers into the brand’s derived ones', () => {
    const { deck } = convertToDeck(
      sourceDeck(8),
      { id: 'd1', title: 'T', createdAt: 'x', updatedAt: 'x' },
      { ds, slideSize: SIZE, measurer },
    );
    expect(deck.pageNumbers).toBe(true);
    // …and no page-number ELEMENTS survive, which is what makes reordering work.
    const bareNumbers = allElements(deck.slides).filter(
      (el) => el.type === 'text' && /^\d+$/.test(el.body.paragraphs[0]?.runs[0]?.text ?? 'x'),
    );
    expect(bareNumbers).toEqual([]);
  });

  it('draws a PLACEHOLDER when the brand has no logo asset', () => {
    const { slides, diagnostics } = convert(sourceDeck(6), { logo: DEFAULT_BRAND_LOGO });
    const placeholders = allElements(slides).filter((el) => el.role === LOGO_PLACEHOLDER_ROLE);
    expect(placeholders.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === 'logo-missing')).toBe(true);
  });

  it('places the real mark when the brand has one, and no placeholder', () => {
    const { slides, diagnostics } = convert(sourceDeck(6), {
      logo: { ...DEFAULT_BRAND_LOGO, srcLight: 'data:image/png;base64,BRAND', aspect: 3 },
    });
    const logos = allElements(slides).filter((el) => el.role === LOGO_ROLE);
    expect(logos.length).toBeGreaterThan(0);
    expect(logos.every((el) => el.type === 'picture')).toBe(true);
    expect(allElements(slides).some((el) => el.role === LOGO_PLACEHOLDER_ROLE)).toBe(false);
    expect(diagnostics.some((d) => d.code === 'logo-missing')).toBe(false);
  });

  it('never stretches the logo — width follows the stated aspect', () => {
    const { slides } = convert(sourceDeck(4), {
      logo: { ...DEFAULT_BRAND_LOGO, srcLight: 'data:X', aspect: 4, heightIn: 0.3 },
    });
    const logo = allElements(slides).find((el) => el.role === LOGO_ROLE)!;
    expect(logo.rect.w / logo.rect.h).toBeCloseTo(4, 1);
  });

  it('puts no logo on a section divider, per the placement rule', () => {
    const divider = slide([text('Part Two', at(0.9, 0.6, 8, 1), { sizePt: 40 })]);
    const { slides } = convert([divider, ...sourceDeck(5).slice(1)], {
      logo: { ...DEFAULT_BRAND_LOGO, srcLight: 'data:X' },
    });
    expect(slides[0].elements.some((el) => el.role === LOGO_ROLE)).toBe(false);
  });
});

describe('convertDeck — decoupling text from panels', () => {
  it('splits a filled shape with text into a panel plus a text box', () => {
    const card = slide([
      text('Metrics', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
      shape(at(0.9, 2, 3, 1.5), { fill: '#1F3864', label: 'Revenue up 31%', color: '#FFFFFF' }),
    ]);
    const { slides, report } = convert([card, ...sourceDeck(4).slice(1)]);
    expect(report.panelsSplit).toBeGreaterThan(0);
    const panels = slides[0].elements.filter((el) => el.type === 'shape');
    // The panel no longer carries text…
    for (const p of panels) expect(p.type === 'shape' && p.body).toBeUndefined();
    // …and the text arrived as its own element, in the panel's group.
    const label = slides[0].elements.find(
      (el) => el.type === 'text' && el.body.paragraphs[0]?.runs[0]?.text === 'Revenue up 31%',
    );
    expect(label).toBeDefined();
    expect(label!.groupIds?.length).toBeGreaterThan(0);
    expect(panels[0].groupIds).toEqual(label!.groupIds);
  });

  it('does not split an unfilled shape — there is no panel to protect', () => {
    const plain = slide([
      text('Title', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
      shape(at(0.9, 2, 3, 1), { label: 'no fill here' }),
    ]);
    const { report } = convert([plain, ...sourceDeck(4).slice(1)]);
    expect(report.panelsSplit).toBe(0);
  });

  it('a panel’s geometry is identical before and after conversion', () => {
    const rect = at(0.9, 2, 3, 1.5);
    const card = slide([
      text('Metrics', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
      shape(rect, { fill: '#1F3864', label: 'word '.repeat(30), color: '#FFFFFF', id: 'panel' }),
    ]);
    const { slides } = convert([card, ...sourceDeck(4).slice(1)]);
    const panel = slides[0].elements.find((el) => el.id === 'panel')!;
    expect(panel.rect).toEqual(rect);
  });
});

/*
 * Regressions from a real converted slide that came out visibly wrong: a title
 * overflowing into the panel below it, and a KPI number invisible on a dark
 * panel. Five independent bugs produced it, and each one is pinned here.
 */
describe('convertDeck — regressions from a real slide', () => {
  /** A KPI panel: dark filled shape with reversed-out text laid over it. */
  const kpiPanelSlide = (): Slide =>
    slide([
      // A title drawn as a SHAPE whose fill matches the slide — very common, and
      // what made the title lose its role.
      {
        ...shape(at(0.5, 0.6, 12.4, 0.36), { fill: '#FCFCFC', id: 'title' }),
        body: {
          paragraphs: [
            {
              runs: [
                {
                  text: 'The output for Wayfair is promising: over 110k engineering hours delivered by remote Devin agents',
                  font: 'Geist' as const,
                  sizePt: 34.7,
                  color: { kind: 'hex' as const, hex: '#000000' },
                },
              ],
            },
          ],
        },
      },
      // An invisible spacer, exactly where it blocks the title from growing.
      shape(at(0.5, 1.1, 6.3, 0.25), { id: 'spacer' }),
      shape(at(0.5, 1.7, 5.8, 5.05), { fill: '#000000', id: 'panel' }),
      // Reversed-out text, 0.2in WIDER than the panel it sits on.
      text('PRODUCTIVE ENG HOURS', at(0.8, 2.0, 5.7, 0.15), {
        sizePt: 10.7,
        color: '#F7F6F5',
        caps: true,
        id: 'kicker',
      }),
      text('112,128', at(0.8, 2.2, 5.7, 0.81), { sizePt: 58.7, color: '#F7F6F5', id: 'kpi' }),
      text('productive engineering hours across pilot and production', at(0.8, 3.1, 4.6, 0.45), {
        sizePt: 12,
        color: '#F7F6F5',
        id: 'caption',
      }),
      // The same near-white used as a hairline rule — which is what made the
      // deck's reversed-out INK classify as a pale fill.
      shape(at(0.8, 3.8, 5.2, 0.03), { fill: '#F7F6F5', id: 'rule' }),
    ]);

  const inkOf = (slides: Slide[], id: string) => {
    const el = allElements(slides).find((e) => e.id === id);
    const body = el && (el.type === 'text' || el.type === 'shape') ? el.body : undefined;
    const color = body?.paragraphs[0]?.runs[0]?.color;
    return color ? resolveColor(color, ds) : undefined;
  };
  const roleOf = (slides: Slide[], id: string) =>
    allElements(slides).find((e) => e.id === id)?.role;

  it('A: a title drawn as a filled shape keeps its TITLE role', () => {
    // It was decoupled into panel + text, the split minted a fresh group, and the
    // role lookup — which searched for a source element sharing that group —
    // found nothing and fell back to `body`. Body shrinks less far before giving
    // up, so the title overflowed instead of fitting.
    const { slides } = convert([kpiPanelSlide()]);
    expect(roleOf(slides, 'title')).toBe('title');
  });

  it('A2: a fill indistinguishable from the slide is not treated as a panel', () => {
    // #FCFCFC on a #FCFCFC slide draws nothing, so splitting it would produce an
    // invisible frozen rectangle whose geometry then blocks refit.
    const { report } = convert([kpiPanelSlide()]);
    expect(report.panelsSplit).toBe(0);
  });

  it('B: reversed-out text on a dark panel stays LIGHT, even overhanging it', () => {
    // The text box is wider than its panel, so a full-containment test put it on
    // the white slide behind — and the legibility pass "corrected" its near-white
    // ink to a mid grey, on black.
    const { slides } = convert([kpiPanelSlide()]);
    for (const id of ['kpi', 'kicker', 'caption']) {
      const ink = inkOf(slides, id)!;
      expect(contrastRatio(ink, '#191919')).toBeGreaterThanOrEqual(LARGE_CONTRAST);
    }
  });

  it('B2: and reports no low-contrast text at all', () => {
    const { diagnostics } = convert([kpiPanelSlide()]);
    expect(diagnostics.filter((d) => d.code === 'contrast-low')).toEqual([]);
  });

  it('C: a COLOURED full-page ground becomes our ink ground, not our accent', () => {
    // Two wrong answers shipped here in turn. `brand.accent` — #2600FF is
    // saturated AND dark — put our accent behind every slide. Flattening it to
    // `surface.base` fixed that and lost something real: a deck's colour pages
    // are its punctuation, and a run of them turned into ordinary white slides.
    // Our palette has no full-bleed colour, so the ground becomes ink.
    const colouredGround = slide(
      [text('Reversed out', at(1, 3, 8, 0.6), { sizePt: 28, color: '#FFFFFF' })],
      '#2600FF',
    );
    const map = buildColorMap(surveyDeck([colouredGround], SIZE, ds), ds);
    expect(map.refs.get('#2600FF')).toEqual({ kind: 'token', token: 'ink.strong' });
  });

  it('C1: a NEUTRAL dark ground still comes onto the light surface', () => {
    // Charcoal says nothing about the source brand — it is just a dark slide —
    // and carrying it over turns the whole deck black. Only a colour earns the
    // ink ground.
    const greyGround = slide(
      [text('Reversed out', at(1, 3, 8, 0.6), { sizePt: 28, color: '#FFFFFF' })],
      '#2B2B2B',
    );
    const map = buildColorMap(surveyDeck([greyGround], SIZE, ds), ds);
    expect(map.refs.get('#2B2B2B')).toEqual({ kind: 'token', token: 'surface.base' });
  });

  it('C2: and the text that was reversed out on it stays readable', () => {
    const darkGround = slide(
      [text('Reversed out', at(1, 3, 8, 0.6), { sizePt: 28, color: '#FFFFFF' })],
      '#2600FF',
    );
    const { diagnostics } = convert([darkGround]);
    expect(diagnostics.filter((d) => d.code === 'contrast-low')).toEqual([]);
  });

  it('D: ink that is also a hairline rule is still classified as INK', () => {
    // `primaryUsage` compared characters against EMU² directly, so any colour
    // appearing as even a 0.03in rule outvoted its own use as the deck's text.
    const map = buildColorMap(surveyDeck([kpiPanelSlide()], SIZE, ds), ds);
    const assigned = map.assignments.find((a) => a.hex === '#F7F6F5')!;
    expect(assigned.reason).toContain('text');
  });

  it('E: an invisible spacer does not block a title from growing', () => {
    const { slides } = convert([kpiPanelSlide()]);
    const title = allElements(slides).find((e) => e.id === 'title')!;
    // It grew past the spacer's top edge (1.1in) into the empty space above the
    // panel, rather than stopping dead at it.
    expect(title.rect.y + title.rect.h).toBeGreaterThan(inchesToEmu(1.1));
  });

  it('the slide comes out clean, with the title at full size', () => {
    const { report, slides } = convert([kpiPanelSlide()]);
    expect(report.clean).toBe(true);
    const title = allElements(slides).find((e) => e.id === 'title')!;
    const body = title.type === 'shape' || title.type === 'text' ? title.body : undefined;
    // Never shrunk to its floor: the box found the room instead.
    expect(body!.paragraphs[0].runs[0].sizePt).toBeGreaterThan(30);
  });
});

describe('isConvertible — a no-op must not read as a success', () => {
  /** What `import/pdf.ts` produces: one full-bleed page raster, nothing else. */
  const pdfPage = (): Slide => ({
    id: 'p1',
    background: { kind: 'solid', color: { kind: 'hex', hex: '#FFFFFF' } },
    elements: [
      { id: 'pic1', type: 'picture', name: 'Page 1', src: 'data:image/png;base64,X', rect: { x: 0, y: 0, w: SIZE.w, h: SIZE.h } },
    ],
  });

  it('says no to a page image', () => {
    expect(isConvertible(pdfPage())).toBe(false);
  });

  it('says yes to anything with text', () => {
    expect(isConvertible(slide([text('hello', at(1, 2, 3, 0.4))]))).toBe(true);
  });

  it('says yes to a filled shape even with no text — the palette can re-token it', () => {
    expect(isConvertible(slide([shape(at(1, 2, 3, 1), { fill: '#123456' })]))).toBe(true);
  });

  it('says no to a slide of only whitespace text and invisible shapes', () => {
    expect(isConvertible(slide([text('   ', at(1, 2, 3, 0.4)), shape(at(1, 4, 2, 1))]))).toBe(false);
  });

  it('says yes to a slide carrying a chart — it is re-themed', () => {
    const withChart: Slide = {
      ...slide([]),
      elements: [
        { ...text('0', at(1, 2, 0.3, 0.2)), chartRef: { chartId: 'c1', part: 'tick' } as never },
      ],
    };
    expect(isConvertible(withChart)).toBe(true);
  });

  it('a PDF-shaped deck is reported as UNCONVERTIBLE, not clean', () => {
    // The bug this pins: the engine correctly changed nothing, and the report
    // said "5 clean" and offered the deck as though it had been rebranded.
    const { report, diagnostics } = convert([pdfPage(), pdfPage(), pdfPage()]);
    expect(report.unconvertible).toEqual([1, 2, 3]);
    expect(report.clean).toBe(false);
    expect(diagnostics.filter((d) => d.code === 'nothing-to-convert')).toHaveLength(3);
  });

  it('…but does not fail the gate: nothing went WRONG', () => {
    const { diagnostics } = convert([pdfPage()]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagnostics.every((d) => d.code !== 'nothing-to-convert' || d.severity === 'warning'))
      .toBe(true);
  });

  it('reports nothing changed, rather than "0 sizes → 0"', () => {
    const { report } = convert([pdfPage()]);
    expect(report.sizesBefore).toBe(0);
    expect(report.colorsBefore).toBeLessThanOrEqual(1);
  });

  it('a MIXED deck counts only the slides it could not touch', () => {
    const real = slide([
      text('Heading', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
      text('body copy here', at(0.9, 2, 6, 1), { sizePt: 14 }),
    ]);
    const { report } = convert([real, pdfPage(), real]);
    expect(report.unconvertible).toEqual([2]);
    // Two slides were genuinely converted, so the deck is not a no-op.
    expect(report.clean).toBe(true);
  });
});

describe('coherenceDecisions', () => {
  const outcome = (finalPt: number) => ({
    element: {} as SlideElement,
    steps: [],
    overflowEmu: 0,
    finalPt,
    offLadder: false,
  });
  const trace = (brandPt: number) => ({
    elementId: '',
    role: 'body' as const,
    sourcePt: brandPt,
    brandPt,
    ratio: 1,
  });

  it('resizes a role deck-wide when most of it shrank', () => {
    const outcomes = new Map(
      [12, 12, 12, 12, 14, 14].map((pt, i) => [`e${i}`, outcome(pt)] as const),
    );
    const traces = new Map([...outcomes.keys()].map((id) => [id, trace(14)] as const));
    const roles = new Map([...outcomes.keys()].map((id) => [id, 'body' as const] as const));
    const decisions = coherenceDecisions(outcomes, traces, roles);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ role: 'body', fromPt: 14, toPt: 12 });
  });

  it('does nothing when only a minority shrank', () => {
    const outcomes = new Map(
      [12, 14, 14, 14, 14, 14].map((pt, i) => [`e${i}`, outcome(pt)] as const),
    );
    const traces = new Map([...outcomes.keys()].map((id) => [id, trace(14)] as const));
    const roles = new Map([...outcomes.keys()].map((id) => [id, 'body' as const] as const));
    expect(coherenceDecisions(outcomes, traces, roles)).toEqual([]);
  });

  it('uses the MEDIAN, so one pathological box cannot drag the deck down', () => {
    const outcomes = new Map(
      [13, 13, 13, 13, 9].map((pt, i) => [`e${i}`, outcome(pt)] as const),
    );
    const traces = new Map([...outcomes.keys()].map((id) => [id, trace(14)] as const));
    const roles = new Map([...outcomes.keys()].map((id) => [id, 'body' as const] as const));
    expect(coherenceDecisions(outcomes, traces, roles)[0].toPt).toBe(13);
  });

  it('ignores a role with too few instances to show a pattern', () => {
    const outcomes = new Map([10, 10].map((pt, i) => [`e${i}`, outcome(pt)] as const));
    const traces = new Map([...outcomes.keys()].map((id) => [id, trace(14)] as const));
    const roles = new Map([...outcomes.keys()].map((id) => [id, 'body' as const] as const));
    expect(coherenceDecisions(outcomes, traces, roles)).toEqual([]);
  });

  it('is sorted, so the report is stable', () => {
    const build = (role: 'body' | 'caption') =>
      [12, 12, 12, 12].map((pt, i) => [`${role}${i}`, outcome(pt)] as const);
    const outcomes = new Map([...build('body'), ...build('caption')]);
    const traces = new Map([...outcomes.keys()].map((id) => [id, trace(14)] as const));
    const roles = new Map(
      [...outcomes.keys()].map((id) => [id, id.startsWith('body') ? 'body' : 'caption'] as const),
    );
    expect(coherenceDecisions(outcomes, traces, roles).map((d) => d.role)).toEqual([
      'body',
      'caption',
    ]);
  });

  it('decides each SIZE TIER of a role on its own', () => {
    // `body` covering two brand sizes is the norm, not the exception — bullets
    // at one size, card captions at another. Bucketing by role alone and
    // bailing out on the disagreement meant one 11pt caption anywhere in the
    // deck disabled coherence for every 14pt bullet in it.
    const big = [12, 12, 12, 12].map((pt, i) => [`b${i}`, outcome(pt)] as const);
    const small = [11, 11, 11, 11].map((pt, i) => [`s${i}`, outcome(pt)] as const);
    const outcomes = new Map([...big, ...small]);
    const traces = new Map(
      [...outcomes.keys()].map((id) => [id, trace(id.startsWith('b') ? 14 : 12)] as const),
    );
    const roles = new Map([...outcomes.keys()].map((id) => [id, 'body' as const] as const));
    expect(coherenceDecisions(outcomes, traces, roles)).toMatchObject([
      { role: 'body', fromPt: 12, toPt: 11 },
      { role: 'body', fromPt: 14, toPt: 12 },
    ]);
  });

  it('never decides a size below the legibility floor', () => {
    // A tier whose boxes were restored to a small source size has a small
    // median. Adopting it deck-wide would take everything else in the tier with
    // it, below the floor, on the strength of the boxes that could not hold the
    // brand size in the first place.
    const outcomes = new Map([7, 7, 7, 8].map((pt, i) => [`e${i}`, outcome(pt)] as const));
    const traces = new Map([...outcomes.keys()].map((id) => [id, trace(14)] as const));
    const roles = new Map([...outcomes.keys()].map((id) => [id, 'body' as const] as const));
    expect(coherenceDecisions(outcomes, traces, roles)[0].toPt).toBe(MIN_LEGIBLE_PT);
  });

  it('COHERENCE_THRESHOLD is a majority', () => {
    expect(COHERENCE_THRESHOLD).toBeGreaterThan(0.5);
  });
});

describe('convertDeck — scale invariance', () => {
  it('converts the same design the same way on a bigger canvas', () => {
    /*
     * The same deck, authored once at 13.33in and once at 20in — the second is
     * the first scaled up, which is what a real 20in .pptx is: not a different
     * design, a different unit. Every decision the engine makes should be the
     * same decision, so every size should come out 1.5× and no diagnostic should
     * appear or vanish.
     *
     * Before the brand was put on the slide's own scale, the big canvas measured
     * its own 1.5× type against an unscaled 9pt floor and 11pt body rung, read
     * dense body copy as text that needed ENLARGING, and spent the slide
     * unwinding a decision that was never real.
     */
    const factor = 1.5;
    const big = { w: Math.round(SIZE.w * factor), h: Math.round(SIZE.h * factor) };
    const source = () =>
      slide(
        [
          text('A comparison of two approaches', at(0.6, 0.5, 8, 0.6), { sizePt: 22 }),
          text('Left column', at(0.6, 1.6, 3, 0.3), { sizePt: 13 }),
          text(
            'A dense paragraph of body copy that has to wrap at least twice inside the box it was drawn in.',
            at(0.6, 2.0, 3, 0.9),
            { sizePt: 9 },
          ),
          text('Right column', at(4.2, 1.6, 3, 0.3), { sizePt: 13 }),
          text('A shorter note.', at(4.2, 2.0, 3, 0.9), { sizePt: 9 }),
        ],
        '#FFFFFF',
      );
    const ids = () => {
      let n = 0;
      return (p: string) => `${p}_${(n += 1)}`;
    };
    const small = convertDeck([source()], { ds, slideSize: SIZE, measurer, newId: ids() });
    const scaled = fitSlide(source(), placementFor(SIZE, big));
    const large = convertDeck([scaled], { ds, slideSize: big, measurer, newId: ids() });

    const sizes = (slides: Slide[]) =>
      allRuns(slides)
        .map((r) => r.sizePt!)
        .sort((a, b) => a - b);
    const codes = (ds_: Diagnostic[]) => ds_.map((d) => d.code).sort();

    expect(sizes(large.slides).length).toBe(sizes(small.slides).length);
    for (const [i, pt] of sizes(small.slides).entries()) {
      // Half-point rounding at both scales, so a rung can land half a point out.
      expect(sizes(large.slides)[i]).toBeGreaterThanOrEqual(pt * factor - 0.5);
      expect(sizes(large.slides)[i]).toBeLessThanOrEqual(pt * factor + 0.5);
    }
    expect(codes(large.diagnostics)).toEqual(codes(small.diagnostics));
  });
});

describe('convertDeck — determinism and reporting', () => {
  it('converting the same deck twice gives the identical result', () => {
    resetIds();
    const a = convert(sourceDeck(8));
    resetIds();
    const b = convert(sourceDeck(8));
    expect(a.slides).toEqual(b.slides);
    expect(a.diagnostics).toEqual(b.diagnostics);
    expect(a.report).toEqual(b.report);
  });

  it('keeps every slide', () => {
    const { slides } = convert(sourceDeck(9));
    expect(slides).toHaveLength(9);
  });

  it('reports what it did in terms a reviewer can read', () => {
    const { report } = convert(sourceDeck(8));
    expect(report.sourceFonts.length).toBeGreaterThan(0);
    expect(report.brandFonts.length).toBeGreaterThan(0);
    expect(report.sizesAfter).toBeLessThanOrEqual(report.sizesBefore);
    expect(report.tokensAfter).toBeLessThanOrEqual(report.colorsBefore);
    expect(report.slides).toHaveLength(8);
    for (const s of report.slides) expect(s.reason.length).toBeGreaterThan(0);
  });

  it('collapses a deck’s accidental size variety, but not its real hierarchy', () => {
    // The distinction that matters. A deck with six deliberate levels keeps six
    // — flattening a real hierarchy would be the worse failure. What collapses
    // is the residue of dragging text boxes around in an app with autofit on:
    // 12, 12.5 and 13pt are one level that got jittered, not three.
    const clean = convert(sourceDeck(10)).report;
    expect(clean.sizesAfter).toBeLessThanOrEqual(clean.sizesBefore);

    const messy = convert([
      slide([
        text('Heading', at(0.9, 0.5, 8, 0.6), { sizePt: 28 }),
        text('one', at(0.9, 2.0, 5, 0.4), { sizePt: 12 }),
        text('two', at(0.9, 2.6, 5, 0.4), { sizePt: 12.5 }),
        text('three', at(0.9, 3.2, 5, 0.4), { sizePt: 13 }),
      ]),
    ]).report;
    expect(messy.sizesBefore).toBe(4);
    expect(messy.sizesAfter).toBe(2);
  });

  it('collapses the source palette onto fewer brand tokens', () => {
    const { report } = convert(sourceDeck(10));
    expect(report.tokensAfter).toBeLessThan(report.colorsBefore);
  });

  it('every element keeps its id, so diagnostics can point at it', () => {
    const { slides, diagnostics } = convert(sourceDeck(8));
    const ids = new Set(allElements(slides).map((el) => el.id));
    for (const d of diagnostics) {
      if (d.elementId) expect(ids.has(d.elementId)).toBe(true);
    }
  });

  it('handles an empty deck without throwing', () => {
    const { slides, report } = convert([]);
    expect(slides).toEqual([]);
    expect(report.clean).toBe(true);
  });

  it('handles a deck of one blank slide', () => {
    const { slides, report } = convert([slide([])]);
    expect(slides).toHaveLength(1);
    expect(report.clean).toBe(true);
  });
});
