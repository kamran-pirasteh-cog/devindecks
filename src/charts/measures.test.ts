import { describe, expect, it } from 'vitest';
import {
  MEASURES,
  MEASURE_GROUPS,
  additive,
  freeMeasure,
  isRate,
  measureFormat,
  resolveMeasure,
} from './measures';
import { SEGMENTS, freeSegment, namedMembers, resolveSegment, segmentWith } from './segments';

describe('the measure catalog', () => {
  it('has unique ids and a group that is offered', () => {
    const ids = MEASURES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MEASURES) expect(MEASURE_GROUPS).toContain(m.group);
  });

  it('files every per-something measure as non-additive', () => {
    // The one property the warnings are built on: a ratio or a rate cannot be
    // stacked, pied or flowed, because its parts do not sum to its whole.
    for (const m of MEASURES) {
      if (/\bper\b/i.test(m.label) || /rate|adoption/i.test(m.label)) {
        expect(additive(m)).toBe(false);
        expect(isRate(m)).toBe(true);
      }
    }
  });

  it('treats counts, hours and money as things that add up', () => {
    expect(additive(resolveMeasure('acus'))).toBe(true);
    expect(additive(resolveMeasure('productive-hours'))).toBe(true);
    expect(additive(resolveMeasure('arr'))).toBe(true);
  });

  it('gives every per-something measure a denominator to print', () => {
    for (const m of MEASURES) {
      if (m.unit === 'ratio') expect(m.per).toBeTruthy();
    }
  });
});

describe('freeMeasure', () => {
  it('reads a typed rate as a rate', () => {
    expect(freeMeasure('Review pass rate').unit).toBe('percent');
    expect(additive(freeMeasure('Review pass rate'))).toBe(false);
  });

  it('reads a typed per-something as a ratio', () => {
    expect(freeMeasure('Reviews per PR').unit).toBe('ratio');
  });

  it('reads anything else as a count, which blocks nothing', () => {
    expect(additive(freeMeasure('Widgets shipped'))).toBe(true);
  });

  it('round-trips through the free: prefix', () => {
    expect(resolveMeasure('free:Time to first review').label).toBe('Time to first review');
  });
});

describe('measureFormat', () => {
  it('scales only counts big enough for the scaling to be shorter', () => {
    expect(measureFormat(resolveMeasure('acus')).unitDivisor).toBe(1e3);
    // 320 active developers reads as 320, not as 0.3K.
    expect(measureFormat(resolveMeasure('active-developers')).unitDivisor).toBeUndefined();
  });

  it('leaves a ratio unscaled, with a decimal', () => {
    const f = measureFormat(resolveMeasure('acus-per-merged-pr'));
    expect(f.unitDivisor).toBeUndefined();
    expect(f.numberFormat.decimals).toBe(1);
  });

  it('gives a percentage no scale and no currency to get wrong', () => {
    const f = measureFormat(resolveMeasure('merge-rate'));
    expect(f.numberFormat.style).toBe('percent');
    expect(f.unitDivisor).toBeUndefined();
  });

  it('honours the currency it is asked for', () => {
    expect(measureFormat(resolveMeasure('arr'), 'GBP').numberFormat.currency).toBe('GBP');
  });

  it('names no units — the axis title carries them', () => {
    for (const id of ['productive-hours', 'arr', 'acus', 'acus-per-merged-pr']) {
      expect(measureFormat(resolveMeasure(id))).not.toHaveProperty('unitNote');
    }
  });
});

describe('the segment catalog', () => {
  it('has unique ids and at least two members each', () => {
    const ids = SEGMENTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SEGMENTS) expect(s.members.length).toBeGreaterThan(1);
  });

  it('letters the members of a cut nobody can know the membership of', () => {
    expect(freeSegment('vertical').members).toEqual(['Vertical A', 'Vertical B', 'Vertical C']);
  });

  it('round-trips through the free: prefix', () => {
    expect(resolveSegment('free:vertical').noun).toBe('vertical');
    expect(resolveSegment('department').members).toEqual(['Engineering', 'Go-to-market', 'G&A']);
  });

  it('reads a cut that is no longer on the menu as a typed one, rather than erroring', () => {
    // The menu is short on purpose; a chart saved with a cut that has since
    // left it still resolves to something with the right noun.
    expect(resolveSegment('region').noun).toBe('region');
  });

  it('offers exactly the cuts these decks are built on', () => {
    expect(SEGMENTS.map((s) => s.label)).toEqual([
      'Company',
      'Department',
      'Devin Org',
      'Use Case',
      'Cohort',
    ]);
  });
});

describe('which ones of a cut', () => {
  it('takes a comma-separated answer as the members themselves', () => {
    expect(namedMembers('Engineering, Sales, G&A')).toEqual(['Engineering', 'Sales', 'G&A']);
    expect(segmentWith('department', 'Platform, Payments').members).toEqual([
      'Platform',
      'Payments',
    ]);
  });

  it('leaves an instruction as prose rather than printing it on an axis', () => {
    // Every one of these answers "which departments?" without naming any, and
    // reading them as names is how "Exclude G&A" ends up as a legend entry.
    for (const said of [
      'only the ones over 100 ACUs',
      'exclude G&A, and the internal orgs',
      'all of them',
      'the top 3 by ACUs',
      'whichever ones the finance deck uses',
    ]) {
      expect(namedMembers(said)).toEqual([]);
    }
    expect(segmentWith('department', 'only the big ones').members).toEqual([
      'Engineering',
      'Go-to-market',
      'G&A',
    ]);
  });

  it('needs two names, because one is a filter and not a breakdown', () => {
    expect(namedMembers('Engineering')).toEqual([]);
  });

  it('does not split on and or ampersand, which live inside real names', () => {
    expect(namedMembers('Research and Development, G&A')).toEqual([
      'Research and Development',
      'G&A',
    ]);
  });

  it('says nothing when nothing was said', () => {
    expect(namedMembers(undefined)).toEqual([]);
    expect(namedMembers('   ')).toEqual([]);
    expect(segmentWith('cohort').members).toEqual(resolveSegment('cohort').members);
  });

  it('asks the question with a plural, including for a cut that was typed', () => {
    expect(SEGMENTS.map((s) => s.plural)).toEqual([
      'companies',
      'departments',
      'Devin orgs',
      'use cases',
      'cohorts',
    ]);
    expect(freeSegment('vertical').plural).toBe('verticals');
    expect(freeSegment('industry').plural).toBe('industries');
    expect(freeSegment('business').plural).toBe('businesses');
  });
});
