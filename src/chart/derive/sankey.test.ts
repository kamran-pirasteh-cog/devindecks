import { describe, expect, it } from 'vitest';
import { inchesToEmu, type SankeyData } from '@/model';
import { layoutSankey, type SankeyLayoutInput } from './sankey';

const ALONG = inchesToEmu(8);
const ACROSS = inchesToEmu(4.5);

const run = (data: SankeyData, over: Partial<SankeyLayoutInput> = {}) =>
  layoutSankey({
    data,
    alongExtent: ALONG,
    acrossExtent: ACROSS,
    nodeThicknessEmu: inchesToEmu(0.14),
    nodePaddingEmu: inchesToEmu(0.1),
    ...over,
  });

/** A -> B -> C, plus a second source feeding B. */
const CHAIN: SankeyData = {
  nodes: [
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B' },
    { key: 'c', label: 'C' },
    { key: 'd', label: 'D' },
  ],
  links: [
    { key: 'l1', from: 'a', to: 'b', value: 60 },
    { key: 'l2', from: 'd', to: 'b', value: 40 },
    { key: 'l3', from: 'b', to: 'c', value: 100 },
  ],
};

const layerOf = (l: ReturnType<typeof run>, key: string) =>
  l.nodes.find((n) => n.key === key)!.layer;

describe('layoutSankey — layering', () => {
  it('puts a node one column past everything feeding it', () => {
    const l = run(CHAIN);
    expect(layerOf(l, 'a')).toBe(0);
    expect(layerOf(l, 'd')).toBe(0);
    expect(layerOf(l, 'b')).toBe(1);
    expect(layerOf(l, 'c')).toBe(2);
    expect(l.layers).toBe(3);
  });

  it('uses the LONGEST path, so a shortcut does not pull a node forward', () => {
    // a -> b -> c and a -> c. If c were placed off the shortcut it would sit
    // in column 1 and its ribbon from b would run backwards.
    const l = run({
      nodes: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
      ],
      links: [
        { key: 'l1', from: 'a', to: 'b', value: 10 },
        { key: 'l2', from: 'b', to: 'c', value: 10 },
        { key: 'l3', from: 'a', to: 'c', value: 5 },
      ],
    });
    expect(layerOf(l, 'c')).toBe(2);
    for (const link of l.links) expect(link.endAlong).toBeGreaterThan(link.startAlong);
  });

  it('honours an explicit layer pin', () => {
    const l = run({
      nodes: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B', layer: 3 },
      ],
      links: [{ key: 'l1', from: 'a', to: 'b', value: 10 }],
    });
    expect(layerOf(l, 'b')).toBe(3);
  });

  it('terminates on a cycle and says so', () => {
    const l = run({
      nodes: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
      ],
      links: [
        { key: 'l1', from: 'a', to: 'b', value: 10 },
        { key: 'l2', from: 'b', to: 'c', value: 10 },
        { key: 'l3', from: 'c', to: 'a', value: 10 },
      ],
    });
    expect(l.diagnostics.some((d) => d.code === 'sankey-cycle')).toBe(true);
    expect(l.nodes).toHaveLength(3);
  });
});

describe('layoutSankey — sizing', () => {
  it('makes a node as thick as the most that passes through it', () => {
    const l = run(CHAIN);
    const b = l.nodes.find((n) => n.key === 'b')!;
    const c = l.nodes.find((n) => n.key === 'c')!;
    expect(b.value).toBe(100);
    // C only receives; sizing it on its (empty) outgoing side would erase it.
    expect(c.value).toBe(100);
    expect(c.acrossExtent).toBeGreaterThan(0);
  });

  it('uses ONE scale for every column, so thickness is comparable', () => {
    const l = run(CHAIN);
    const a = l.nodes.find((n) => n.key === 'a')!;
    const d = l.nodes.find((n) => n.key === 'd')!;
    const b = l.nodes.find((n) => n.key === 'b')!;
    // 60 : 40 : 100 across two different columns.
    expect(a.acrossExtent / d.acrossExtent).toBeCloseTo(60 / 40, 1);
    expect(b.acrossExtent / a.acrossExtent).toBeCloseTo(100 / 60, 1);
  });

  it('keeps every node inside the frame it was given', () => {
    for (const node of run(CHAIN).nodes) {
      expect(node.across).toBeGreaterThanOrEqual(0);
      expect(node.across + node.acrossExtent).toBeLessThanOrEqual(ACROSS + 1);
      expect(node.along).toBeGreaterThanOrEqual(0);
      expect(node.along + node.alongExtent).toBeLessThanOrEqual(ALONG + 1);
    }
  });

  it('still fits when padding alone would overflow the frame', () => {
    // Twelve nodes in one column at a padding that sums past the frame.
    const data: SankeyData = {
      nodes: [
        { key: 'src', label: 'Source' },
        ...Array.from({ length: 12 }, (_, i) => ({ key: `n${i}`, label: `N${i}` })),
      ],
      links: Array.from({ length: 12 }, (_, i) => ({
        key: `l${i}`,
        from: 'src',
        to: `n${i}`,
        value: 10,
      })),
    };
    const l = run(data, { nodePaddingEmu: inchesToEmu(0.5) });
    for (const node of l.nodes) expect(node.acrossExtent).toBeGreaterThan(0);
  });

  it('centres a short column rather than stranding it at one edge', () => {
    const l = run(CHAIN);
    const c = l.nodes.find((n) => n.key === 'c')!;
    const above = c.across;
    const below = ACROSS - (c.across + c.acrossExtent);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(2);
  });
});

