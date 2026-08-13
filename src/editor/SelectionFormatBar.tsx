'use client';

/**
 * Selection format bar — PowerPoint's mini toolbar, pinned just above the slide
 * and right-aligned with its edge. Only the controls that apply to what's
 * selected are shown: character controls for text, fill/border controls for
 * shapes and lines, both for a shape carrying text.
 *
 * It's a thin trigger surface like the Toolbar: every control calls the same
 * store action the Inspector does, so the two stay in sync for free. The
 * `dd-format-bar` class is load-bearing — the canvas's mousedown resolver and
 * Selecto both check for it so clicking a control neither clears the selection
 * nor starts a marquee.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ALLOWED_FONTS,
  emuToPoints,
  pointsToEmu,
  resolveColor,
  token,
  type BulletKind,
  type ColorRef,
  type ColorToken,
  type DashStyle,
  type DesignSystem,
  type FontFamily,
  type Outline,
  type SlideElement,
} from '@/model';
import { useEditor } from '@/store/editorStore';

const DASHES: { value: DashStyle; label: string; pattern: string }[] = [
  { value: 'solid', label: 'Solid', pattern: '' },
  { value: 'dash', label: 'Dashed', pattern: '6 4' },
  { value: 'dot', label: 'Dotted', pattern: '2 3' },
];

/** Border weights, in points. Mirrors PowerPoint's weight menu. */
const WEIGHTS_PT = [0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];

const FONT_SIZES_PT = [8, 10, 11, 12, 14, 18, 20, 24, 28, 32, 40, 48, 54, 60, 72, 96];

/** The outline a border control edits when the target has none yet. */
const OUTLINE_FALLBACK: Outline = {
  color: token('ink.strong'),
  widthEmu: pointsToEmu(1),
  dash: 'solid',
};

const Divider = () => <div className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />;

const FIELD_CLASS =
  'h-7 rounded border border-zinc-200 bg-white px-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

/** A label + control pair, so each cluster reads without a tooltip. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</span>
      {children}
    </div>
  );
}

/**
 * A swatch that opens the palette. Dismisses on outside click or Escape rather
 * than trapping, same as the line inserter.
 */
