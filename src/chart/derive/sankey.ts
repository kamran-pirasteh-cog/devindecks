/**
 * Sankey layout: nodes and links -> positions, in a canonical left-to-right
 * space.
 *
 * The placer transposes for a top-to-bottom chart, so everything here talks
 * about COLUMNS (the flow direction) and a CROSS extent (the thickness of the
 * diagram). Keeping the solve in one orientation is what stops the vertical
 * case being a second, subtly different implementation.
 *
 * Deliberately DETERMINISTIC end to end, like the label solver: same spec, same
 * layout, byte for byte. Crossing reduction is the one place a Sankey is
 * tempted to reach for randomness — a few ordered barycentre sweeps get most of
 * the benefit and keep the canvas, the SSR thumbnail and the exported .pptx
 * agreeing on where every ribbon goes.
 */
import type { EMU, SankeyData, SankeyLink, SankeyNode } from '@/model';

export interface SankeyDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface PlacedSankeyNode {
  key: string;
  label: string;
  layer: number;
  /** Total flow through the node: the larger of what enters and what leaves. */
  value: number;
  /** Index of the source node in the spec, for stable palette assignment. */
  index: number;
  /** Along the flow axis. */
  along: EMU;
  alongExtent: EMU;
  /** Across the flow axis. */
  across: EMU;
  acrossExtent: EMU;
}

export interface PlacedSankeyLink {
  key: string;
  from: string;
  to: string;
  value: number;
  /** Index of the SOURCE node, so a ribbon inherits its origin's colour. */
  sourceIndex: number;
  /** Where the ribbon leaves its source and meets its target. */
  startAlong: EMU;
  endAlong: EMU;
  startAcross: EMU;
  endAcross: EMU;
  /** Ribbon thickness at each end — equal, since flow is conserved. */
  thickness: EMU;
}

export interface SankeyLayout {
  nodes: PlacedSankeyNode[];
  links: PlacedSankeyLink[];
  layers: number;
  diagnostics: SankeyDiagnostic[];
}

export interface SankeyLayoutInput {
  data: SankeyData;
  /** Extent along the flow direction. */
  alongExtent: EMU;
  /** Extent across it. */
  acrossExtent: EMU;
  nodeThicknessEmu: EMU;
  nodePaddingEmu: EMU;
}

/** Crossing-reduction sweeps. Four is where the improvement flattens out. */
const SWEEPS = 4;

/**
 * How much of the cross extent the gaps between stacked nodes may take.
 *
 * The padding is a fixed number of points, so it does NOT shrink with the
 * chart — and a column of a dozen nodes carries eleven of them. Left alone,
 * the gaps outgrow the space the flows have to share and the column is laid
 * out taller than the frame it was solved for, so shrinking a Sankey pushes
 * its own diagram out through the top and bottom of its box. Capping the
 * gaps' TOTAL share is what keeps the column inside the frame at every size;
 * a diagram squeezed until its gaps close is still a diagram, one drawn
 * outside its own selection box is not.
 */
const PADDING_BUDGET = 0.4;

/**
 * How thick a column may be relative to the space along the flow.
 *
 * Same failure a quarter turn round. Node thickness is fixed in points too, so
 * narrowing a multi-column Sankey eventually leaves the columns less than a
 * bar apart — and then closer than nothing, at which point each ribbon's box
 * collapses to zero width (it vanishes) and then inverts (it runs backwards
 * through the column behind it). Capping the thickness so the gap between two
 * columns is never smaller than a column keeps every ribbon travelling
 * forwards, however narrow the frame gets.
 */
const columnThickness = (want: EMU, alongExtent: EMU, layers: number): EMU =>
  Math.max(1, Math.min(want, Math.floor(alongExtent / Math.max(1, 2 * layers - 1))));

