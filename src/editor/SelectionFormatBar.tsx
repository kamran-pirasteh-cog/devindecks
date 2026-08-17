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
  hex as hexRef,
  isCropped,
  isRoundedPreset,
  isStacked,
  pointsToEmu,
  ROUNDABLE_PRESETS,
  resolveColor,
  token,
  type BulletKind,
  type ColorRef,
  type ColorToken,
  type DashStyle,
  type DesignSystem,
  type FontFamily,
  type Outline,
  type ParaAlign,
  type SlideElement,
  type VerticalAnchor,
} from '@/model';
import { useEditor } from '@/store/editorStore';
import { CustomColorSwatch, customHexOf } from './color';

const DASHES: { value: DashStyle; label: string; pattern: string }[] = [
  { value: 'solid', label: 'Solid', pattern: '' },
  { value: 'dash', label: 'Dashed', pattern: '6 4' },
  { value: 'dot', label: 'Dotted', pattern: '2 3' },
];

/** Border weights, in points. Mirrors PowerPoint's weight menu. */
const WEIGHTS_PT = [0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];

const FONT_SIZES_PT = [8, 10, 11, 12, 14, 18, 20, 24, 26, 28, 32, 40, 48, 54, 60, 72, 96];

/** Fill transparency, as percentages — PowerPoint's own 10% ladder. */
const TRANSPARENCY_PCT = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

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
  /** Takes a ref, not a token id — the palette hands over tokens, custom hands over hex. */
  onPick: (color: ColorRef) => void;
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
                  onPick(token(c.id));
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
            {/* Last, after the brand: leaving the palette is the exception, and
                a picked hex stops following brand changes. */}
            <CustomColorSwatch
              value={customHexOf(value)}
              active={value?.kind === 'hex'}
              onPick={(h) => onPick(hexRef(h))}
              onDone={() => setOpen(false)}
              align="right"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The first run in a box, skipping paragraphs that carry no text. */
function firstRunOf(el: Extract<SlideElement, { type: 'text' | 'shape' }> | undefined) {
  return el?.body?.paragraphs.find((p) => p.runs.length)?.runs[0];
}

/**
 * The body-bearing element whose values the bar displays. One that carries a
 * run wins: a blank opening line or an empty leading table cell has nothing to
 * read, and letting it win showed the theme's defaults instead of the text's
 * own font and size.
 */
function bodyElementOf(selected: SlideElement[]) {
  const bodies = selected.filter(
    (e): e is Extract<SlideElement, { type: 'text' | 'shape' }> =>
      e.type === 'text' || (e.type === 'shape' && !!e.body),
  );
  return bodies.find((e) => firstRunOf(e)) ?? bodies[0];
}

/** Bullet/numbering icons, drawn rather than typed so they scale with the bar. */
/**
 * Rows sit inset from the 14×14 box: the marker's square and the rules' round
 * caps both grow past their nominal coordinates, so rows flush to the edges
 * clip against the button.
 */
const ROWS = [3, 7, 11];

