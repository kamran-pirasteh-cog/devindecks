/**
 * Preset geometry -> SVG. Each shape is drawn in its own local viewBox
 * (0 0 W H) so it scales with the element box. These mirror the OOXML preset
 * geometries we allow; the SVG here and the exported <a:prstGeom> must stay in
 * lockstep so the editor preview matches PowerPoint/Slides.
 */
import type { ShapePreset } from '@/model';

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
  const iw = w - strokeWidth;
  const ih = h - strokeWidth;

  switch (preset) {
    case 'ellipse':
      return (
        <ellipse cx={w / 2} cy={h / 2} rx={iw / 2} ry={ih / 2} {...common} />
      );
    case 'roundRect': {
      const r = Math.min(w, h) * 0.12;
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
