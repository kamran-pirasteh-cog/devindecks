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
  DEFAULT_TEXT_INSETS,
  EMU_PER_POINT,
  FONTS,
  resolveColor,
  runWeight,
  type BulletKind,
  type ShapeElement,
  type TextElement,
  type Paragraph,
  type TextRun,
} from '@/model';
import {
  bulletMarkers,
  clampLevel,
  indentMetricsPt,
  markerShiftEm,
  markerSizeScale,
} from '@/render/bullets';
import { useEditor } from '@/store/editorStore';
import { fontSizeDirection } from './fontSizeShortcut';
import { backspaceList } from './listBackspace';
import { formatPainterAction } from './formatShortcut';
import { placeCaretAt, type CaretPoint } from './caretPoint';
import { plainPasteLines } from './plainPaste';
import { paragraphSource, parseRunKey, runAt, runKey } from './runSource';
import { selectOffsets, selectionOffsets } from './textOffsets';
import { nextAnchor, nextParaAlign, textAlignEdge } from './textAlignShortcut';

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
 * fragment a little more with every edit. A <br> starts a new paragraph, which
 * is what the old innerText split gave us — so a soft line break and an Enter
 * (which the browser makes a new block) read back the same way.
 */
/**
 * A run still carrying its bookkeeping: the `data-run` key it was parsed from,
 * and the spans that produced it — which `commit` re-keys once the write lands,
 * so the DOM keeps naming the runs the model actually has.
 */
type DraftRun = TextRun & { __src: string | null; __els: HTMLElement[] };

const runsFromNodes = (
  nodes: Node[],
  /** The source run for a `data-run` key — anything CSS can't round-trip. */
  sourceRun: (key: string | null) => TextRun,
  inherit: Fmt,
): DraftRun[][] => {
  const paras: DraftRun[][] = [[]];
  const push = (text: string, f: Fmt, src: string | null, el: HTMLElement | null) => {
    if (!text) return;
    const cur = paras[paras.length - 1];
    const last = cur[cur.length - 1];
    // Text the browser produced without a span of its own — typed, or pasted —
    // continues the run it follows, which is how PowerPoint carries formatting
    // forward from the character behind the caret. Falling straight back to the
    // paragraph's first run instead reformatted the tail of a mixed line.
    const from = src ?? last?.__src ?? null;
    if (
      last &&
      last.__src === from &&
      !!last.bold === f.bold &&
      !!last.italic === f.italic &&
      !!last.underline === f.underline
    ) {
      last.text += text;
      if (el && !last.__els.includes(el)) last.__els.push(el);
    } else {
      cur.push({
        ...sourceRun(from),
        text,
        bold: f.bold,
        italic: f.italic,
        underline: f.underline,
        __src: from,
        __els: el ? [el] : [],
      });
    }
  };
  const walk = (node: Node, f: Fmt, src: string | null, el: HTMLElement | null) => {
    if (node.nodeType === Node.TEXT_NODE) return push(node.nodeValue ?? '', f, src, el);
    if (!(node instanceof HTMLElement)) return;
    // Bullet glyphs and number labels are drawn, not typed — they must never
    // come back as run text.
    if (node.dataset.marker !== undefined) return;
    if (node.tagName === 'BR') {
      // A TRAILING <br> is a placeholder, not a line break — an empty block
      // collapses to nothing without one, so `paint` emits it and browsers add
      // their own. Splitting on it would turn every empty paragraph into two,
      // which is how a title typed into a freshly inserted (still wordless) box
      // ended up on the second line.
      if (node.nextSibling) paras.push([]);
      return;
    }
    const own = node.dataset.run;
    const keyed = own !== undefined;
    const next = fmtFrom(node, f);
    node.childNodes.forEach((c) => walk(c, next, keyed ? own : src, keyed ? node : el));
  };
  nodes.forEach((n) => walk(n, inherit, null, null));
  return paras;
};

