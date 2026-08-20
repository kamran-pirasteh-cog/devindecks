import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, type DesignSystem } from '@/model/tokens';
import {
  buildLadder,
  buildSizeMap,
  distinctLevels,
  mapFont,
  mapSize,
  MIN_LEGIBLE_PT,
  stepDown,
  stepUp,
} from './type';
import { surveyDeck } from './survey';
import { at, SIZE, slide, sourceDeck, text } from './testkit';

const ds = DEFAULT_DESIGN_SYSTEM;
const survey = (slides: Parameters<typeof surveyDeck>[0]) => surveyDeck(slides, SIZE, ds);

/** A deck whose only content is text at each of these sizes. */
const deckWithSizes = (pts: number[]) => [
  slide(
    pts.map((pt, i) =>
      text('some text of a reasonable length here', at(1, 0.5 + i * 0.6, 6, 0.5), { sizePt: pt }),
    ),
  ),
];

describe('buildLadder', () => {
  it('contains every type role size', () => {
    const ladder = buildLadder(ds);
    for (const role of Object.values(ds.type)) {
      // Roles below the legibility floor are excluded by design.
      if (role.sizePt >= MIN_LEGIBLE_PT) expect(ladder.steps).toContain(role.sizePt);
    }
  });

  it('is ascending and deduplicated', () => {
    const { steps } = buildLadder(ds);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(new Set(steps).size).toBe(steps.length);
  });

  it('adds a rung above the largest and below the smallest role', () => {
    const { steps } = buildLadder(ds);
    const roleSizes = Object.values(ds.type).map((r) => r.sizePt);
    expect(Math.max(...steps)).toBeGreaterThan(Math.max(...roleSizes));
    expect(Math.min(...steps)).toBeLessThan(Math.min(...roleSizes));
  });

  it('never goes below the legibility floor', () => {
    expect(Math.min(...buildLadder(ds).steps)).toBeGreaterThanOrEqual(MIN_LEGIBLE_PT);
  });

  it('includes admin-added custom roles', () => {
    const withCustom: DesignSystem = {
      ...ds,
      type: { ...ds.type, 'custom.1': { font: 'Geist', sizePt: 33, colorToken: 'ink.strong' } },
    };
    expect(buildLadder(withCustom).steps).toContain(33);
  });
});

describe('distinctLevels', () => {
  it('merges sizes within the epsilon into one level', () => {
    const s = survey(deckWithSizes([12, 12.5]));
    expect(distinctLevels(s.sizes)).toHaveLength(1);
  });

  it('keeps clearly different sizes as separate levels', () => {
    const s = survey(deckWithSizes([32, 18, 12]));
    expect(distinctLevels(s.sizes)).toHaveLength(3);
  });

  it('orders levels largest first', () => {
    const levels = distinctLevels(survey(deckWithSizes([12, 32, 18])).sizes);
    expect(levels.map((l) => l[0])).toEqual([32, 18, 12]);
  });
});

