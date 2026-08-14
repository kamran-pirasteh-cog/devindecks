/**
 * Number formatting for chart labels and axis ticks.
 *
 * `Intl.NumberFormat` does the digits; this adds the things a chart needs and
 * Intl doesn't express: scale suffixes (1_240_000 -> "1.2M"), accounting
 * negatives, prefix/suffix, and — the one that actually matters visually —
 * decimals resolved ONCE across a whole set, so a column of labels lines up
 * instead of reading 1.5 / 2 / 1.25.
 *
 * Locale is pinned to en-US. Chart numbers are export-bound; a viewer's locale
 * must not change what the slide says.
 */
import {
  DEFAULT_NUMBER_FORMAT,
  type FormattedNumber,
  type NumberFormat,
  type NumberScale,
} from '@/model';

const LOCALE = 'en-US';

const SCALE_DIVISOR: Record<Exclude<NumberScale, 'none' | 'auto'>, number> = {
  K: 1e3,
  M: 1e6,
  B: 1e9,
  T: 1e12,
};

/** The scale `auto` picks for a magnitude. Thresholds match how people read. */
function autoScale(maxAbs: number): Exclude<NumberScale, 'auto'> {
  if (maxAbs >= 1e12) return 'T';
  if (maxAbs >= 1e9) return 'B';
  if (maxAbs >= 1e6) return 'M';
  if (maxAbs >= 1e4) return 'K';
  return 'none';
}

/**
 * Resolve `scale: 'auto'` against the values that will share the axis or label
 * set. Must be done for the SET, not per value, or 950 and 1_100 render as
 * "950" and "1.1K" side by side.
 */
export function resolveScale(values: number[], f: NumberFormat): Exclude<NumberScale, 'auto'> {
  const s = f.scale ?? 'none';
  if (s !== 'auto') return s;
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return 'none';
  return autoScale(Math.max(...finite.map(Math.abs)));
}

const divisorFor = (s: Exclude<NumberScale, 'auto'>): number =>
  s === 'none' ? 1 : SCALE_DIVISOR[s];

const suffixFor = (s: Exclude<NumberScale, 'auto'>): string => (s === 'none' ? '' : s);

/**
 * How many decimals this set needs so every value is distinguishable, capped at
 * 2. A set of round thousands gets 0; a set with 1.25 gets 2. This is what
 * makes an axis read 0 / 200 / 400 rather than 0.0 / 200.0 / 400.0.
 */
export function resolveAutoDecimals(values: number[], f: NumberFormat): number {
  if (f.decimals !== undefined) return f.decimals;

  const scale = resolveScale(values, f);
  const div = divisorFor(scale) * (f.style === 'percent' ? 0.01 : 1);
  const scaled = values
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.abs(v / div));
  if (!scaled.length) return 0;

  for (let d = 0; d <= 2; d++) {
    const factor = 10 ** d;
    // Every value survives a round-trip at this precision -> enough decimals.
    if (scaled.every((v) => Math.abs(Math.round(v * factor) / factor - v) < 1e-9)) {
      return d;
    }
  }
  return 2;
}

export interface FormatOptions {
  /**
   * The peer values this one is formatted alongside. Supplying them is what
   * makes `scale: 'auto'` and `decimals: undefined` resolve consistently; omit
   * only when formatting a genuinely standalone number.
   */
  peers?: number[];
}

export function formatNumber(
  value: number,
  format: NumberFormat = DEFAULT_NUMBER_FORMAT,
  opts: FormatOptions = {},
): FormattedNumber {
  if (!Number.isFinite(value)) {
    return { text: '—', negative: false, red: false };
  }

  const peers = opts.peers ?? [value];
  const scale = resolveScale(peers, format);
  const decimals = resolveAutoDecimals(peers, format);

  const negative = value < 0;
  const magnitude = Math.abs(value) / divisorFor(scale);

  const digits = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: format.thousands ?? true,
  }).format(format.style === 'percent' ? magnitude * 100 : magnitude);

  let body = digits + suffixFor(scale);

  if (format.style === 'percent') body += '%';
  if (format.style === 'currency') {
    body = currencySymbol(format.currency ?? 'USD') + body;
  }

  body = (format.prefix ?? '') + body + (format.suffix ?? '');

  const mode = format.negative ?? 'minus';
  const text = negative ? (mode === 'parens' ? `(${body})` : `-${body}`) : body;

  return { text, negative, red: negative && mode === 'red' };
}

/**
 * Symbol for an ISO code. Asking Intl rather than shipping a table means a code
 * we've never seen still renders as something sensible (its own code) instead
 * of silently dropping the unit.
 */
function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/** Format a whole set consistently — the normal entry point for an axis. */
export function formatSet(values: number[], format: NumberFormat): FormattedNumber[] {
  return values.map((v) => formatNumber(v, format, { peers: values }));
}
