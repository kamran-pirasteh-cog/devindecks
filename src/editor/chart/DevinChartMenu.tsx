'use client';

/**
 * The Devin split-button in the datasheet's header.
 *
 * "Copy research prompt" generates from the LIVE spec on every click, so a
 * prompt can never describe a chart that's since changed. The copy always
 * offers to show the text too: people want to read a brief before sending it,
 * and `navigator.clipboard` simply doesn't exist on a non-secure origin, so a
 * silent failure would be a dead end.
 */
import { useMemo, useState } from 'react';
import { cellText, specFromSheet, type ChartInstance, type SheetModel } from '@/model';
import { useEditor } from '@/store/editorStore';
import { buildDevinChartPrompt } from '@/devin/prompt';
import { parseDevinChartResult, type DevinResult } from '@/devin/parseResult';
import { sheetFromSpec } from '@/model';
import { MODAL_Z } from '../layers';

export function DevinChartMenu({
  chart,
  onApplied,
}: {
  chart: ChartInstance;
  onApplied?: () => void;
}) {
  const deck = useEditor((s) => s.deck);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const updateChartSpec = useEditor((s) => s.updateChartSpec);

  const [showPrompt, setShowPrompt] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
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
        <button
          onClick={() => setShowPaste(true)}
          title="Paste Devin's result back into this chart"
          className="border-l border-zinc-300 px-2 py-0.5 text-[11px] hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700"
        >
          Paste result
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

      {showPaste ? (
        <PasteDevinResultDialog
          chart={chart}
          onClose={() => setShowPaste(false)}
          onApply={(sheet) => {
            const { spec } = specFromSheet(sheet, chart.spec);
            updateChartSpec(chart.id, spec);
            setShowPaste(false);
            onApplied?.();
          }}
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

function PasteDevinResultDialog({
  chart,
  onClose,
  onApply,
}: {
  chart: ChartInstance;
  onClose: () => void;
  onApply: (sheet: SheetModel) => void;
}) {
  const [text, setText] = useState('');
  const result: DevinResult | null = useMemo(
    () => (text.trim() ? parseDevinChartResult(text, chart.spec) : null),
    [text, chart.spec],
  );

  const current = useMemo(() => sheetFromSpec(chart.spec), [chart.spec]);
  const errors = result?.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const warnings = result?.diagnostics.filter((d) => d.severity === 'warning') ?? [];

  return (
    <Dialog
      title="Paste Devin's result"
      wide
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            disabled={!result?.sheet}
            onClick={() => result?.sheet && onApply(result.sheet)}
            className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-zinc-800 dark:bg-white dark:text-black"
          >
            Apply to chart
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-0">
        <div className="border-r border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Paste JSON or CSV
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the JSON block Devin returned…"
            className="h-[45vh] w-full resize-none rounded border border-zinc-200 bg-transparent p-2 font-mono text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700"
          />
        </div>

        <div className="flex flex-col p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            What would change
          </div>
          {!result ? (
            <p className="text-xs text-zinc-400">Nothing pasted yet.</p>
          ) : !result.sheet ? (
            <p className="text-xs text-red-600">{errors[0]?.message ?? "Couldn't read that."}</p>
          ) : (
            <DiffPreview before={current} after={result.sheet} />
          )}

          {result && (errors.length || warnings.length) ? (
            <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-[11px]">
              {[...errors, ...warnings].slice(0, 12).map((d, i) => (
                <li key={i} className={d.severity === 'error' ? 'text-red-600' : 'text-amber-600'}>
                  {d.message}
                </li>
              ))}
            </ul>
          ) : null}

          {result?.notes ? (
            <p className="mt-2 rounded bg-zinc-50 p-2 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {result.notes}
            </p>
          ) : null}
          {result?.unresolved.length ? (
            <p className="mt-2 text-[11px] text-amber-600">
              Unresolved: {result.unresolved.join('; ')}
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * A cell-level before/after. This is what makes pasting an agent's output into
 * a client deck feel safe rather than reckless — you see every figure that
 * moves before it moves.
 */
function DiffPreview({ before, after }: { before: SheetModel; after: SheetModel }) {
  const rows = Math.max(before.rows.length, after.rows.length);
  const changes: { label: string; column: string; from: string; to: string }[] = [];

  for (let r = 0; r < rows; r++) {
    const label = cellText(after.rows[r]?.[0] ?? before.rows[r]?.[0]) || `Row ${r + 1}`;
    for (let c = 0; c < after.columns.length; c++) {
      const from = cellText(before.rows[r]?.[c]);
      const to = cellText(after.rows[r]?.[c]);
      if (from !== to) {
        changes.push({ label, column: after.columns[c].header, from, to });
      }
    }
  }

  if (!changes.length) {
    return <p className="text-xs text-zinc-400">No values would change.</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mb-1 text-[11px] text-zinc-500">
        {changes.length} value{changes.length === 1 ? '' : 's'} would change
        {after.rows.length !== before.rows.length
          ? `, and the chart would go from ${before.rows.length} to ${after.rows.length} rows`
          : ''}
        .
      </div>
      <table className="w-full text-[11px]">
        <tbody>
          {changes.slice(0, 60).map((c, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <td className="py-0.5 pr-2 text-zinc-500">{c.label}</td>
              <td className="py-0.5 pr-2 text-zinc-400">{c.column}</td>
              <td className="py-0.5 pr-1 text-right text-red-500 line-through">{c.from || '—'}</td>
              <td className="py-0.5 text-right text-emerald-600">{c.to || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
