/**
 * Text: `<p:txBody>` -> our `TextBody`, with the full OOXML inheritance chain.
 *
 * A run's real appearance is almost never written on the run. It comes from,
 * in increasing precedence:
 *
 *   presentation defaultTextStyle -> master txStyles (title/body/other) ->
 *   layout placeholder lstStyle -> shape lstStyle -> paragraph pPr/defRPr ->
 *   run rPr
 *
 * Skipping any layer is how imports end up with everything at 18pt black: the
 * title's 40pt bold lives on the MASTER, not on the slide. `resolveStyleStack`
 * takes those layers in order and flattens them per indent level, so callers
 * ask a single question: "what are the effective props for level N here".
 */
import {
  isAllowedFont,
  type Autofit,
  type BulletKind,
  type ColorRef,
  type DesignSystem,
  type FontFamily,
  type Insets,
  type Paragraph,
  type ParaAlign,
  type TextBody,
  type TextRun,
  type VerticalAnchor,
} from '@/model';
import { attr, boolAttr, child, children, numAttr, textOf, type XmlNode } from '../xml';
import { resolveFillColor, toColorRef, type ColorContext } from './color';

/** PowerPoint's own default text insets: 0.1in sides, 0.05in top/bottom. */
export const OOXML_DEFAULT_INSETS: Insets = { l: 91_440, t: 45_720, r: 91_440, b: 45_720 };

interface ParaProps {
  align?: ParaAlign;
  level?: number;
  bullet?: BulletKind;
  lineSpacingPct?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
}

interface RunProps {
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: ColorRef;
  typeface?: string;
}

export interface TextContext extends ColorContext {
  ds: DesignSystem;
  /**
   * Style layers from most generic to most specific — each is an `lstStyle`-ish
   * node holding `lvl1pPr`..`lvl9pPr`.
   */
  layers: (XmlNode | undefined)[];
}

/* ------------------------------------------------------------------ */
/* Property readers                                                    */
/* ------------------------------------------------------------------ */

const ALIGN: Record<string, ParaAlign> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'justify',
  justLow: 'justify',
  dist: 'justify',
};

function readParaProps(pPr: XmlNode | undefined): ParaProps {
  if (!pPr) return {};
  const out: ParaProps = {};
  const algn = attr(pPr, 'algn');
  if (algn && ALIGN[algn]) out.align = ALIGN[algn];
  const lvl = numAttr(pPr, 'lvl');
  if (lvl !== undefined) out.level = Math.max(0, Math.min(4, lvl));

  // Bullets are a family of mutually exclusive elements; the LAST word wins
  // because a level can turn off what it inherited.
  if (child(pPr, 'buNone')) out.bullet = 'none';
  if (child(pPr, 'buChar')) out.bullet = 'bullet';
  if (child(pPr, 'buAutoNum')) out.bullet = 'number';

  const spcPct = numAttr(child(child(pPr, 'lnSpc'), 'spcPct'), 'val');
  if (spcPct !== undefined) out.lineSpacingPct = spcPct / 1000;
  const spcPts = numAttr(child(child(pPr, 'lnSpc'), 'spcPts'), 'val');
  if (spcPts !== undefined && out.lineSpacingPct === undefined) {
    // Exact point spacing has no model equivalent; carried as a percentage of
    // the paragraph's own size later, and 100% is the honest fallback here.
    out.lineSpacingPct = 100;
  }
  const before = numAttr(child(child(pPr, 'spcBef'), 'spcPts'), 'val');
  if (before !== undefined) out.spaceBeforePt = before / 100;
  const after = numAttr(child(child(pPr, 'spcAft'), 'spcPts'), 'val');
  if (after !== undefined) out.spaceAfterPt = after / 100;

  return out;
}

function readRunProps(rPr: XmlNode | undefined, ctx: ColorContext, ds: DesignSystem): RunProps {
  if (!rPr) return {};
  const out: RunProps = {};
  const sz = numAttr(rPr, 'sz');
  if (sz !== undefined) out.sizePt = sz / 100;
  const b = boolAttr(rPr, 'b');
  if (b !== undefined) out.bold = b;
  const i = boolAttr(rPr, 'i');
  if (i !== undefined) out.italic = i;
  const u = attr(rPr, 'u');
  if (u !== undefined) out.underline = u !== 'none';

  const solid = child(rPr, 'solidFill');
  if (solid) {
    const c = resolveFillColor(solid, ctx);
    if (c) out.color = toColorRef(c.hex, ds);
  }

  const face = attr(child(rPr, 'latin'), 'typeface') ?? attr(child(rPr, 'cs'), 'typeface');
  if (face) out.typeface = face;

  return out;
}

const merge = <T extends object>(base: T, next: T): T => {
  const out = { ...base };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
};

/** Flatten the style layers for one indent level. */
function resolveStyleStack(
  ctx: TextContext,
  level: number,
): { para: ParaProps; run: RunProps } {
  let para: ParaProps = {};
  let run: RunProps = {};
  const key = `lvl${Math.min(9, level + 1)}pPr`;
  for (const layer of ctx.layers) {
    const lvlNode = child(layer, key);
    if (!lvlNode) continue;
    para = merge(para, readParaProps(lvlNode));
    run = merge(run, readRunProps(child(lvlNode, 'defRPr'), ctx, ctx.ds));
  }
  return { para, run };
}

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

