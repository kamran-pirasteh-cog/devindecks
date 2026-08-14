/**
 * Research framing carried by a chart or its template.
 *
 * Everything the Devin prompt needs is normally INFERRED from the chart itself
 * — the axes say the units, the categories say the period, the series say the
 * breakdown. These fields exist for the two things a chart genuinely cannot
 * know: which entity it's about, and any house rule about where the figures
 * should come from.
 *
 * All optional. Nothing here is required to generate a prompt.
 */
export interface ChartResearchHints {
  /** Who or what the chart is about, when the deck doesn't make it obvious. */
  company?: string;
  market?: string;
  geography?: string;
  /** Free text, for when the axis labels don't carry the period. */
  period?: string;
  /** Archetype-level instructions: "use reported segment revenue". */
  guidance?: string;
  preferredSources?: string[];
}

export const hasResearchHints = (h?: ChartResearchHints): boolean =>
  !!h && Object.values(h).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));
