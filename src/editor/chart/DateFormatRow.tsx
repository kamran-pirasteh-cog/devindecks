'use client';

/**
 * How a dated axis writes its periods — the panel's counterpart to the
 * right-click menu's "Date format" submenu (`dateFormatMenuItems`).
 *
 * Two controls, for the same reason `NumberFormatRows` has a dropdown and a
 * box: the list is the forms a business chart actually uses, written out as
 * they will appear on the axis, and the box is for the one form the list
 * doesn't have. Both write the SAME field, and the box only ever writes a
 * pattern `formatDate` can draw (see `parseDatePattern`) — a pattern it can't
 * lower is refused out loud rather than half-applied.
 */
import { useState } from 'react';
import type { DateGrain } from '@/model';
import {
  DEFAULT_TICK_FORMAT,
  TICK_FORMAT_CHOICES,
  parseDatePattern,
  sampleTick,
} from '@/chart/format/dateAxis';
import { FIELD, Row } from './panelChrome';

/**
 * The custom-pattern box. A component and not a bare input because it holds a
 * DRAFT: it writes on a pattern that parses and on nothing else, so typing
 * `MMM-yy` doesn't apply the four half-patterns you pass through on the way.
 */
export function DatePatternInput({
  value,
  onChange,
  className = FIELD,
}: {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value ?? '');

  // Re-seed when the format changes UNDER the box — the dropdown moved, or
  // another axis was selected. Adjusted during the render that brings the new
  // value rather than in an effect, so the box never paints the old pattern
  // for a frame. See "You Might Not Need an Effect".
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value ?? '');
  }

  const invalid = draft.trim() !== '' && parseDatePattern(draft) === null;

  const commit = () => {
    // Blank is a real answer: it hands the axis back to its grain's own form.
    if (draft.trim() === '') {
      onChange(undefined);
      return;
    }
    const next = parseDatePattern(draft);
    if (next) onChange(next);
    else setDraft(value ?? '');
  };

  return (
    <input
      value={draft}
      placeholder="MMM-yy"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') setDraft(value ?? '');
      }}
      aria-label="Custom date format"
      aria-invalid={invalid}
      title={
        invalid
          ? "This pattern can't be drawn on an axis, so it hasn't been applied."
          : 'A date pattern — MMM-yy for Jun-24, MM/dd for 06/28, QQ yyyy for Q2 2024.'
      }
      className={`${className} font-mono ${invalid ? 'border-rose-400 text-rose-600 dark:text-rose-400' : ''}`}
    />
  );
}

export function DateFormatRow({
  grain,
  value,
  onChange,
  label = 'Dates',
}: {
  /** The axis's grain, which decides what forms are worth offering. */
  grain: DateGrain;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  label?: string;
}) {
  const choices = TICK_FORMAT_CHOICES[grain];
  return (
    <Row label={label}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        aria-label="Date format"
        title="How each period is written. Auto follows the axis's own grain."
        className={FIELD}
      >
        <option value="">{`Auto (${sampleTick(grain, DEFAULT_TICK_FORMAT[grain])})`}</option>
        {choices.map((p) => (
          <option key={p} value={p}>
            {sampleTick(grain, p)}
          </option>
        ))}
        {/* A pattern typed into the box isn't in the list, and a select with no
            matching option shows blank — so it joins the list for as long as
            it is the answer. */}
        {value && !choices.includes(value) ? (
          <option value={value}>{sampleTick(grain, value)}</option>
        ) : null}
      </select>
      <DatePatternInput value={value} onChange={onChange} />
    </Row>
  );
}