const SERIF = /(serif|georgia|garamond|times|book|cambria|palatino|caslon|didot|merriweather|playfair)/i;
const MONO = /(mono|courier|consol|menlo|code|typewriter)/i;

/**
 * Map an arbitrary typeface onto the three families the model allows.
 *
 * The restriction is deliberate (see `model/fonts.ts`), so the honest thing on
 * import is to keep the CATEGORY — a serif deck stays serif — rather than
 * flattening every deck to the sans face.
 */
export function mapTypeface(name: string | undefined, ctx: TextContext): FontFamily {
  let face = name?.trim() ?? '';
  if (face === '+mj-lt' || face === '+mj-ea' || face === '+mj-cs') face = ctx.theme.majorFont ?? '';
  if (face === '+mn-lt' || face === '+mn-ea' || face === '+mn-cs') face = ctx.theme.minorFont ?? '';
  if (isAllowedFont(face)) return face;
  if (MONO.test(face)) return 'Geist Mono';
  if (SERIF.test(face)) return 'Source Serif 4';
  return 'Geist';
}

/* ------------------------------------------------------------------ */
/* Body                                                                */
/* ------------------------------------------------------------------ */

const ANCHOR: Record<string, VerticalAnchor> = { t: 'top', ctr: 'middle', b: 'bottom' };

export interface ParsedBody {
  body: TextBody;
  /** True when the shape had a txBody but every run was empty. */
  empty: boolean;
}

export function parseTextBody(txBody: XmlNode, ctx: TextContext): ParsedBody {
  const bodyPr = child(txBody, 'bodyPr');

  // normAutofit's fontScale is how PowerPoint records "this text was shrunk to
  // fit". Applying it is what makes an imported dense slide look the same
  // rather than overflowing its box.
  const normAutofit = child(bodyPr, 'normAutofit');
  const fontScale = (numAttr(normAutofit, 'fontScale') ?? 100_000) / 100_000;
  const lnSpcReduction = (numAttr(normAutofit, 'lnSpcReduction') ?? 0) / 100_000;

  const autofit: Autofit = child(bodyPr, 'spAutoFit')
    ? 'resize'
    : normAutofit
      ? 'shrink'
      : 'none';

  const insets: Insets = {
    l: numAttr(bodyPr, 'lIns') ?? OOXML_DEFAULT_INSETS.l,
    t: numAttr(bodyPr, 'tIns') ?? OOXML_DEFAULT_INSETS.t,
    r: numAttr(bodyPr, 'rIns') ?? OOXML_DEFAULT_INSETS.r,
    b: numAttr(bodyPr, 'bIns') ?? OOXML_DEFAULT_INSETS.b,
  };

  // The shape's own lstStyle is the most specific layer, after the inherited ones.
  const local: TextContext = {
    ...ctx,
    layers: [...ctx.layers, child(txBody, 'lstStyle')],
  };

  const paragraphs: Paragraph[] = [];
  let empty = true;

  for (const p of children(txBody, 'p')) {
    const pPr = child(p, 'pPr');
    const level = numAttr(pPr, 'lvl') ?? 0;
    const inherited = resolveStyleStack(local, level);
    const para = merge(inherited.para, readParaProps(pPr));
    const paraDefaults = merge(inherited.run, readRunProps(child(pPr, 'defRPr'), local, local.ds));

    const runs: TextRun[] = [];
    for (const node of p.children) {
      if (node.name === 'r' || node.name === 'fld') {
        // A field (slide number, date) keeps its cached text — that string is
        // what the deck showed, and our page numbers are literal too.
        const text = textOf(child(node, 't'));
        if (!text) continue;
        const rp = merge(paraDefaults, readRunProps(child(node, 'rPr'), local, local.ds));
        runs.push(toRun(text, rp, local, fontScale));
      } else if (node.name === 'br') {
        // A soft break inside a paragraph: the renderer honours `\n`
        // (white-space: pre-wrap) and so does the exporter.
        if (runs.length) runs[runs.length - 1].text += '\n';
        else runs.push(toRun('\n', paraDefaults, local, fontScale));
      }
    }

    if (runs.some((r) => r.text.trim())) empty = false;

    // An empty <a:p> is a blank line the author typed; keep it, styled, so
    // vertical rhythm survives the import.
    if (!runs.length) {
      runs.push(toRun('', paraDefaults, local, fontScale));
    }

    const lineSpacing = para.lineSpacingPct;
    paragraphs.push({
      runs,
      align: para.align,
      level: para.level ?? level ?? undefined,
      bullet: para.bullet ?? 'none',
      lineSpacingPct: lineSpacing
        ? Math.round(lineSpacing * (1 - lnSpcReduction))
        : undefined,
      spaceBeforePt: para.spaceBeforePt,
      spaceAfterPt: para.spaceAfterPt,
    });
  }

  return {
    body: {
      paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }],
      anchor: ANCHOR[attr(bodyPr, 'anchor') ?? 't'] ?? 'top',
      autofit,
      wrap: attr(bodyPr, 'wrap') !== 'none',
      insets,
    },
    empty,
  };
}

function toRun(text: string, rp: RunProps, ctx: TextContext, fontScale: number): TextRun {
  const size = rp.sizePt !== undefined ? rp.sizePt * fontScale : undefined;
  return {
    text,
    font: mapTypeface(rp.typeface, ctx),
    sizePt: size !== undefined ? round1(size) : undefined,
    bold: rp.bold || undefined,
    italic: rp.italic || undefined,
    underline: rp.underline || undefined,
    color: rp.color,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
