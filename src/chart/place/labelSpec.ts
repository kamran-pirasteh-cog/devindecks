/**
 * Which data-label settings are in force on one point, and the type they get
 * drawn in.
 *
 * There are three places a label's settings can live — the chart, the series (or
 * a waterfall's item), and the single point — and every placer has to resolve
 * them the same way, because the editor writes to the NARROWEST one it can: a
 * single label selected on the canvas becomes a point override, not a chart-wide
 * change (see `ChartPartPopover`, `applyChartTextFormat`). A placer that reads
 * only `spec.decorations.labels` therefore drops that edit on the floor, and the
 * user sees a control that writes to the spec and moves nothing on screen.
 */
import { fontOver, type ChartTextRole, type ChartTheme } from '../theme';
import type { LabelFont, LabelSpec } from '@/model';

/**
 * Chart default < series/item < point. Most specific wins.
 *
 * Overrides are stored as whole `LabelSpec`s in practice — the editor seeds them
 * from the level above on first write — but they're typed as partials so a spec
 * hand-written or imported with only `{ font }` on a point still resolves.
 */
export const labelSpecFor = (
  chartDefault: LabelSpec,
  ...overrides: (Partial<LabelSpec> | undefined)[]
): LabelSpec =>
  overrides.reduce<LabelSpec>((acc, o) => (o ? { ...acc, ...o } : acc), chartDefault);

/**
 * The brand's data-label type with a label's own font override laid over it.
 *
 * Through `fontOver` rather than a spread, because an override written by the
 * panel carries explicit `undefined`s for the fields it isn't setting — "back to
 * the brand's colour" is a `color: undefined` — and spreading those would wipe
 * the resolved token instead of leaving it alone.
 *
 * Colour is resolved here only when the label names one: a label sitting on its
 * own mark takes its ink from that mark, which only the placer knows, so callers
 * still settle the fallback themselves.
 */
export const labelRole = (theme: ChartTheme, font: LabelFont | undefined): ChartTextRole => ({
  ...theme.text.dataLabel,
  ...fontOver(font),
});
