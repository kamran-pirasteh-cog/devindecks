/**
 * SlideView — renders a Slide from the canonical model to DOM/SVG. This is the
 * WYSIWYG surface: what it draws must equal what the .pptx export produces.
 *
 * The per-element visuals live in <ElementVisual>, which the interactive editor
 * canvas reuses verbatim — so the editing surface, the thumbnail, the preview,
 * and the export are all literally the same rendering of the same model.
 */
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

const dashArray = (dash: Outline['dash'], stroke: number): string | undefined => {
  if (dash === 'dash') return `${stroke * 3} ${stroke * 2}`;
  if (dash === 'dot') return `${stroke} ${stroke * 1.5}`;
  return undefined;
};

export function fillToCss(fill: Fill | undefined, ds: DesignSystem): string {
  if (!fill || fill.kind === 'none') return 'transparent';
  return resolveColor(fill.color, ds);
}

/** Render a text body as stacked paragraphs with per-run styling. */
export function TextBodyView({
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
        pointerEvents: 'none',
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

/**
 * The visual for a single element, filling its parent box (which must be sized
 * to el.rect * scale and positioned by the caller). No selection chrome here —
 * purely the model's appearance.
 */
export function ElementVisual({
  el,
  ds,
  scale,
  hideBody,
  sizeOverridePx,
}: {
  el: SlideElement;
  ds: DesignSystem;
  scale: number;
  hideBody?: boolean;
  /** Live px size during an active resize drag, before the store commit lands. */
  sizeOverridePx?: { w: number; h: number };
}) {
  const w = sizeOverridePx?.w ?? el.rect.w * scale;
  const h = sizeOverridePx?.h ?? el.rect.h * scale;

  switch (el.type) {
    case 'text':
      return (
        <div style={{ position: 'absolute', inset: 0, background: fillToCss(el.fill, ds) }}>
          {hideBody ? null : <TextBodyView body={el.body} ds={ds} scale={scale} />}
        </div>
      );

    case 'shape': {
      const strokeW = el.outline ? el.outline.widthEmu * scale : 0;
      return (
        <div style={{ position: 'absolute', inset: 0 }}>
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
          {el.body && !hideBody ? <TextBodyView body={el.body} ds={ds} scale={scale} /> : null}
        </div>
      );
    }

    case 'line': {
      const strokeW = el.outline.widthEmu * scale;
      const y1 = el.flipV ? h : 0;
      const y2 = el.flipV ? 0 : h;
      return (
        <svg width={w} height={h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
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
      );
    }

    case 'picture':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={el.src}
          alt={el.name ?? ''}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      );

    default:
      return null;
  }
}

function PositionedElement({
  el,
  ds,
  scale,
}: {
  el: SlideElement;
  ds: DesignSystem;
  scale: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: el.rect.x * scale,
        top: el.rect.y * scale,
        width: el.rect.w * scale,
        height: el.rect.h * scale,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
    >
      <ElementVisual el={el} ds={ds} scale={scale} />
    </div>
  );
}

interface SlideViewProps {
  slide: Slide;
  slideSize: { w: EMU; h: EMU };
  designSystem: DesignSystem;
  width: number;
  className?: string;
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
        <PositionedElement key={el.id} el={el} ds={designSystem} scale={scale} />
      ))}
    </div>
  );
}
