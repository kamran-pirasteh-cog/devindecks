/**
 * Slide builders for the brand-engine tests.
 *
 * Every test in `src/brand` needs a slide with specific sizes, colours and
 * positions, and writing those out longhand buries the one fact each test is
 * about under twenty lines of `rect` and `runs`. These helpers take inches and
 * hexes — the units a person reasons in when describing a slide — and produce
 * real model elements.
 *
 * Not a test file itself (no `.test.ts`), so vitest doesn't collect it.
 */
import { inchesToEmu, SLIDE_16x9 } from '@/model';
import type {
  Paragraph,
  PictureElement,
  Rect,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
  TextRun,
} from '@/model/types';
import { hex } from '@/model/tokens';

export const SIZE = SLIDE_16x9;

/** A rect from inches. */
export const at = (x: number, y: number, w: number, h: number): Rect => ({
  x: inchesToEmu(x),
  y: inchesToEmu(y),
  w: inchesToEmu(w),
  h: inchesToEmu(h),
});

export interface TextOpts {
  id?: string;
  sizePt?: number;
  color?: string;
  font?: TextRun['font'];
  bold?: boolean;
  caps?: boolean;
  role?: string;
  align?: Paragraph['align'];
  bullet?: Paragraph['bullet'];
  level?: number;
  anchor?: 'top' | 'middle' | 'bottom';
  /** Each string becomes its own paragraph. */
  lines?: string[];
}

let n = 0;
const nextId = (prefix: string) => `${prefix}${++n}`;
/** Tests that assert on ids call this first so numbering is predictable. */
export const resetIds = () => {
  n = 0;
};

export function text(body: string, rect: Rect, opts: TextOpts = {}): TextElement {
  const lines = opts.lines ?? [body];
  return {
    id: opts.id ?? nextId('t'),
    type: 'text',
    ...(opts.role ? { role: opts.role } : {}),
    rect,
    body: {
      paragraphs: lines.map((line) => ({
        runs: [
          {
            text: line,
            font: opts.font ?? 'Geist',
            sizePt: opts.sizePt ?? 14,
            ...(opts.bold ? { bold: true } : {}),
            ...(opts.caps ? { caps: true } : {}),
            ...(opts.color ? { color: hex(opts.color) } : {}),
          },
        ],
        ...(opts.align ? { align: opts.align } : {}),
        ...(opts.bullet ? { bullet: opts.bullet } : {}),
        ...(opts.level !== undefined ? { level: opts.level } : {}),
      })),
      ...(opts.anchor ? { anchor: opts.anchor } : {}),
    },
  };
}

export interface ShapeOpts extends TextOpts {
  preset?: ShapeElement['preset'];
  fill?: string;
  outlineColor?: string;
  outlineWidthPt?: number;
  /** Text inside the shape — what `decouple` splits out. */
  label?: string;
}

export function shape(rect: Rect, opts: ShapeOpts = {}): ShapeElement {
  const el: ShapeElement = {
    id: opts.id ?? nextId('s'),
    type: 'shape',
    ...(opts.role ? { role: opts.role } : {}),
    rect,
    preset: opts.preset ?? 'rect',
    ...(opts.fill ? { fill: { kind: 'solid' as const, color: hex(opts.fill) } } : {}),
    ...(opts.outlineColor
      ? {
          outline: {
            color: hex(opts.outlineColor),
            widthEmu: inchesToEmu((opts.outlineWidthPt ?? 1) / 72),
            dash: 'solid' as const,
          },
        }
      : {}),
  };
  if (opts.label !== undefined) {
    el.body = {
      paragraphs: [
        {
          runs: [
            {
              text: opts.label,
              font: opts.font ?? 'Geist',
              sizePt: opts.sizePt ?? 14,
              ...(opts.bold ? { bold: true } : {}),
              ...(opts.caps ? { caps: true } : {}),
              ...(opts.color ? { color: hex(opts.color) } : {}),
            },
          ],
          ...(opts.align ? { align: opts.align } : {}),
        },
      ],
      ...(opts.anchor ? { anchor: opts.anchor } : {}),
    };
  }
  return el;
}

export function picture(src: string, rect: Rect, opts: { id?: string } = {}): PictureElement {
  return { id: opts.id ?? nextId('p'), type: 'picture', rect, src };
}

export function slide(elements: SlideElement[], background?: string): Slide {
  return {
    id: nextId('sl'),
    elements,
    ...(background ? { background: { kind: 'solid' as const, color: hex(background) } } : {}),
  };
}

/**
 * A plausible source deck: a title slide, content slides with a heading and
 * bullets, and a footer logo + page number on every content slide.
 *
 * Deliberately styled like a deck from ANOTHER brand — Arial-ish sizes, a navy
 * heading colour, a red accent — so conversion has something real to map.
 */
export function sourceDeck(slideCount = 6): Slide[] {
  const out: Slide[] = [
    slide([
      text('Fourth Quarter Business Review', at(0.9, 2.6, 8, 1.2), {
        sizePt: 40,
        color: '#1F3864',
        role: undefined,
      }),
      text('Prepared for Acme Corp', at(0.9, 3.9, 8, 0.5), { sizePt: 18, color: '#7F7F7F' }),
    ]),
  ];

  for (let i = 1; i < slideCount; i += 1) {
    out.push(
      slide([
        text(`Section heading ${i}`, at(0.9, 0.5, 11.5, 0.7), {
          sizePt: 28,
          color: '#1F3864',
        }),
        text('supporting line', at(0.9, 1.25, 11.5, 0.4), { sizePt: 16, color: '#7F7F7F' }),
        text('body copy', at(0.9, 2.0, 5.5, 3), {
          sizePt: 12,
          color: '#404040',
          bullet: 'bullet',
          lines: ['First point worth making', 'Second point worth making', 'Third point'],
        }),
        // Source chrome: same logo and footer text on every content slide.
        picture('data:image/png;base64,LOGO', at(11.9, 6.85, 0.8, 0.3)),
        text('Acme Corp — Confidential', at(0.9, 6.9, 4, 0.25), {
          sizePt: 9,
          color: '#A6A6A6',
        }),
        text(String(i + 1), at(12.6, 6.9, 0.4, 0.25), { sizePt: 9, color: '#A6A6A6' }),
      ]),
    );
  }
  return out;
}
