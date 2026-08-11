/**
 * SlideView — renders a Slide from the canonical model to DOM/SVG. This is the
 * WYSIWYG surface: what it draws must equal what the .pptx export produces.
 * Geometry comes in as EMU and is scaled to px by a single factor so nothing
 * drifts. Fonts, colors and sizes all resolve through the active DesignSystem.
 */
import { Fragment } from 'react';
import {
  EMU_PER_POINT,
  FONTS,
  resolveColor,
  type DesignSystem,
  type EMU,
  type Fill,
  type Outline,
  type Paragraph,
  type Slide,
  type SlideElement,
  type TextBody,
} from '@/model';
import { ShapeGeom } from './geometry';

interface SlideViewProps {
  slide: Slide;
  slideSize: { w: EMU; h: EMU };
  designSystem: DesignSystem;
  /** Rendered width in px; height derives from aspect ratio. */
  width: number;
  className?: string;
}

const dashArray = (dash: Outline['dash'], stroke: number): string | undefined => {
  if (dash === 'dash') return `${stroke * 3} ${stroke * 2}`;
  if (dash === 'dot') return `${stroke} ${stroke * 1.5}`;
  return undefined;
};

function fillToCss(fill: Fill | undefined, ds: DesignSystem): string {
  if (!fill || fill.kind === 'none') return 'transparent';
  return resolveColor(fill.color, ds);
}

/** Render a text body as stacked paragraphs with per-run styling. */
function TextBodyView({
  body,
  ds,
  scale,
}: {
  body: TextBody;
  ds: DesignSystem;
  scale: number;
}) {
  const justify =
    body.anchor === 'middle'
      ? 'center'
      : body.anchor === 'bottom'
        ? 'flex-end'
        : 'flex-start';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        paddingLeft: (body.insets?.l ?? 91440) * scale,
        paddingTop: (body.insets?.t ?? 45720) * scale,
        paddingRight: (body.insets?.r ?? 91440) * scale,
        paddingBottom: (body.insets?.b ?? 45720) * scale,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        overflow: 'hidden',
      }}
    >
      {body.paragraphs.map((p, i) => (
        <ParagraphView key={i} p={p} ds={ds} scale={scale} />
      ))}
    </div>
  );
}

function ParagraphView({
  p,
  ds,
  scale,
}: {
  p: Paragraph;
  ds: DesignSystem;
  scale: number;
}) {
  const textAlign = (p.align ?? 'left') as 'left' | 'center' | 'right' | 'justify';
  return (
    <p
      style={{
        margin: 0,
        marginTop: (p.spaceBeforePt ?? 0) * EMU_PER_POINT * scale,
        marginBottom: (p.spaceAfterPt ?? 0) * EMU_PER_POINT * scale,
        textAlign,
        lineHeight: (p.lineSpacingPct ?? 100) / 100,
        paddingLeft: p.bullet && p.bullet !== 'none' ? 18 * scale * 16 : 0,
        textIndent: 0,
      }}
    >
      {p.bullet === 'bullet' ? '• ' : null}
      {p.runs.map((r, i) => {
        const font = FONTS[r.font ?? ds.fonts.body];
        return (
          <span
            key={i}
            style={{
              fontFamily: font.cssStack,
              fontSize: (r.sizePt ?? ds.type.body.sizePt) * EMU_PER_POINT * scale,
              fontWeight: r.bold ? 700 : 400,
              fontStyle: r.italic ? 'italic' : 'normal',
              textDecoration: r.underline ? 'underline' : 'none',
              color: resolveColor(r.color, ds),
              whiteSpace: 'pre-wrap',
            }}
          >
            {r.text}
          </span>
        );
      })}
    </p>
  );
}

function ElementView({
  el,
  ds,
  scale,
}: {
  el: SlideElement;
  ds: DesignSystem;
  scale: number;
}) {
  const w = el.rect.w * scale;
  const h = el.rect.h * scale;
  const box: React.CSSProperties = {
    position: 'absolute',
    left: el.rect.x * scale,
    top: el.rect.y * scale,
    width: w,
    height: h,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: 'center center',
  };

  switch (el.type) {
    case 'text':
      return (
        <div style={{ ...box, background: fillToCss(el.fill, ds) }}>
          <TextBodyView body={el.body} ds={ds} scale={scale} />
        </div>
      );

    case 'shape': {
      const strokeW = el.outline ? el.outline.widthEmu * scale : 0;
      return (
        <div style={box}>
          <svg
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
          >
            <ShapeGeom
              preset={el.preset}
              w={w}
              h={h}
              fill={fillToCss(el.fill, ds)}
              stroke={el.outline ? resolveColor(el.outline.color, ds) : undefined}
              strokeWidth={strokeW}
              dash={el.outline ? dashArray(el.outline.dash, strokeW) : undefined}
            />
          </svg>
          {el.body ? <TextBodyView body={el.body} ds={ds} scale={scale} /> : null}
        </div>
      );
    }

    case 'line': {
      const strokeW = el.outline.widthEmu * scale;
      // Direction encoded by flipV (default: top-left -> bottom-right).
      const y1 = el.flipV ? h : 0;
      const y2 = el.flipV ? 0 : h;
      return (
        <div style={box}>
          <svg width={w} height={h} style={{ overflow: 'visible' }}>
            <line
              x1={0}
              y1={y1}
              x2={w}
              y2={y2}
              stroke={resolveColor(el.outline.color, ds)}
              strokeWidth={strokeW}
              strokeDasharray={dashArray(el.outline.dash, strokeW)}
              strokeLinecap="round"
            />
          </svg>
        </div>
      );
    }

    case 'picture':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={el.src}
          alt={el.name ?? ''}
          style={{ ...box, objectFit: 'cover' }}
        />
      );

    default:
      return null;
  }
}

export function SlideView({
  slide,
  slideSize,
  designSystem,
  width,
  className,
}: SlideViewProps) {
  const scale = width / slideSize.w;
  const height = slideSize.h * scale;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width,
        height,
        background: fillToCss(slide.background, designSystem) || '#ffffff',
        overflow: 'hidden',
      }}
    >
      {slide.elements.map((el) => (
        <Fragment key={el.id}>
          <ElementView el={el} ds={designSystem} scale={scale} />
        </Fragment>
      ))}
    </div>
  );
}