describe('buildSizeMap — the monotonicity guarantee', () => {
  it('preserves order: bigger source stays bigger or equal', () => {
    const s = survey(deckWithSizes([40, 28, 20, 16, 12, 10]));
    const map = buildSizeMap(s, ds);
    const sources = [...map.to.keys()].sort((a, b) => a - b);
    for (let i = 1; i < sources.length; i += 1) {
      expect(map.to.get(sources[i])!).toBeGreaterThanOrEqual(map.to.get(sources[i - 1])!);
    }
  });

  it('never inverts a hierarchy even when it must compress one', () => {
    // Ten levels against a six-rung ladder: the bottom compresses, nothing flips.
    const s = survey(deckWithSizes([44, 40, 36, 32, 28, 24, 20, 16, 13, 10]));
    const map = buildSizeMap(s, ds);
    const sources = [...map.to.keys()].sort((a, b) => b - a);
    for (let i = 1; i < sources.length; i += 1) {
      expect(map.to.get(sources[i])!).toBeLessThanOrEqual(map.to.get(sources[i - 1])!);
    }
  });

  it('is total — every surveyed size has a mapping', () => {
    const s = survey(sourceDeck(6));
    const map = buildSizeMap(s, ds);
    for (const stat of s.sizes) expect(map.to.has(stat.sizePt)).toBe(true);
  });

  it('only ever produces sizes that are on the brand ladder', () => {
    const s = survey(deckWithSizes([40, 28, 20, 16, 12, 10, 9.5]));
    const map = buildSizeMap(s, ds);
    for (const brandPt of map.to.values()) expect(map.ladder.steps).toContain(brandPt);
  });

  it('anchors a dense deck near its own scale rather than stretching it to the top rung', () => {
    // A deck whose largest text is 16pt is a dense deck. Blowing that up to the
    // 60pt hero rung because it is the biggest thing present would be absurd.
    const map = buildSizeMap(survey(deckWithSizes([16, 13, 11])), ds);
    expect(map.to.get(16)!).toBeLessThan(30);
  });

  it('maps a big title deck to the big end of the ladder', () => {
    const map = buildSizeMap(survey(deckWithSizes([44, 20, 12])), ds);
    expect(map.to.get(44)!).toBeGreaterThan(map.to.get(20)!);
    expect(map.to.get(44)!).toBeGreaterThanOrEqual(ds.type.title.sizePt);
  });

  it('collapses near-duplicate source sizes onto ONE brand size', () => {
    const map = buildSizeMap(survey(deckWithSizes([12, 12.5])), ds);
    expect(map.to.get(12)).toBe(map.to.get(12.5));
  });

  it('is stable under slide reordering — the consistency guarantee', () => {
    const slides = sourceDeck(6);
    const forward = buildSizeMap(survey(slides), ds);
    const reversed = buildSizeMap(survey([...slides].reverse()), ds);
    expect([...reversed.to.entries()].sort()).toEqual([...forward.to.entries()].sort());
  });

  it('explains every mapping', () => {
    const map = buildSizeMap(survey(deckWithSizes([40, 20, 12])), ds);
    for (const m of map.mappings) expect(m.reason.length).toBeGreaterThan(0);
  });
});

describe('mapSize', () => {
  it('returns the mapped rung for a known size', () => {
    const map = buildSizeMap(survey(deckWithSizes([40, 20, 12])), ds);
    expect(mapSize(map, 20)).toBe(map.to.get(20));
  });

  it('falls back to the nearest rung for a size the survey never saw', () => {
    const map = buildSizeMap(survey(deckWithSizes([40, 20, 12])), ds);
    const got = mapSize(map, 15.5);
    expect(map.ladder.steps).toContain(got);
  });
});

describe('stepDown / stepUp', () => {
  const ladder = buildLadder(ds);

  it('stepDown finds the next rung below', () => {
    const sorted = ladder.steps;
    expect(stepDown(ladder, sorted[2])).toBe(sorted[1]);
  });

  it('stepDown returns null at the bottom of the ladder', () => {
    expect(stepDown(ladder, ladder.steps[0])).toBeNull();
  });

  it('stepUp returns null at the top', () => {
    expect(stepUp(ladder, ladder.steps[ladder.steps.length - 1])).toBeNull();
  });

  it('stepping down then up returns where it started', () => {
    const mid = ladder.steps[3];
    expect(stepUp(ladder, stepDown(ladder, mid)!)).toBe(mid);
  });
});

describe('mapFont', () => {
  it('gives heading roles the heading face', () => {
    expect(mapFont(ds, 'title', 'Arial')).toBe(ds.fonts.heading);
    expect(mapFont(ds, 'kpiValue', 'Arial')).toBe(ds.fonts.heading);
  });

  it('gives body and caption the body face', () => {
    expect(mapFont(ds, 'body', 'Arial')).toBe(ds.fonts.body);
    expect(mapFont(ds, 'caption', 'Arial')).toBe(ds.fonts.body);
  });

  it('keeps a monospaced source run monospaced', () => {
    // A code sample or a fixed-width table was set in mono deliberately.
    expect(mapFont(ds, 'body', 'Courier New')).toBe(ds.fonts.mono);
    expect(mapFont(ds, 'body', 'Consolas')).toBe(ds.fonts.mono);
  });

  it('sets an eyebrow in mono, as the brand does', () => {
    expect(mapFont(ds, 'eyebrow', 'Arial')).toBe(ds.fonts.mono);
  });

  it('defaults an unknown role to the body face', () => {
    expect(mapFont(ds, undefined, undefined)).toBe(ds.fonts.body);
    expect(mapFont(ds, 'something.invented', 'Arial')).toBe(ds.fonts.body);
  });
});
