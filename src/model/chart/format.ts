/**
 * Number formatting — the TYPE only. The engine lives in
 * `src/chart/format/number.ts`; the type sits here because the spec references
 * it and the model must not depend on the engine.
 *
 * There is deliberately no general Excel pattern parser. A `pattern` string can
 * express things neither PowerPoint nor our label layout can honor, and every
 * one of them would be a silent fidelity bug. The curated fields below cover
 * what a consulting chart actually needs.
 */

export type NumberStyle = 'number' | 'percent' | 'currency';

/** Scale divisor applied before formatting, with the matching suffix. */
export type NumberScale = 'none' | 'auto' | 'K' | 'M' | 'B' | 'T';

export interface NumberFormat {
  style: NumberStyle;
  /**
   * Fixed decimal places, or undefined for "auto" — which resolves ONCE across
   * a whole set of values (see `resolveAutoDecimals`) so a column of labels
   * lines up instead of each label picking its own precision.
   */
  decimals?: number;
  thousands?: boolean;
  /** ISO 4217, for style:'currency'. */
  currency?: string;
  scale?: NumberScale;
  prefix?: string;
  suffix?: string;
  negative?: 'minus' | 'parens' | 'red';
}

export const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  style: 'number',
  thousands: true,
  scale: 'none',
  negative: 'minus',
};

/**
 * A formatted value plus the styling the format implies. `negative: 'red'` is
 * a color decision, not a string one — the emitter applies it to the run rather
 * than baking an ANSI-ish marker into the text.
 */
export interface FormattedNumber {
  text: string;
  negative: boolean;
  /** True when `negative: 'red'` applies and the caller should recolor. */
  red: boolean;
}
