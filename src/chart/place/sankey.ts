/**
 * Sankey diagrams.
 *
 * Like a pie, this doesn't use the cartesian projector — there are no axes to
 * project onto. It takes the plot rect, asks `derive/sankey` for a layout in a
 * canonical left-to-right space, and transposes on the way out if the flow runs
 * top to bottom. One solve, two orientations.
 */
import { pointsToEmu, type EMU, type Rect, type SankeySpec } from '@/model';
import type { TextMeasurer } from '@/render/measureText';
import { lineHeightEmu } from '@/render/measureText';
import type { ChartTheme } from '../theme';
import type { Mark } from '../mark';
import { ribbonPath } from '../geom/path';
import { formatNumber } from '../format/number';
import { layoutSankey, type SankeyDiagnostic } from '../derive/sankey';
import { textStyle } from './cartesian';

export interface SankeyInput {
  chartId: string;
  spec: SankeySpec;
  plot: Rect;
  theme: ChartTheme;
  measurer: TextMeasurer;
}

/** Node bar thickness across the flow. Thin enough to read as a gate, not a bar. */
const DEFAULT_THICKNESS = pointsToEmu(9);
const DEFAULT_PADDING = pointsToEmu(10);
/** Ribbons overlap constantly; opaque ones would hide each other outright. */
const DEFAULT_ALPHA = 0.45;

