/**
 * Where a chart came from, and whether it has drifted from it.
 *
 * Mirrors `Deck.designSystemId`/`designSystemVersion`. Two independent kinds of
 * staleness matter, and they're offered separately because they mean different
 * things: the BRAND moved (restyle, always safe) or the TEMPLATE moved (the
 * archetype changed, which the author may or may not want).
 *
 * Neither ever touches data. A chart's numbers are the one thing no automatic
 * update is allowed to rewrite.
 */
import type { ChartProvenance, ChartSpec, DesignSystem } from '@/model';
import type { StoredChartTemplate } from './repository';

export interface ChartDrift {
  /** The design system has been edited since this chart was made. */
  styleStale: boolean;
  /** The template has been re-saved since this chart was made from it. */
  templateStale: boolean;
}

export function chartDrift(
  spec: ChartSpec,
  ds: DesignSystem,
  template?: StoredChartTemplate | null,
): ChartDrift {
  const p = spec.provenance;
  if (!p) return { styleStale: false, templateStale: false };
  return {
    styleStale: p.designSystemId === ds.id && p.designSystemVersion !== ds.version,
    templateStale:
      !!template && p.templateId === template.id && p.templateVersion !== template.version,
  };
}

export const stampProvenance = (
  spec: ChartSpec,
  ds: DesignSystem,
  template?: StoredChartTemplate | null,
): ChartSpec => ({
  ...spec,
  provenance: {
    templateId: template?.id,
    templateVersion: template?.version,
    designSystemId: ds.id,
    designSystemVersion: ds.version,
  } satisfies ChartProvenance,
});

export interface RestyleOptions {
  /**
   * Also adopt the template's structure — axes, labels, legend, formats.
   * Off by default: the author may have deliberately changed those.
   */
  adoptTemplateSpec?: boolean;
}

/**
 * Bring a chart back in line with its sources.
 *
 * Style and provenance only, unless `adoptTemplateSpec` is set — and even then,
 * the DATA is carried across untouched. A "restyle" that silently replaced the
 * numbers with a template's placeholders would be a catastrophe on a client
 * deck, and it's the obvious thing to get wrong here.
 */
export function restyleChart(
  spec: ChartSpec,
  ds: DesignSystem,
  template?: StoredChartTemplate | null,
  opts: RestyleOptions = {},
): ChartSpec {
  let next: ChartSpec = { ...spec };

  if (opts.adoptTemplateSpec && template && template.spec.kind === spec.kind) {
    const data = extractData(spec);
    next = { ...structuredClone(template.spec), ...data } as ChartSpec;
  }

  // The spec's own palette is a deliberate deviation; clearing it is what makes
  // the chart pick the brand's colours up again.
  delete next.palette;

  return stampProvenance(next, ds, template);
}

/**
 * The data-bearing fields, whatever shape this spec's data takes.
 *
 * Every kind must be named. Adopting a template's spec REPLACES everything this
 * doesn't carry back, so a kind that falls through to `spec.data` when it has
 * none silently wipes the author's numbers — and a schedule is not the place to
 * discover that.
 */
function extractData(spec: ChartSpec): Partial<ChartSpec> {
  if (spec.kind === 'butterfly') {
    return { categories: spec.categories, left: spec.left, right: spec.right } as Partial<ChartSpec>;
  }
  // A Gantt keeps its data in four fields and has no `data` at all.
  if (spec.kind === 'gantt') {
    return {
      rows: spec.rows,
      items: spec.items,
      cells: spec.cells,
      columns: spec.columns,
    } as Partial<ChartSpec>;
  }
  return { data: spec.data } as Partial<ChartSpec>;
}
