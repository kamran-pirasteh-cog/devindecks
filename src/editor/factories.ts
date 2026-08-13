/**
 * Factories for new elements. Everything created here is, by construction, a
 * safe primitive with token-based styling — so nothing a user adds can break on
 * export or drift off-brand.
 */
import { inchesToEmu, pointsToEmu, token } from '@/model';
import type {
  DashStyle,
  FontFamily,
  LineElement,
  ShapeElement,
  ShapePreset,
  TextElement,
} from '@/model';
import { newId } from '@/store/editorStore';

/**
 * The typefaces an author can drop text in, as *faces* rather than families —
 * "Geist Medium" is the family Geist at weight 500. Only faces that exist in the
 * three allowed families appear here, so picking one can never ask the renderer
 * (or PowerPoint) for a face it hasn't got.
 */
export interface TextStyle {
  id: string;
  label: string;
  font: FontFamily;
  weight: number;
  italic?: boolean;
  /** Placeholder copy, so a dropped box shows the face rather than "Text". */
  sample: string;
}

export const TEXT_STYLES: TextStyle[] = [
  { id: 'geist-medium', label: 'Geist Medium', font: 'Geist', weight: 500, sample: 'Geist Medium' },
  { id: 'geist-bold', label: 'Geist Bold', font: 'Geist', weight: 700, sample: 'Geist Bold' },
  {
    id: 'serif-medium',
    label: 'Source Serif 4 Medium',
    font: 'Source Serif 4',
    weight: 500,
    sample: 'Source Serif 4 Medium',
  },
  {
    id: 'serif-medium-italic',
    label: 'Source Serif 4 Medium Italic',
    font: 'Source Serif 4',
    weight: 500,
    italic: true,
    sample: 'Source Serif 4 Medium Italic',
  },
  {
    id: 'mono-medium',
    label: 'Geist Mono Medium',
    font: 'Geist Mono',
    weight: 500,
    sample: 'Geist Mono Medium',
  },
  {
    id: 'mono-bold',
    label: 'Geist Mono Bold',
    font: 'Geist Mono',
    weight: 700,
    sample: 'Geist Mono Bold',
  },
];

/** Sizes offered in the inserter, in points — the deck's own type ladder. */
export const TEXT_SIZES = [12, 14, 18, 24, 32, 40, 54] as const;

export const DEFAULT_TEXT_SIZE_PT = 18;

export function makeText(style?: TextStyle, sizePt: number = DEFAULT_TEXT_SIZE_PT): TextElement {
  const s = style ?? TEXT_STYLES[0];
  return {
    id: newId('text'),
    type: 'text',
    role: 'body',
    rect: { x: inchesToEmu(4.5), y: inchesToEmu(3.0), w: inchesToEmu(4), h: inchesToEmu(1) },
    body: {
      anchor: 'top',
      // 'resize' so the box takes the shape of whichever face and size was
      // picked, instead of clipping a 54pt sample inside a 1in default box.
      autofit: 'resize',
      paragraphs: [
        {
          runs: [
            {
              text: style ? s.sample : 'Text',
              font: s.font,
              sizePt,
              // Bold is the 700 face; anything lighter rides on `weight`, which
              // has no OOXML equivalent and exports as regular.
              weight: s.weight >= 700 ? undefined : s.weight,
              bold: s.weight >= 700 || undefined,
              italic: s.italic,
              color: token('ink.strong'),
            },
          ],
        },
      ],
    },
  };
}

export function makeShape(preset: ShapePreset): ShapeElement {
  return {
    id: newId('shape'),
    type: 'shape',
    preset,
    rect: { x: inchesToEmu(5.2), y: inchesToEmu(2.9), w: inchesToEmu(2.4), h: inchesToEmu(1.6) },
    fill: { kind: 'solid', color: token('brand.accent') },
  };
}

export interface LineOptions {
  orientation: 'horizontal' | 'vertical';
  dash: DashStyle;
  /** Stroke weight in points — PowerPoint's own unit for line weight. */
  weightPt: number;
  /** Design-system color token id. */
  colorToken: string;
}

export const DEFAULT_LINE_OPTIONS: LineOptions = {
  orientation: 'horizontal',
  dash: 'solid',
  weightPt: 1,
  colorToken: 'ink.strong',
};

export function makeLine(opts: LineOptions = DEFAULT_LINE_OPTIONS): LineElement {
  const len = inchesToEmu(4);
  // A line has zero extent on its cross axis, so the model stays a true line
  // (not a thin rectangle) and exports as one.
  const rect =
    opts.orientation === 'horizontal'
      ? { x: inchesToEmu(4.5), y: inchesToEmu(3.75), w: len, h: 0 }
      : { x: inchesToEmu(6.5), y: inchesToEmu(1.75), w: 0, h: len };
  return {
    id: newId('line'),
    type: 'line',
    rect,
    outline: {
      color: token(opts.colorToken),
      widthEmu: pointsToEmu(opts.weightPt),
      dash: opts.dash,
    },
  };
}