export function placeSankey(input: SankeyInput): {
  marks: Mark[];
  diagnostics: SankeyDiagnostic[];
} {
  const { chartId, spec, plot, theme, measurer } = input;
  const vertical = spec.orientation === 'vertical';
  const marks: Mark[] = [];

  const labelStyle = textStyle(theme.text.dataLabel, 'left', 'middle');
  const labelH = lineHeightEmu(labelStyle);

  /**
   * A Sankey is ONE colour.
   *
   * Handing each node the next entry of a categorical ramp is what a bar chart
   * wants and what a Sankey emphatically doesn't: nodes in a flow diagram
   * aren't competing categories, they're stations on the same journey, and
   * seven of them exhausts any palette's first hue and starts inventing
   * clashes — a brown "Disqualified" next to an orange "Won" that mean nothing
   * by being different colours. Thickness carries the meaning here. Colour is
   * left free for EMPHASIS: set a node's fill and it tints everything
   * flowing out of it.
   */
  const nodeColor = theme.seriesColor(0);

  // Labels sit outside the end columns, so the flow has to give up that space
  // before anything is laid out — the alternative is a diagram that fills its
  // frame and then writes its labels off the edge of it.
  //
  // The same chicken-and-egg the axis gutter has: a label reads "Total  500",
  // and the 500 comes out of the layout we're sizing. Pass one measures the
  // names alone, pass two re-measures against the values it got back and
  // re-solves if they need more room. Two passes converge because the second
  // gutter is only ever wider.
  const gap = theme.sizes.labelGapEmu;
  const flowExtent = vertical ? plot.h : plot.w;
  const acrossExtent = Math.max(1, vertical ? plot.w : plot.h);

  const solve = (gutter: number) =>
    layoutSankey({
      data: spec.data,
      alongExtent: Math.max(1, flowExtent - gutter * 2),
      acrossExtent,
      nodeThicknessEmu: spec.nodeThicknessEmu ?? DEFAULT_THICKNESS,
      nodePaddingEmu: spec.nodePaddingEmu ?? DEFAULT_PADDING,
    });

  const gutterFor = (widest: number) => Math.min(widest + gap * 2, flowExtent * 0.3);

  const namesOnly = spec.data.nodes.reduce(
    (w, n) => Math.max(w, measurer.measure(labelText(n.label, undefined), labelStyle).wEmu),
    0,
  );
  let gutter = gutterFor(namesOnly);
  let layout = solve(gutter);

  if (layout.nodes.length) {
    const peers = layout.nodes.map((n) => n.value);
    const widest = layout.nodes.reduce((w, n) => {
      const value = spec.decorations.labels.show
        ? formatNumber(n.value, spec.numberFormat, { peers }).text
        : undefined;
      return Math.max(w, measurer.measure(labelText(n.label, value), labelStyle).wEmu);
    }, 0);
    const needed = gutterFor(widest);
    if (needed > gutter) {
      gutter = needed;
      layout = solve(gutter);
    }
  }

  if (!layout.nodes.length) return { marks, diagnostics: layout.diagnostics };

  /**
   * Layout space -> slide space. The gutter offset applies to the flow axis
   * only; the cross axis already spans the whole plot.
   */
  const toXY = (along: EMU, across: EMU) =>
    vertical
      ? { x: plot.x + across, y: plot.y + gutter + along }
      : { x: plot.x + gutter + along, y: plot.y + across };

  /* --- ribbons first, so nodes sit on top of their own flows --- */
  const alpha = spec.linkAlpha ?? DEFAULT_ALPHA;
  const overrideFor = (nodeKey: string) => {
    const fill = spec.data.nodes.find((n) => n.key === nodeKey)?.format?.fill;
    return fill?.kind === 'solid' ? fill.color : undefined;
  };

  for (const link of layout.links) {
    const start = toXY(link.startAlong, link.startAcross);
    const end = toXY(link.endAlong, link.endAcross);
    const path = ribbonPath(start, end, link.thickness, vertical ? 'y' : 'x');
    marks.push({
      kind: 'path',
      ref: { chartId, part: 'mark', series: link.from, point: link.key },
      name: `${nameOf(layout, link.from)} → ${nameOf(layout, link.to)}`,
      rect: path.box,
      d: path.d,
      // A ribbon takes its colour from where it came FROM, so a coloured node
      // tints everything downstream of it.
      fill: { kind: 'solid', color: overrideFor(link.from) ?? nodeColor, alpha },
    });
  }

  /* --- nodes --- */
  for (const node of layout.nodes) {
    const origin = toXY(node.along, node.across);
    const rect: Rect = vertical
      ? { x: origin.x, y: origin.y, w: node.acrossExtent, h: node.alongExtent }
      : { x: origin.x, y: origin.y, w: node.alongExtent, h: node.acrossExtent };

    marks.push({
      kind: 'rect',
      ref: { chartId, part: 'mark', series: node.key, point: node.key },
      name: node.label,
      rect,
      fill: { kind: 'solid', color: overrideFor(node.key) ?? nodeColor },
    });

    /* --- its label --- */
    const value = spec.decorations.labels.show
      ? formatNumber(node.value, spec.numberFormat, {
          peers: layout.nodes.map((n) => n.value),
        }).text
      : undefined;
    const text = labelText(node.label, value);
    const w = measurer.measure(text, labelStyle).wEmu + pointsToEmu(2);

    // The FIRST column labels backwards and the LAST forwards, so both sit in
    // the gutters reserved for them, clear of the diagram. Only the columns in
    // between have nowhere to go but forward across their own ribbons.
    const before = node.layer === 0 && layout.layers > 1;
    const style = textStyle(theme.text.dataLabel, before ? 'right' : 'left', 'middle');

    marks.push({
      kind: 'text',
      ref: { chartId, part: 'label', series: node.key, point: node.key },
      name: `${node.label} label`,
      text,
      style,
      rect: vertical
        ? {
            x: Math.round(rect.x + rect.w / 2 - w / 2),
            y: Math.round(before ? rect.y - gap - labelH : rect.y + rect.h + gap),
            w,
            h: labelH,
          }
        : {
            x: Math.round(before ? rect.x - gap - w : rect.x + rect.w + gap),
            y: Math.round(rect.y + rect.h / 2 - labelH / 2),
            w,
            h: labelH,
          },
    });
  }

  return { marks, diagnostics: layout.diagnostics };
}

const nameOf = (layout: ReturnType<typeof layoutSankey>, key: string): string =>
  layout.nodes.find((n) => n.key === key)?.label ?? key;

const labelText = (label: string, value: string | undefined): string =>
  value ? `${label}  ${value}` : label;
