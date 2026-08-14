/**
 * Text measurement for chart layout.
 *
 * A chart layout measures hundreds of strings — every tick, every data label,
 * twice (the plot area is solved in two passes). `editor/fitToText.ts` clones
 * live DOM, which is exactly right for fitting one text box and far too slow
 * and too browser-bound for this: it can't run in a test, in an SSR thumbnail,
 * or in the deck validator.
 *
 * So the compiler takes a `TextMeasurer` by INJECTION. The canvas passes the
 * canvas-backed one; tests and SSR pass the deterministic metric one. Same
 * chart, same numbers, everywhere — which is the only way the canvas, the
 * thumbnail and the exported .pptx can agree on where a label goes.
 */
import { FONTS, pointsToEmu, type EMU, type FontFamily } from '@/model';

export interface TextStyleMetrics {
  font: FontFamily;
  sizePt: number;
  bold?: boolean;
  /**
   * Small-caps-free all-caps: the label is uppercased before it's measured and
   * before it's emitted. It has to be BOTH, or the axis gutter gets sized for
   * "FY24 revenue" and then renders "FY24 REVENUE" over the plot.
   */
  caps?: boolean;
}

/**
 * The string a run actually shows. The single place the caps transform lives, so
 * measurement, the canvas and the .pptx export can't disagree about it.
 */
export const displayText = (text: string, style: TextStyleMetrics): string =>
  style.caps ? text.toUpperCase() : text;

export interface TextMeasurer {
  measure(text: string, style: TextStyleMetrics): { wEmu: EMU; hEmu: EMU };
}

/** One line's height, from the font's own metrics — same source the renderer uses. */
export const lineHeightEmu = (style: TextStyleMetrics): EMU =>
  Math.round(pointsToEmu(style.sizePt) * FONTS[style.font].singleLineFactor);

/* ------------------------------------------------------------------ */
/* Metric measurer — deterministic, no DOM                            */
/* ------------------------------------------------------------------ */

/**
 * Average advance width per character as a fraction of the font size, by
 * character class. Measured from the three shipped faces at 100px; good to a
 * few percent, which is well inside the padding the label solver leaves anyway.
 *
 * The classes matter more than the precision: digits and capitals are much
 * wider than 'l' or a space, and a tick-label estimate that ignores that
 * mis-sizes the axis gutter by enough to be visible.
 */
const WIDTH_CLASSES: { test: (c: string) => boolean; ratio: number }[] = [
  { test: (c) => c === ' ', ratio: 0.26 },
  { test: (c) => c >= '0' && c <= '9', ratio: 0.56 },
  { test: (c) => 'ilj.,;:\'`|!'.includes(c), ratio: 0.28 },
  { test: (c) => 'ftr()[]{}-'.includes(c), ratio: 0.36 },
  { test: (c) => 'mwMW'.includes(c), ratio: 0.88 },
  { test: (c) => c >= 'A' && c <= 'Z', ratio: 0.68 },
];
const DEFAULT_RATIO = 0.53;

/** Monospace has one advance for everything — that's the whole point of it. */
const MONO_RATIO = 0.6;

function charRatio(c: string, font: FontFamily): number {
  if (font === 'Geist Mono') return MONO_RATIO;
  for (const cls of WIDTH_CLASSES) {
    if (cls.test(c)) return cls.ratio;
  }
  return DEFAULT_RATIO;
}

/** Bold adds roughly 3% to advance width across these faces. */
const BOLD_FACTOR = 1.03;
/** Source Serif runs slightly wider than Geist at the same size. */
const SERIF_FACTOR = 1.04;

export function metricMeasurer(): TextMeasurer {
  return {
    measure(text, style) {
      // Defensive: this sits under every chart, and a single undefined label
      // from a malformed spec should degrade to a zero-width measurement, not
      // throw halfway through a render.
      const raw = typeof text === 'string' ? text : String(text ?? '');
      const s = displayText(raw, style);
      let ratio = 0;
      for (const c of s) ratio += charRatio(c, style.font);
      if (style.bold) ratio *= BOLD_FACTOR;
      if (style.font === 'Source Serif 4') ratio *= SERIF_FACTOR;
      return {
        wEmu: Math.round(pointsToEmu(style.sizePt) * ratio),
        hEmu: lineHeightEmu(style),
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Canvas measurer — exact, browser only                              */
/* ------------------------------------------------------------------ */

const MEASURE_PX = 100;

/**
 * Canvas `measureText` against the real loaded webfonts. Results are cached per
 * (text, style) because a chart re-measures the same tick labels on every pass
 * and on every recompile.
 *
 * Falls back to the metric measurer when there's no 2d context — a headless or
 * pre-font-load call must still return something laid out rather than throwing
 * mid-render.
 */
/**
 * Resolve a font's CSS stack to something `ctx.font` will actually accept.
 *
 * The stacks in `FONTS` are `var(--font-geist-sans), system-ui, sans-serif`,
 * and a canvas context REJECTS a font string containing `var()` — silently,
 * leaving the previous value in place, so every measurement comes back as
 * 10px sans-serif and every chart's gutters and labels are sized off
 * ~10× too-narrow text. Reading the computed value off a probe element turns
 * the variable into the real family name the browser resolved it to.
 */
function resolveFontStack(family: FontFamily): string {
  const stack = FONTS[family].cssStack;
  if (!stack.includes('var(')) return stack;
  if (typeof document === 'undefined') return `"${family}", sans-serif`;

  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  probe.style.fontFamily = stack;
  document.body.appendChild(probe);
  try {
    const resolved = getComputedStyle(probe).fontFamily;
    // If the variable wasn't defined the computed value still contains it.
    return resolved && !resolved.includes('var(') ? resolved : `"${family}", sans-serif`;
  } finally {
    probe.remove();
  }
}

export function canvasMeasurer(): TextMeasurer {
  const fallback = metricMeasurer();
  let ctx: CanvasRenderingContext2D | null = null;
  if (typeof document !== 'undefined') {
    ctx = document.createElement('canvas').getContext('2d');
  }
  if (!ctx) return fallback;

  const cache = new Map<string, number>();
  const stacks = new Map<FontFamily, string>();

  return {
    measure(text, style) {
      const shown = displayText(String(text ?? ''), style);
      const key = `${style.font}|${style.bold ? 'b' : 'n'}|${shown}`;
      let widthAt100 = cache.get(key);
      if (widthAt100 === undefined) {
        let stack = stacks.get(style.font);
        if (stack === undefined) {
          stack = resolveFontStack(style.font);
          stacks.set(style.font, stack);
        }
        // Measure once at a fixed size and scale — advance width is linear in
        // font size, so this turns N sizes into one measurement per string.
        const font = `${style.bold ? 700 : 400} ${MEASURE_PX}px ${stack}`;
        ctx.font = font;
        // An assignment the context refused leaves `ctx.font` unchanged; if
        // that happened, the measurement would be meaningless.
        if (!ctx.font.includes(`${MEASURE_PX}px`)) return fallback.measure(text, style);
        widthAt100 = ctx.measureText(shown).width;
        cache.set(key, widthAt100);
      }
      if (!widthAt100) return fallback.measure(text, style);
      return {
        wEmu: Math.round(pointsToEmu(style.sizePt) * (widthAt100 / MEASURE_PX)),
        hEmu: lineHeightEmu(style),
      };
    },
  };
}

/**
 * The measurer to use in this environment. Charts compiled during SSR or in a
 * test get the deterministic one automatically.
 */
export function defaultMeasurer(): TextMeasurer {
  return typeof document === 'undefined' ? metricMeasurer() : canvasMeasurer();
}
