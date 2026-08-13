'use client';

/**
 * Inline text editing. A contentEditable overlay sized to the element, styled to
 * match the first run so editing feels WYSIWYG. On commit we split by newline
 * into paragraphs and rebuild runs, preserving each paragraph's own styling.
 *
 * The overlay mirrors <ParagraphView>'s box metrics exactly — one block per
 * paragraph carrying the same strut font-size, line-height, space-before/after
 * and bullet marker. Without that the browser falls back to `line-height:
 * normal` (~1.2) over a single flat block, so the text visibly grows and
 * paragraph spacing collapses the moment you double-click in.
 *
 * (Phase 1 keeps this single-style per box; rich mid-run formatting comes with
 * the selection-aware text model later.)
 */
import { useEffect, useRef } from 'react';
import {
  EMU_PER_POINT,
  FONTS,
  resolveColor,
  type ShapeElement,
  type TextElement,
  type Paragraph,
  type TextRun,
} from '@/model';
import { useEditor, nextFontSize } from '@/store/editorStore';
import { fontSizeDirection } from './fontSizeShortcut';
import { formatPainterAction } from './formatShortcut';

/** Character-level formatting, as carried by the contentEditable DOM. */
interface Fmt {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/**
 * What one element does to the format its parent handed down. `execCommand`
 * marks up in two dialects depending on the browser and on whether it is
 * turning a format on or off — <b>/<i>/<u> tags, or an inline style that has to
 * be able to say "normal" and *cancel* an inherited format. Read both, and fall
 * through to the inherited value only when this element is silent.
 */
const fmtFrom = (node: HTMLElement, inherit: Fmt): Fmt => {
  const s = node.style;
  const weight = s.fontWeight;
  const deco = s.textDecorationLine || s.textDecoration;
  return {
    bold:
      node.tagName === 'B' || node.tagName === 'STRONG'
        ? true
        : weight
          ? weight === 'bold' || (parseInt(weight, 10) || 0) >= 600
          : inherit.bold,
    italic:
      node.tagName === 'I' || node.tagName === 'EM'
        ? true
        : s.fontStyle
          ? s.fontStyle === 'italic'
          : inherit.italic,
    underline: node.tagName === 'U' ? true : deco ? deco.includes('underline') : inherit.underline,
  };
};

/**
 * Flatten a paragraph's DOM into model runs — one run per stretch of uniform
 * formatting, adjacent identical stretches merged so a box's runs don't
 * fragment a little more with every edit. A <br> (Shift+Enter) starts a new
 * paragraph, which is what the old innerText split gave us.
 */
/** A run still carrying the `data-run` index it was parsed from. */
type DraftRun = TextRun & { __src: number | null };

const runsFromNodes = (
  nodes: Node[],
  /** The source run for a `data-run` index — anything CSS can't round-trip. */
  sourceRun: (index: number | null) => TextRun,
  inherit: Fmt,
): TextRun[][] => {
  const paras: DraftRun[][] = [[]];
  const push = (text: string, f: Fmt, src: number | null) => {
    if (!text) return;
    const cur = paras[paras.length - 1];
    const last = cur[cur.length - 1];
    if (
      last &&
      last.__src === src &&
      !!last.bold === f.bold &&
      !!last.italic === f.italic &&
      !!last.underline === f.underline
    ) {
      last.text += text;
    } else {
      cur.push({
        ...sourceRun(src),
        text,
        bold: f.bold,
        italic: f.italic,
        underline: f.underline,
        __src: src,
      });
    }
  };
  const walk = (node: Node, f: Fmt, src: number | null) => {
    if (node.nodeType === Node.TEXT_NODE) return push(node.nodeValue ?? '', f, src);
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'BR') {
      paras.push([]);
      return;
    }
    const own = node.dataset.run;
    const nextSrc = own === undefined ? src : Number(own);
    const next = fmtFrom(node, f);
    node.childNodes.forEach((c) => walk(c, next, nextSrc));
  };
  nodes.forEach((n) => walk(n, inherit, null));
  // Drop the bookkeeping key before the runs reach the model.
  return paras.map((runs) =>
    runs.map((run) => {
      const out: TextRun & { __src?: number | null } = { ...run };
      delete out.__src;
      return out as TextRun;
    }),
  );
};