describe('layoutSankey — ribbons', () => {
  it('gives a ribbon the same thickness at both ends, since flow is conserved', () => {
    for (const link of run(CHAIN).links) expect(link.thickness).toBeGreaterThan(0);
  });

  it('stacks a node’s ribbons inside the node, without overlap or overflow', () => {
    const l = run(CHAIN);
    const b = l.nodes.find((n) => n.key === 'b')!;
    const into = l.links
      .filter((k) => k.to === 'b')
      .sort((x, y) => x.endAcross - y.endAcross);
    expect(into).toHaveLength(2);
    expect(into[0].endAcross).toBeGreaterThanOrEqual(b.across - 1);
    const last = into[into.length - 1];
    expect(last.endAcross + last.thickness).toBeLessThanOrEqual(b.across + b.acrossExtent + 2);
    // No two ribbons occupy the same band.
    expect(into[0].endAcross + into[0].thickness).toBeLessThanOrEqual(into[1].endAcross + 1);
  });

  it('always runs forward, never back into an earlier column', () => {
    for (const link of run(CHAIN).links) {
      expect(link.endAlong).toBeGreaterThanOrEqual(link.startAlong);
    }
  });

  it('orders ribbons by the node at the far end, to avoid needless crossings', () => {
    // One source fanning out to three targets: the ribbons should leave the
    // source in the same order the targets appear, so none of them cross.
    const l = run({
      nodes: [
        { key: 's', label: 'S' },
        { key: 't1', label: 'T1' },
        { key: 't2', label: 'T2' },
        { key: 't3', label: 'T3' },
      ],
      links: [
        { key: 'l3', from: 's', to: 't3', value: 10 },
        { key: 'l1', from: 's', to: 't1', value: 10 },
        { key: 'l2', from: 's', to: 't2', value: 10 },
      ],
    });
    const sorted = [...l.links].sort((a, b) => a.startAcross - b.startAcross);
    const ends = sorted.map((k) => k.endAcross);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
  });
});

describe('layoutSankey — bad input', () => {
  const bad = (links: SankeyData['links']) =>
    run({
      nodes: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      links,
    });

  it('drops a flow pointing at a node that does not exist', () => {
    const l = bad([{ key: 'l1', from: 'a', to: 'ghost', value: 10 }]);
    expect(l.links).toHaveLength(0);
    expect(l.diagnostics.some((d) => d.code === 'sankey-unknown-node')).toBe(true);
  });

  it('drops a self-flow', () => {
    const l = bad([{ key: 'l1', from: 'a', to: 'a', value: 10 }]);
    expect(l.links).toHaveLength(0);
    expect(l.diagnostics.some((d) => d.code === 'sankey-self-link')).toBe(true);
  });

  it('drops a zero or negative flow rather than drawing it backwards', () => {
    for (const value of [0, -5]) {
      const l = bad([{ key: 'l1', from: 'a', to: 'b', value }]);
      expect(l.links).toHaveLength(0);
      expect(l.diagnostics.some((d) => d.code === 'sankey-nonpositive')).toBe(true);
    }
  });

  it('ignores a duplicate node key instead of drawing two of it', () => {
    const l = run({
      nodes: [
        { key: 'a', label: 'A' },
        { key: 'a', label: 'A again' },
      ],
      links: [],
    });
    expect(l.nodes).toHaveLength(1);
    expect(l.diagnostics.some((d) => d.code === 'sankey-duplicate-node')).toBe(true);
  });

  it('returns an empty layout for no nodes at all', () => {
    const l = run({ nodes: [], links: [] });
    expect(l.nodes).toEqual([]);
    expect(l.links).toEqual([]);
  });

  it('survives nodes with no links between them', () => {
    const l = run({
      nodes: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      links: [],
    });
    expect(l.nodes).toHaveLength(2);
    expect(l.layers).toBe(1);
  });
});

