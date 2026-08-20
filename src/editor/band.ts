/**
 * Side bands — the full-bleed panel that runs top to bottom down one edge of a
 * slide, with the title (or a stack of stat cards) living inside it.
 *
 * It is the arrangement this deck reaches for most, and until now it could only
 * be had by picking a whole replica layout and deleting everything on it. So it
 * is parameterised instead: the three things that actually change from slide to
 * slide — which edge, how much of the page, what sits in it — are the three
 * controls, and everything else is derived.
 *
 * Built out of plain primitives inserted as ONE group, exactly as a callout is
 * (see `callout.ts`): a filled rect for the panel and a text box per slot on top
 * of it, so a title can be retyped, a card recoloured, or a number dragged,
 * without any of them being trapped inside a shape's `body`.
 *
 * Ink colour is DERIVED from the panel fill's luminance rather than picked, so a
 * band is never inserted with black type on a black panel; and a card's own lift
 * off the panel is the SAME ink at low alpha rather than a third hardcoded grey,
 * so a brand change that repaints the panel repaints the cards with it.
 */
import { inchesToEmu, pointsToEmu, resolveColor, token } from '@/model';
import type {
  ColorRef,
  DesignSystem,
  EMU,
  ShapeElement,
  SlideElement,
  TextElement,
} from '@/model';
import { nanoid } from 'nanoid';
import { isLightFill } from './callout';

/** Ids in the store's shape, minted here — importing `newId` back out of the
 *  store would make this module a cycle, as it does for `eyebrow.ts`. */
const newId = (prefix: string) => `${prefix}-${nanoid(8)}`;

/** Roles, so a band's parts stay findable after the group is broken up. */
export const BAND_PANEL_ROLE = 'band.panel';
export const BAND_CARD_ROLE = 'band.card';

export type BandSide = 'left' | 'right';

/** The fractions of the page a band is ever cut at, as authored. */
export const BAND_FRACTIONS = [
  { id: 'quarter', label: '1/4', value: 1 / 4 },
  { id: 'third', label: '1/3', value: 1 / 3 },
  { id: 'half', label: '1/2', value: 1 / 2 },
] as const;

export type BandFraction = (typeof BAND_FRACTIONS)[number]['id'];

/** What the panel carries. `empty` is the panel alone, to fill by hand. */
export const BAND_CONTENTS = ['title-subtitle', 'cards', 'empty'] as const;
export type BandContent = (typeof BAND_CONTENTS)[number];

export const BAND_CONTENT_LABEL: Record<BandContent, string> = {
  'title-subtitle': 'Title + subtitle',
  cards: 'Three boxes',
  empty: 'Empty',
};

export interface BandOptions {
  side: BandSide;
  fraction: BandFraction;
  content: BandContent;
  /** The panel fill — a brand token, or a hex from the custom panel. */
  fill: ColorRef;
}

export const DEFAULT_BAND_OPTIONS: BandOptions = {
  side: 'left',
  fraction: 'third',
  content: 'title-subtitle',
  fill: token('ink.strong'),
};

export const fractionValue = (id: BandFraction): number =>
  BAND_FRACTIONS.find((f) => f.id === id)!.value;

/** Placeholder copy — real enough to show how long a line the slot takes. */
const SAMPLE = {
  title: 'Executive Summary',
  subtitle: 'The one line that frames what follows',
  cardLabel: 'IMPACT SO FAR',
  cardValues: ['98%', '2.3x', '1.1x'],
  cardNotes: [
    'What the number counts, and against what baseline.',
    'What the number counts, and against what baseline.',
    'What the number counts, and against what baseline.',
  ],
};

/** Breathing room between the panel edge and anything typed inside it. */
const PAD_IN = 0.5;
/** A quarter-page band on a 4:3 slide is narrow; padding gives way before type. */
const MIN_INNER_W_IN = 0.8;
/** Gap between the title and the line under it, and between stacked cards. */
const TITLE_GAP_IN = 0.35;
const CARD_GAP_IN = 0.22;
/** Padding inside a card — tighter than the panel's, or the cards read as panels. */
const CARD_PAD_IN = 0.28;
const LINE_HEIGHT = 1.25;
const PT_PER_IN = 72;
const CARD_COUNT = 3;
/** How far a card lifts off the panel: the same ink, barely there. */
const CARD_ALPHA = 0.12;

const lineHeightIn = (sizePt: number, lines = 1) => (sizePt * LINE_HEIGHT * lines) / PT_PER_IN;

/** The panel's own rect — full bleed, top to bottom, on the chosen edge. */
export function bandRect(
  slideSize: { w: EMU; h: EMU },
  side: BandSide,
  fraction: BandFraction,
) {
  const w = Math.round(slideSize.w * fractionValue(fraction));
  return { x: side === 'left' ? 0 : slideSize.w - w, y: 0, w, h: slideSize.h };
}

/** Panel padding, given up before the type is when the band is very narrow. */
function padIn(panelWIn: number): number {
  return Math.min(PAD_IN, Math.max(0, (panelWIn - MIN_INNER_W_IN) / 2));
}

