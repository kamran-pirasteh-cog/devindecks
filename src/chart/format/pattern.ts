/**
 * Excel-style number patterns, LOWERED onto `NumberFormat`.
 *
 * `format.ts` says there is deliberately no general Excel pattern parser, and
 * that still holds: nothing here interprets a pattern at render time. This is a
 * translator for ONE surface — the "custom" box in the number-format controls —
 * and it only ever produces the curated fields the engine already honors. A
 * pattern expressing something we cannot draw is REFUSED at the box rather than
 * accepted and quietly half-applied, which is the fidelity bug that note is
 * about.
 *
 * What a pattern can say here, which is what people actually type:
 *
 *   #,##0        1,235          grouping, no decimals
 *   0.0          1234.6         no grouping, one decimal
 *   #,##0.0,,    1.2            millions — a trailing comma is a divide by 1000
 *   $#,##0.0,,   $1.2           a currency symbol in front
 *   0.0%         123.5%         percent
 *   "FY"0.0,     FY1.2          quoted literals become prefix/suffix
 *   #,##0;(#,##0)               a negative section in parentheses
 *   #,##0;[Red]-#,##0           a red negative
 *
 * `.##` is how "auto decimals" writes itself — the engine's auto mode resolves
 * a set to at most two places, so the two are the same statement.
 */
import type { NumberFormat, NumberScale } from '@/model';

/** Symbols we recognise in a pattern, longest first so `R$` beats `$`. */
const CURRENCIES: [string, string][] = [
  ['R$', 'BRL'],
  ['CHF', 'CHF'],
  ['kr', 'SEK'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
  ['₩', 'KRW'],
  ['₽', 'RUB'],
  ['₺', 'TRY'],
];

const SCALE_BY_COMMAS: Exclude<NumberScale, 'auto'>[] = ['none', 'K', 'M', 'B', 'T'];
const COMMAS_BY_SCALE: Record<Exclude<NumberScale, 'auto'>, string> = {
  none: '',
  K: ',',
  M: ',,',
  B: ',,,',
  T: ',,,,',
};

/**
 * The digit block: at least one placeholder, grouping commas allowed INSIDE it
 * but never at its end — a trailing comma is a scale divisor, not a separator,
 * and letting the block swallow it is how `0,,` would come out as plain zero.
 */
const CORE = /[#0](?:[#0,]*[#0])?(?:\.[#0]+)?/;

/** Split on `;` that isn't inside a quoted literal. */
function sections(src: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of src) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * A literal as the user meant it: quotes and escapes are syntax, not text.
 * Spaces are NOT trimmed — `"in "0.0` puts a space before the number, and
 * eating it would render "in1.2".
 */
const literal = (s: string): string => s.replace(/"/g, '').replace(/\\(.)/g, '$1');

/**
 * Placeholders Excel has and the engine hasn't: fractions (`?`, `/`),
 * scientific notation, text substitution and the padding operators. A pattern
 * using one is refused whole — dropping it silently would render a number the
 * user did not ask for.
 */
const UNSUPPORTED = /[?/@*_]|[Ee][+-]/;

/**
 * Parse a pattern, or null when it says nothing we can draw.
 *
 * Returns a WHOLE format rather than a patch: typing in the custom box is a
 * statement about the entire number, and merging it over what was there would
 * leave, say, a percent sign behind after the user typed a plain `#,##0`.
 */
export function parseNumberPattern(src: string): NumberFormat | null {
  const raw = src.trim();
  if (!raw) return null;

  const parts = sections(raw);
  const negSection = parts[1];

  // Colour wins over parentheses when a negative section asks for both: the
  // model carries one answer, and red is the one the reader sees first.
  const negative: NonNullable<NumberFormat['negative']> = /\[red\]/i.test(negSection ?? '')
    ? 'red'
    : negSection?.includes('(')
      ? 'parens'
      : /\[red\]/i.test(parts[0]!)
        ? 'red'
        : 'minus';

  // `[Red]`, `[$-409]` and friends are annotations on the section, not text.
  const body = parts[0]!.replace(/\[[^\]]*\]/g, '');

  // Tested outside quotes: `"1/2 of"0.0` is a caption, not a fraction.
  if (UNSUPPORTED.test(body.replace(/"[^"]*"/g, ''))) return null;

  const core = CORE.exec(body);
  if (!core) return null;

  const before = body.slice(0, core.index);
  const afterAll = body.slice(core.index + core[0].length);

  const commas = /^,*/.exec(afterAll)![0].length;
  if (commas >= SCALE_BY_COMMAS.length) return null;
  const scale = SCALE_BY_COMMAS[commas]!;
  const after = afterAll.slice(commas);

  // A second digit block means a fraction or a repeated section — neither of
  // which the engine can honor, so it is refused rather than half-read.
  if (CORE.test(after.replace(/"[^"]*"/g, ''))) return null;

  const percent = /%/.test(before) || /%/.test(after);

  const [intPart, fracPart] = core[0].split('.');
  const thousands = intPart!.includes(',');
  const decimals =
    fracPart === undefined ? 0 : /^#+$/.test(fracPart) ? undefined : fracPart.length;

  let prefix = literal(before.replace(/%/g, ''));
  const suffix = literal(after.replace(/%/g, ''));

  let style: NumberFormat['style'] = percent ? 'percent' : 'number';
  let currency: string | undefined;
  if (!percent) {
    for (const [symbol, code] of CURRENCIES) {
      if (prefix.includes(symbol)) {
        style = 'currency';
        currency = code;
        prefix = prefix.replace(symbol, '');
        break;
      }
    }
  }

  return {
    style,
    ...(decimals === undefined ? {} : { decimals }),
    thousands,
    ...(currency ? { currency } : {}),
    scale,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
    negative,
  };
}

/** Quote a literal that would otherwise read as pattern syntax. */
const quote = (s: string): string => (/[#0.,;%"[\]\\]/.test(s) ? `"${s}"` : s);

const symbolFor = (code: string): string =>
  CURRENCIES.find(([, iso]) => iso === code)?.[0] ?? code;

/**
 * The pattern a format writes itself as, or null when it can't be written.
 *
 * `scale: 'auto'` is the one that can't: it resolves against the values on the
 * chart, and no pattern says "whatever these numbers need". The box shows blank
 * for it rather than a pattern that would silently pin the scale on the next
 * keystroke.
 */
export function numberPatternOf(f: NumberFormat): string | null {
  if ((f.scale ?? 'none') === 'auto') return null;

  const int = f.thousands === false ? '0' : '#,##0';
  const frac =
    f.decimals === undefined ? '.##' : f.decimals > 0 ? `.${'0'.repeat(f.decimals)}` : '';
  const scale = COMMAS_BY_SCALE[(f.scale ?? 'none') as Exclude<NumberScale, 'auto'>];

  const lead =
    (f.style === 'currency' ? symbolFor(f.currency ?? 'USD') : '') +
    (f.prefix ? quote(f.prefix) : '');
  const tail = (f.style === 'percent' ? '%' : '') + (f.suffix ? quote(f.suffix) : '');

  const body = lead + int + frac + scale + tail;
  const mode = f.negative ?? 'minus';
  if (mode === 'parens') return `${body};(${body})`;
  if (mode === 'red') return `${body};[Red]-${body}`;
  return body;
}
