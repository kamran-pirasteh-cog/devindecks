/**
 * Marks -> `SlideElement[]`.
 *
 * The only place in the chart engine that knows the element model exists. Two
 * things matter here and nowhere else:
 *
 * 1. **Ids are deterministic** — `${chartId}::${partKey}`. `reconcileChartElements`
 *    diffs on them, so a fresh nanoid per recompile would throw away z-order,
 *    selection and React's reconciliation on every keystroke.
 * 2. **Everything carries `chartRef`** — the address of the spec node it came
 *    from, so a click on the canvas can edit the chart rather than the rectangle.
 */
import { elementIdFor } from '@/model';
import { displayText } from '@/render/measureText';
import type {
  LineElement,
  PathElement,
  ShapeElement,
  SlideElement,
  TextElement,
} from '@/model';
import type { Mark } from './mark';

/** The semantic role for a mark, in the same namespace as the rest of the deck. */
function roleFor(mark: Mark): string {
  switch (mark.ref.part) {
    case 'mark':
      return 'chart.series';
    case 'label':
      return 'chart.label';
    case 'total':
      return 'chart.total';
    case 'axis':
      switch (mark.ref.sub) {
        case 'grid':
          return 'chart.gridline';
        case 'line':
          return 'chart.axis';
        case 'title':
          return 'chart.axislabel';
        case 'unitNote':
          return 'chart.unitnote';
        default:
          return 'chart.tick';
      }
    case 'legend.item':
    case 'legend.box':
      return 'chart.legend';
    case 'title':
      return 'chart.title';
    case 'plot':
      return 'chart.plot';
    case 'decoration':
      return 'chart.decoration';
  }
}

export function emitMarks(marks: Mark[], groupId: string): SlideElement[] {
  return marks.map((mark) => emitMark(mark, groupId));
}

function emitMark(mark: Mark, groupId: string): SlideElement {
  const common = {
    id: elementIdFor(mark.ref),
    role: roleFor(mark),
    name: mark.name,
    rect: mark.rect,
    groupIds: [groupId],
    chartRef: mark.ref,
  };

  switch (mark.kind) {
    case 'rect': {
      const el: ShapeElement = {
        ...common,
        type: 'shape',
        preset: 'rect',
        fill: mark.fill,
        outline: mark.outline,
      };
      return el;
    }
    case 'marker': {
      const el: ShapeElement = {
        ...common,
        type: 'shape',
        // Markers are the one place a chart needs a non-rect preset today;
        // richer shapes arrive with the path primitive.
        preset: mark.shape === 'square' ? 'rect' : mark.shape === 'diamond' ? 'diamond' : 'ellipse',
        fill: mark.fill,
        outline: mark.outline,
      };
      return el;
    }
    case 'path': {
      const el: PathElement = {
        ...common,
        type: 'path',
        d: mark.d,
        fill: mark.fill,
        outline: mark.outline,
      };
      return el;
    }
    case 'line': {
      const el: LineElement = {
        ...common,
        type: 'line',
        outline: { color: mark.color, widthEmu: mark.widthEmu, dash: mark.dash },
        ...(mark.flipV ? { flipV: true } : {}),
      };
      return el;
    }
    case 'text': {
      const el: TextElement = {
        ...common,
        type: 'text',
        rotation: mark.style.rotation,
        body: {
          anchor: mark.style.anchor,
          wrap: mark.style.wrap ?? true,
          // Charts position their own text exactly; PowerPoint's default inset
          // would shift every label by 0.1in and break the alignment we solved.
          insets: { l: 0, t: 0, r: 0, b: 0 },
          paragraphs: [
            {
              align: mark.style.align,
              runs: [
                {
                  text: displayText(mark.text, mark.style),
                  font: mark.style.font,
                  sizePt: mark.style.sizePt,
                  bold: mark.style.bold,
                  weight: mark.style.weight,
                  color: mark.style.color,
                },
              ],
            },
          ],
        },
      };
      return el;
    }
  }
}
