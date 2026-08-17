/**
 * Chart colour: the ramp series are drawn in, and the ink labels are drawn in.
 *
 * Both jobs need a PERCEPTUAL colour space, not sRGB. Stepping a hex value's
 * channels gives you a ramp whose middle entries collapse into each other and
 * whose ends fall off a cliff; stepping OKLCH's lightness gives you steps that
 * look evenly spaced because they are. The conversion is ~60 lines and it is
 * the difference between a designed palette and a generated one.
 *
 * Everything here is pure and hex-in/hex-out. `theme.ts` owns the policy about
 * WHICH colours a chart gets; this file only knows how to make good ones.
 */

/* ------------------------------------------------------------------ */
/* sRGB <-> OKLCH                                                     */
/* ------------------------------------------------------------------ */

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  l: number;
  /** Chroma, 0..~0.4 in sRGB. */
  c: number;
  /** Hue in degrees, 0..360. */
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** sRGB channel (0..1) -> linear light. */
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Linear light -> sRGB channel (0..1). */
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  // Accept #abc as well as #aabbcc — hand-written brand kits use both.
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  const v = parseInt(full, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const toHex = (r: number, g: number, b: number): string =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(clamp(v, 0, 1) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

export function hexToOklch(hex: string): Oklch {
  const [sr, sg, sb] = parseHex(hex);
  const r = toLinear(sr);
  const g = toLinear(sg);
  const b = toLinear(sb);

  // Björn Ottosson's OKLab matrices.
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.sqrt(a * a + bb * bb);
  const h = c < 1e-6 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToRgb({ l: L, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

const inGamut = ([r, g, b]: [number, number, number]) =>
  r >= -1e-4 && r <= 1 + 1e-4 && g >= -1e-4 && g <= 1 + 1e-4 && b >= -1e-4 && b <= 1 + 1e-4;

/**
 * OKLCH -> hex, reducing chroma until the colour actually fits in sRGB.
 *
 * Clamping the CHANNELS instead (the obvious shortcut) shifts hue: a too-vivid
 * blue clips its red to zero and comes back purple. Walking chroma down keeps
 * the hue the ramp was built around, which is the whole point of building it
 * in a perceptual space.
 */
export function oklchToHex(colour: Oklch): string {
  let { c } = colour;
  for (let i = 0; i < 24; i++) {
    const rgb = oklchToRgb({ ...colour, c });
    if (inGamut(rgb)) return toHex(...rgb);
    c *= 0.9;
  }
  const [r, g, b] = oklchToRgb({ ...colour, c: 0 });
  return toHex(r, g, b);
}

/* ------------------------------------------------------------------ */
/* Contrast                                                           */
/* ------------------------------------------------------------------ */

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The ink a label should use when it sits ON a fill.
 *
 * This is the fix for the single most visible chart defect: a near-black data
 * label centred in a saturated segment. Whichever of the two inks contrasts
 * more wins — no threshold constant to tune, and it degrades correctly for
 * mid-tone fills where neither option is comfortable.
 */
export function inkOn(background: string, dark = '#0A0A0A', light = '#FFFFFF'): string {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

/** Is this colour too pale to be a series on a white slide? */
export const isTooPale = (hex: string): boolean => contrastRatio(hex, '#FFFFFF') < 1.6;

/** Would a reader see these as the same colour? */
export const tooSimilar = (a: string, b: string): boolean => {
  const x = hexToOklch(a);
  const y = hexToOklch(b);
  // Hue distance means nothing at low chroma, so weight it by how colourful
  // the pair actually is — otherwise two greys 180° "apart" read as distinct.
  const dh = Math.min(Math.abs(x.h - y.h), 360 - Math.abs(x.h - y.h)) / 180;
  const chroma = Math.min(x.c, y.c);
  return Math.hypot((x.l - y.l) * 1.6, (x.c - y.c) * 1.2, dh * chroma * 4) < 0.13;
};

/* ------------------------------------------------------------------ */
/* The categorical ramp                                               */
/* ------------------------------------------------------------------ */

/**
 * The legible band for a series colour on a light slide. Above the ceiling a
 * bar washes out; below the floor two dark series stop being distinguishable
 * from each other and from the axis ink.
 */
const L_MIN = 0.42;
const L_MAX = 0.80;

/**
 * Build `count` series colours from one brand seed.
 *
 * The shape is deliberately the consulting one rather than a rainbow: the
 * accent leads, then a TONAL ladder of the same hue, and only once that ladder
 * runs out of legible room does a second hue appear. A deck whose charts are
 * all one hue plus tints reads as designed; a deck of twelve competing hues
 * reads as Excel.
 */
export function buildRamp(seedHex: string, count: number): string[] {
  const seed = hexToOklch(seedHex);
  if (count <= 0) return [];

  // A seed that is itself unusable (near-white, or a pure grey with no hue to
  // build a ladder from) gets nudged into the band first, so the ramp is
  // always built on something drawable.
  const base: Oklch = {
    l: clamp(seed.l, L_MIN, L_MAX),
    c: seed.c < 0.02 ? 0.12 : seed.c,
    h: seed.c < 0.02 ? 264 : seed.h,
  };

  const out: string[] = [];
  // Up to four steps per hue: past that the tints stop separating.
  const perHue = Math.min(4, Math.max(2, count));
  const hues = Math.ceil(count / perHue);

  for (let hueIndex = 0; hueIndex < hues; hueIndex++) {
    // Successive hues are spread around the wheel, skewed away from the exact
    // complement (which reads as a clash rather than a set).
    const h = (base.h + hueIndex * 145) % 360;
    const steps = Math.min(perHue, count - out.length);

    for (let i = 0; i < steps; i++) {
      // Start at the seed's own lightness and climb toward the ceiling, so
      // series 1 is always exactly the brand colour the author expects.
      const t = steps === 1 ? 0 : i / (steps - 1);
      const l = hueIndex === 0 ? base.l + (L_MAX - base.l) * t : L_MIN + (L_MAX - L_MIN) * t;
      // Chroma tapers as lightness climbs; a pale, fully-saturated tint looks
      // like a highlighter rather than a tint.
      const c = base.c * (1 - 0.45 * t);
      out.push(oklchToHex({ l, c, h }));
    }
  }

  return out.slice(0, count);
}

/* ------------------------------------------------------------------ */
/* The flow ladder                                                    */
/* ------------------------------------------------------------------ */

/**
 * A Sankey's ribbons are OPAQUE and they stack, so they can't be told apart by
 * alpha the way translucent ones are — they need their own tonal ladder, wider
 * than the categorical band at both ends. Pale is safe here in a way it isn't
 * for a bar: a ribbon a reader can only just see is still legible as flow,
 * because its neighbours bracket it.
 */
const FLOW_L_MIN = 0.45;
const FLOW_L_MAX = 0.86;

/**
 * The seed hue at position `t` (0 = deepest, 1 = palest) of the flow ladder.
 *
 * Continuous rather than an n-step array: a diagram with thirty ribbons wants a
 * smooth gradient down the stack, and one with four wants distinct steps — the
 * caller decides by choosing `t`, and both come out of the same formula.
 */
export function flowTint(seedHex: string, t: number): string {
  const seed = hexToOklch(seedHex);
  // Cap where the ladder STARTS, not just where the seed sits: a seed already
  // at 0.8 would leave no room to climb and every ribbon would be the same
  // near-white.
  const l0 = clamp(seed.l, FLOW_L_MIN, 0.62);
  const grey = seed.c < 0.02;
  const u = clamp(t, 0, 1);
  return oklchToHex({
    l: l0 + (FLOW_L_MAX - l0) * u,
    // Chroma tapers less steeply than the categorical ramp's. A Sankey's pale
    // end should still read as the brand hue, not as grey.
    c: (grey ? 0.14 : seed.c) * (1 - 0.3 * u),
    h: grey ? 264 : seed.h,
  });
}

/**
 * A darker/lighter variant of a colour, for `paletteOverflow: 'shade'` — the
 * ninth series in a five-colour palette should be a shade of the fourth, not
 * an exact repeat of it.
 */
export function shadeOf(hex: string, cycle: number): string {
  if (cycle === 0) return hex;
  const base = hexToOklch(hex);
  // Alternate down and up so shades stay inside the legible band instead of
  // marching off one end of it.
  const dir = cycle % 2 === 1 ? -1 : 1;
  const magnitude = Math.ceil(cycle / 2) * 0.13;
  return oklchToHex({ ...base, l: clamp(base.l + dir * magnitude, L_MIN, L_MAX) });
}
