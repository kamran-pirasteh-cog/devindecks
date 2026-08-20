/**
 * Preset geometry -> SVG. Each shape is drawn in its own local viewBox
 * (0 0 W H) so it scales with the element box. These mirror the OOXML preset
 * geometries we allow; the SVG here and the exported <a:prstGeom> must stay in
 * lockstep so the editor preview matches PowerPoint/Slides.
 */
import { ROUND_RECT_RADIUS_RATIO } from '@/model';
import type { PathOp, ShapePreset } from '@/model';

export interface ShapeGeomProps {
  preset: ShapePreset;
  w: number;
  h: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: string; // svg dash-array or undefined
}

export function ShapeGeom({
  preset,
  w,
  h,
  fill,
  stroke,
  strokeWidth = 0,
  dash,
}: ShapeGeomProps) {
  const common = {
    fill,
    stroke: stroke ?? 'none',
    strokeWidth,
    strokeDasharray: dash,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  // Inset by half stroke so the outline isn't clipped by the viewBox edge.
  const s = strokeWidth / 2;
  // Clamped: at thumbnail scale a shape can be thinner than its own stroke,
  // and a negative width/height is invalid SVG.
  const iw = Math.max(0, w - strokeWidth);
  const ih = Math.max(0, h - strokeWidth);

  switch (preset) {
    case 'ellipse':
      return (
        <ellipse cx={w / 2} cy={h / 2} rx={iw / 2} ry={ih / 2} {...common} />
      );
    case 'roundRect': {
      const r = Math.min(w, h) * ROUND_RECT_RADIUS_RATIO;
      return (
        <rect x={s} y={s} width={iw} height={ih} rx={r} ry={r} {...common} />
      );
    }
    case 'pill': {
      const r = ih / 2;
      return (
        <rect x={s} y={s} width={iw} height={ih} rx={r} ry={r} {...common} />
      );
    }
    case 'triangle':
      return (
        <polygon points={`${w / 2},${s} ${w - s},${h - s} ${s},${h - s}`} {...common} />
      );
    case 'diamond':
      return (
        <polygon
          points={`${w / 2},${s} ${w - s},${h / 2} ${w / 2},${h - s} ${s},${h / 2}`}
          {...common}
        />
      );
    case 'rightArrow': {
      const tail = h * 0.25; // half-height of the shaft
      const headW = w * 0.4;
      const cy = h / 2;
      return (
        <polygon
          points={`${s},${cy - tail} ${w - headW},${cy - tail} ${w - headW},${s} ${w - s},${cy} ${w - headW},${h - s} ${w - headW},${cy + tail} ${s},${cy + tail}`}
          {...common}
        />
      );
    }
    case 'chevron': {
      const notch = h * 0.5;
      return (
        <polygon
          points={`${s},${s} ${w - notch},${s} ${w - s},${h / 2} ${w - notch},${h - s} ${s},${h - s} ${notch - s},${h / 2}`}
          {...common}
        />
      );
    }
    case 'rect':
    default:
      return <rect x={s} y={s} width={iw} height={ih} {...common} />;
  }
}

/**
 * A freeform path. Coordinates are normalized to the element box, so the same
 * `d` renders at any size — and the SVG here has to stay in lockstep with the
 * `<a:custGeom>` the exporter writes, exactly as `ShapeGeom` does with
 * `<a:prstGeom>`.
 */
export function PathGeom({
  d,
  w,
  h,
  fill,
  stroke,
  strokeWidth = 0,
  dash,
}: {
  d: PathOp[];
  w: number;
  h: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: string;
}) {
  return (
    <path
      d={pathData(d, w, h)}
      fill={fill}
      stroke={stroke ?? 'none'}
      strokeWidth={strokeWidth}
      strokeDasharray={dash}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** Normalized ops -> an SVG `d` string at a concrete pixel size. */
export function pathData(d: PathOp[], w: number, h: number): string {
  const x = (v: number) => (v * w).toFixed(3);
  const y = (v: number) => (v * h).toFixed(3);
  return d
    .map((op) => {
      switch (op.op) {
        case 'M':
          return `M ${x(op.x)} ${y(op.y)}`;
        case 'L':
          return `L ${x(op.x)} ${y(op.y)}`;
        case 'C':
          return `C ${x(op.x1)} ${y(op.y1)} ${x(op.x2)} ${y(op.y2)} ${x(op.x)} ${y(op.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}
