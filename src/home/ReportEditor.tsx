'use client';

/**
 * The report sheet — three stages, in the order the decision actually gets
 * made: what goes out, when it goes out, and who receives it in what shape.
 *
 * It opens on the same modal frame as `NewDocModal` so creating a report feels
 * like creating a deck. The stepper across the top doubles as the workflow
 * summary: each stage shows what it has been set to, so the last stage still
 * tells you the deck and the cadence you picked two screens ago.
 *
 * Stages are navigable in both directions and out of order once they're valid —
 * the sheet is also the edit surface for an existing report, where jumping
 * straight to "recipients" is the common case.
 *
 * Nothing here transmits: "Send test" writes a run (see `reports/runs.ts`),
 * which is where a real integration will hang.
 */
import { useEffect, useState } from 'react';
import type { Deck } from '@/model';
import {
  CHANNELS,
  DAY_NAMES,
  FORMATS,
  FREQUENCIES,
  STATUSES,
  describeSchedule,
  nextRunAt,
  type Channel,
  type Format,
  type Report,
} from '@/reports/types';
import { newRecipient } from '@/reports/repository';
import { createRun } from '@/reports/runs';
import { DEFAULT_OWNER } from '@/docs/repository';
import { Thumb } from './Thumb';
import { ChannelIcon } from './ChannelBadge';

// Width is deliberately NOT in here: Tailwind resolves `w-full w-auto` by
// stylesheet order, not by which one you wrote last, so every call site states
// its own width instead.
const field =
  'rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900';

const STEPS = ['Deck', 'Automation', 'Delivery'] as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{label}</span>
        {hint ? <span className="text-[11px] text-zinc-400">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** A checkbox with a caption under it — the automation options are all this shape. */
function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer gap-2 rounded-md border border-zinc-200 px-3 py-2.5 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-500"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">{hint}</span>
      </span>
    </label>
  );
}

