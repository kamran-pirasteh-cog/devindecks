/**
 * Shape geometry: OOXML `prstGeom`/`custGeom` -> our `ShapePreset` or `PathOp[]`.
 *
 * The model deliberately allows only eight preset geometries (the ones that
 * render identically in PowerPoint and Google Slides), but a real deck uses
 * dozens. Rather than flatten everything unmapped to a rectangle, anything
 * outside the eight is emitted as a PATH — the model's freeform primitive,
 * which exports to `<a:custGeom>` and therefore survives the round trip with
 * its actual outline intact. So a hexagon imports as a hexagon, not a box.
 *
 * Path coordinates are normalized 0..1 against the element box, per the
 * PathElement contract, so an imported freeform scales with every other
 * element.
 */
import type { PathOp, ShapePreset } from '@/model';
import { attr, children, child, numAttr, type XmlNode } from '../xml';

/** OOXML presets that ARE one of our eight, exactly. */
const DIRECT_PRESETS: Record<string, ShapePreset> = {
  rect: 'rect',
  roundRect: 'roundRect',
  round1Rect: 'roundRect',
  round2SameRect: 'roundRect',
  round2DiagRect: 'roundRect',
  snip1Rect: 'rect',
  snip2SameRect: 'rect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  rightArrow: 'rightArrow',
  chevron: 'chevron',
  homePlate: 'chevron',
  flowChartProcess: 'rect',
  flowChartAlternateProcess: 'roundRect',
  flowChartDecision: 'diamond',
  flowChartConnector: 'ellipse',
  flowChartTerminator: 'pill',
  actionButtonBlank: 'rect',
  pie: 'ellipse',
  blockArc: 'ellipse',
};

/** Presets that mean "a straight line", handled as a LineElement instead. */
export const LINE_PRESETS = new Set([
  'line',
  'straightConnector1',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
]);

export const presetToShape = (prst: string): ShapePreset | undefined => DIRECT_PRESETS[prst];

/**
 * A normalized outline for presets we don't have natively.
 *
 * Adjust values (`adj`) are ignored except where they change the shape's
 * identity — the point is a faithful silhouette, not a re-implementation of
 * PowerPoint's 187 geometry formulas.
 */
