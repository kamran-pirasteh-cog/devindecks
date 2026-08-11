/**
 * Factories for new elements. Everything created here is, by construction, a
 * safe primitive with token-based styling — so nothing a user adds can break on
 * export or drift off-brand.
 */
import { inchesToEmu, token } from '@/model';
import type {
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

export function makeLine(): LineElement {
  return {
    id: newId('line'),
    type: 'line',
    rect: { x: inchesToEmu(4.5), y: inchesToEmu(3.75), w: inchesToEmu(4), h: 0 },
    outline: { color: token('ink.strong'), widthEmu: inchesToEmu(0.03), dash: 'solid' },
  };
}
