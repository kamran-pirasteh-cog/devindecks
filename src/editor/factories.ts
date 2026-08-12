/**
 * Factories for new elements. Everything created here is, by construction, a
 * safe primitive with token-based styling — so nothing a user adds can break on
 * export or drift off-brand.
 */
import { inchesToEmu, pointsToEmu, token } from '@/model';
import type {
  DashStyle,
  LineElement,
  ShapeElement,
  ShapePreset,
  TextElement,
} from '@/model';
import { newId } from '@/store/editorStore';

export function makeText(): TextElement {
  return {
    id: newId('text'),
    type: 'text',
    role: 'body',
    rect: { x: inchesToEmu(4.5), y: inchesToEmu(3.0), w: inchesToEmu(4), h: inchesToEmu(1) },
    body: {
      anchor: 'top',
      paragraphs: [
        { runs: [{ text: 'Text', font: 'Geist', sizePt: 18, color: token('ink.strong') }] },
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
