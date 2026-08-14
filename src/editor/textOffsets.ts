/**
 * Mapping between the text editor's contentEditable DOM and the flat character
 * offsets `textRange` speaks in.
 *
 * The walk mirrors `readParagraphs`/`runsFromNodes` in <TextEditor> exactly —
 * bullet markers are drawn, not typed, so they count for nothing; a <br> and a
 * block boundary each count as the one newline that separates two model
 * paragraphs. Only then do offsets taken off the DOM address the same
 * characters in the model the editor just wrote back.
 */
export interface OffsetRange {
  start: number;
  end: number;
}

interface Index {
  starts: Map<Node, number>;
  ends: Map<Node, number>;
  texts: { node: Text; start: number }[];
}

const isBlock = (node: Node) =>
  node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P');

function indexNodes(root: HTMLElement): Index {
  const starts = new Map<Node, number>();
  const ends = new Map<Node, number>();
  const texts: { node: Text; start: number }[] = [];
  let count = 0;

  const visit = (node: Node) => {
    starts.set(node, count);
    if (node.nodeType === Node.TEXT_NODE) {
      texts.push({ node: node as Text, start: count });
      count += (node.nodeValue ?? '').length;
    } else if (node instanceof HTMLElement) {
      if (node.dataset.marker !== undefined) {
        // Drawn glyph — no characters of its own.
      } else if (node.tagName === 'BR') {
        count += 1;
      } else {
        node.childNodes.forEach(visit);
      }
    }
    ends.set(node, count);
  };

  starts.set(root, 0);
  // Paragraph grouping, as in readParagraphs: every block child is its own
  // paragraph, and a stretch of loose nodes between blocks is one more.
  let started = false;
  let inImplicit = false;
  for (const child of Array.from(root.childNodes)) {
    if (isBlock(child)) {
      if (started) count += 1;
      inImplicit = false;
    } else if (!inImplicit) {
      if (started) count += 1;
      inImplicit = true;
    }
    started = true;
    visit(child);
  }
  ends.set(root, count);
  return { starts, ends, texts };
}

/** Where the current selection sits in `root`, or null if it isn't inside it. */
export function selectionOffsets(root: HTMLElement): OffsetRange | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const idx = indexNodes(root);
  const at = (node: Node, offset: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (idx.starts.get(node) ?? 0) + Math.min(offset, (node.nodeValue ?? '').length);
    }
    const child = node.childNodes[offset];
    if (child) return idx.starts.get(child) ?? idx.ends.get(node) ?? 0;
    return idx.ends.get(node) ?? 0;
  };
  // A DOM range is always ordered, so start <= end already; clamp anyway rather
  // than hand a backwards range to the model.
  const a = at(range.startContainer, range.startOffset);
  const b = at(range.endContainer, range.endOffset);
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/**
 * Put the selection back after the editor's DOM has been rebuilt — a paste that
 * restyles part of a box replaces every span, and the highlight has to survive
 * so the user can paste a second format over the same words.
 */
export function selectOffsets(root: HTMLElement, { start, end }: OffsetRange) {
  const idx = indexNodes(root);
  const point = (offset: number): [Node, number] => {
    for (const t of idx.texts) {
      const len = (t.node.nodeValue ?? '').length;
      if (offset >= t.start && offset <= t.start + len) return [t.node, offset - t.start];
      if (t.start > offset) break;
    }
    const last = idx.texts[idx.texts.length - 1];
    if (last) return [last.node, (last.node.nodeValue ?? '').length];
    return [root, 0];
  };
  const range = document.createRange();
  const [sn, so] = point(start);
  const [en, eo] = point(end);
  range.setStart(sn, so);
  range.setEnd(en, eo);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