/** The run as the model wants it, without the parser's bookkeeping. */
const plainRun = (run: DraftRun): TextRun => {
  const out: TextRun & { __src?: string | null; __els?: HTMLElement[] } = { ...run };
  delete out.__src;
  delete out.__els;
  return out as TextRun;
};

export function TextEditor({
  el,
  scale,
  onInput,
  caretPoint,
}: {
  el: TextElement | ShapeElement;
  scale: number;
  /**
   * Fired with the live editable on mount and after every keystroke, for the box
   * whose SIZE follows its text as it's typed (a sticky note's). The text itself
   * lives in the DOM until commit — this is a measurement hook, not a write.
   */
  onInput?: (node: HTMLElement) => void;
  /**
   * The point the editor was opened from, in viewport coordinates — where the
   * caret should land. Read on mount only, and only a double-click supplies one:
   * every other way in (Enter on a selected box, a new box, the Inspector)
   * passes null and the caret falls to the end of the text.
   */
  caretPoint?: CaretPoint | null;
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
    node.style.fontWeight = String(runWeight(r));
    node.style.fontStyle = r.italic ? 'italic' : 'normal';
    node.style.textDecoration = r.underline ? 'underline' : 'none';
    node.style.textTransform = r.caps ? 'uppercase' : 'none';
    node.style.color = resolveColor(r.color, ds);
    // The block, not the model, is the live truth for list style while the
    // editor is open — Tab and the list shortcuts move these two attributes and
    // `commit` reads them back out. Seed them from the model on the way in.
    setList(node, p.bullet, p.level);
  };

  /* ---------------------------------------------------------------- */
  /* Bullets                                                          */
  /* ---------------------------------------------------------------- */

  /** The paragraph blocks, in order. */
  const blocks = () =>
    Array.from(ref.current?.children ?? []).filter(
      (n): n is HTMLElement => n instanceof HTMLElement,
    );

  const listOf = (node: HTMLElement) => ({
    bullet: (node.dataset.bullet as BulletKind | undefined) || undefined,
    level: Number(node.dataset.level ?? '0') || undefined,
  });

  const setList = (node: HTMLElement, bullet: BulletKind | undefined, level: number | undefined) => {
    if (bullet && bullet !== 'none') node.dataset.bullet = bullet;
    else delete node.dataset.bullet;
    const lv = clampLevel(level);
    if (lv) node.dataset.level = String(lv);
    else delete node.dataset.level;
  };

  /**
   * Draw the markers and hanging indents, exactly as <ParagraphView> does.
   *
   * Numbering counts across the whole body, so this runs over every block after
   * any edit — typing a new line in the middle of a numbered list has to
   * renumber the ones below it. Markers are `contenteditable=false` spans
   * carrying `data-marker`, which keeps the caret out of them and lets
   * `runsFromNodes` skip them when reading the text back.
   */
  const syncMarkers = () => {
    const nodes = blocks();
    const markers = bulletMarkers(nodes.map((n) => ({ runs: [], ...listOf(n) })));
    nodes.forEach((node, i) => {
      const { indentPt, hangPt } = indentMetricsPt({ runs: [], ...listOf(node) });
      node.style.paddingLeft = `${indentPt * EMU_PER_POINT * scale}px`;
      node.style.textIndent = `${-hangPt * EMU_PER_POINT * scale}px`;
      const marker = markers[i];
      const existing = node.querySelector<HTMLElement>(':scope > [data-marker]');
      if (!marker) {
        existing?.remove();
        return;
      }
      const span = existing ?? document.createElement('span');
      span.dataset.marker = '';
      span.contentEditable = 'false';
      span.style.display = 'inline-block';
      span.style.width = `${hangPt * EMU_PER_POINT * scale}px`;
      span.style.textIndent = '0';
      span.style.fontWeight = '400';
      span.style.fontStyle = 'normal';
      span.style.textDecoration = 'none';
      // Match the paragraph's own type — the block carries its first run's
      // font, size and colour, so inheriting from it is enough. A square
      // bullet is then drawn up so it reads at the weight of that text, with
      // the line height pinned so the bigger glyph can't grow the line box.
      const blockPx = parseFloat(node.style.fontSize) || 0;
      const sizeScale = markerSizeScale(listOf(node));
      span.style.fontSize = sizeScale === 1 ? node.style.fontSize : `${blockPx * sizeScale}px`;
      span.style.lineHeight = `${blockPx * (parseFloat(node.style.lineHeight) || 1)}px`;
      // A transform, so centring the glyph on the text can't shift the line box.
      const shift = markerShiftEm(listOf(node)) * blockPx;
      span.style.transform = shift ? `translateY(${shift}px)` : '';
      span.textContent = marker;
      if (!existing) node.insertBefore(span, node.firstChild);
    });
  };

  /** Blocks the caret or selection touches; the whole box if we can't tell. */
  const targetBlocks = () => {
    const all = blocks();
    const sel = window.getSelection();
    if (!sel?.rangeCount || !ref.current?.contains(sel.anchorNode)) return all;
    const range = sel.getRangeAt(0);
    const hit = all.filter((b) => range.intersectsNode(b));
    return hit.length ? hit : all;
  };

  const applyList = (kind: BulletKind) => {
    const hit = targetBlocks();
    // Pressing the style a paragraph already has clears it, as in PowerPoint.
    const off = hit.every((b) => b.dataset.bullet === kind);
    hit.forEach((b) => setList(b, off ? 'none' : kind, listOf(b).level));
    syncMarkers();
    syncModel();
  };

  /**
   * The block the caret sits at the START of, if it does — everything before it
   * inside the block is the marker span, which is drawn rather than typed.
   */
  const blockAtCaretStart = (): HTMLElement | null => {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel?.rangeCount || !sel.isCollapsed) return null;
    const caret = sel.getRangeAt(0);
    if (!root.contains(caret.startContainer)) return null;
    const block = blocks().find((b) => b.contains(caret.startContainer));
    if (!block) return null;
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(caret.startContainer, caret.startOffset);
    const head = before.cloneContents();
    head.querySelectorAll('[data-marker]').forEach((n) => n.remove());
    return head.textContent ? null : block;
  };

  /**
   * Backspace at the head of a list paragraph. The browser would delete the
   * marker span sitting to the left of the caret — which `syncMarkers` then
   * redraws, so the line looked undeletable. Peel the list style instead, and
   * let a plain paragraph fall through to the browser's own merge.
   */
  const backspaceOutdent = () => {
    const block = blockAtCaretStart();
    if (!block) return false;
    const next = backspaceList(listOf(block));
    if (!next) return false;
    setList(block, next.bullet, next.level);
    syncMarkers();
    syncModel();
    return true;
  };

  const applyIndent = (delta: number) => {
    targetBlocks().forEach((b) => {
      const { bullet, level } = listOf(b);
      setList(b, bullet, clampLevel((level ?? 0) + delta));
    });
    syncMarkers();
    syncModel();
  };

  /**
   * One <span> per run, mirroring <ParagraphView>. Entering edit mode used to
   * join a paragraph's runs into one flat text node, so mixed formatting was
   * invisible while editing — and `commit` then wrote that flattened text back,
   * quietly destroying (say) an italic job title inside a caption.
   *
   * `data-run` records which paragraph AND run each span came from, so `commit`
   * can recover the props that CSS can't round-trip: color is a design-system
   * token, not a hex, and size/font live in model units. Both halves matter —
   * see `runSource.ts`.
   */
  const applyRunStyle = (span: HTMLElement, r: TextRun) => {
    span.style.fontFamily = FONTS[r.font ?? ds.fonts.body].cssStack;
    span.style.fontSize = `${(r.sizePt ?? ds.type.body.sizePt) * EMU_PER_POINT * scale}px`;
    span.style.fontWeight = String(runWeight(r));
    span.style.fontStyle = r.italic ? 'italic' : 'normal';
    span.style.textDecoration = r.underline ? 'underline' : 'none';
    // Visual only — `commit` reads `nodeValue`, which CSS never touches, so the
    // author's own casing survives in the model.
    span.style.textTransform = r.caps ? 'uppercase' : 'none';
    span.style.color = resolveColor(r.color, ds);
  };

  const runSpan = (r: TextRun, para: number, index: number) => {
    const span = document.createElement('span');
    span.dataset.run = runKey(para, index);
    applyRunStyle(span, r);
    span.textContent = r.text;
    return span;
  };

  /**
   * Re-style the run spans inside one paragraph block from the model. The
   * block's own strut only drives the LINE BOX, so restyling blocks alone made
   * a font-size change while editing show up as lines opening up around type
   * that hadn't changed size — the glyphs only jumped once the edit committed
   * and the renderer took over. Style attributes only, never text: the caret
   * and any half-typed word have to survive.
   */
  const applyRunStyles = (block: HTMLElement) => {
    block.querySelectorAll<HTMLElement>('[data-run]').forEach((span) => {
      // Against the whole body, not one paragraph: a span carries its own
      // paragraph index, and after an Enter the block it sits in is no longer
      // the paragraph it was painted from.
      const r = runAt(body.paragraphs, span.dataset.run);
      if (r) applyRunStyle(span, r);
    });
  };

  /**
   * Build the editable's contents from a set of paragraphs. Used on mount, and
   * again whenever the model's RUN STRUCTURE changes under the open editor —
   * splitting a run to restyle a selection renumbers `data-run`, which the
   * restyle-only effect below can't follow.
   */
  const paint = (paragraphs: Paragraph[]) => {
    const node = ref.current;
    if (!node) return;
    node.replaceChildren(
      ...paragraphs.map((p, pi) => {
        const line = document.createElement('div');
        // Which paragraph this block IS, so `commit` doesn't have to infer it
        // from a position the browser is free to change.
        line.dataset.para = String(pi);
        applyParagraphStyle(line, p);
        // Index by position in p.runs, not in the filtered list — `data-run` is
        // how commit finds the source run again.
        const runs = p.runs.map((r, i) => [r, i] as const).filter(([r]) => r.text);
        // An empty block collapses to zero height without a <br> placeholder.
        if (runs.length) line.append(...runs.map(([r, i]) => runSpan(r, pi, i)));
        else line.appendChild(document.createElement('br'));
        return line;
      }),
    );
    syncMarkers();
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    paint(body.paragraphs);
    node.focus();
    // Double-clicked in? The editable now covers the same rectangle the text was
    // drawn in, so the click point resolves to the character it landed on.
    if (caretPoint && placeCaretAt(node, caretPoint)) {
      onInput?.(node);
      return;
    }
    // Place caret at the end of the last PARAGRAPH, not of the editable: text
    // typed after the last block is a sibling of it, which reads back as an
    // extra paragraph. An empty block holds only its placeholder <br>, so the
    // caret goes before that rather than after it.
    const range = document.createRange();
    const last = node.lastElementChild;
    const target = last && (last.tagName === 'DIV' || last.tagName === 'P') ? last : node;
    const only = target.childNodes.length === 1 ? target.firstChild : null;
    if (only instanceof HTMLBRElement) range.setStartBefore(only);
    else range.selectNodeContents(target);
    range.collapse(only instanceof HTMLBRElement ? true : false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Whatever this box's size follows from its text (a sticky note's paper)
    // sizes itself once here too: the editor can open on text the model has
    // never measured — a note typed on straight from the keyboard, or one whose
    // words arrived from anywhere but this editable.
    if (node) onInput?.(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply styling when the model changes under an OPEN editor — Inspector
  // edits, a caret-only B/I/U, a font-size shortcut. Blocks and the run spans
  // inside them both, since the block carries only the line box. Style
  // attributes only, never text nodes, so the caret and any half-typed word
  // survive; rebuilding children here would fling the caret to the end
  // mid-sentence.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    Array.from(node.children).forEach((child, i) => {
      if (!(child instanceof HTMLElement)) return;
      const claimed = child.dataset.para;
      const p = body.paragraphs[claimed === undefined ? i : Number(claimed)];
      if (p) applyParagraphStyle(child, p);
      applyRunStyles(child);
    });
    // applyParagraphStyle reseeds each block's list attributes from the model,
    // so the markers and indents have to be redrawn to match.
    syncMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, scale, ds]);

  /**
   * Read the editable back out as model paragraphs. Takes the root explicitly
   * because the unmount commit runs after React has detached `ref`.
   *
   * `stamp` re-keys the DOM to the paragraphs just read: run for run, block for
   * block. The caller runs it once the write has landed, because until then the
   * blocks and spans still name the paragraphs the editor OPENED with — and a
   * second read (another sync, or the commit) would resolve those stale claims
   * against a model that has since gained or lost paragraphs, pulling one
   * paragraph's font and colour onto another's text.
   */
  const readParagraphs = (
    root: HTMLElement | null,
  ): { paragraphs: Paragraph[]; stamp: () => void } | null => {
    if (!root) return null;

    // Group the editable's top-level nodes into paragraphs. Our own render puts
    // one <div> per paragraph and Enter keeps that shape, but a browser can also
    // leave bare text or a <br> at the top level — those collect into an
    // implicit paragraph rather than being dropped.
    // `owner` is the block element the nodes came from, when there is one: it
    // carries the paragraph's live bullet and indent level.
    const groups: { nodes: Node[]; owner: HTMLElement | null }[] = [];
    let implicit: Node[] | null = null;
    for (const node of Array.from(root.childNodes)) {
      if (node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P')) {
        implicit = null;
        groups.push({ nodes: [node], owner: node });
      } else {
        if (!implicit) {
          implicit = [];
          groups.push({ nodes: implicit, owner: null });
        }
        implicit.push(node);
      }
    }

    const paragraphs: Paragraph[] = [];
    // Collected as we go, applied by `stamp` — reading must not disturb the DOM
    // it is reading, and a read whose element has gone never stamps at all.
    const stamps: (() => void)[] = [];
    let previous: number | null = null;
    for (const [position, { nodes, owner }] of (
      groups.length ? groups : [{ nodes: [], owner: null }]
    ).entries()) {
      // Keep each paragraph's own spacing/bullet/alignment. A block painted
      // from the model says which paragraph it is; one the browser made — the
      // far half of an Enter, bare text at the top level — inherits from the
      // paragraph before it. Reading the style off the block's POSITION instead
      // meant one Enter shifted every paragraph below it onto the next
      // paragraph's styling.
      const claimed = owner?.dataset.para;
      const index = paragraphSource(
        body.paragraphs.length,
        claimed === undefined ? null : Number(claimed),
        previous,
        position,
      );
      previous = index;
      const src = body.paragraphs[index];
      const base = src?.runs[0] ?? firstRun;
      const inherit: Fmt = {
        bold: !!base.bold,
        italic: !!base.italic,
        underline: !!base.underline,
      };
      // Font, size and color come from the run the text was typed into, which
      // `data-run` names outright — paragraph and run both, so a span still
      // resolves to its own run after the browser has moved it into another
      // block. Text with no span of its own continues the run it follows (see
      // `runsFromNodes`), and only a paragraph that starts with such text falls
      // back to its first run.
      const sourceRun = (key: string | null) => runAt(body.paragraphs, key) ?? base;
      // The block, not `src`, owns the list style — a bullet toggled or
      // indented since the editor opened lives only in the DOM until now. A
      // <br>-split block hands the same style to both halves.
      const list = owner ? listOf(owner) : { bullet: src?.bullet, level: src?.level };
      const first = paragraphs.length;
      if (owner) stamps.push(() => (owner.dataset.para = String(first)));
      for (const runs of runsFromNodes(nodes, sourceRun, inherit)) {
        const at = paragraphs.length;
        runs.forEach((run, i) =>
          run.__els.forEach((el) => stamps.push(() => (el.dataset.run = runKey(at, i)))),
        );
        paragraphs.push({
          ...src,
          ...list,
          runs: runs.length ? runs.map(plainRun) : [{ ...base, text: '' }],
        });
      }
    }
    return { paragraphs, stamp: () => stamps.forEach((f) => f()) };
  };

  /**
   * Write the editable's text into the model, if it actually differs — an
   * unchanged write would still push an undo step.
   */
  const writeBack = (root: HTMLElement | null) => {
    const read = readParagraphs(root);
    if (!read) return;
    const { paragraphs } = read;
    // Against the LIVE body, not this render's: `commit` writes and closes in
    // one batch, so the unmount pass never sees a render carrying its own
    // result and would otherwise re-write it as a second undo step. A missing
    // element (deleted, or the slide changed under us) has nowhere to go.
    const s = store();
    const el2 = s.deck.slides
      .find((sl) => sl.id === s.currentSlideId)
      ?.elements.find((x) => x.id === el.id);
    const live = el2 && 'body' in el2 ? el2.body : undefined;
    if (!live) return;
    // Re-key either way: an unchanged read still tells us which block and span
    // is which paragraph and run, and the claims are worth correcting before
    // the next read leans on them.
    read.stamp();
    if (JSON.stringify(paragraphs) === JSON.stringify(live.paragraphs)) return;
    store().updateElement(el.id, { body: { ...live, paragraphs } });
  };

  /** Push the current text into the model without leaving edit mode. */
  const syncModel = () => writeBack(ref.current);

  const commit = () => {
    writeBack(ref.current);
    store().setEditing(null);
  };

  /**
   * Every way OUT of edit mode other than blur — clicking another element,
   * clicking empty canvas, Escape, changing slides — clears `editingId` from
   * inside the mousedown/keydown handler, which unmounts this component before
   * the browser gets around to firing `blur`. Typing lives only in the
   * contentEditable DOM until commit, so without this the edit was thrown away.
   *
   * The node is captured on mount: by cleanup time React has already nulled
   * `ref`, but the detached element still holds the text we need to read.
   */
  const commitRef = useRef<(root: HTMLElement | null) => void>(writeBack);
  // Refreshed every render so the cleanup writes against the CURRENT model,
  // not the one this component happened to mount with.
  commitRef.current = writeBack;
  useEffect(() => {
    const node = ref.current;
    return () => commitRef.current(node);
  }, []);

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

  /**
   * The format painter, narrowed to the text under the cursor.
   *
   * With characters highlighted it works exactly like B/I/U does: ⌘⌥C samples
   * the run the selection starts in and ⌘⌥V restyles only those characters,
   * leaving the rest of the box alone. A bare caret keeps the old whole-element
   * behaviour, which is what PowerPoint falls back to as well.
   *
   * Typing lives in the DOM until commit, so the model is synced first —
   * otherwise the offsets read off the DOM would address a stale body — and the
   * editor is repainted after, because splitting a run to restyle a stretch of
   * it renumbers every `data-run` below the split.
   */
  const applyPainter = (painter: 'copy' | 'paste') => {
    const node = ref.current;
    const range = node ? selectionOffsets(node) : null;
    if (range) syncModel();
    if (painter === 'copy') {
      if (!range) return store().copyFormat(el.id);
      // A selection samples its first character; a caret samples the character
      // behind it, the one it would extend by typing.
      store().copyTextFormat(el.id, range.start, range.end > range.start ? 'after' : 'before');
      return;
    }
    if (!range || range.end === range.start) {
      // Restyling the whole box ends the edit — commit the typing first, then
      // stamp the format over the result.
      commit();
      store().pasteFormat([el.id]);
      return;
    }
    store().pasteTextFormat(el.id, range.start, range.end);
    const s = store();
    const live = s.deck.slides
      .find((sl) => sl.id === s.currentSlideId)
      ?.elements.find((x) => x.id === el.id);
    const paragraphs = live && 'body' in live ? live.body?.paragraphs : undefined;
    if (!paragraphs || !node) return;
    paint(paragraphs);
    node.focus();
    selectOffsets(node, range);
  };

  const justify =
    body.anchor === 'middle' ? 'center' : body.anchor === 'bottom' ? 'flex-end' : 'flex-start';

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      // Typing can add, remove or reorder blocks (Enter, a paste, deleting a
      // line), and every one of those changes the numbering below it.
      onInput={(e) => {
        syncMarkers();
        onInput?.(e.currentTarget);
      }}
      // Pasting brings the words, never the source's formatting — see
      // `plainPaste.ts`. `insertText` is used rather than writing to the DOM
      // directly so the browser keeps its own undo stack and caret handling,
      // and each newline becomes a <br>, which `commit` already reads back as
      // a new paragraph.
      onPaste={(e) => {
        e.preventDefault();
        const lines = plainPasteLines(e.clipboardData);
        if (!lines.length) return;
        lines.forEach((line, i) => {
          if (i) document.execCommand('insertLineBreak');
          if (line) document.execCommand('insertText', false, line);
        });
        syncMarkers();
        onInput?.(e.currentTarget);
      }}
      // Enter is deliberately NOT handled: it types a new paragraph, the way it
      // does in PowerPoint and in every other text box. It used to finish the
      // edit, on the theory that most boxes are one-line labels — but that
      // makes a multi-line box impossible to type normally, and Escape (and
      // clicking away) already end the edit.
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          store().setEditing(null);
        }
        const mod = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        const sizeDir = fontSizeDirection(e);
        const painter = formatPainterAction(e);
        const textEdge = textAlignEdge(e);
        if (painter) {
          e.preventDefault();
          applyPainter(painter);
        } else if (e.key === 'Backspace' && !mod && backspaceOutdent()) {
          e.preventDefault();
        } else if (e.key === 'Tab') {
          // PowerPoint's demote/promote. The editable would otherwise lose
          // focus to the next control, ending the edit.
          e.preventDefault();
          applyIndent(e.shiftKey ? -1 : 1);
        } else if (mod && e.shiftKey && (key === '8' || key === '*')) {
          e.preventDefault();
          applyList('bullet');
        } else if (mod && e.shiftKey && (key === '7' || key === '&')) {
          e.preventDefault();
          applyList('number');
        } else if (textEdge) {
          // Same chord as on the canvas, so alignment behaves the same whether
          // the box is selected or being typed into.
          e.preventDefault();
          if (textEdge === 'left' || textEdge === 'right') {
            store().patchParagraphs([el.id], {
              align: nextParaAlign(textEdge, body.paragraphs[0]?.align),
            });
          } else {
            store().setAnchor([el.id], nextAnchor(textEdge, body.anchor));
          }
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
          store().stepFontSize([el.id], sizeDir);
        }
        e.stopPropagation();
      }}
      style={{
        position: 'absolute',
        inset: 0,
        paddingLeft: (body.insets?.l ?? DEFAULT_TEXT_INSETS.l) * scale,
        paddingTop: (body.insets?.t ?? DEFAULT_TEXT_INSETS.t) * scale,
        paddingRight: (body.insets?.r ?? DEFAULT_TEXT_INSETS.r) * scale,
        paddingBottom: (body.insets?.b ?? DEFAULT_TEXT_INSETS.b) * scale,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        outline: '2px solid #2600FF',
        fontFamily: font.cssStack,
        fontSize: (firstRun.sizePt ?? ds.type.body.sizePt) * EMU_PER_POINT * scale,
        fontWeight: runWeight(firstRun),
        fontStyle: firstRun.italic ? 'italic' : 'normal',
        textTransform: firstRun.caps ? ('uppercase' as const) : ('none' as const),
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