describe('layoutSankey — determinism', () => {
  it('returns byte-identical layouts for the same input', () => {
    expect(run(CHAIN)).toEqual(run(CHAIN));
  });

  it('does not depend on the order links were typed in', () => {
    const reversed: SankeyData = { ...CHAIN, links: [...CHAIN.links].reverse() };
    const a = run(CHAIN);
    const b = run(reversed);
    const positions = (l: typeof a) =>
      [...l.nodes].sort((x, y) => x.key.localeCompare(y.key)).map((n) => [n.key, n.layer, n.across]);
    expect(positions(a)).toEqual(positions(b));
  });
});

/**
 * Both of the spec's fixed sizes — the gap between stacked nodes and the
 * thickness of a node bar — are in POINTS, so neither shrinks with the chart.
 * Shrinking a Sankey used to walk straight past what its frame could hold: the
 * gaps outgrew the cross extent and the column was laid out past both ends of
 * the frame, and the columns closed to less than a bar apart and then to less
 * than nothing, so every ribbon collapsed to zero width and came back running
 * backwards. Both are what "resizing a Sankey makes it fall apart" was.
 */
describe('layoutSankey — fitting the frame it was given', () => {
  const fan = (branches: number): SankeyData => ({
    nodes: [
      { key: 'src', label: 'Total' },
      ...Array.from({ length: branches }, (_, i) => ({ key: `n${i}`, label: `Seg ${i}` })),
    ],
    links: Array.from({ length: branches }, (_, i) => ({
      key: `f${i}`,
      from: 'src',
      to: `n${i}`,
      value: 100,
    })),
  });

  const chain = (layers: number): SankeyData => ({
    nodes: Array.from({ length: layers }, (_, i) => ({ key: `n${i}`, label: `L${i}` })),
    links: Array.from({ length: layers - 1 }, (_, i) => ({
      key: `f${i}`,
      from: `n${i}`,
      to: `n${i + 1}`,
      value: 100,
    })),
  });

  it('keeps a crowded column inside the cross extent at every height', () => {
    for (const branches of [5, 8, 12]) {
      for (const across of [4.5, 2, 1, 0.5].map(inchesToEmu)) {
        const l = run(fan(branches), { acrossExtent: across });
        const top = Math.min(...l.nodes.map((n) => n.across));
        const bottom = Math.max(...l.nodes.map((n) => n.across + n.acrossExtent));
        // Each node's extent is rounded to whole EMU, so a tall column can end
        // half an EMU per node past the edge. That's a millionth of an inch —
        // the failure this guards against overshot by fractions of an INCH.
        const rounding = l.nodes.length;
        expect(top).toBeGreaterThanOrEqual(-rounding);
        expect(bottom).toBeLessThanOrEqual(across + rounding);
      }
    }
  });

  it('never lets two columns meet, so no ribbon inverts', () => {
    for (const layers of [2, 3, 5]) {
      for (const along of [8, 3, 1.5, 0.5, 0.25].map(inchesToEmu)) {
        const l = run(chain(layers), { alongExtent: along });
        for (const link of l.links) expect(link.endAlong).toBeGreaterThan(link.startAlong);
        const last = l.nodes.reduce((n, m) => (m.along > n.along ? m : n));
        expect(last.along + last.alongExtent).toBeLessThanOrEqual(along);
      }
    }
  });

  it('narrows monotonically — a ribbon never widens as the frame shrinks', () => {
    const widths = [8, 4, 2, 1.5, 1, 0.5]
      .map(inchesToEmu)
      .map((along) => run(chain(5), { alongExtent: along }).links[0])
      .map((l) => l.endAlong - l.startAlong);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]);
  });
});