export function layoutSankey(input: SankeyLayoutInput): SankeyLayout {
  const diagnostics: SankeyDiagnostic[] = [];
  const { data } = input;

  const byKey = new Map<string, SankeyNode>();
  for (const n of data.nodes) {
    if (byKey.has(n.key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'sankey-duplicate-node',
        message: `Two nodes share the key "${n.key}"; the second is ignored.`,
      });
      continue;
    }
    byKey.set(n.key, n);
  }

  const links = usableLinks(data.links, byKey, diagnostics);
  if (!byKey.size) {
    return { nodes: [], links: [], layers: 0, diagnostics };
  }

  const order = [...byKey.keys()];
  const layerOf = assignLayers(order, byKey, links, diagnostics);
  const layers = Math.max(...order.map((k) => layerOf.get(k)!)) + 1;

  /* --- node totals --- */
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const l of links) {
    outgoing.set(l.from, (outgoing.get(l.from) ?? 0) + l.value);
    incoming.set(l.to, (incoming.get(l.to) ?? 0) + l.value);
  }
  // A node is as thick as the most that passes through it. Using only the
  // outgoing side would pinch every terminal node to nothing.
  const valueOf = new Map(
    order.map((k) => [k, Math.max(incoming.get(k) ?? 0, outgoing.get(k) ?? 0)] as const),
  );

  /* --- the value scale --- */
  const columns: string[][] = Array.from({ length: layers }, () => []);
  for (const k of order) columns[layerOf.get(k)!].push(k);

  // Both of the spec's fixed sizes, brought inside what the frame can actually
  // hold — see `PADDING_BUDGET` and `columnThickness`. Everything below reads
  // these rather than the spec, so the scale and the positions can't disagree
  // about how much room the gaps take.
  const thickness = columnThickness(input.nodeThicknessEmu, input.alongExtent, layers);
  const tallest = columns.reduce((n, c) => Math.max(n, c.length), 0);
  const padding =
    tallest > 1
      ? Math.min(
          input.nodePaddingEmu,
          Math.floor((input.acrossExtent * PADDING_BUDGET) / (tallest - 1)),
        )
      : input.nodePaddingEmu;

  const scale = valueScale(columns, valueOf, input.acrossExtent, padding);

  /* --- ordering within each column --- */
  reduceCrossings(columns, links, layerOf);

  /* --- positions --- */
  const nodes: PlacedSankeyNode[] = [];
  const placedByKey = new Map<string, PlacedSankeyNode>();
  // Columns are spread evenly, with the last one ending flush against the far
  // edge so the diagram fills its frame rather than trailing off.
  const step = layers > 1 ? (input.alongExtent - thickness) / (layers - 1) : 0;

  for (let layer = 0; layer < layers; layer++) {
    const column = columns[layer];
    const used = column.reduce((sum, k) => sum + valueOf.get(k)! * scale, 0);
    const gaps = padding * Math.max(0, column.length - 1);
    // Centre the column across the frame; a short column floating at the top
    // reads as a mistake rather than as a design.
    let across = Math.round((input.acrossExtent - used - gaps) / 2);

    for (const key of column) {
      const value = valueOf.get(key)!;
      const extent = Math.max(1, Math.round(value * scale));
      const placed: PlacedSankeyNode = {
        key,
        label: byKey.get(key)!.label,
        layer,
        value,
        index: order.indexOf(key),
        along: Math.round(layer * step),
        alongExtent: thickness,
        across,
        acrossExtent: extent,
      };
      nodes.push(placed);
      placedByKey.set(key, placed);
      across += extent + padding;
    }
  }

  /* --- link endpoints --- */
  // Each side of a node stacks its ribbons in the order of the nodes at the
  // FAR end. That single rule is what stops ribbons from needlessly crossing
  // each other inside the gap between two columns.
  const acrossOf = (key: string) => placedByKey.get(key)?.across ?? 0;
  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();

  const sortedForSource = [...links].sort(
    (a, b) => acrossOf(a.to) - acrossOf(b.to) || a.key.localeCompare(b.key),
  );
  const startAcross = new Map<string, number>();
  for (const l of sortedForSource) {
    const node = placedByKey.get(l.from)!;
    const cursor = outCursor.get(l.from) ?? node.across;
    startAcross.set(l.key, cursor);
    outCursor.set(l.from, cursor + l.value * scale);
  }

  const sortedForTarget = [...links].sort(
    (a, b) => acrossOf(a.from) - acrossOf(b.from) || a.key.localeCompare(b.key),
  );
  const endAcross = new Map<string, number>();
  for (const l of sortedForTarget) {
    const node = placedByKey.get(l.to)!;
    const cursor = inCursor.get(l.to) ?? node.across;
    endAcross.set(l.key, cursor);
    inCursor.set(l.to, cursor + l.value * scale);
  }

  const placedLinks: PlacedSankeyLink[] = links.map((l) => {
    const source = placedByKey.get(l.from)!;
    const target = placedByKey.get(l.to)!;
    const thickness = Math.max(1, Math.round(l.value * scale));
    return {
      key: l.key,
      from: l.from,
      to: l.to,
      value: l.value,
      sourceIndex: source.index,
      startAlong: source.along + source.alongExtent,
      endAlong: target.along,
      startAcross: Math.round(startAcross.get(l.key)!),
      endAcross: Math.round(endAcross.get(l.key)!),
      thickness,
    };
  });

  return { nodes, links: placedLinks, layers, diagnostics };
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

