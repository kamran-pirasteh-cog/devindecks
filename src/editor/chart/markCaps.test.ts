import { describe, expect, it } from 'vitest';
import { defaultChartSpec, type ComboSpec } from '@/model';
import { markCapabilities, seriesRender } from './markCaps';

/** The capabilities of series `key` as drawn in a bare chart of this kind. */
const caps = (kind: Parameters<typeof defaultChartSpec>[0], key = 's0') => {
  const spec = defaultChartSpec(kind);
  return markCapabilities(spec, seriesRender(spec, key));
};

describe('markCapabilities', () => {
  it('gives a column a fill, a border and a placement', () => {
    expect(caps('column')).toMatchObject({
      stroked: false,
      filled: true,
      labels: 'point',
      placement: true,
      content: true,
    });
    expect(caps('bar').placement).toBe(true);
  });

  it('gives a line a stroke, and its labels only at the end', () => {
    // `placeLineArea` draws no per-point label and reads no placement, so a
    // line offering "inside base" was a control that could only do nothing.
    expect(caps('line')).toMatchObject({
      stroked: true,
      filled: false,
      labels: 'end',
      placement: false,
      content: false,
    });
  });

  it('gives an area a stroke and no labels at all', () => {
    expect(caps('area')).toMatchObject({ stroked: true, labels: 'none' });
  });

  it('reads a combo series by how it is drawn, not by the chart kind', () => {
    const spec = defaultChartSpec('combo') as ComboSpec;
    const asLine = Object.keys(spec.render).find((k) => spec.render[k] === 'line');
    expect(asLine).toBeDefined();

    const line = markCapabilities(spec, seriesRender(spec, asLine!));
    expect(line).toMatchObject({ stroked: true, filled: false });
    // A combo is not a line chart, so there are no end labels either — the
    // line member of a combo carries no text of any kind.
    expect(line.labels).toBe('none');

    const column = Object.keys(spec.render).find((k) => spec.render[k] !== 'line');
    expect(markCapabilities(spec, seriesRender(spec, column!))).toMatchObject({
      filled: true,
      placement: true,
    });
  });

  it('lets a slice pick its label content but not its placement', () => {
    expect(caps('pie')).toMatchObject({
      filled: true,
      labels: 'point',
      placement: false,
      content: true,
    });
    expect(caps('donut').placement).toBe(false);
  });

  it('offers a scatter point neither a placement nor a content', () => {
    // `placeXY` labels a dot with the dot's own name.
    expect(caps('scatter')).toMatchObject({ labels: 'point', placement: false, content: false });
    expect(caps('bubble').content).toBe(false);
  });

  it('fixes a Mekko cell to its share', () => {
    expect(caps('mekko')).toMatchObject({ filled: true, placement: false, content: false });
  });
});
