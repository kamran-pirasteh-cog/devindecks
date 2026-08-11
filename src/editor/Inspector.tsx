'use client';

/**
 * Inspector — the constrained style surface. Every control here only exposes
 * choices from the safe vocabulary (token colors, the three allowed fonts, real
 * outline widths), so the inspector itself is a guardrail: you can't dial in
 * something that breaks on export.
 */
import {
  ALLOWED_FONTS,
  emuToInches,
  emuToPoints,
  inchesToEmu,
  pointsToEmu,
  token,
  type ColorToken,
  type FontFamily,
  type Rect,
  type SlideElement,
} from '@/model';
import { useEditor } from '@/store/editorStore';

function NumField({
  label,
  value,
  onCommit,
  step = 0.1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
      <span className="w-3.5">{label}</span>
      <input
        type="number"
        defaultValue={value.toFixed(2)}
        step={step}
        key={value}
        onBlur={(e) => onCommit(parseFloat(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-zinc-100 px-3 py-3 dark:border-zinc-800">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function Swatches({
  colors,
  onPick,
  allowNone,
  onNone,
}: {
  colors: ColorToken[];
  onPick: (id: string) => void;
  allowNone?: boolean;
  onNone?: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {allowNone ? (
        <button
          onClick={onNone}
          title="None"
          className="h-6 w-6 rounded border border-zinc-300 bg-white text-[10px] text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
        >
          ∅
        </button>
      ) : null}
      {colors.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(c.id)}
          title={c.name}
          className="h-6 w-6 rounded border border-black/10 ring-offset-1 hover:ring-2 hover:ring-indigo-400"
          style={{ background: c.hex }}
        />
      ))}
    </div>
  );
}

export function Inspector() {
  const deck = useEditor((s) => s.deck);
  const ds = useEditor((s) => s.designSystem);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const store = useEditor.getState;

  const slide = deck.slides.find((s) => s.id === currentSlideId);
  const selected = (slide?.elements.filter((e) => selectedIds.includes(e.id)) ??
    []) as SlideElement[];

  if (selected.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-xs text-zinc-400">
        <div>Nothing selected</div>
        <div className="text-[11px]">Click an element, or drag to marquee-select.</div>
      </div>
    );
  }

  const primary = selected[0];
  const single = selected.length === 1;
  const hasText = selected.some((e) => e.type === 'text' || (e.type === 'shape' && e.body));
  const hasFillable = selected.some((e) => e.type === 'text' || e.type === 'shape');
  const firstRun =
    primary.type === 'text' || (primary.type === 'shape' && primary.body)
      ? primary.body?.paragraphs[0]?.runs[0]
      : undefined;

  const setRect = (patch: Partial<Rect>) => {
    if (!single) return;
    store().setRect(primary.id, { ...primary.rect, ...patch });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-zinc-100 px-3 py-2.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
        {single ? primary.type : `${selected.length} elements`}
        {primary.role ? (
          <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800">
            {primary.role}
          </span>
        ) : null}
      </div>

      {single ? (
        <Section title="Position & size (in)">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="X" value={emuToInches(primary.rect.x)} onCommit={(v) => setRect({ x: inchesToEmu(v) })} />
            <NumField label="Y" value={emuToInches(primary.rect.y)} onCommit={(v) => setRect({ y: inchesToEmu(v) })} />
            <NumField label="W" value={emuToInches(primary.rect.w)} onCommit={(v) => setRect({ w: inchesToEmu(v) })} />
            <NumField label="H" value={emuToInches(primary.rect.h)} onCommit={(v) => setRect({ h: inchesToEmu(v) })} />
          </div>
        </Section>
      ) : null}

      {hasFillable ? (
        <Section title="Fill">
          <Swatches
            colors={ds.colors}
            onPick={(id) => store().setFill(selectedIds, { kind: 'solid', color: token(id) })}
            allowNone
            onNone={() => store().setFill(selectedIds, { kind: 'none' })}
          />
        </Section>
      ) : null}

      <Section title="Outline">
        <Swatches
          colors={ds.colors}
          onPick={(id) =>
            store().setOutline(selectedIds, {
              color: token(id),
              widthEmu: inchesToEmu(0.02),
              dash: 'solid',
            })
          }
          allowNone
          onNone={() => store().setOutline(selectedIds, undefined)}
        />
        <div className="mt-2">
          <NumField
            label="pt"
            value={
              primary.type !== 'picture' && 'outline' in primary && primary.outline
                ? emuToPoints(primary.outline.widthEmu)
                : 1
            }
            step={0.25}
            onCommit={(v) => {
              const cur =
                primary.type !== 'picture' && 'outline' in primary && primary.outline
                  ? primary.outline
                  : { color: token('ink.strong'), dash: 'solid' as const };
              store().setOutline(selectedIds, { ...cur, widthEmu: pointsToEmu(v) });
            }}
          />
        </div>
      </Section>

      {hasText ? (
        <Section title="Text">
          <div className="flex flex-col gap-2">
            <select
              value={firstRun?.font ?? ds.fonts.body}
              onChange={(e) => store().patchRuns(selectedIds, { font: e.target.value as FontFamily })}
              className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              {ALLOWED_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <input
                type="number"
                defaultValue={firstRun?.sizePt ?? ds.type.body.sizePt}
                key={firstRun?.sizePt}
                onBlur={(e) => store().patchRuns(selectedIds, { sizePt: parseFloat(e.target.value) })}
                className="w-16 rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
              <div className="flex gap-0.5">
                {(['bold', 'italic', 'underline'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => store().patchRuns(selectedIds, { [k]: !firstRun?.[k] })}
                    className={`h-7 w-7 rounded text-xs ${
                      firstRun?.[k]
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    {k === 'bold' ? 'B' : k === 'italic' ? 'I' : 'U'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-0.5">
              {(['left', 'center', 'right', 'justify'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => store().patchParagraphs(selectedIds, { align: a })}
                  className="h-7 flex-1 rounded bg-zinc-100 text-[11px] text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {a[0].toUpperCase()}
                </button>
              ))}
            </div>

            <div>
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Text color</div>
              <Swatches colors={ds.colors} onPick={(id) => store().patchRuns(selectedIds, { color: token(id) })} />
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