function usableLinks(
  links: SankeyLink[],
  byKey: Map<string, SankeyNode>,
  diagnostics: SankeyDiagnostic[],
): SankeyLink[] {
  const out: SankeyLink[] = [];
  for (const l of links) {
    if (!byKey.has(l.from) || !byKey.has(l.to)) {
      diagnostics.push({
        severity: 'warning',
        code: 'sankey-unknown-node',
        message: `Flow "${l.key}" points at a node that doesn't exist (${
          byKey.has(l.from) ? l.to : l.from
        }); it isn't drawn.`,
      });
      continue;
    }
    if (l.from === l.to) {
      diagnostics.push({
        severity: 'warning',
        code: 'sankey-self-link',
        message: `"${byKey.get(l.from)!.label}" flows into itself; that flow isn't drawn.`,
      });
      continue;
    }
    if (!(l.value > 0)) {
      // A zero or negative flow has no width to draw and would drag the
      // running offsets backwards through their own node.
      diagnostics.push({
        severity: 'warning',
        code: 'sankey-nonpositive',
        message: `Flow "${l.key}" is ${l.value}; a Sankey can only show flows above zero.`,
      });
      continue;
    }
    out.push(l);
  }
  return out;
}

/**
 * Longest-path layering, with cycles broken rather than hung on.
 *
 * A node sits one column past the furthest node feeding it, so every ribbon
 * runs strictly forward. Cycles have no such ordering at all, so the link that
 * closes one is reported and dropped from the layering — the alternative is a
 * layout that never terminates.
 */
function assignLayers(
  order: string[],
  byKey: Map<string, SankeyNode>,
  links: SankeyLink[],
  diagnostics: SankeyDiagnostic[],
): Map<string, number> {
  const targets = new Map<string, string[]>();
  for (const l of links) {
    targets.set(l.from, [...(targets.get(l.from) ?? []), l.to]);
  }

  const layer = new Map<string, number>(order.map((k) => [k, 0]));
  const state = new Map<string, 'fresh' | 'open' | 'done'>(order.map((k) => [k, 'fresh']));
  let reportedCycle = false;

  // Iterative depth-first, so a deep chain can't blow the call stack on a
  // diagram someone pasted in from a spreadsheet.
  for (const root of order) {
    if (state.get(root) !== 'fresh') continue;
    const stack: { key: string; childIndex: number }[] = [{ key: root, childIndex: 0 }];
    state.set(root, 'open');

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const children = targets.get(frame.key) ?? [];

      if (frame.childIndex >= children.length) {
        state.set(frame.key, 'done');
        stack.pop();
        continue;
      }

      const child = children[frame.childIndex++];
      if (state.get(child) === 'open') {
        if (!reportedCycle) {
          reportedCycle = true;
          diagnostics.push({
            severity: 'warning',
            code: 'sankey-cycle',
            message: `The flows loop back on themselves (through "${
              byKey.get(child)!.label
            }"). A Sankey has to run one way, so the looping flow is drawn but not used to order the columns.`,
          });
        }
        continue;
      }

      const want = layer.get(frame.key)! + 1;
      if (want > layer.get(child)!) layer.set(child, want);
      if (state.get(child) !== 'open') {
        state.set(child, 'open');
        stack.push({ key: child, childIndex: 0 });
      }
    }
  }

  // An explicit pin overrides everything the links implied.
  for (const k of order) {
    const pinned = byKey.get(k)!.layer;
    if (pinned !== undefined && pinned >= 0) layer.set(k, Math.floor(pinned));
  }

  return layer;
}

