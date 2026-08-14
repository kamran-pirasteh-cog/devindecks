'use client';

/**
 * Toolbar — thin trigger surface over the command layer. Every button calls a
 * store action; it holds no logic of its own. The same actions back the future
 * Devin chat.
 */
import { useRef, useState } from 'react';
import { useEditor } from '@/store/editorStore';
import { useComments } from '@/store/commentStore';
import { makeShape } from './factories';
import { LinePopover } from './LinePopover';
import { TextPopover } from './TextPopover';
import { ShortcutsModal } from './ShortcutsModal';
import { ChartPopover } from './ChartPopover';
import { OVERLAY_Z } from './layers';
import { FIT_TO_MARGINS_BUTTON } from '@/flags';
import type { ShapePreset } from '@/model';

const SHAPES: { preset: ShapePreset; label: string }[] = [
  { preset: 'rect', label: '▭' },
  { preset: 'rightArrow', label: '→' },
];

function Btn({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        onClick={onClick}
        aria-label={title}
        disabled={disabled}
        className="flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {children}
      </button>
      <span
        style={{ zIndex: OVERLAY_Z }}
        className="pointer-events-none absolute top-full left-1/2 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity delay-300 group-hover:opacity-100 dark:bg-zinc-700"
      >
        {title}
      </span>
    </div>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />;

export function Toolbar() {
  const addElement = useEditor((s) => s.addElement);
  const reorder = useEditor((s) => s.reorder);
  const copyFormat = useEditor((s) => s.copyFormat);
  const pasteFormat = useEditor((s) => s.pasteFormat);
  const hasFormat = useEditor((s) => s.formatClipboard !== null);
  const showGuides = useEditor((s) => s.showGuides);
  const toggleGuides = useEditor((s) => s.toggleGuides);
  const pageNumbers = useEditor((s) => !!s.deck.pageNumbers);
  const togglePageNumbers = useEditor((s) => s.togglePageNumbers);
  const fitToMargins = useEditor((s) => s.fitToMargins);
  const slideIsEmpty = useEditor(
    (s) => !s.deck.slides.find((sl) => sl.id === s.currentSlideId)?.elements.length,
  );
  const selCount = useEditor((s) => s.selectedIds.length);
  const selectedIds = useEditor((s) => s.selectedIds);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const startDraft = useComments((s) => s.startDraft);
  const togglePanel = useComments((s) => s.togglePanel);
  const panelOpen = useComments((s) => s.panelOpen);
  const openThreads = useComments((s) => s.threads.filter((t) => !t.resolved).length);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const insertChart = useEditor((s) => s.insertChart);
  const ds = useEditor((s) => s.designSystem);
  const [showLine, setShowLine] = useState(false);
  const [showText, setShowText] = useState(false);
  const lineAnchorRef = useRef<HTMLDivElement>(null);
  const textAnchorRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-center gap-0.5 border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
      <div ref={textAnchorRef} className="relative flex">
        <Btn onClick={() => setShowText((v) => !v)} title="Add text">
          <span className="font-serif">T</span>
        </Btn>
        {showText ? (
          <TextPopover onClose={() => setShowText(false)} anchorRef={textAnchorRef} />
        ) : null}
      </div>
      <div ref={lineAnchorRef} className="relative flex">
        <Btn onClick={() => setShowLine((v) => !v)} title="Add line">
          ╱
        </Btn>
        {showLine ? (
          <LinePopover onClose={() => setShowLine(false)} anchorRef={lineAnchorRef} />
        ) : null}
      </div>
      <Divider />
      {SHAPES.map((s) => (
        <Btn key={s.preset} onClick={() => addElement(makeShape(s.preset))} title={`Add ${s.preset}`}>
          {s.label}
        </Btn>
      ))}
      <Divider />
      <Btn
        onClick={() => copyFormat()}
        title="Copy formatting (⌘⌥C)"
        disabled={selCount < 1}
      >
        🖌↑
      </Btn>
      <Btn
        onClick={() => pasteFormat()}
        title="Paste formatting (⌘⌥V)"
        disabled={selCount < 1 || !hasFormat}
      >
        🖌↓
      </Btn>
      <Divider />
      <Btn
        onClick={toggleGuides}
        title={showGuides ? 'Hide margin guides (⌘⇧G)' : 'Show margin guides (⌘⇧G)'}
      >
        <span className={showGuides ? 'text-sky-500' : undefined}>⊞</span>
      </Btn>
      {FIT_TO_MARGINS_BUTTON ? (
        <Btn
          onClick={fitToMargins}
          title={
            selCount > 0
              ? 'Fit selection inside margin guides'
              : 'Fit slide content inside margin guides'
          }
          disabled={slideIsEmpty}
        >
          ⊡
        </Btn>
      ) : null}
      <Btn
        onClick={togglePageNumbers}
        title={pageNumbers ? 'Remove page numbers' : 'Add page numbers to all slides'}
      >
        <span className={pageNumbers ? 'text-sky-500' : undefined}>#</span>
      </Btn>
      <Divider />
      <Btn
        onClick={() => startDraft(currentSlideId, selectedIds[0])}
        title={
          selectedIds.length
            ? 'Comment on selection (⌘⌥M)'
            : 'Comment on this slide (⌘⌥M)'
        }
      >
        💬
      </Btn>
      <Divider />
      <Btn onClick={() => reorder('front')} title="Bring to front" disabled={selCount < 1}>
        ⬆
      </Btn>
      <Btn onClick={() => reorder('back')} title="Send to back" disabled={selCount < 1}>
        ⬇
      </Btn>
      <div className="flex-1" />
      <div className="relative">
        <button
          onClick={() => setShowCharts((o) => !o)}
          title="Insert a chart"
          aria-pressed={showCharts}
          className={`flex h-8 items-center rounded-md px-2.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            showCharts ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-600 dark:text-zinc-300'
          }`}
        >
          Charts
        </button>
        {showCharts ? (
          <ChartPopover
            ds={ds}
            onPick={(spec) => insertChart(spec)}
            onClose={() => setShowCharts(false)}
          />
        ) : null}
      </div>
      <Divider />
      <button
        onClick={togglePanel}
        title={panelOpen ? 'Hide comments' : 'Show comments'}
        aria-pressed={panelOpen}
        className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
          panelOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-600 dark:text-zinc-300'
        }`}
      >
        Comments
        {openThreads > 0 ? (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-semibold text-amber-950">
            {openThreads}
          </span>
        ) : null}
      </button>
      <Divider />
      <button
        onClick={() => setShowShortcuts(true)}
        title="Keyboard shortcuts"
        className="flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Shortcuts
      </button>
      {showShortcuts ? <ShortcutsModal onClose={() => setShowShortcuts(false)} /> : null}
    </div>
  );
}
