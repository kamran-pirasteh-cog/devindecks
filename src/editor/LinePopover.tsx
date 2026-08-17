'use client';

/**
 * Line inserter — orientation, dash, weight and color chosen up front, then a
 * single click drops the line on the slide. Colors come from the live design
 * system, so a line is on-brand unless it's deliberately taken off it through
 * the custom swatch at the end of the row.
 */
import { useEffect, useRef, useState } from 'react';
import { hex as hexRef, resolveColor, token, type DashStyle } from '@/model';
import { useEditor } from '@/store/editorStore';
import { CustomColorSwatch, customHexOf } from './color';
import { DEFAULT_LINE_OPTIONS, makeLine, type LineOptions } from './factories';
import { OVERLAY_Z } from './layers';

const ORIENTATIONS: { value: LineOptions['orientation']; label: string }[] = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
];

const DASHES: { value: DashStyle; label: string; pattern: string }[] = [
  { value: 'solid', label: 'Solid', pattern: '' },
  { value: 'dash', label: 'Dashed', pattern: '6 4' },
  { value: 'dot', label: 'Dotted', pattern: '2 3' },
];

const WEIGHTS: { value: number; label: string }[] = [
  { value: 0.5, label: '½ pt' },
  { value: 1, label: '1 pt' },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs ${
        active
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
          : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

export function LinePopover({
  onClose,
  anchorRef,
}: {
  onClose: () => void;
  /** The trigger's wrapper — clicks inside it must not count as "outside", or
   *  the close-then-toggle race would leave the popover stuck open. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const ds = useEditor((s) => s.designSystem);
  const addElement = useEditor((s) => s.addElement);
  const [opts, setOpts] = useState<LineOptions>(DEFAULT_LINE_OPTIONS);
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click or Escape — a popover that traps you is worse
  // than a dialog.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  const insert = () => {
    addElement(makeLine(opts));
    onClose();
  };

  const previewColor = resolveColor(opts.color, ds);
  const previewDash = DASHES.find((d) => d.value === opts.dash)?.pattern;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Insert line"
      style={{ zIndex: OVERLAY_Z }}
      className="absolute top-full left-0 mt-1.5 w-64 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-3">
        <Row label="Direction">
          {ORIENTATIONS.map((o) => (
            <Choice
              key={o.value}
              active={opts.orientation === o.value}
              onClick={() => setOpts((s) => ({ ...s, orientation: o.value }))}
            >
              {o.label}
            </Choice>
          ))}
        </Row>

        <Row label="Style">
          {DASHES.map((d) => (
            <Choice
              key={d.value}
              active={opts.dash === d.value}
              onClick={() => setOpts((s) => ({ ...s, dash: d.value }))}
              title={d.label}
            >
              <svg width={30} height={8} aria-hidden>
                <line
                  x1={1}
                  y1={4}
                  x2={29}
                  y2={4}
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray={d.pattern || undefined}
                />
              </svg>
            </Choice>
          ))}
        </Row>

        <Row label="Weight">
          {WEIGHTS.map((w) => (
            <Choice
              key={w.value}
              active={opts.weightPt === w.value}
              onClick={() => setOpts((s) => ({ ...s, weightPt: w.value }))}
            >
              {w.label}
            </Choice>
          ))}
        </Row>

        <Row label="Color">
          {ds.colors.map((c) => {
            const active = opts.color.kind === 'token' && opts.color.token === c.id;
            return (
              <button
                key={c.id}
                type="button"
                title={c.name}
                aria-label={c.name}
                aria-pressed={active}
                onClick={() => setOpts((s) => ({ ...s, color: token(c.id) }))}
                className={`h-6 w-6 rounded-full border ${
                  active
                    ? 'border-zinc-900 ring-2 ring-zinc-900 ring-offset-1 dark:border-white dark:ring-white dark:ring-offset-zinc-900'
                    : 'border-zinc-300 dark:border-zinc-600'
                }`}
                style={{ background: c.hex }}
              />
            );
          })}
          <CustomColorSwatch
            value={customHexOf(opts.color)}
            active={opts.color.kind === 'hex'}
            onPick={(h) => setOpts((s) => ({ ...s, color: hexRef(h) }))}
            shape="rounded-full"
          />
        </Row>

        <div className="flex h-8 items-center justify-center rounded-md bg-zinc-50 dark:bg-zinc-800">
          <svg width={opts.orientation === 'horizontal' ? 180 : 8} height={opts.orientation === 'horizontal' ? 8 : 24} aria-hidden>
            {opts.orientation === 'horizontal' ? (
              <line x1={1} y1={4} x2={179} y2={4} stroke={previewColor} strokeWidth={opts.weightPt * 2} strokeDasharray={previewDash || undefined} />
            ) : (
              <line x1={4} y1={1} x2={4} y2={23} stroke={previewColor} strokeWidth={opts.weightPt * 2} strokeDasharray={previewDash || undefined} />
            )}
          </svg>
        </div>

        <button
          type="button"
          onClick={insert}
          className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Insert line
        </button>
      </div>
    </div>
  );
}
