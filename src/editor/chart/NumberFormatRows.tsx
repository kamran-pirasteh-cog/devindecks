'use client';

/**
 * How a number on a chart is written — think-cell's three dropdowns, plus the
 * escape hatch.
 *
 * The three are the ones people reach for in that order: what UNIT the number
 * is in (thousands, millions), how many DECIMALS it carries, and what KIND of
 * number it is (plain, money, percent). Grouping commas are not a fourth
 * dropdown — a business chart always wants them, so they are simply on unless
 * a custom pattern says otherwise.
 *
 * The custom box is the fourth control, for the format the dropdowns can't
 * spell: `$0.0,,`, `#.0,`, `#,##0;(#,##0)`. It parses to the SAME curated
 * fields the dropdowns write (see `parseNumberPattern`) — there is no second
 * rendering path — so whatever it accepts, the dropdowns can then read back.
 * What it can't lower, it refuses out loud rather than half-applying.
 *
 * The block is deliberately dumb: it takes the format in force and hands back a
 * whole one. Which spec node that lands on — a point, a series, an axis, the
 * chart — is the caller's business, and only the caller knows it.
 */
import { useState } from 'react';
import { DEFAULT_NUMBER_FORMAT, type NumberFormat, type NumberScale } from '@/model';
import { numberPatternOf, parseNumberPattern } from '@/chart/format/pattern';
import { FIELD, Row } from './panelChrome';

/** The units a chart is ever read in, in the words a reader uses for them. */
const PLACES: { value: NumberScale; label: string }[] = [
  { value: 'none', label: 'Units' },
  { value: 'auto', label: 'Auto' },
  { value: 'K', label: 'Thousands (K)' },
  { value: 'M', label: 'Millions (M)' },
  { value: 'B', label: 'Billions (B)' },
  { value: 'T', label: 'Trillions (T)' },
];

const STYLES: { value: NumberFormat['style']; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
];

/**
 * Decimal places, each shown as what a number looks like at it. Blank is
 * "auto", which resolves across the whole set — see `formatNumber`.
 */
const DECIMALS: { value: string; label: string }[] = [
  { value: '', label: '0.#' },
  { value: '0', label: '0' },
  { value: '1', label: '0.0' },
  { value: '2', label: '0.00' },
  { value: '3', label: '0.000' },
];

/**
 * The custom-pattern box on its own, for a panel that lays its controls out
 * side by side rather than in rows.
 *
 * A component and not a bare input because the box holds a DRAFT: it writes on
 * a pattern that parses and on nothing else, so typing "#,##0" doesn't apply
 * the four half-patterns you pass through on the way there.
 */
export function NumberPatternInput({
  value,
  onChange,
  className = FIELD,
}: {
  value: NumberFormat | undefined;
  onChange: (next: NumberFormat) => void;
  className?: string;
}) {
  const f = value ?? DEFAULT_NUMBER_FORMAT;
  const pattern = numberPatternOf(f);
  const [draft, setDraft] = useState(pattern ?? '');

  // The box re-seeds when the format changes UNDER it — a dropdown moved, or
  // another label selected. Adjusted during the render that brings the new
  // format rather than in an effect, so the box never paints the old pattern
  // for a frame. See "You Might Not Need an Effect".
  const [seen, setSeen] = useState(pattern);
  if (seen !== pattern) {
    setSeen(pattern);
    setDraft(pattern ?? '');
  }

  const invalid = draft.trim() !== '' && parseNumberPattern(draft) === null;

  const commit = () => {
    const next = parseNumberPattern(draft);
    if (next) onChange(next);
    else setDraft(pattern ?? '');
  };

  return (
    <input
      value={draft}
      // Blank is what an auto scale shows: no pattern can say "whatever these
      // numbers need", so the box offers an example instead of a wrong answer.
      placeholder={pattern === null ? 'auto' : '#,##0.0,,'}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') setDraft(pattern ?? '');
      }}
      aria-label="Custom number format"
      aria-invalid={invalid}
      title={
        invalid
          ? "This pattern can't be drawn on a chart, so it hasn't been applied."
          : 'An Excel-style pattern — $0.0,, for millions of dollars, #.0, for thousands.'
      }
      className={`${className} font-mono ${invalid ? 'border-rose-400 text-rose-600 dark:text-rose-400' : ''}`}
    />
  );
}

export function NumberFormatRows({
  value,
  onChange,
  label = 'Number',
}: {
  /** The format in force at whatever the caller has selected. */
  value: NumberFormat | undefined;
  /** Always a whole format: the controls state the number, they don't patch it. */
  onChange: (next: NumberFormat) => void;
  /** The word for the first row, so an axis can say "Ticks" instead. */
  label?: string;
}) {
  const f = value ?? DEFAULT_NUMBER_FORMAT;

  return (
    <>
      <Row label={label}>
        <select
          value={f.style}
          onChange={(e) => onChange({ ...f, style: e.target.value as NumberFormat['style'] })}
          aria-label="Number format"
          className={FIELD}
        >
          {STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={f.decimals === undefined ? '' : String(f.decimals)}
          onChange={(e) =>
            onChange({
              ...f,
              decimals: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
          aria-label="Decimal places"
          title="Decimal places. Auto gives the whole set the fewest that keep it exact."
          className={`${FIELD} w-16 shrink-0`}
        >
          {DECIMALS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Place">
        <select
          value={f.scale ?? 'none'}
          onChange={(e) => onChange({ ...f, scale: e.target.value as NumberScale })}
          aria-label="Number place"
          title="Divide by this before writing the number, and say so with a suffix."
          className={FIELD}
        >
          {PLACES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Custom">
        <NumberPatternInput value={f} onChange={onChange} />
      </Row>
    </>
  );
}
