import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_SYSTEM, defaultChartSpec, type ChartSpec } from '@/model';
import { restyleChart } from './provenance';
import type { StoredChartTemplate } from './repository';

const DS = DEFAULT_DESIGN_SYSTEM;

const briefed = (): ChartSpec => ({
  ...defaultChartSpec('column', 'stacked'),
  authorBrief: {
    v: 1,
    description: "Acme's ARR by segment, last 8 quarters",
    subject: 'Acme',
    subjectFrom: 'described',
    measure: 'ARR',
    measureFrom: 'stated',
    measures: ['ARR'],
    dimension: 'segment',
    dimensionFrom: 'stated',
    periodFrom: 'inferred',
    unitFrom: 'inferred',
    gaps: [],
  },
});

/** An archetype, which by construction has no author and no brief. */
const template = (): StoredChartTemplate => ({
  id: 'chart.arr-trend',
  name: 'ARR trend',
  description: '',
  category: 'Trend',
  spec: defaultChartSpec('column', 'stacked'),
  version: 3,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

describe('the brief surviving a restyle', () => {
  it('stays put through a plain restyle', () => {
    expect(restyleChart(briefed(), DS).authorBrief?.subject).toBe('Acme');
  });

  it('survives adopting a template, which replaces everything else', () => {
    // The template has no brief of its own, so without carrying it across, an
    // "apply brand" would quietly throw away what the author asked for and send
    // the next research prompt back to reading the picture.
    const next = restyleChart(briefed(), DS, template(), { adoptTemplateSpec: true });
    expect(next.authorBrief).toMatchObject({ subject: 'Acme', measure: 'ARR' });
  });

  it('leaves a chart that never had one without one', () => {
    const plain = restyleChart(defaultChartSpec('column', 'stacked'), DS, template(), {
      adoptTemplateSpec: true,
    });
    expect(plain.authorBrief).toBeUndefined();
  });
});