function textEl(
  rect: { x: EMU; y: EMU; w: EMU; h: EMU },
  text: string,
  role: DesignSystem['type'][keyof DesignSystem['type']],
  color: ColorRef,
  extra: { name: string; italic?: boolean; anchor?: 'top' | 'middle' | 'bottom' },
  gids: string[],
): TextElement {
  return {
    id: newId('text'),
    type: 'text',
    role: 'body',
    name: extra.name,
    rect,
    body: {
      anchor: extra.anchor ?? 'top',
      // 'none' — the panel is a fixed frame and the slots are placed against
      // each other, so a measure pass must not resize one out from under the
      // next.
      autofit: 'none',
      paragraphs: [
        {
          runs: [
            {
              text,
              font: role.font,
              sizePt: role.sizePt,
              bold: role.bold,
              weight: role.weight,
              italic: extra.italic,
              color,
            },
          ],
          align: 'left',
        },
      ],
    },
    groupIds: gids,
  };
}

/**
 * The panel and everything in it, in z-order (panel first), stamped with one
 * group id so a click grabs the whole band and a second click drills into a slot.
 */
export function makeBand(
  ds: DesignSystem,
  slideSize: { w: EMU; h: EMU },
  opts: BandOptions = DEFAULT_BAND_OPTIONS,
): SlideElement[] {
  const gid = newId('g');
  const rect = bandRect(slideSize, opts.side, opts.fraction);
  const onLight = isLightFill(resolveColor(opts.fill, ds));
  // On a dark panel both slots take the surface colour — a muted grey that reads
  // on white is mud on black.
  const strong = onLight ? token('ink.strong') : token('surface.base');
  const muted = onLight ? token('ink.muted') : token('surface.base');

  const panel: ShapeElement = {
    id: newId('shape'),
    type: 'shape',
    role: BAND_PANEL_ROLE,
    preset: 'rect',
    rect,
    fill: { kind: 'solid', color: opts.fill },
    groupIds: [gid],
  };

  const panelWIn = rect.w / inchesToEmu(1);
  const pad = inchesToEmu(padIn(panelWIn));
  const innerX = rect.x + pad;
  const innerW = Math.max(pointsToEmu(1), rect.w - pad * 2);

  if (opts.content === 'empty') return [panel];

  if (opts.content === 'title-subtitle') {
    // A title that runs three lines is normal in a band this narrow; the
    // subtitle is given four, which is where a framing line stops being one.
    const titleH = inchesToEmu(lineHeightIn(ds.type.title.sizePt, 3));
    const subH = inchesToEmu(lineHeightIn(ds.type.subtitle.sizePt, 4));
    const y = rect.y + pad + inchesToEmu(0.2);
    return [
      panel,
      textEl(
        { x: innerX, y, w: innerW, h: titleH },
        SAMPLE.title,
        ds.type.title,
        strong,
        { name: 'Title' },
        [gid],
      ),
      textEl(
        { x: innerX, y: y + titleH + inchesToEmu(TITLE_GAP_IN), w: innerW, h: subH },
        SAMPLE.subtitle,
        ds.type.subtitle,
        muted,
        { name: 'Subtitle', italic: ds.type.subtitle.font === 'Source Serif 4' },
        [gid],
      ),
    ];
  }

  // Cards: a label at the top, then an equal-height stack filling what's left.
  const labelH = inchesToEmu(lineHeightIn(ds.type.caption.sizePt));
  const labelY = rect.y + pad + inchesToEmu(0.1);
  const stackTop = labelY + labelH + inchesToEmu(0.3);
  const stackBottom = rect.y + rect.h - pad;
  const gap = inchesToEmu(CARD_GAP_IN);
  const cardH = Math.round((stackBottom - stackTop - gap * (CARD_COUNT - 1)) / CARD_COUNT);
  const cardPad = inchesToEmu(CARD_PAD_IN);
  const valueH = inchesToEmu(lineHeightIn(ds.type.kpiValue.sizePt));
  const noteH = inchesToEmu(lineHeightIn(ds.type.body.sizePt, 3));

  const els: SlideElement[] = [
    panel,
    textEl(
      { x: innerX, y: labelY, w: innerW, h: labelH },
      SAMPLE.cardLabel,
      ds.type.caption,
      muted,
      { name: 'Label' },
      [gid],
    ),
  ];

  for (let i = 0; i < CARD_COUNT; i++) {
    const y = stackTop + i * (cardH + gap);
    const card: ShapeElement = {
      id: newId('shape'),
      type: 'shape',
      role: BAND_CARD_ROLE,
      preset: 'roundRect',
      rect: { x: innerX, y, w: innerW, h: cardH },
      // The panel's own ink at low alpha: the lift follows the brand rather than
      // being a grey that only happens to work against today's palette.
      fill: { kind: 'solid', color: strong, alpha: CARD_ALPHA },
      groupIds: [gid],
    };
    const textX = innerX + cardPad;
    const textW = Math.max(pointsToEmu(1), innerW - cardPad * 2);
    els.push(
      card,
      textEl(
        { x: textX, y: y + cardPad, w: textW, h: valueH },
        SAMPLE.cardValues[i],
        ds.type.kpiValue,
        strong,
        { name: `Card ${i + 1} value` },
        [gid],
      ),
      textEl(
        {
          x: textX,
          y: y + cardPad + valueH + inchesToEmu(0.08),
          w: textW,
          h: Math.max(pointsToEmu(1), Math.min(noteH, cardH - cardPad * 2 - valueH)),
        },
        SAMPLE.cardNotes[i],
        ds.type.body,
        muted,
        { name: `Card ${i + 1} note` },
        [gid],
      ),
    );
  }

  return els;
}
