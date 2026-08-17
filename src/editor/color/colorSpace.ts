/**
 * Colour maths for the custom-colour picker: hex ⇄ RGB ⇄ HSV.
 *
 * HSV, not HSL, because the picker's big rectangle IS the SV plane — x is
 * saturation, y is value — and the hue strip below it is the H axis. Going
 * through HSL would need a conversion on every pointer move and would round-trip
 * badly at the edges (pure white and pure black have no single HSL answer).
 *
 * Everything here is pure and total: a parse either returns a colour or null,
 * never a half-parsed one, so a caller can drive an input off it and let the
 * user type freely without the field fighting back.
 */

export interface Rgb {
  r: number; // 0-255
  g: number;
  b: number;
}

export interface Hsv {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Clamp and round to a byte — what every channel input has to land on. */
export const clampByte = (n: number) => clamp(Math.round(n), 0, 255);

/**
 * Anything a user might type in a hex field, normalised to `#RRGGBB` — with or
 * without the `#`, shorthand or full, any case. `null` when it isn't a colour
 * yet, which is the state a half-typed field is in most of the time.
 */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;
  if (raw.length === 3) {
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')}`.toUpperCase();
  }
  if (raw.length === 6) return `#${raw}`.toUpperCase();
  return null;
}

/** Parse to RGB, falling back to black so render paths never see undefined. */
export function hexToRgb(input: string): Rgb {
  const hex = normalizeHex(input) ?? '#000000';
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((c) => clampByte(c).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  // A grey has no hue at all. Reporting 0 keeps the strip's thumb parked at red
  // rather than jumping somewhere arbitrary; callers that care (the picker)
  // remember the hue the user last chose instead of reading it back.
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 1);
  const vn = clamp(v, 0, 1);
  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;
  const sector = Math.floor(hn / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector]!;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export const hexToHsv = (hex: string): Hsv => rgbToHsv(hexToRgb(hex));
export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

/**
 * Whether a colour needs dark ink on top of it — used for the thumb ring and
 * the check mark drawn over a chosen swatch, so neither disappears into it.
 *
 * Relative luminance per WCAG, not a naive channel average: #00FF00 and #0000FF
 * average the same but one is nearly white and the other nearly black.
 */
export function isLight(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.45;
}