export function presetToPath(prst: string, adj: Record<string, number>): PathOp[] | undefined {
  const poly = (...pts: [number, number][]): PathOp[] => [
    { op: 'M', x: pts[0][0], y: pts[0][1] },
    ...pts.slice(1).map(([x, y]) => ({ op: 'L' as const, x, y })),
    { op: 'Z' },
  ];
  // `adj1` is a fraction of the shape's smaller side in OOXML; as a 0..1
  // silhouette parameter the direct reading is close enough and always sane.
  const a1 = adj.adj1 !== undefined ? Math.min(0.5, Math.abs(adj.adj1) / 100_000) : undefined;

  switch (prst) {
    case 'parallelogram': {
      const s = a1 ?? 0.25;
      return poly([s, 0], [1, 0], [1 - s, 1], [0, 1]);
    }
    case 'trapezoid': {
      const s = a1 ?? 0.25;
      return poly([s, 0], [1 - s, 0], [1, 1], [0, 1]);
    }
    case 'hexagon': {
      const s = a1 ?? 0.25;
      return poly([s, 0], [1 - s, 0], [1, 0.5], [1 - s, 1], [s, 1], [0, 0.5]);
    }
    case 'octagon': {
      const s = a1 ?? 0.29;
      return poly(
        [s, 0], [1 - s, 0], [1, s], [1, 1 - s],
        [1 - s, 1], [s, 1], [0, 1 - s], [0, s],
      );
    }
    case 'pentagon':
      return regularPolygon(5, -90);
    case 'heptagon':
      return regularPolygon(7, -90);
    case 'decagon':
      return regularPolygon(10, -90);
    case 'star4':
      return star(4, 0.38);
    case 'star5':
      return star(5, 0.382);
    case 'star6':
      return star(6, 0.5);
    case 'star8':
      return star(8, 0.55);
    case 'plus': {
      const s = a1 ?? 0.25;
      return poly(
        [s, 0], [1 - s, 0], [1 - s, s], [1, s], [1, 1 - s], [1 - s, 1 - s],
        [1 - s, 1], [s, 1], [s, 1 - s], [0, 1 - s], [0, s], [s, s],
      );
    }
    case 'mathMinus':
      return poly([0, 0.4], [1, 0.4], [1, 0.6], [0, 0.6]);
    case 'leftArrow':
      return poly([0, 0.5], [0.4, 0], [0.4, 0.25], [1, 0.25], [1, 0.75], [0.4, 0.75], [0.4, 1]);
    case 'upArrow':
      return poly([0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1], [0.25, 1], [0.25, 0.4], [0, 0.4]);
    case 'downArrow':
      return poly([0.25, 0], [0.75, 0], [0.75, 0.6], [1, 0.6], [0.5, 1], [0, 0.6], [0.25, 0.6]);
    case 'leftRightArrow':
      return poly(
        [0, 0.5], [0.25, 0.1], [0.25, 0.3], [0.75, 0.3], [0.75, 0.1], [1, 0.5],
        [0.75, 0.9], [0.75, 0.7], [0.25, 0.7], [0.25, 0.9],
      );
    case 'bentArrow':
    case 'uturnArrow':
      return poly(
        [0, 1], [0, 0.45], [0.55, 0.45], [0.55, 0.2], [1, 0.5], [0.55, 0.8],
        [0.55, 0.6], [0.18, 0.6], [0.18, 1],
      );
    case 'triangleRight':
    case 'rtTriangle':
      return poly([0, 0], [0, 1], [1, 1]);
    case 'teardrop':
      return poly([0.5, 0], [1, 0], [1, 0.5], [0.5, 1], [0, 0.5]);
    case 'cube':
      return poly([0, 0.25], [0.25, 0], [1, 0], [1, 0.75], [0.75, 1], [0, 1]);
    case 'can':
    case 'flowChartMagneticDrum':
      return poly([0, 0.12], [1, 0.12], [1, 0.88], [0, 0.88]);
    case 'flowChartPreparation':
      return poly([0.2, 0], [0.8, 0], [1, 0.5], [0.8, 1], [0.2, 1], [0, 0.5]);
    case 'flowChartInputOutput':
    case 'flowChartOutputInput':
      return poly([0.2, 0], [1, 0], [0.8, 1], [0, 1]);
    case 'flowChartInternalStorage':
      return poly([0, 0], [1, 0], [1, 1], [0, 1]);
    case 'chord':
    case 'halfFrame':
      return poly([0, 0], [1, 0], [0, 1]);
    default:
      return undefined;
  }
}

function regularPolygon(n: number, startDeg: number): PathOp[] {
  const ops: PathOp[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    const x = 0.5 + 0.5 * Math.cos(a);
    const y = 0.5 + 0.5 * Math.sin(a);
    ops.push(i === 0 ? { op: 'M', x, y } : { op: 'L', x, y });
  }
  ops.push({ op: 'Z' });
  return ops;
}

/** `innerRatio` is the valley radius as a fraction of the point radius. */
function star(points: number, innerRatio: number): PathOp[] {
  const ops: PathOp[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? 0.5 : 0.5 * innerRatio;
    const a = ((-90 + (180 / points) * i) * Math.PI) / 180;
    const x = 0.5 + radius * Math.cos(a);
    const y = 0.5 + radius * Math.sin(a);
    ops.push(i === 0 ? { op: 'M', x, y } : { op: 'L', x, y });
  }
  ops.push({ op: 'Z' });
  return ops;
}

/** `<a:avLst><a:gd name="adj1" fmla="val 16667"/></a:avLst>` -> `{adj1: 16667}`. */
export function parseAdjustments(prstGeom: XmlNode | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const gd of children(child(prstGeom, 'avLst'), 'gd')) {
    const name = attr(gd, 'name');
    const fmla = attr(gd, 'fmla');
    if (!name || !fmla?.startsWith('val ')) continue;
    const n = Number(fmla.slice(4));
    if (Number.isFinite(n)) out[name] = n;
  }
  return out;
}

/**
 * `<a:custGeom>` -> normalized path ops.
 *
 * Each `<a:path>` declares its own coordinate space via `w`/`h`; we divide by
 * those (falling back to the shape's EMU extents) so the result is 0..1.
 * `arcTo` is flattened into <=90 degree cubics, matching the same restriction
 * the exporter honours in the other direction.
 */