/* ------------------------------------------------------------------ */
/* Scale and ordering                                                 */
/* ------------------------------------------------------------------ */

/**
 * EMU per unit of flow.
 *
 * Set by the BUSIEST column: every column shares one scale, because a Sankey's
 * whole claim is that a ribbon twice as thick carries twice as much. Scaling
 * each column to fit its own space independently would break that.
 */
function valueScale(
  columns: string[][],
  valueOf: Map<string, number>,
  acrossExtent: EMU,
  padding: EMU,
): number {
  let scale = Infinity;
  for (const column of columns) {
    if (!column.length) continue;
    const total = column.reduce((sum, k) => sum + valueOf.get(k)!, 0);
    if (total <= 0) continue;
    // `padding` is already capped at a fraction of the extent (see
    // `PADDING_BUDGET`), so what's left over is always a real share of the
    // frame — no floor to apply here, and no way for the gaps plus the flows
    // to add up to more than the column was given.
    const usable = acrossExtent - padding * (column.length - 1);
    scale = Math.min(scale, Math.max(0, usable) / total);
  }
  return Number.isFinite(scale) ? scale : 0;
}

/**
 * Order nodes within each column to reduce ribbon crossings.
 *
 * The standard barycentre heuristic: put each node at the average position of
 * the nodes it connects to, sweep forward and back, keep the order stable when
 * two nodes tie. It isn't optimal — crossing minimisation is NP-hard — but it
 * removes the crossings a reader would notice, and it always returns the same
 * answer for the same input.
 */
function reduceCrossings(
  columns: string[][],
  links: SankeyLink[],
  layerOf: Map<string, number>,
): void {
  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();
  for (const l of links) {
    if (layerOf.get(l.from)! >= layerOf.get(l.to)!) continue; // a broken cycle
    outbound.set(l.from, [...(outbound.get(l.from) ?? []), l.to]);
    inbound.set(l.to, [...(inbound.get(l.to) ?? []), l.from]);
  }

  const positions = new Map<string, number>();
  const reindex = () => {
    for (const column of columns) column.forEach((k, i) => positions.set(k, i));
  };
  reindex();

  const barycentre = (key: string, neighbours: Map<string, string[]>): number | null => {
    const ns = neighbours.get(key);
    if (!ns?.length) return null;
    return ns.reduce((sum, n) => sum + (positions.get(n) ?? 0), 0) / ns.length;
  };

  const sweep = (neighbours: Map<string, string[]>, order: number[]) => {
    for (const layer of order) {
      const column = columns[layer];
      if (column.length < 2) continue;
      // A node with no neighbours in the reference column keeps its current
      // slot rather than being shoved to the top by a default of zero.
      const keyed = column.map((k, i) => ({ k, b: barycentre(k, neighbours) ?? i, i }));
      keyed.sort((a, b) => a.b - b.b || a.i - b.i);
      columns[layer] = keyed.map((e) => e.k);
    }
    reindex();
  };

  const forward = columns.map((_, i) => i);
  const backward = [...forward].reverse();
  for (let i = 0; i < SWEEPS; i++) {
    sweep(inbound, forward);
    sweep(outbound, backward);
  }
}
