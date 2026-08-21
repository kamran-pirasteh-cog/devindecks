/**
 * Factories for new elements. Everything created here is, by construction, a
 * safe primitive with token-based styling — so nothing a user adds can break on
 * export or drift off-brand.
 */
import { inchesToEmu, pointsToEmu, titleBand, token } from '@/model';
import type {
  ColorRef,
  DashStyle,
  DesignSystem,
  EMU,
  FontFamily,
  LineElement,
  PictureElement,
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

/** The colour a newly dropped text box is typed in, unless one is picked. */
export const DEFAULT_TEXT_COLOR: ColorRef = token('ink.strong');

export function makeText(
  style?: TextStyle,
  sizePt: number = DEFAULT_TEXT_SIZE_PT,
  color: ColorRef = DEFAULT_TEXT_COLOR,
): TextElement {
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
              color,
            },
          ],
        },
      ],
    },
  };
}

/**
 * An arrow as a glyph rather than a shape. A typeset "→" sits at the same
 * optical weight as the deck's body copy, so an arrow between two thoughts
 * reads as punctuation instead of as a filled block competing with them.
 */
export function makeArrow(sizePt: number = 32): TextElement {
  return {
    id: newId('text'),
    type: 'text',
    role: 'body',
    rect: { x: inchesToEmu(5.2), y: inchesToEmu(3.2), w: inchesToEmu(0.6), h: inchesToEmu(0.6) },
    body: {
      anchor: 'middle',
      // 'resize' so the box shrinks to the glyph — a single arrow shouldn't
      // carry an inch of empty box around with it when it's dragged.
      autofit: 'resize',
      paragraphs: [
        {
          align: 'center',
          runs: [
            {
              text: '→',
              font: 'Source Serif 4',
              sizePt,
              weight: 500,
              color: token('ink.strong'),
            },
          ],
        },
      ],
    },
  };
}

/** Leading the renderer gives an unspaced paragraph. */
const LINE_HEIGHT = 1.25;

/**
 * The slide's title, hung in the title band and typed from the brand's title
 * role — the one object whose position is a rule rather than a layout choice
 * (see `alignTitles`), so it needs no drag to be right.
 *
 * The run carries the styling but no text: the box is inserted straight into
 * edit mode, and typing into an empty paragraph inherits the first run's font,
 * size and colour (see `TextEditor.readParagraphs`) — so the author types the
 * title itself instead of clearing a placeholder word first.
 */
export function makeTitle(ds: DesignSystem, slideSize: { w: EMU; h: EMU }): TextElement {
  const role = ds.type.title;
  const band = titleBand(slideSize);
  return {
    id: newId('text'),
    type: 'text',
    role: 'title',
    rect: {
      x: band.x,
      y: band.y,
      w: band.w,
      // One line of title type, capped by the band: a title that runs to two
      // lines grows down into the band rather than starting oversized.
      h: Math.min(band.h, pointsToEmu(role.sizePt * LINE_HEIGHT)),
    },
    body: {
      anchor: 'top',
      // 'none', not 'resize': the box spans the safe area's full width by
      // design, and a fit pass would shrink-wrap it onto the typed words.
      autofit: 'none',
      paragraphs: [
        {
          runs: [
            {
              text: '',
              font: role.font,
              sizePt: role.sizePt,
              bold: role.bold,
              weight: role.weight,
              color: token(role.colorToken),
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

/** The box a dropped picture is fitted inside, before centring. */
const PICTURE_FIT = { w: inchesToEmu(4), h: inchesToEmu(3) };

/**
 * A picture placed centred on the slide, scaled to sit inside `PICTURE_FIT`
 * with its aspect ratio intact.
 *
 * Aspect matters more here than it does for a shape: a picture with no `crop`
 * is COVER-fit into its rect (see `PictureElement`), so a rect that doesn't
 * match the source's proportions doesn't letterbox — it silently crops. Sizing
 * from the intrinsic pixels is what keeps a wordmark whole. A source with no
 * intrinsic size (an SVG with no width/height) falls back to the fit box.
 */
export function makePicture(
  src: string,
  intrinsic: { width: number; height: number },
  slideSize: { w: EMU; h: EMU },
): PictureElement {
  const ratio =
    intrinsic.width > 0 && intrinsic.height > 0 ? intrinsic.height / intrinsic.width : null;
  let w = PICTURE_FIT.w;
  let h = ratio === null ? PICTURE_FIT.h : Math.round(PICTURE_FIT.w * ratio);
  if (h > PICTURE_FIT.h && ratio !== null) {
    h = PICTURE_FIT.h;
    w = Math.round(PICTURE_FIT.h / ratio);
  }
  return {
    id: newId('picture'),
    type: 'picture',
    src,
    rect: {
      x: Math.round((slideSize.w - w) / 2),
      y: Math.round((slideSize.h - h) / 2),
      w,
      h,
    },
  };
}

export interface LineOptions {
  orientation: 'horizontal' | 'vertical';
  dash: DashStyle;
  /** Stroke weight in points — PowerPoint's own unit for line weight. */
  weightPt: number;
  /** The stroke — a brand token, or a hex picked from the custom panel. */
  color: ColorRef;
}

export const DEFAULT_LINE_OPTIONS: LineOptions = {
  orientation: 'horizontal',
  dash: 'solid',
  weightPt: 1,
  color: token('ink.strong'),
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
      color: opts.color,
      widthEmu: pointsToEmu(opts.weightPt),
      dash: opts.dash,
    },
  };
}
