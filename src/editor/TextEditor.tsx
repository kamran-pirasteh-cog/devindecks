'use client';

/**
 * Inline text editing. A contentEditable overlay sized to the element, styled to
 * match the first run so editing feels WYSIWYG. On commit we split by newline
 * into paragraphs and rebuild runs, preserving the leading run's styling.
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
} from '@/model';
import { useEditor } from '@/store/editorStore';

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
  const initialText = body.paragraphs
    .map((p) => p.runs.map((r) => r.text).join(''))
    .join('\n');

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.textContent = initialText;
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

  const commit = () => {
    const text = ref.current?.innerText ?? '';
    const paragraphs: Paragraph[] = text.split('\n').map((line) => ({
      ...body.paragraphs[0],
      runs: [{ ...firstRun, text: line }],
    }));
    store().updateElement(el.id, { body: { ...body, paragraphs } });
    store().setEditing(null);
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
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
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
        background: 'rgba(255,255,255,0.6)',
        fontFamily: font.cssStack,
        fontSize: (firstRun.sizePt ?? ds.type.body.sizePt) * EMU_PER_POINT * scale,
        fontWeight: firstRun.bold ? 700 : 400,
        fontStyle: firstRun.italic ? 'italic' : 'normal',
        color: resolveColor(firstRun.color, ds),
        textAlign: (body.paragraphs[0]?.align ?? 'left') as 'left' | 'center' | 'right',
        whiteSpace: 'pre-wrap',
        cursor: 'text',
      }}
    />
  );
}