function ColorPicker({
  label,
  value,
  colors,
  ds,
  onPick,
  onNone,
}: {
  label: string;
  value: ColorRef | undefined;
  colors: ColorToken[];
  ds: DesignSystem;
  onPick: (id: string) => void;
  /** Omitted when the property can't be cleared (a line must keep its color). */
  onNone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeToken = value?.kind === 'token' ? value.token : undefined;

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className="flex h-7 w-7 items-center justify-center rounded border border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        {value ? (
          <span
            className="h-4 w-4 rounded-sm border border-black/10"
            style={{ background: resolveColor(value, ds) }}
          />
        ) : (
          <span className="text-[11px] text-zinc-400">∅</span>
        )}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-40 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {label}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {onNone ? (
              <button
                type="button"
                onClick={() => {
                  onNone();
                  setOpen(false);
                }}
                title="None"
                aria-label="None"
                className="h-6 w-6 rounded border border-zinc-300 bg-white text-[10px] text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
              >
                ∅
              </button>
            ) : null}
            {colors.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onPick(c.id);
                  setOpen(false);
                }}
                title={c.name}
                aria-label={c.name}
                aria-pressed={activeToken === c.id}
                className={`h-6 w-6 rounded border ${
                  activeToken === c.id
                    ? 'border-zinc-900 ring-2 ring-zinc-900 ring-offset-1 dark:border-white dark:ring-white dark:ring-offset-zinc-900'
                    : 'border-black/10 dark:border-zinc-600'
                }`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The body-bearing element whose values the bar displays. */
function bodyElementOf(selected: SlideElement[]) {
  return selected.find(
    (e): e is Extract<SlideElement, { type: 'text' | 'shape' }> =>
      e.type === 'text' || (e.type === 'shape' && !!e.body),
  );
}

/** Bullet/numbering icons, drawn rather than typed so they scale with the bar. */
function ListIcon({ numbered }: { numbered: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden fill="none">
      {[1.5, 6.5, 11.5].map((y, i) =>
        numbered ? (
          <text key={y} x={0} y={y + 4} fontSize={5} fill="currentColor">
            {i + 1}
          </text>
        ) : (
          <circle key={y} cx={2} cy={y + 2} r={1.4} fill="currentColor" />
        ),
      )}
      {[1.5, 6.5, 11.5].map((y) => (
        <line
          key={y}
          x1={6}
          y1={y + 2}
          x2={14}
          y2={y + 2}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function outlineOf(el: SlideElement | undefined): Outline | undefined {
  if (!el || el.type === 'picture') return undefined;
  return 'outline' in el ? el.outline : undefined;
}

export function SelectionFormatBar() {
  const deck = useEditor((s) => s.deck);
  const ds = useEditor((s) => s.designSystem);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const store = useEditor.getState;

  const slide = deck.slides.find((s) => s.id === currentSlideId);
  const selected = slide?.elements.filter((e) => selectedIds.includes(e.id)) ?? [];
  if (!selected.length) return null;

  const hasText = selected.some((e) => e.type === 'text' || (e.type === 'shape' && e.body));
  const hasFillable = selected.some((e) => e.type === 'text' || e.type === 'shape');
  // Pictures are the one thing with nothing to offer here.
  const hasBorder = selected.some((e) => e.type !== 'picture');
  if (!hasText && !hasFillable && !hasBorder) return null;

  const fillPrimary = selected.find((e) => e.type === 'text' || e.type === 'shape');
  const fill = fillPrimary?.type === 'text' || fillPrimary?.type === 'shape' ? fillPrimary.fill : undefined;
  const borderPrimary = selected.find((e) => e.type !== 'picture');
  const outline = outlineOf(borderPrimary);
  // A line's outline is structural, so its color and weight can be changed but
  // never removed.
  const borderRequired = selected.every((e) => e.type === 'line');

  const textEl = bodyElementOf(selected);
  const run = textEl?.body?.paragraphs[0]?.runs[0];
  const paragraphs = textEl?.body?.paragraphs ?? [];
  // A list button reads "on" only when the whole box is that list — the same
  // rule `toggleBullet` uses to decide whether pressing it clears the style.
  const listKind = (kind: BulletKind) =>
    paragraphs.length > 0 && paragraphs.every((p) => p.bullet === kind);

  /** Border edits patch whatever outline exists, falling back to a real one. */
  const patchOutline = (patch: Partial<Outline>) =>
    store().setOutline(selectedIds, { ...(outline ?? OUTLINE_FALLBACK), ...patch });

  return (
    <div
      // See the module comment: the canvas keys off this class.
      className="dd-format-bar flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      role="toolbar"
      aria-label="Format selection"
      onContextMenu={(e) => e.stopPropagation()}
    >
      {hasText ? (
        <>
          <Group label="Font">
            <select
              value={run?.font ?? ds.fonts.body}
              onChange={(e) => store().patchRuns(selectedIds, { font: e.target.value as FontFamily })}
              aria-label="Font"
              className={FIELD_CLASS}
            >
              {ALLOWED_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Group>
          <Group label="Size">
            <select
              value={run?.sizePt ?? ds.type.body.sizePt}
              onChange={(e) => store().patchRuns(selectedIds, { sizePt: parseFloat(e.target.value) })}
              aria-label="Font size"
              className={FIELD_CLASS}
            >
              {/* The current size may be off-list (nudged by ⌘⇧< or the
                  inspector), so it's spliced in rather than snapped. */}
              {[...new Set([...FONT_SIZES_PT, run?.sizePt ?? ds.type.body.sizePt])]
                .sort((a, b) => a - b)
                .map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </select>
          </Group>
          <Group label="List">
            <div className="flex gap-0.5">
              {([
                { kind: 'bullet' as const, label: 'Bulleted list' },
                { kind: 'number' as const, label: 'Numbered list' },
              ]).map(({ kind, label }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => store().toggleBullet(selectedIds, kind)}
                  title={label}
                  aria-label={label}
                  aria-pressed={listKind(kind)}
                  className={`flex h-7 w-7 items-center justify-center rounded border ${
                    listKind(kind)
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <ListIcon numbered={kind === 'number'} />
                </button>
              ))}
              {([
                { delta: -1, label: 'Decrease indent', glyph: '⇤' },
                { delta: 1, label: 'Increase indent', glyph: '⇥' },
              ]).map(({ delta, label, glyph }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => store().indentParagraphs(selectedIds, delta)}
                  title={label}
                  aria-label={label}
                  className="flex h-7 w-7 items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {glyph}
                </button>
              ))}
            </div>
          </Group>
          <Group label="Text">
            <ColorPicker
              label="Text color"
              value={run?.color ?? token(ds.type.body.colorToken)}
              colors={ds.colors}
              ds={ds}
              onPick={(id) => store().patchRuns(selectedIds, { color: token(id) })}
            />
          </Group>
        </>
      ) : null}

      {hasText && (hasFillable || hasBorder) ? <Divider /> : null}

      {hasFillable ? (
        <Group label="Fill">
          <ColorPicker
            label="Fill"
            value={fill?.kind === 'solid' ? fill.color : undefined}
            colors={ds.colors}
            ds={ds}
            onPick={(id) => store().setFill(selectedIds, { kind: 'solid', color: token(id) })}
            onNone={() => store().setFill(selectedIds, { kind: 'none' })}
          />
        </Group>
      ) : null}

      {hasBorder ? (
        <>
          <Group label="Border">
            <ColorPicker
              label="Border color"
              value={outline?.color}
              colors={ds.colors}
              ds={ds}
              onPick={(id) => patchOutline({ color: token(id) })}
              onNone={borderRequired ? undefined : () => store().setOutline(selectedIds, undefined)}
            />
          </Group>
          <select
            value={outline ? emuToPoints(outline.widthEmu) : 1}
            onChange={(e) => patchOutline({ widthEmu: pointsToEmu(parseFloat(e.target.value)) })}
            aria-label="Border thickness"
            title="Border thickness"
            className={FIELD_CLASS}
          >
            {[...new Set([...WEIGHTS_PT, outline ? emuToPoints(outline.widthEmu) : 1])]
              .sort((a, b) => a - b)
              .map((w) => (
                <option key={w} value={w}>
                  {w} pt
                </option>
              ))}
          </select>
          <div className="flex gap-0.5">
            {DASHES.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => patchOutline({ dash: d.value })}
                title={d.label}
                aria-label={`Border ${d.label.toLowerCase()}`}
                aria-pressed={outline?.dash === d.value}
                className={`flex h-7 w-8 items-center justify-center rounded border ${
                  outline?.dash === d.value
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                <svg width={20} height={8} aria-hidden>
                  <line
                    x1={1}
                    y1={4}
                    x2={19}
                    y2={4}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeDasharray={d.pattern || undefined}
                  />
                </svg>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
