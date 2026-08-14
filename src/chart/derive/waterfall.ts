/**
 * Waterfall (bridge) derivation.
 *
 * The whole chart is a running total, so each bar's position depends on
 * everything before it. Computing that here — before any geometry — is what
 * lets the placer stay a simple loop, and what makes "leave the total blank
 * and we'll work it out" possible.
 */
import type { WaterfallItem, WaterfallRole, WaterfallSpec } from '@/model';

export interface WaterfallDatum {
  key: string;
  label: string;
  role: WaterfallRole;
  /** The authored figure, or the computed one for a blank total. */
  value: number;
  /** Value-axis span of the bar. */
  base: number;
  top: number;
  /** True when the bar decreases the running total. */
  negative: boolean;
  /** True when the value was computed rather than stated. */
  computed: boolean;
  index: number;
}

export interface WaterfallDerived {
  data: WaterfallDatum[];
  extent: number[];
  labels: string[];
}

export function deriveWaterfall(spec: WaterfallSpec): WaterfallDerived {
  const data: WaterfallDatum[] = [];
  const extent: number[] = [0];
  // Subtotal and total bars are drawn from zero, as absolute levels, which is
  // what makes a bridge readable: the movements float, the milestones stand.
  let running = 0;

  spec.data.items.forEach((item: WaterfallItem, index) => {
    const authored = item.value;

    switch (item.role) {
      case 'spacer':
        data.push({
          key: item.key,
          label: item.label,
          role: item.role,
          value: 0,
          base: running,
          top: running,
          negative: false,
          computed: false,
          index,
        });
        return;

      case 'start': {
        const v = authored ?? 0;
        running = v;
        data.push({
          key: item.key,
          label: item.label,
          role: item.role,
          value: v,
          base: 0,
          top: v,
          negative: v < 0,
          computed: authored === null,
          index,
        });
        extent.push(0, v);
        return;
      }

      case 'delta': {
        const v = authored ?? 0;
        const base = running;
        running += v;
        data.push({
          key: item.key,
          label: item.label,
          role: item.role,
          value: v,
          base,
          top: running,
          negative: v < 0,
          computed: authored === null,
          index,
        });
        extent.push(base, running);
        return;
      }

      case 'subtotal':
      case 'total': {
        // A blank total is the normal case: the point of a bridge is that the
        // closing figure follows from the movements above it.
        const v = authored ?? running;
        if (authored !== null) running = authored;
        data.push({
          key: item.key,
          label: item.label,
          role: item.role,
          value: v,
          base: 0,
          top: v,
          negative: v < 0,
          computed: authored === null,
          index,
        });
        extent.push(0, v);
        return;
      }
    }
  });

  return { data, extent, labels: spec.data.items.map((i) => i.label) };
}
