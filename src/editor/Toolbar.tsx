'use client';

/**
 * Toolbar — thin trigger surface over the command layer. Every button calls a
 * store action; it holds no logic of its own. The same actions back the future
 * Devin chat.
 */
import { useMemo, useRef, useState } from 'react';
import { useEditor } from '@/store/editorStore';
import { useComments } from '@/store/commentStore';
import { FLAGS } from '@/flags';
import { makeArrow, makeShape } from './factories';
import { LinePopover } from './LinePopover';
import { TextPopover } from './TextPopover';
import { CalloutPopover } from './CalloutPopover';
import { BandPopover } from './BandPopover';
import { ShortcutsModal } from './ShortcutsModal';
import { RefreshPromptDialog } from './RefreshPromptDialog';
import { ChartPopover } from './ChartPopover';
import { ImportSlidesDialog } from './ImportSlidesDialog';
import { OVERLAY_Z } from './layers';
import { showsPageNumbers, type ShapePreset } from '@/model';
import { buildDeckRefreshPrompt } from '@/devin/refresh';
import { useToast } from '@/ui/Toast';

const SHAPES: { preset: ShapePreset; label: string }[] = [{ preset: 'rect', label: '▭' }];

function Btn({
  onClick,
  title,
  disabled,
  variant = 'ghost',
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  /** `primary` is the filled blue affordance — one per cluster at most. */
  variant?: 'ghost' | 'primary';
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex">
      <button
        onClick={onClick}
        aria-label={title}
        disabled={disabled}
        className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm disabled:opacity-30 ${
          variant === 'primary'
            ? 'bg-blue-600 font-semibold text-white hover:bg-blue-700'
            : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
        }`}
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
  const insertEyebrow = useEditor((s) => s.insertEyebrow);
  const showGuides = useEditor((s) => s.showGuides);
  const toggleGuides = useEditor((s) => s.toggleGuides);
  const pageNumbers = useEditor((s) => showsPageNumbers(s.deck));
  const togglePageNumbers = useEditor((s) => s.togglePageNumbers);
  const fitToMargins = useEditor((s) => s.fitToMargins);
  const slideIsEmpty = useEditor(
    (s) => !s.deck.slides.find((sl) => sl.id === s.currentSlideId)?.elements.length,
  );
  const selCount = useEditor((s) => s.selectedIds.length);
  const insertSticky = useEditor((s) => s.insertSticky);
  const togglePanel = useComments((s) => s.togglePanel);
  const panelOpen = useComments((s) => s.panelOpen);
  const openThreads = useComments((s) => s.threads.filter((t) => !t.resolved).length);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showRefresh, setShowRefresh] = useState(false);
  const toast = useToast();
  const [showCharts, setShowCharts] = useState(false);
  const insertChart = useEditor((s) => s.insertChart);
  const ds = useEditor((s) => s.designSystem);
  const deck = useEditor((s) => s.deck);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  // What the deck already knows about its subject. A chart described as
  // "quarterly ARR by segment" is about SOMEBODY, and the tag is where client
  // names live — so the picker can name the client without asking for it again.
  // Derived here rather than in the selector: a selector that builds an object
  // returns a new reference every read, which React's snapshot check rejects.
  const chartContext = useMemo(() => {
    const slide = deck.slides.find((sl) => sl.id === currentSlideId);
    const title = slide?.elements.find(
      (e) => e.type === 'text' && (e.role === 'title' || e.role === 'heading'),
    );
    return {
      deckTitle: deck.title,
      deckTags: deck.tags,
      slideTitle:
        title?.type === 'text'
          ? title.body.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(' ')
          : undefined,
    };
  }, [deck, currentSlideId]);
  const [showLine, setShowLine] = useState(false);
  const [showText, setShowText] = useState(false);
  const lineAnchorRef = useRef<HTMLDivElement>(null);
  const [showImport, setShowImport] = useState(false);
  const textAnchorRef = useRef<HTMLDivElement>(null);
  const [showCallout, setShowCallout] = useState(false);
  const calloutAnchorRef = useRef<HTMLDivElement>(null);
  const [showBand, setShowBand] = useState(false);
  const bandAnchorRef = useRef<HTMLDivElement>(null);

  /**
   * The prompt is built from the LIVE deck on every click, so it can never
   * describe numbers that have since changed. `navigator.clipboard` doesn't
   * exist on a non-secure origin, so a failure falls back to showing the text
   * rather than dead-ending.
   */
  const copyRefreshPrompt = async () => {
    const { text } = buildDeckRefreshPrompt(deck);
    try {
      await navigator.clipboard.writeText(text);
      toast('Devin prompt copied to clipboard');
    } catch {
      setShowRefresh(true);
    }
  };

  return (
    <div className="flex items-center gap-0.5 border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
      <button
        onClick={() => setShowImport(true)}
        title="Import slides from a .pptx or PDF"
        className="flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Import Slides
      </button>
      {showImport ? <ImportSlidesDialog onClose={() => setShowImport(false)} /> : null}
      <Divider />
      <div ref={calloutAnchorRef} className="relative flex">
        <Btn onClick={() => setShowCallout((v) => !v)} title="Add callout card">
          {/* The text button's serif T, boxed — the card is type on a fill. */}
          <span className="flex h-4 w-5 items-center justify-center rounded-[3px] bg-zinc-800 font-serif text-[10px] leading-none text-white dark:bg-zinc-200 dark:text-zinc-900">
            T
          </span>
        </Btn>
        {showCallout ? (
          <CalloutPopover onClose={() => setShowCallout(false)} anchorRef={calloutAnchorRef} />
        ) : null}
      </div>
      <div ref={bandAnchorRef} className="relative flex">
        <Btn onClick={() => setShowBand((v) => !v)} title="Add side band">
          {/* The arrangement itself, in miniature: a filled panel down one edge
              of the page, with the rest of the slide left open. */}
          <span className="flex h-4 w-5 overflow-hidden rounded-[2px] border border-current opacity-80">
            <span className="h-full w-1/3 bg-current" />
          </span>
        </Btn>
        {showBand ? (
          <BandPopover onClose={() => setShowBand(false)} anchorRef={bandAnchorRef} />
        ) : null}
      </div>
      <Btn onClick={insertEyebrow} title="Add eyebrow above the title (⌘⇧E)">
        {/* The feature itself, in miniature: the accent square, then the line
            of type it introduces. */}
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 bg-blue-600" />
          <span className="h-0.5 w-3 rounded-full bg-current opacity-60" />
        </span>
      </Btn>
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
      {SHAPES.map((s) => (
        <Btn
          key={s.preset}
          onClick={() => addElement(makeShape(s.preset))}
          title={`Add ${s.preset}`}
        >
          {s.label}
        </Btn>
      ))}
      <Btn onClick={() => addElement(makeArrow())} title="Add arrow">
        →
      </Btn>
      <Divider />
      <Btn
        onClick={toggleGuides}
        title={showGuides ? 'Hide margin guides (⌘⇧G)' : 'Show margin guides (⌘⇧G)'}
      >
        <span className={showGuides ? 'text-sky-500' : undefined}>⊞</span>
      </Btn>
      <Btn
        onClick={fitToMargins}
        title={
          selCount > 0
            ? 'Move the selection as one block onto the margin guides'
            : 'Move this slide\u2019s content as one block onto the margin guides'
        }
        disabled={slideIsEmpty}
      >
        <span className="text-xs font-medium">Enforce margins</span>
      </Btn>
      <Btn
        onClick={togglePageNumbers}
        title={pageNumbers ? 'Remove page numbers' : 'Add page numbers to all slides'}
      >
        <span className={pageNumbers ? 'text-sky-500' : undefined}>#</span>
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
            context={chartContext}
            onPick={(spec, variantId) => insertChart(spec, undefined, variantId)}
            onClose={() => setShowCharts(false)}
          />
        ) : null}
      </div>
      <Divider />
      <button
        onClick={insertSticky}
        title="Add a sticky note (it grows as you type)"
        className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Sticky note
      </button>
      {FLAGS.comments ? (
        <>
          <Divider />
          <button
            onClick={togglePanel}
            title={panelOpen ? 'Hide comments' : 'Show comments'}
            aria-pressed={panelOpen}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              panelOpen
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-zinc-600 dark:text-zinc-300'
            }`}
          >
            Comments
            {openThreads > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-300 px-1 text-[10px] font-semibold text-amber-900">
                {openThreads}
              </span>
            ) : null}
          </button>
        </>
      ) : null}
      <Divider />
      <button
        onClick={() => setShowShortcuts(true)}
        title="Keyboard shortcuts"
        className="flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Shortcuts
      </button>
      {showShortcuts ? <ShortcutsModal onClose={() => setShowShortcuts(false)} /> : null}
      <button
        onClick={copyRefreshPrompt}
        title="Copy a Devin prompt describing every number in this deck, page by page"
        className="ml-1 flex h-8 items-center rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700"
      >
        Refresh Data
      </button>
      {showRefresh ? <RefreshPromptDialog onClose={() => setShowRefresh(false)} /> : null}
    </div>
  );
}
