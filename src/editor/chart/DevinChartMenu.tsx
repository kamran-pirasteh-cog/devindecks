'use client';

/**
 * The Devin split-button in the datasheet's header.
 *
 * "Devin prompt" generates from the LIVE spec on every click, so a prompt can
 * never describe a chart that's since changed. The copy always offers to show
 * the text too: people want to read a brief before sending it, and
 * `navigator.clipboard` simply doesn't exist on a non-secure origin, so a
 * silent failure would be a dead end.
 *
 * Devin's answer comes back through the chat agent, not through a paste box of
 * its own — one way in for agent-written data is the whole point of having the
 * diff live there.
 */
import { useMemo, useState } from 'react';
import { type ChartInstance } from '@/model';
import { useEditor } from '@/store/editorStore';
import { buildDevinChartPrompt } from '@/devin/prompt';
import { researchHintsFor } from '@/charts/research';
import { MODAL_Z } from '../layers';

export function DevinChartMenu({ chart }: { chart: ChartInstance }) {
  const deck = useEditor((s) => s.deck);
  const currentSlideId = useEditor((s) => s.currentSlideId);

  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const prompt = useMemo(() => {
    const slide = deck.slides.find((s) => s.id === currentSlideId);
    // The slide's title text is the most specific subject hint available
    // without asking the author to type one.
    const slideTitle = slide?.elements.find(
      (e) => e.type === 'text' && (e.role === 'title' || e.role === 'heading'),
    );
    const titleText =
      slideTitle?.type === 'text'
        ? slideTitle.body.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(' ')
        : undefined;

    return buildDevinChartPrompt(chart.spec, {
      deckTitle: deck.title,
      deckTags: deck.tags,
      slideTitle: titleText,
      chartId: chart.id,
      research: researchHintsFor(chart.spec),
    });
  }, [chart.spec, chart.id, deck, currentSlideId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // No clipboard (or permission refused) — show the text so it can still
      // be selected and copied by hand.
      setShowPrompt(true);
    }
  };

  return (
    <>
      <div className="flex items-center overflow-hidden rounded border border-zinc-300 dark:border-zinc-600">
        <button
          onClick={copy}
          title="Generate a research prompt from this chart and copy it"
          className="px-2 py-0.5 text-[11px] font-medium hover:bg-zinc-100 dark:hover:bg-zinc-700"
        >
          {copied ? 'Copied' : 'Devin prompt'}
        </button>
        <button
          onClick={() => setShowPrompt(true)}
          title="Show the prompt"
          className="border-l border-zinc-300 px-1 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700"
        >
          ⋯
        </button>
      </div>

      {showPrompt ? (
        <PromptPreviewDialog
          text={prompt.text}
          onCopy={copy}
          copied={copied}
          onClose={() => setShowPrompt(false)}
        />
      ) : null}
    </>
  );
}

function Dialog({
  title,
  children,
  footer,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      style={{ zIndex: MODAL_Z }}
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900 ${
          wide ? 'max-w-4xl' : 'max-w-2xl'
        }`}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          {footer}
        </div>
      </div>
    </div>
  );
}

function PromptPreviewDialog({
  text,
  onCopy,
  copied,
  onClose,
}: {
  text: string;
  onCopy: () => void;
  copied: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Research prompt for this chart"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
          <button
            onClick={onCopy}
            className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </>
      }
    >
      <textarea
        readOnly
        value={text}
        // Auto-selected so the fallback path is one ⌘C away when the clipboard
        // API isn't available at all.
        ref={(el) => el?.select()}
        className="h-[55vh] w-full resize-none bg-transparent p-4 font-mono text-[11px] leading-relaxed outline-none"
      />
    </Dialog>
  );
}