export function TextEditor({
  el,
  scale,
}: {
  el: TextElement | ShapeElement;
  scale: number;
}) {
  const ds = useEditor((s) => s.designSystem);
  const store = useEditor.getState;
  const ref = useRef<HTMLDivElement>(null);

  const body = el.body!;
  const firstRun = body.paragraphs[0]?.runs[0] ?? {};
  const font = FONTS[firstRun.font ?? ds.fonts.body];
  // Same strut rule as <ParagraphView>: size AND font both come from the
  // paragraph's largest run, because line-height is a multiple of that font's
  // own single-line metrics.
  const strut = (p: Paragraph) => {
    const largest = p.runs.reduce(
      (max, r) => {
        const pt = r.sizePt ?? ds.type.body.sizePt;
        return pt > max.pt ? { pt, font: r.font ?? ds.fonts.body } : max;
      },
      { pt: 0, font: ds.fonts.body },
    );
    return { pt: largest.pt || ds.type.body.sizePt, font: largest.font };
  };

  const applyParagraphStyle = (node: HTMLElement, p: Paragraph) => {
    node.style.margin = '0';
    node.style.marginTop = `${(p.spaceBeforePt ?? 0) * EMU_PER_POINT * scale}px`;
    node.style.marginBottom = `${(p.spaceAfterPt ?? 0) * EMU_PER_POINT * scale}px`;
    node.style.textAlign = p.align ?? 'left';
    const { pt, font: strutFont } = strut(p);
    node.style.fontSize = `${pt * EMU_PER_POINT * scale}px`;
    // OOXML 100% == one single-spaced line of THIS font (ascent + descent +
    // gap), not 1.0 × font-size — the same factor <ParagraphView> applies.
    // Dropping it shrank every line box by ~0.3em on entering edit mode, which
    // pulled the text up by half that against a top anchor.
    node.style.lineHeight = `${((p.lineSpacingPct ?? 100) / 100) * FONTS[strutFont].singleLineFactor}`;
    // Each paragraph wears its own run style, not paragraph 0's. Inheriting the
    // first run box-wide repainted (say) a bold display title in the eyebrow's
    // mono 400 face, which changed its look *and* re-wrapped it mid-edit.
    const r = p.runs[0] ?? firstRun;
    node.style.fontFamily = FONTS[r.font ?? ds.fonts.body].cssStack;
    node.style.fontWeight = r.bold ? '700' : '400';
    node.style.fontStyle = r.italic ? 'italic' : 'normal';
    node.style.textDecoration = r.underline ? 'underline' : 'none';
    node.style.color = resolveColor(r.color, ds);
    if (p.bullet === 'bullet') {
      // A list marker instead of a literal "• " keeps the caret out of the
      // bullet — it renders at the same place but isn't editable text.
      node.style.display = 'list-item';
      node.style.listStyleType = 'disc';
      node.style.listStylePosition = 'inside';
    }
  };

  /**
   * One <span> per run, mirroring <ParagraphView>. Entering edit mode used to
   * join a paragraph's runs into one flat text node, so mixed formatting was
   * invisible while editing — and `commit` then wrote that flattened text back,
   * quietly destroying (say) an italic job title inside a caption.
   *
   * `data-run` records which run each span came from, so `commit` can recover
   * the props that CSS can't round-trip: color is a design-system token, not a
   * hex, and size/font live in model units.
   */
  const runSpan = (r: TextRun, index: number) => {
    const span = document.createElement('span');
    span.dataset.run = String(index);
    span.style.fontFamily = FONTS[r.font ?? ds.fonts.body].cssStack;
    span.style.fontSize = `${(r.sizePt ?? ds.type.body.sizePt) * EMU_PER_POINT * scale}px`;
    span.style.fontWeight = r.bold ? '700' : '400';
    span.style.fontStyle = r.italic ? 'italic' : 'normal';
    span.style.textDecoration = r.underline ? 'underline' : 'none';
    span.style.color = resolveColor(r.color, ds);
    span.textContent = r.text;
    return span;
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.replaceChildren(
      ...body.paragraphs.map((p) => {
        const line = document.createElement('div');
        applyParagraphStyle(line, p);
        // Index by position in p.runs, not in the filtered list — `data-run` is
        // how commit finds the source run again.
        const runs = p.runs.map((r, i) => [r, i] as const).filter(([r]) => r.text);
        // An empty block collapses to zero height without a <br> placeholder.
        if (runs.length) line.append(...runs.map(([r, i]) => runSpan(r, i)));
        else line.appendChild(document.createElement('br'));
        return line;
      }),
    );
    node.focus();
    // Place caret at end.
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply paragraph styling when the model changes under an OPEN editor —
  // Inspector edits, a caret-only B/I/U, a font-size shortcut. Only the blocks'
  // style attributes are touched, never their text nodes, so the caret and any
  // half-typed word survive; rebuilding children here would fling the caret to
  // the end mid-sentence.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    Array.from(node.children).forEach((child, i) => {
      const p = body.paragraphs[i];
      if (p && child instanceof HTMLElement) applyParagraphStyle(child, p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, scale, ds]);

  const commit = () => {
    const root = ref.current;
    if (!root) return store().setEditing(null);

    // Group the editable's top-level nodes into paragraphs. Our own render puts
    // one <div> per paragraph and Enter keeps that shape, but a browser can also
    // leave bare text or a <br> at the top level — those collect into an
    // implicit paragraph rather than being dropped.
    const blocks: Node[][] = [];
    let implicit: Node[] | null = null;
    for (const node of Array.from(root.childNodes)) {
      if (node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P')) {
        implicit = null;
        blocks.push([node]);
      } else {
        if (!implicit) {
          implicit = [];
          blocks.push(implicit);
        }
        implicit.push(node);
      }
    }

    const paragraphs: Paragraph[] = [];
    for (const nodes of blocks.length ? blocks : [[]]) {
      // Keep each paragraph's own spacing/bullet/alignment; paragraphs the user
      // added inherit from the one they split off the end of.
      const src = body.paragraphs[paragraphs.length] ?? body.paragraphs[body.paragraphs.length - 1];
      const base = src?.runs[0] ?? firstRun;
      const inherit: Fmt = {
        bold: !!base.bold,
        italic: !!base.italic,
        underline: !!base.underline,
      };
      // Font, size and color come from the run the text was typed into, which
      // `data-run` identifies; text the browser produced without a span (a
      // pasted or freshly typed stretch) falls back to the paragraph's first.
      const sourceRun = (i: number | null) => (i === null ? base : (src?.runs[i] ?? base));
      for (const runs of runsFromNodes(nodes, sourceRun, inherit)) {
        paragraphs.push({ ...src, runs: runs.length ? runs : [{ ...base, text: '' }] });
      }
    }

    store().updateElement(el.id, { body: { ...body, paragraphs } });
    store().setEditing(null);
  };

  /**
   * B/I/U inside the editor. With text highlighted the format applies to the
   * SELECTION — the browser splits the DOM and `commit` reads those spans back
   * out as runs. With only a caret it falls back to the whole box, which is what
   * PowerPoint does too.
   *
   * `patchRuns` alone could never do the former: it assigns the patch to every
   * run in the box, so a highlighted word came out bold along with everything
   * else — and only in the filmstrip, since the open editor's DOM was built once
   * on mount and never heard about the change.
   */
  const applyFormat = (key: 'bold' | 'italic' | 'underline') => {
    const sel = window.getSelection();
    const inEditor = !!sel?.anchorNode && !!ref.current?.contains(sel.anchorNode);
    if (inEditor && sel && !sel.isCollapsed) document.execCommand(key);
    else store().patchRuns([el.id], { [key]: !firstRun[key] });
  };

  const justify =
    body.anchor === 'middle' ? 'center' : body.anchor === 'bottom' ? 'flex-end' : 'flex-start';

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          store().setEditing(null);
        }
        const mod = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        const sizeDir = fontSizeDirection(e);
        const painter = formatPainterAction(e);
        if (painter) {
          e.preventDefault();
          if (painter === 'copy') {
            store().copyFormat(el.id);
          } else {
            // Pasting a format restyles the whole box, so it ends the edit —
            // commit the typing first, then stamp the format over the result.
            commit();
            store().pasteFormat([el.id]);
          }
        } else if (mod && key === 'enter') {
          e.preventDefault();
          commit();
        } else if (mod && (key === 'b' || key === 'i' || key === 'u')) {
          e.preventDefault();
          applyFormat(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
        } else if (mod && key === 'e') {
          e.preventDefault();
          store().patchParagraphs([el.id], { align: 'center' });
        } else if (mod && key === 'r') {
          e.preventDefault();
          store().patchParagraphs([el.id], { align: 'right' });
        } else if (mod && key === 'l') {
          e.preventDefault();
          store().patchParagraphs([el.id], { align: 'left' });
        } else if (sizeDir) {
          e.preventDefault();
          store().patchRuns([el.id], {
            sizePt: nextFontSize(firstRun.sizePt ?? ds.type.body.sizePt, sizeDir),
          });
        }
        e.stopPropagation();
      }}
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
        outline: '2px solid #4F46E5',
        fontFamily: font.cssStack,
        fontSize: (firstRun.sizePt ?? ds.type.body.sizePt) * EMU_PER_POINT * scale,
        fontWeight: firstRun.bold ? 700 : 400,
        fontStyle: firstRun.italic ? 'italic' : 'normal',
        color: resolveColor(firstRun.color, ds),
        textAlign: (body.paragraphs[0]?.align ?? 'left') as 'left' | 'center' | 'right',
        whiteSpace: 'pre-wrap',
        cursor: 'text',
        // The canvas suppresses text selection so drags don't highlight slide
        // copy; the editor itself has to opt back in.
        userSelect: 'text',
      }}
    />
  );
}
