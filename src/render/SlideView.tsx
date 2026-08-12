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
  type FontFamily,
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
      // Tagged so the editor can find this box and measure the text inside it
      // (fit-box-to-text) without knowing how the element wraps it.
      className="dd-text-body"
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
        // NOT `overflow: hidden`. A PowerPoint text box with autofit off does
        // not clip — text that outgrows the shape spills outside it and stays
        // fully visible (that's why "shrink text on overflow" exists as an
        // option). Google Slides does the same. Clipping here invented a
        // constraint the source app never applies, silently eating any line
        // that didn't fit a box we must not resize. The slide container still
        // clips at the slide edge, which IS what both engines do.
        overflow: 'visible',
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
  // The paragraph must carry its own font-size and line-height, both taken from
  // its LARGEST run — which is how PowerPoint sizes a line.
  //
  // font-size: a line box is at least as tall as its block's strut, so leaving
  // <p> at the inherited 16px browser default inflates every line to ~16px no
  // matter how small the runs are, clipping text in boxes sized for the real type.
  //
  // line-height: OOXML's 100% means one *single-spaced line* (the font's own
  // ascent + descent + gap), not 100% of the font size — so scale the font's
  // singleLineFactor, or lines pack tighter than their glyphs and collide.
  const largest = p.runs.reduce<{ pt: number; font: FontFamily }>(
    (max, r) => {
      const pt = r.sizePt ?? ds.type.body.sizePt;
      return pt > max.pt ? { pt, font: r.font ?? ds.fonts.body } : max;
    },
    { pt: 0, font: ds.fonts.body },
  );
  const linePt = largest.pt || ds.type.body.sizePt;
  const lineHeight = ((p.lineSpacingPct ?? 100) / 100) * FONTS[largest.font].singleLineFactor;
  return (
    <p
      style={{
        margin: 0,
        marginTop: (p.spaceBeforePt ?? 0) * EMU_PER_POINT * scale,
        marginBottom: (p.spaceAfterPt ?? 0) * EMU_PER_POINT * scale,
        textAlign,
        fontSize: linePt * EMU_PER_POINT * scale,
        lineHeight,
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
        // A line's box is zero on its cross axis (h=0 horizontal, w=0
        // vertical), and an <svg> with a zero width or height renders NOTHING
        // — the whole subtree is disabled. Floor both at 1px and let the stroke
        // overflow; the geometry below still uses the true w/h.
        <svg
          width={Math.max(w, 1)}
          height={Math.max(h, 1)}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          {/* A line's box is zero-thickness on its cross axis, so there is
              nothing to click. This invisible fat stroke gives it a grab
              target; it paints nothing, in the editor or on export. */}
          <line
            x1={0}
            y1={y1}
            x2={w}
            y2={y2}
            stroke="transparent"
            strokeWidth={Math.max(strokeW, 10)}
            pointerEvents="stroke"
          />
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
        background:
          slide.background?.kind === 'solid'
            ? resolveColor(slide.background.color, designSystem)
            : '#ffffff',
        overflow: 'hidden',
      }}
    >
      {slide.elements.map((el) => (
        <PositionedElement key={el.id} el={el} ds={designSystem} scale={scale} />
      ))}
    </div>
  );
}