function ListIcon({ numbered }: { numbered: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden fill="none">
      {ROWS.map((y, i) =>
        numbered ? (
          <text
            key={y}
            x={2.2}
            y={y}
            fontSize={5}
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
          >
            {i + 1}
          </text>
        ) : (
          <rect key={y} x={0.8} y={y - 1.4} width={2.8} height={2.8} fill="currentColor" />
        ),
      )}
      {ROWS.map((y) => (
        <line
          key={y}
          x1={6}
          y1={y}
          x2={13.2}
          y2={y}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** Square vs round corner glyphs — one box, drawn with the corner in question. */
function CornerIcon({ rounded }: { rounded: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden fill="none">
      <rect
        x={2}
        y={2}
        width={10}
        height={10}
        rx={rounded ? 3.5 : 0}
        stroke="currentColor"
        strokeWidth={1.6}
      />
    </svg>
  );
}

const PARA_ALIGNS: { value: ParaAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'justify', label: 'Justify' },
];

const ANCHORS: { value: VerticalAnchor; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
];

/**
 * The one value a set of boxes shares, or '' when they disagree — the empty
 * string is what a `<select>` needs to land on its "Mixed" placeholder.
 */
function agreedOn<T extends string>(values: T[]): T | '' {
  return values.length && values.every((v) => v === values[0]) ? values[0] : '';
}

function outlineOf(el: SlideElement | undefined): Outline | undefined {
  if (!el || el.type === 'picture') return undefined;
  return 'outline' in el ? el.outline : undefined;
}

export function SelectionFormatBar({
  onOpenChartData,
}: {
  onOpenChartData?: (chartId: string) => void;
} = {}) {
  const deck = useEditor((s) => s.deck);
  const ds = useEditor((s) => s.designSystem);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const store = useEditor.getState;

  const slide = deck.slides.find((s) => s.id === currentSlideId);
  const selected = slide?.elements.filter((e) => selectedIds.includes(e.id)) ?? [];
  if (!selected.length) return null;

  // A chart part is a shape or a text box, but offering "Font" and "List" for
  // a bar is nonsense — the chart cluster replaces them.
  const chartRefs = selected.map((e) => e.chartRef).filter(Boolean);
  const isChart = chartRefs.length > 0 && chartRefs.length === selected.length;
  const chartId = isChart ? chartRefs[0]!.chartId : null;

  const hasText = !isChart && selected.some((e) => e.type === 'text' || (e.type === 'shape' && e.body));
  const hasFillable = selected.some((e) => e.type === 'text' || e.type === 'shape');
  if (isChart && chartId) {
    return (
      <ChartFormatCluster chartId={chartId} onOpenData={onOpenChartData} />
    );
  }
  // A picture answers to none of the controls below — no fill, no type — so it
  // gets its own cluster rather than an empty bar.
  const pictures = selected.filter((e): e is Extract<SlideElement, { type: 'picture' }> =>
    e.type === 'picture',
  );
  if (pictures.length === selected.length) {
    return <PictureFormatCluster pictures={pictures} />;
  }
  // Shapes and lines only. A plain text box can take an outline, but it's a
  // rare want and the color/weight/dash trio costs the bar a whole second row —
  // the Inspector still has it.
  const hasBorder = selected.some((e) => e.type !== 'picture' && e.type !== 'text');
  if (!hasText && !hasFillable && !hasBorder) return null;

  const fillPrimary = selected.find((e) => e.type === 'text' || e.type === 'shape');
  const fill = fillPrimary?.type === 'text' || fillPrimary?.type === 'shape' ? fillPrimary.fill : undefined;
  // Rounded because the model stores opacity: a value nudged elsewhere still
  // needs to land on an integer percentage to match an <option>.
  const fillTransparencyPct =
    fill?.kind === 'solid' ? Math.round((1 - (fill.alpha ?? 1)) * 100) : 0;
  const borderPrimary = selected.find((e) => e.type !== 'picture');
  const outline = outlineOf(borderPrimary);
  // A line's outline is structural, so its color and weight can be changed but
  // never removed.
  const borderRequired = selected.every((e) => e.type === 'line');

  // Only the rectangular family has corners to round; a mixed selection shows
  // the control and rounds whichever shapes can take it.
  const roundable = selected.filter(
    (e): e is Extract<SlideElement, { type: 'shape' }> =>
      e.type === 'shape' && ROUNDABLE_PRESETS.includes(e.preset),
  );
  const cornersRounded = roundable.length > 0 && roundable.every((e) => isRoundedPreset(e.preset));

  const textEl = bodyElementOf(selected);
  const run = firstRunOf(textEl);
  const paragraphs = textEl?.body?.paragraphs ?? [];
  // A list button reads "on" only when the whole box is that list — the same
  // rule `toggleBullet` uses to decide whether pressing it clears the style.
  const listKind = (kind: BulletKind) =>
    paragraphs.length > 0 && paragraphs.every((p) => p.bullet === kind);

  // Both alignment readouts span the WHOLE selection, unlike the font and size
  // fields above, which show the primary element's value. A select-all over a
  // mix of left-, center- and right-aligned boxes would otherwise read "Right"
  // just because the primary box happened to be right-aligned — the dropdown
  // shows a value only when every box agrees, and "Mixed" when they don't.
  const textBodies = selected.flatMap((e) =>
    (e.type === 'text' || e.type === 'shape') && e.body ? [e.body] : [],
  );
  // Unset reads as its rendered value ('left' / 'top', per `SlideView`), so a
  // fresh box shows Left and Top rather than no alignment at all.
  const allParagraphs = textBodies.flatMap((b) => b.paragraphs);
  const paraAlign = agreedOn(allParagraphs.map((p) => p.align ?? 'left'));
  const anchor = agreedOn(textBodies.map((b) => b.anchor ?? 'top'));

  /** Border edits patch whatever outline exists, falling back to a real one. */
  const patchOutline = (patch: Partial<Outline>) =>
    store().setOutline(selectedIds, { ...(outline ?? OUTLINE_FALLBACK), ...patch });

  return (
    <div
      // See the module comment: the canvas keys off this class.
      //
      // Wrapping, because this is the one cluster-heavy bar: a text-bearing
      // shape shows font, size, list, align, color, fill and border at once,
      // which outgrows a narrow window. It's anchored to the slide's right edge
      // and grows leftward, so without this the leftmost groups slide out under
      // the filmstrip. Rows are right-aligned so it stays flush to that edge.
      className="dd-format-bar pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
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
          {/* Both axes, in one cluster: horizontal alignment is a paragraph
              property, the vertical anchor belongs to the body, but from the
              outside they're the same question — which edge does the text sit
              on. Two dropdowns rather than seven pressed toggles: the bar has
              to fit on one line, and the chords (⌘⌥Ctrl+arrow) are still the
              fast path for anyone reaching often. */}
          <Group label="Align">
            <select
              value={paraAlign}
              onChange={(e) =>
                store().patchParagraphs(selectedIds, { align: e.target.value as ParaAlign })
              }
              aria-label="Text alignment"
              title="Text alignment"
              className={FIELD_CLASS}
            >
              {paraAlign === '' ? <option value="">Mixed</option> : null}
              {PARA_ALIGNS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={anchor}
              onChange={(e) => store().setAnchor(selectedIds, e.target.value as VerticalAnchor)}
              aria-label="Vertical alignment"
              title="Vertical alignment"
              className={FIELD_CLASS}
            >
              {anchor === '' ? <option value="">Mixed</option> : null}
              {ANCHORS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Group>
          <Group label="Text">
            <ColorPicker
              label="Text color"
              value={run?.color ?? token(ds.type.body.colorToken)}
              colors={ds.colors}
              ds={ds}
              onPick={(color) => store().patchRuns(selectedIds, { color })}
            />
          </Group>
        </>
      ) : null}

      {hasText && (hasFillable || hasBorder) ? <Divider /> : null}

      {hasFillable ? (
        <>
          <Group label="Fill">
            <ColorPicker
              label="Fill"
              value={fill?.kind === 'solid' ? fill.color : undefined}
              colors={ds.colors}
              ds={ds}
              // Recoloring keeps whatever transparency is already set — the two
              // are independent controls, so one shouldn't reset the other.
              onPick={(color) =>
                store().setFill(selectedIds, {
                  kind: 'solid',
                  color,
                  alpha: fill?.kind === 'solid' ? fill.alpha : undefined,
                })
              }
              onNone={() => store().setFill(selectedIds, { kind: 'none' })}
            />
          </Group>
          <Group label="Transparency">
            <select
              value={fillTransparencyPct}
              onChange={(e) =>
                store().setFillAlpha(selectedIds, 1 - parseFloat(e.target.value) / 100)
              }
              aria-label="Fill transparency"
              title="Fill transparency"
              // Nothing to make see-through until there's a fill to see through.
              disabled={fill?.kind !== 'solid'}
              className={`${FIELD_CLASS} disabled:opacity-40`}
            >
              {[...new Set([...TRANSPARENCY_PCT, fillTransparencyPct])]
                .sort((a, b) => a - b)
                .map((p) => (
                  <option key={p} value={p}>
                    {p}%
                  </option>
                ))}
            </select>
          </Group>
        </>
      ) : null}

      {roundable.length ? (
        <>
          <Divider />
          <Group label="Corners">
            <div className="flex gap-0.5">
              {([
                { rounded: false, label: 'Square corners' },
                { rounded: true, label: 'Round corners' },
              ]).map(({ rounded, label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => store().setCornersRounded(selectedIds, rounded)}
                  title={label}
                  aria-label={label}
                  aria-pressed={cornersRounded === rounded}
                  className={`flex h-7 w-7 items-center justify-center rounded border ${
                    cornersRounded === rounded
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <CornerIcon rounded={rounded} />
                </button>
              ))}
            </div>
          </Group>
        </>
      ) : null}

      {hasBorder ? (
        <>
          <Group label="Border">
            <ColorPicker
              label="Border color"
              value={outline?.color}
              colors={ds.colors}
              ds={ds}
              onPick={(color) => patchOutline({ color })}
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

/**
 * The bar a picture shows — clicking an image is what puts it on screen, and
 * cropping is what it's mostly for.
 *
 * While a crop is in progress the buttons step aside: the live geometry belongs
 * to `CropOverlay` until it commits, and Done/Cancel sit down there with the
 * handles rather than up here away from the gesture.
 */
function PictureFormatCluster({
  pictures,
}: {
  pictures: Extract<SlideElement, { type: 'picture' }>[];
}) {
  const store = useEditor.getState;
  const croppingId = useEditor((s) => s.croppingId);
  const cropping = pictures.some((p) => p.id === croppingId);
  // Cropping is a gesture on ONE box; several pictures at once can still be
  // reset, which needs no geometry.
  const sole = pictures.length === 1 ? pictures[0] : null;
  const cropped = pictures.filter((p) => isCropped(p.crop));

  return (
    <div
      className="dd-format-bar pointer-events-auto flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      role="toolbar"
      aria-label="Format picture"
      onContextMenu={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        {pictures.length > 1 ? `${pictures.length} images` : 'Image'}
      </span>
      {cropping ? (
        <span className="px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          Drag the handles to trim, or the image to reposition it.
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={() => sole && store().setCropping(sole.id)}
            disabled={!sole}
            title={sole ? 'Crop this image' : 'Select a single image to crop'}
            className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            <CropIcon />
            Crop
          </button>
          {cropped.length ? (
            <button
              type="button"
              onClick={() =>
                cropped.forEach((p) => store().setCrop(p.id, undefined))
              }
              title="Show the whole image again"
              className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Reset crop
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The two overlapping carpenter's rules PowerPoint uses for crop. */
function CropIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 14 14" aria-hidden fill="none">
      <path
        d="M4 0.8V10h9.2M0.8 4H10v9.2"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The bar a chart shows instead of the ordinary one.
 *
 * Chart-WIDE settings only. Anything addressed to one series, point, label or
 * axis belongs to `ChartPartPopover`, which floats next to the part the user
 * drilled into rather than making them look back up here to find out what a
 * click did.
 *
 * Everything here writes to the SPEC through a store action, never to the
 * selected rectangles — a fill set on the element would be erased by the next
 * recompile, so the color would survive right up until someone edited the data.
 */
function ChartFormatCluster({
  chartId,
  onOpenData,
}: {
  chartId: string;
  onOpenData?: (chartId: string) => void;
}) {
  const store = useEditor.getState;
  const chart = useEditor((s) =>
    s.deck.slides.find((sl) => sl.id === s.currentSlideId)?.charts?.find((c) => c.id === chartId),
  );
  if (!chart) return null;

  const spec = chart.spec;
  const labels = spec.decorations.labels;
  const stacked = isStacked(spec);

  return (
    <div
      className="dd-format-bar pointer-events-auto flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      role="toolbar"
      aria-label="Format chart"
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* The primary action. Double-clicking the chart also opens this, but
          only when it isn't already selected — once it is, Moveable's control
          box sits over every part and swallows the click. */}
      <button
        onClick={() => onOpenData?.(chartId)}
        title="Edit this chart's data"
        className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-500"
      >
        Data
      </button>

      <Divider />

      <Group label="Stacking">
        <select
          value={'stack' in spec ? spec.stack : 'clustered'}
          disabled={!('stack' in spec)}
          onChange={(e) =>
            store().patchChart(chartId, (s) => {
              if (!('stack' in s)) return;
              const mode = e.target.value as 'clustered' | 'stacked' | 'stacked100';
              s.stack = mode;
              if ('overlapPct' in s) s.overlapPct = mode === 'clustered' ? -27 : 100;
            })
          }
          aria-label="Stacking"
          className={FIELD_CLASS}
        >
          <option value="clustered">Clustered</option>
          <option value="stacked">Stacked</option>
          <option value="stacked100">100%</option>
        </select>
      </Group>

      <Group label="Labels">
        <div className="flex gap-0.5">
          <ToggleButton
            active={labels.show}
            label="Data labels"
            onClick={() =>
              store().patchChart(chartId, (s) => (s.decorations.labels.show = !s.decorations.labels.show))
            }
          >
            123
          </ToggleButton>
          <ToggleButton
            active={spec.decorations.totals?.show ?? false}
            label="Total labels"
            disabled={!stacked}
            onClick={() =>
              store().patchChart(chartId, (s) => {
                s.decorations.totals = s.decorations.totals?.show
                  ? undefined
                  : { show: true, content: { kind: 'value' }, placement: 'above' };
              })
            }
          >
            ∑
          </ToggleButton>
          <ToggleButton
            active={spec.decorations.gridlines.major?.show ?? false}
            label="Gridlines"
            onClick={() =>
              store().patchChart(chartId, (s) => {
                s.decorations.gridlines.major = { show: !s.decorations.gridlines.major?.show };
              })
            }
          >
            ≡
          </ToggleButton>
          <ToggleButton
            active={spec.legend.show}
            label="Legend"
            onClick={() => store().patchChart(chartId, (s) => (s.legend.show = !s.legend.show))}
          >
            ▤
          </ToggleButton>
        </div>
      </Group>

      <Divider />

      <button
        onClick={() => store().resetChartFormatting(chartId)}
        title="Drop hand-applied colour and type, back to the brand's. Data and layout stay."
        className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        Reset formatting
      </button>
    </div>
  );
}

function ToggleButton({
  active,
  label,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-6 w-6 items-center justify-center rounded text-[11px] disabled:opacity-30 ${
        active
          ? 'bg-indigo-600 text-white'
          : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}