export function custGeomToPath(
  custGeom: XmlNode,
  extents: { w: number; h: number },
): PathOp[] {
  const ops: PathOp[] = [];
  let cursor = { x: 0, y: 0 };

  for (const p of children(child(custGeom, 'pathLst'), 'path')) {
    const pw = numAttr(p, 'w') || extents.w || 1;
    const ph = numAttr(p, 'h') || extents.h || 1;
    const nx = (v: number) => v / pw;
    const ny = (v: number) => v / ph;
    const pt = (node: XmlNode | undefined) => ({
      x: numAttr(node, 'x') ?? 0,
      y: numAttr(node, 'y') ?? 0,
    });

    for (const cmd of p.children) {
      switch (cmd.name) {
        case 'moveTo': {
          const to = pt(child(cmd, 'pt'));
          cursor = to;
          ops.push({ op: 'M', x: nx(to.x), y: ny(to.y) });
          break;
        }
        case 'lnTo': {
          const to = pt(child(cmd, 'pt'));
          cursor = to;
          ops.push({ op: 'L', x: nx(to.x), y: ny(to.y) });
          break;
        }
        case 'cubicBezTo': {
          const pts = children(cmd, 'pt').map(pt);
          if (pts.length < 3) break;
          cursor = pts[2];
          ops.push({
            op: 'C',
            x1: nx(pts[0].x), y1: ny(pts[0].y),
            x2: nx(pts[1].x), y2: ny(pts[1].y),
            x: nx(pts[2].x), y: ny(pts[2].y),
          });
          break;
        }
        case 'quadBezTo': {
          const pts = children(cmd, 'pt').map(pt);
          if (pts.length < 2) break;
          // Elevate the quadratic to a cubic: the two control points sit two
          // thirds of the way from each end toward the quadratic's control.
          const c1 = {
            x: cursor.x + (2 / 3) * (pts[0].x - cursor.x),
            y: cursor.y + (2 / 3) * (pts[0].y - cursor.y),
          };
          const c2 = {
            x: pts[1].x + (2 / 3) * (pts[0].x - pts[1].x),
            y: pts[1].y + (2 / 3) * (pts[0].y - pts[1].y),
          };
          cursor = pts[1];
          ops.push({
            op: 'C',
            x1: nx(c1.x), y1: ny(c1.y),
            x2: nx(c2.x), y2: ny(c2.y),
            x: nx(pts[1].x), y: ny(pts[1].y),
          });
          break;
        }
        case 'arcTo': {
          const wR = numAttr(cmd, 'wR') ?? 0;
          const hR = numAttr(cmd, 'hR') ?? 0;
          const stAng = ((numAttr(cmd, 'stAng') ?? 0) / 60_000) * (Math.PI / 180);
          const swAng = ((numAttr(cmd, 'swAng') ?? 0) / 60_000) * (Math.PI / 180);
          // OOXML gives the arc relative to the CURRENT point, which sits at
          // stAng on the ellipse — so the centre is back-computed from it.
          const cx = cursor.x - wR * Math.cos(stAng);
          const cy = cursor.y - hR * Math.sin(stAng);
          for (const seg of arcSegments(cx, cy, wR, hR, stAng, swAng)) {
            ops.push({
              op: 'C',
              x1: nx(seg.x1), y1: ny(seg.y1),
              x2: nx(seg.x2), y2: ny(seg.y2),
              x: nx(seg.x), y: ny(seg.y),
            });
            cursor = { x: seg.x, y: seg.y };
          }
          break;
        }
        case 'close':
          ops.push({ op: 'Z' });
          break;
      }
    }
  }
  return ops;
}

interface CubicSeg {
  x1: number; y1: number;
  x2: number; y2: number;
  x: number; y: number;
}

/** Flatten an elliptical arc into cubic segments of at most 90 degrees. */
function arcSegments(
  cx: number, cy: number, rx: number, ry: number,
  start: number, sweep: number,
): CubicSeg[] {
  const segs: CubicSeg[] = [];
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const step = sweep / count;
  // Magic constant for a cubic approximation of a circular arc of `step`.
  const k = (4 / 3) * Math.tan(step / 4);

  let a0 = start;
  for (let i = 0; i < count; i++) {
    const a1 = a0 + step;
    const p0 = { x: cx + rx * Math.cos(a0), y: cy + ry * Math.sin(a0) };
    const p1 = { x: cx + rx * Math.cos(a1), y: cy + ry * Math.sin(a1) };
    segs.push({
      x1: p0.x - k * rx * Math.sin(a0),
      y1: p0.y + k * ry * Math.cos(a0),
      x2: p1.x + k * rx * Math.sin(a1),
      y2: p1.y - k * ry * Math.cos(a1),
      x: p1.x,
      y: p1.y,
    });
    a0 = a1;
  }
  return segs;
}