/** One stage in the header strip: number, name, and what it's currently set to. */
function Step({
  index,
  label,
  value,
  state,
  onSelect,
}: {
  index: number;
  label: string;
  value: string;
  state: 'done' | 'current' | 'todo';
  onSelect?: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={!onSelect}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left ${
        onSelect ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'cursor-default'
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
          state === 'current'
            ? 'bg-indigo-500 text-white'
            : state === 'done'
              ? 'bg-emerald-500 text-white'
              : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400'
        }`}
      >
        {state === 'done' ? '✓' : index + 1}
      </span>
      <span className="min-w-0">
        <span
          className={`block truncate text-[11px] ${
            state === 'current'
              ? 'font-semibold text-zinc-800 dark:text-zinc-100'
              : 'font-medium text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {label}
        </span>
        <span className="block truncate text-[10px] text-zinc-400">{value}</span>
      </span>
    </button>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 shrink-0 text-zinc-300 dark:text-zinc-600">
      <path
        d="M3 8h9m-3.2-3.2L12 8l-3.2 3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReportEditor({
  report: initial,
  decks,
  onSave,
  onClose,
  /** A run was raised from in here, so the tab behind can refresh its queue. */
  onRunsChange,
}: {
  report: Report;
  decks: Deck[];
  onSave: (report: Report) => void;
  onClose: () => void;
  onRunsChange?: () => void;
}) {
  const [report, setReport] = useState<Report>(initial);
  // An existing report opens on the last stage: editing one is almost always
  // about who gets it, not about which deck it is.
  const [step, setStep] = useState(initial.name ? 2 : 0);
  const [testedAt, setTestedAt] = useState<string | null>(null);
  const patch = (p: Partial<Report>) => setReport((r) => ({ ...r, ...p }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const deck = decks.find((d) => d.id === report.deckId);
  const filled = report.recipients.filter((r) => r.name.trim() || r.address.trim());
  const next = nextRunAt({ ...report, status: 'active' });
  const format = FORMATS.find((f) => f.value === report.format)!;

  // Stage 1 is the gate: everything downstream describes a delivery of a deck,
  // so nothing else can be finished until there is one.
  const deckDone = Boolean(report.name.trim() && report.deckId);
  const deliveryDone = filled.length > 0 && (!report.requiresApproval || Boolean(report.approver));
  const canSave = deckDone;

  const setRecipient = (
    id: string,
    p: Partial<{ name: string; address: string; channel: Channel }>,
  ) =>
    patch({ recipients: report.recipients.map((r) => (r.id === id ? { ...r, ...p } : r)) });

  const sendTest = () => {
    createRun(report, 'test', DEFAULT_OWNER);
    setTestedAt(new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    onRunsChange?.();
  };

  const stepState = (i: number): 'done' | 'current' | 'todo' => {
    if (i === step) return 'current';
    if (i === 0) return deckDone ? 'done' : 'todo';
    if (i === 1) return deckDone ? 'done' : 'todo';
    return deliveryDone ? 'done' : 'todo';
  };

  const stepValue = [
    deck?.title ?? 'Pick a deck',
    describeSchedule(report),
    filled.length
      ? `${filled.length} recipient${filled.length === 1 ? '' : 's'} · ${format.label}`
      : 'Nobody yet',
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">{initial.name ? 'Edit report' : 'New report'}</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
          {STEPS.map((label, i) => (
            <div key={label} className="flex min-w-0 flex-1 items-center gap-1">
              <Step
                index={i}
                label={label}
                value={stepValue[i]}
                state={stepState(i)}
                // Stage 1 must be complete before the later two mean anything.
                onSelect={i === 0 || deckDone ? () => setStep(i) : undefined}
              />
              {i < STEPS.length - 1 ? <Arrow /> : null}
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 0 ? (
            <>
              <Field label="Name">
                <input
                  autoFocus
                  value={report.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="e.g. Acme QBR — weekly send"
                  className={`${field} w-full`}
                />
              </Field>
              <Field label="Deck" hint="what gets sent — always its latest version">
                {decks.length ? (
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
                    {decks.map((d) => {
                      const on = d.id === report.deckId;
                      return (
                        <button
                          key={d.id}
                          onClick={() => patch({ deckId: d.id })}
                          className={`overflow-hidden rounded-lg border text-left transition ${
                            on
                              ? 'border-indigo-400 ring-2 ring-indigo-200 dark:border-indigo-500 dark:ring-indigo-500/30'
                              : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
                          }`}
                        >
                          <div className="border-b border-zinc-100 dark:border-zinc-800 [&>div]:!w-full">
                            <Thumb deck={d} width={200} />
                          </div>
                          <div className="px-2 py-1.5">
                            <div className="truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                              {d.title}
                            </div>
                            <div className="text-[10px] text-zinc-400">{d.slides.length} slides</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">
                    No decks yet — create one on the Documents tab first.
                  </p>
                )}
              </Field>
            </>
          ) : step === 1 ? (
            <>
              <Field label="Frequency" hint="when it goes out">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Frequency"
                    value={report.frequency}
                    onChange={(e) => patch({ frequency: e.target.value as Report['frequency'] })}
                    className={`${field} w-auto`}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>

                  {report.frequency === 'weekly' || report.frequency === 'biweekly' ? (
                    <select
                      aria-label="Day of week"
                      value={report.dayOfWeek}
                      onChange={(e) => patch({ dayOfWeek: Number(e.target.value) })}
                      className={`${field} w-auto`}
                    >
                      {DAY_NAMES.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {report.frequency === 'monthly' || report.frequency === 'quarterly' ? (
                    <select
                      aria-label="Day of month"
                      value={report.dayOfMonth}
                      onChange={(e) => patch({ dayOfMonth: Number(e.target.value) })}
                      className={`${field} w-auto`}
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          Day {d}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  <input
                    aria-label="Time of day"
                    type="time"
                    value={report.timeOfDay}
                    onChange={(e) => patch({ timeOfDay: e.target.value })}
                    className={`${field} w-auto`}
                  />
                </div>
                <p className="mt-2 text-[11px] text-zinc-400">
                  {describeSchedule(report)}
                  {next
                    ? ` · first send ${next.toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}`
                    : ''}
                </p>
              </Field>

              <Field label="Schedule state">
                <div className="flex flex-wrap gap-2">
                  {STATUSES.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => patch({ status: s.value })}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                        report.status === s.value
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300'
                          : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  {report.status === 'active'
                    ? 'Runs on the schedule above.'
                    : report.status === 'paused'
                      ? 'Keeps its settings, raises no runs.'
                      : 'Not scheduled yet — still being put together.'}
                </p>
              </Field>

              <Field label="Automations" hint="what happens around each run">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Toggle
                    checked={Boolean(report.skipIfUnchanged)}
                    onChange={(v) => patch({ skipIfUnchanged: v })}
                    label="Skip if the deck hasn't changed"
                    hint="No edits since the last send means no send — keeps a quiet week quiet."
                  />
                  <Toggle
                    checked={Boolean(report.includeComments)}
                    onChange={(v) => patch({ includeComments: v })}
                    label="Include open comments"
                    hint="Attaches the deck's unresolved threads so recipients see what's still in flight."
                  />
                </div>
              </Field>
            </>
          ) : (
            <>
              <Field label="Recipients" hint="who gets it, and where">
                <div className="space-y-2">
                  {report.recipients.map((r) => {
                    const channel = CHANNELS.find((c) => c.value === r.channel)!;
                    return (
                      <div key={r.id} className="flex items-center gap-2">
                        <input
                          aria-label="Recipient name"
                          value={r.name}
                          onChange={(e) => setRecipient(r.id, { name: e.target.value })}
                          placeholder="Person or group"
                          className={`${field} flex-1`}
                        />
                        <div className="relative shrink-0">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
                            <ChannelIcon channel={r.channel} />
                          </span>
                          <select
                            aria-label="Channel"
                            value={r.channel}
                            onChange={(e) =>
                              setRecipient(r.id, { channel: e.target.value as Channel })
                            }
                            className={`${field} w-auto pl-7`}
                          >
                            {CHANNELS.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <input
                          aria-label="Address"
                          value={r.address}
                          onChange={(e) => setRecipient(r.id, { address: e.target.value })}
                          placeholder={channel.hint}
                          className={`${field} flex-1`}
                        />
                        <button
                          onClick={() =>
                            patch({ recipients: report.recipients.filter((x) => x.id !== r.id) })
                          }
                          title="Remove recipient"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() =>
                    patch({
                      recipients: [
                        ...report.recipients,
                        // New rows inherit the last row's channel: most lists are
                        // all one channel, and re-picking Email five times is
                        // friction.
                        newRecipient(report.recipients.at(-1)?.channel ?? 'email'),
                      ],
                    })
                  }
                  className="mt-2 rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  + Add recipient
                </button>
              </Field>

              <Field label="Format" hint="what the deck arrives as">
                <div className="grid gap-2 sm:grid-cols-3">
                  {FORMATS.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => patch({ format: f.value as Format })}
                      className={`rounded-md border px-3 py-2 text-left ${
                        report.format === f.value
                          ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10'
                          : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
                      }`}
                    >
                      <span
                        className={`block text-xs font-medium ${
                          report.format === f.value
                            ? 'text-indigo-700 dark:text-indigo-300'
                            : 'text-zinc-700 dark:text-zinc-200'
                        }`}
                      >
                        {f.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-zinc-400">{f.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Approval" hint="optional sign-off before each send">
                <Toggle
                  checked={report.requiresApproval}
                  onChange={(v) => patch({ requiresApproval: v })}
                  label="Hold each run for approval"
                  hint="Runs wait in Pending approval until someone releases them."
                />
                {report.requiresApproval ? (
                  <input
                    value={report.approver ?? ''}
                    onChange={(e) => patch({ approver: e.target.value })}
                    placeholder="Who approves?"
                    className={`${field} mt-2 w-full`}
                  />
                ) : null}
                <textarea
                  value={report.note ?? ''}
                  onChange={(e) => patch({ note: e.target.value })}
                  placeholder="Note for recipients (optional)"
                  rows={2}
                  className={`${field} mt-2 w-full resize-none`}
                />
              </Field>

              {/* Test run: the last thing you do before trusting a schedule. It
                  goes to you, never to the recipient list, and skips approval —
                  a test that needed approving would defeat the point. */}
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                      Test run
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">
                      {testedAt
                        ? `Test sent to you at ${testedAt} as ${format.label}. Recipients weren't touched.`
                        : `Sends this deck to you only, as ${format.label}. Recipients aren't touched.`}
                    </div>
                  </div>
                  <button
                    onClick={sendTest}
                    disabled={!report.deckId}
                    className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    {testedAt ? 'Send another test' : 'Send test run'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div className="text-[11px] text-zinc-400">
            Step {step + 1} of {STEPS.length}
          </div>
          <div className="flex items-center gap-2">
            {/* Left of the primary pair, not right of it: appearing between
                stages must not shift Back/Next out from under the pointer. */}
            {step < STEPS.length - 1 && deckDone ? (
              <button
                onClick={() => onSave(report)}
                className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                Save and finish later
              </button>
            ) : null}
            {step > 0 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Back
              </button>
            ) : (
              <button
                onClick={onClose}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!deckDone}
                title={deckDone ? undefined : 'A report needs a name and a deck'}
                className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                Next
              </button>
            ) : (
              <button
                onClick={() => onSave(report)}
                disabled={!canSave}
                className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                Save report
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
