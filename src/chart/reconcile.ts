/**
 * Splice a freshly compiled chart back into a slide's element list.
 *
 * The naive move — `slide.elements = compile(...)` — is what the old
 * `updateSlideChart` did, and it caused every problem this engine exists to
 * fix: it wiped anything else on the slide, so only one chart could ever live
 * there; it minted new ids, so the selection vanished on every keystroke and
 * React rebuilt every node; and it lost z-order.
 *
 * Because part ids are deterministic (`${chartId}::${partKey}`), the update is
 * a keyed diff instead: survivors are patched in place and keep their slot,
 * new parts land in the chart's z-range, departed parts are removed, and
 * nothing outside the chart is touched.
 */
import type { SlideElement } from '@/model';
import { chartIdOfElementId } from '@/model';

export const isChartElement = (el: SlideElement, chartId: string): boolean =>
  chartIdOfElementId(el.id) === chartId;

export function reconcileChartElements(
  elements: SlideElement[],
  chartId: string,
  next: SlideElement[],
): SlideElement[] {
  const incoming = new Map(next.map((el) => [el.id, el]));
  const out: SlideElement[] = [];
  let lastChartIndex = -1;

  for (const el of elements) {
    if (!isChartElement(el, chartId)) {
      out.push(el);
      continue;
    }
    const replacement = incoming.get(el.id);
    if (!replacement) continue; // this part no longer exists
    // Carry forward anything the author set that the compiler doesn't own —
    // `locked` is theirs, not ours.
    out.push(el.locked ? { ...replacement, locked: true } : replacement);
    incoming.delete(el.id);
    lastChartIndex = out.length - 1;
  }

  if (incoming.size) {
    // New parts join at the end of the chart's own run so they sit above the
    // chart's older parts but below anything the author layered on top.
    const insertAt = lastChartIndex >= 0 ? lastChartIndex + 1 : out.length;
    // Insert in compile order, not Map order, so z-order is deterministic.
    const additions = next.filter((el) => incoming.has(el.id));
    out.splice(insertAt, 0, ...additions);
  }

  return out;
}

/**
 * Move some of a chart's parts to the top of the chart's own run.
 *
 * Reconciling holds a survivor's z-slot on purpose: a recompile must not undo
 * the author's layering. But a part can be MOVED by the spec into a place where
 * its old slot is wrong — a legend dragged inside the plot has to paint over the
 * bars, and it keeps the slot it held while it was sitting in a gutter under
 * them, where being buried didn't matter. This lifts those parts back to where
 * the compiler put them, and only those.
 *
 * The run's own bounds don't move, so anything the author layered above the
 * chart stays above it.
 */
export function liftChartParts(
  elements: SlideElement[],
  chartId: string,
  ids: string[],
): SlideElement[] {
  const lift = new Set(ids);
  const lifted = elements.filter((el) => isChartElement(el, chartId) && lift.has(el.id));
  if (!lifted.length) return elements;
  const rest = elements.filter((el) => !lift.has(el.id));
  // The last slot the chart still owns, which is where the lifted parts land.
  const last = rest.findLastIndex((el) => isChartElement(el, chartId));
  const at = last >= 0 ? last + 1 : rest.length;
  return [...rest.slice(0, at), ...lifted, ...rest.slice(at)];
}

/** Remove every element belonging to a chart. */
export const stripChartElements = (
  elements: SlideElement[],
  chartId: string,
): SlideElement[] => elements.filter((el) => !isChartElement(el, chartId));

/**
 * Detach: keep the primitives, drop the link back to the spec. One-way, and
 * that's deliberate — once an author edits the pieces by hand there is no
 * honest way to fold those edits back into a spec, so ungrouping a chart says
 * so rather than silently regenerating over their work.
 */
export function detachChartElements(
  elements: SlideElement[],
  chartId: string,
): SlideElement[] {
  return elements.map((el) => {
    if (!isChartElement(el, chartId)) return el;
    const { chartRef: _chartRef, ...rest } = el;
    // Ids must stop colliding with the chart's namespace, or a later chart with
    // a recycled id would adopt these orphans.
    return { ...rest, id: el.id.replace('::', '-') } as SlideElement;
  });
}
