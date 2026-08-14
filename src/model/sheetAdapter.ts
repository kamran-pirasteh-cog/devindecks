/**
 * Spec <-> sheet, both directions, pure.
 *
 * Two rules, taken from `model/ingest.ts`'s doctrine:
 *
 * - **`specFromSheet` never throws and never drops a row.** A cell that can't
 *   be coerced keeps its raw text in the sheet, contributes `null` to the spec,
 *   and raises a diagnostic. The chart keeps rendering the whole time.
 * - **The sheet owns data, nothing else.** `base` carries styling, axes,
 *   decorations and provenance across, so editing a number can't quietly reset
 *   a series color the author picked.
 */
import { nanoid } from 'nanoid';
import {
  isButterflySpec,
  isGridSpec,
  isSankeySpec,
  isWaterfallSpec,
  isXYSpec,
  type ChartSpec,
  type GridSeries,
  type WaterfallRole,
  type XYSeries,
} from './chart/spec';
import { WATERFALL_ROLE_OPTIONS } from './chart/roles';
import { parseGrain, sheetSchemaFor, sheetSeriesFor } from './sheetSchema';
import {
  columnsFor,
  EMPTY,
  cellText,
  type CellValue,
  type SheetDiagnostic,
  type SheetModel,
} from './sheet';

const numCell = (n: number | null | undefined): CellValue =>
  n === null || n === undefined || !Number.isFinite(n) ? EMPTY : { kind: 'number', n };

const textCell = (s: string): CellValue => (s ? { kind: 'text', text: s } : EMPTY);

/* ------------------------------------------------------------------ */
/* spec -> sheet                                                      */
/* ------------------------------------------------------------------ */

export function sheetFromSpec(spec: ChartSpec): SheetModel {
  const schema = sheetSchemaFor(spec);
  const series = sheetSeriesFor(spec);
  const columns = columnsFor(schema, series);
  const dateKey = schema.keyColumns[0]?.type === 'date';

  const keyCell = (label: string): CellValue => {
    if (!dateKey) return textCell(label);
    const parsed = parseGrain(label);
    // Keep the author's own wording ("FY25") rather than normalizing it to an
    // ISO date they never typed; the ISO form is derived where it's needed.
    return parsed ? { kind: 'text', text: label } : textCell(label);
  };

  const rows: CellValue[][] = [];
  const bandValues: Record<string, CellValue[]> = {};

  if (isGridSpec(spec)) {
    for (const [ci, cat] of spec.data.categories.entries()) {
      rows.push([keyCell(cat.label), ...spec.data.series.map((s) => numCell(s.values[ci]))]);
    }
    if (spec.kind === 'mekko') {
      const widths =
        spec.width.mode === 'explicit'
          ? spec.width.values
          : spec.data.categories.map((_, ci) =>
              spec.data.series.reduce((sum, s) => sum + (s.values[ci] ?? 0), 0),
            );
      bandValues.width = spec.data.categories.map((_, ci) => numCell(widths[ci]));
    }
  } else if (isXYSpec(spec)) {
    const withSize = schema.perSeries.some((c) => c.key === 'size');
    const count = Math.max(0, ...spec.data.series.map((s) => s.points.length));
    for (let i = 0; i < count; i++) {
      const row: CellValue[] = [textCell(spec.data.series[0]?.points[i]?.label ?? `Point ${i + 1}`)];
      for (const s of spec.data.series) {
        const p = s.points[i];
        row.push(numCell(p?.x), numCell(p?.y));
        if (withSize) row.push(numCell(p?.size));
      }
      rows.push(row);
    }
  } else if (isWaterfallSpec(spec)) {
    for (const item of spec.data.items) {
      rows.push([textCell(item.label), numCell(item.value), { kind: 'enum', value: item.role }]);
    }
  } else if (isSankeySpec(spec)) {
    // One row per flow. The endpoints are shown as node LABELS rather than as
    // keys: nobody wants to type "n3" to point a flow at "Qualified".
    const labelOf = new Map(spec.data.nodes.map((n) => [n.key, n.label] as const));
    for (const link of spec.data.links) {
      rows.push([
        textCell(labelOf.get(link.from) ?? link.from),
        textCell(labelOf.get(link.to) ?? link.to),
        numCell(link.value),
      ]);
    }
  } else if (isButterflySpec(spec)) {
    const all = [...spec.left, ...spec.right];
    for (const [ci, cat] of spec.categories.entries()) {
      rows.push([textCell(cat.label), ...all.map((s) => numCell(s.values[ci]))]);
    }
  }

  return { schema, columns, series, rows, bandValues };
}

/* ------------------------------------------------------------------ */
/* sheet -> spec                                                      */
/* ------------------------------------------------------------------ */

export interface SpecFromSheetResult {
  spec: ChartSpec;
  diagnostics: SheetDiagnostic[];
}

export function specFromSheet(sheet: SheetModel, base: ChartSpec): SpecFromSheetResult {
  const diagnostics: SheetDiagnostic[] = [];
  const spec = structuredClone(base) as ChartSpec;
  const { schema, columns, rows } = sheet;

  const colIndex = (predicate: (c: (typeof columns)[number]) => boolean) =>
    columns.findIndex(predicate);

  const readNumber = (r: number, c: number, columnKey: string): number | null => {
    const cell = rows[r]?.[c];
    if (!cell || cell.kind === 'empty') return null;
    if (cell.kind === 'number') return cell.n;
    diagnostics.push({
      severity: 'error',
      code: 'cell-not-a-number',
      message: `"${cellText(cell)}" isn't a number.`,
      cell: { r, c },
      column: columnKey,
    });
    return null;
  };

  const labelAt = (r: number, fallback: string): string => {
    const cell = rows[r]?.[0];
    const t = cellText(cell).trim();
    return t || fallback;
  };

  /* --- category grid --- */
  if (isGridSpec(spec)) {
    const existing = spec.data.categories;
    spec.data.categories = rows.map((_, r) => ({
      // Reuse the key positionally so per-point overrides survive a rename.
      key: existing[r]?.key ?? `c-${nanoid(5)}`,
      label: labelAt(r, `Category ${r + 1}`),
    }));

    spec.data.series = sheet.series.map((s): GridSeries => {
      const prior = spec.data.series.find((x) => x.key === s.key);
      const c = colIndex((col) => col.seriesKey === s.key && col.field === 'value');
      return {
        ...(prior ?? { key: s.key, name: s.name, values: [] }),
        key: s.key,
        name: s.name,
        values: rows.map((_, r) => (c < 0 ? null : readNumber(r, c, `${s.key}.value`))),
        pointOverrides: pruneOverrides(prior?.pointOverrides, spec.data.categories.map((x) => x.key)),
      };
    });

    if (spec.kind === 'mekko') {
      const widths = sheet.bandValues.width ?? [];
      const values = rows.map((_, r) => {
        const cell = widths[r];
        return cell?.kind === 'number' ? cell.n : 0;
      });
      spec.width = values.some((v) => v > 0) ? { mode: 'explicit', values } : { mode: 'total' };
    }
  } else if (isXYSpec(spec)) {
    const withSize = schema.perSeries.some((c) => c.key === 'size');
    spec.data.series = sheet.series.map((s): XYSeries => {
      const prior = spec.data.series.find((x) => x.key === s.key);
      const xi = colIndex((col) => col.seriesKey === s.key && col.field === 'x');
      const yi = colIndex((col) => col.seriesKey === s.key && col.field === 'y');
      const zi = colIndex((col) => col.seriesKey === s.key && col.field === 'size');
      return {
        ...(prior ?? { key: s.key, name: s.name, points: [] }),
        key: s.key,
        name: s.name,
        points: rows.map((_, r) => {
          const x = readNumber(r, xi, `${s.key}.x`);
          const y = readNumber(r, yi, `${s.key}.y`);
          if (x === null || y === null) {
            diagnostics.push({
              severity: 'warning',
              code: 'incomplete-point',
              message: `Point ${r + 1} of "${s.name}" is missing an X or Y and won't be plotted.`,
              cell: { r, c: x === null ? xi : yi },
            });
          }
          return {
            key: prior?.points[r]?.key ?? `p-${nanoid(5)}`,
            x: x ?? 0,
            y: y ?? 0,
            ...(withSize ? { size: readNumber(r, zi, `${s.key}.size`) ?? 0 } : {}),
            label: labelAt(r, `Point ${r + 1}`),
          };
        }),
      };
    });
  } else if (isWaterfallSpec(spec)) {
    const vi = colIndex((col) => col.field === 'value');
    const ri = colIndex((col) => col.key === 'role');
    spec.data.items = rows.map((_, r) => {
      const prior = spec.data.items[r];
      const roleCell = rows[r]?.[ri];
      const role = coerceRole(roleCell, r, ri, diagnostics);
      const value = readNumber(r, vi, 'value');
      if (value === null && (role === 'start' || role === 'delta')) {
        diagnostics.push({
          severity: 'warning',
          code: 'missing-value',
          message: `Row ${r + 1} is a ${role === 'start' ? 'start' : 'change'} with no value.`,
          cell: { r, c: vi },
        });
      }
      return {
        key: prior?.key ?? `w-${nanoid(5)}`,
        label: labelAt(r, `Item ${r + 1}`),
        role,
        value,
      };
    });
  } else if (isSankeySpec(spec)) {
    const vi = colIndex((col) => col.field === 'value');
    const priorNodes = spec.data.nodes;
    // Node identity follows the LABEL, because the label is what the sheet
    // shows and edits. Matching it back to an existing node is what carries a
    // hand-picked colour or a pinned layer across an edit to the flows.
    const byLabel = new Map(priorNodes.map((n) => [n.label.trim().toLowerCase(), n] as const));
    const nodes: typeof priorNodes = [];
    const seen = new Map<string, string>();

    const nodeKeyFor = (label: string): string => {
      const id = label.trim().toLowerCase();
      const already = seen.get(id);
      if (already) return already;
      const prior = byLabel.get(id);
      const node = prior
        ? { ...prior, label: label.trim() }
        : { key: `n-${nanoid(5)}`, label: label.trim() };
      nodes.push(node);
      seen.set(id, node.key);
      return node.key;
    };

    const links = rows.flatMap((_, r) => {
      const from = cellText(rows[r]?.[0]).trim();
      const to = cellText(rows[r]?.[1]).trim();
      const value = readNumber(r, vi, 'value');
      if (!from || !to) {
        diagnostics.push({
          severity: 'warning',
          code: 'incomplete-flow',
          message: `Row ${r + 1} is missing a ${from ? 'destination' : 'source'} and won't be drawn.`,
          cell: { r, c: from ? 1 : 0 },
        });
        return [];
      }
      if (value === null || value <= 0) {
        diagnostics.push({
          severity: 'warning',
          code: 'missing-value',
          message: `"${from} → ${to}" needs a value above zero to be drawn.`,
          cell: { r, c: vi },
        });
      }
      return [
        {
          key: spec.data.links[r]?.key ?? `f-${nanoid(5)}`,
          from: nodeKeyFor(from),
          to: nodeKeyFor(to),
          value: value ?? 0,
        },
      ];
    });

    // A node the flows no longer mention has nothing left to draw, so it goes
    // — otherwise deleting the last flow into a node leaves it stranded.
    spec.data = { nodes, links };
  } else if (isButterflySpec(spec)) {
    const existing = spec.categories;
    spec.categories = rows.map((_, r) => ({
      key: existing[r]?.key ?? `c-${nanoid(5)}`,
      label: labelAt(r, `Category ${r + 1}`),
    }));
    const built = sheet.series.map((s): GridSeries => {
      const prior = [...spec.left, ...spec.right].find((x) => x.key === s.key);
      const c = colIndex((col) => col.seriesKey === s.key && col.field === 'value');
      return {
        ...(prior ?? { key: s.key, name: s.name, values: [] }),
        key: s.key,
        name: s.name,
        values: rows.map((_, r) => (c < 0 ? null : readNumber(r, c, `${s.key}.value`))),
      };
    });
    spec.left = built.slice(0, 1);
    spec.right = built.slice(1, 2);
  }

  return { spec, diagnostics };
}

function coerceRole(
  cell: CellValue | undefined,
  r: number,
  c: number,
  diagnostics: SheetDiagnostic[],
): WaterfallRole {
  const raw = cellText(cell).trim().toLowerCase();
  if (!raw) return 'delta';
  const match = WATERFALL_ROLE_OPTIONS.find(
    (o) => o.value === raw || o.label.toLowerCase() === raw,
  );
  if (match) return match.value;
  diagnostics.push({
    severity: 'error',
    code: 'unknown-enum',
    message: `"${cellText(cell)}" isn't one of ${WATERFALL_ROLE_OPTIONS.map((o) => o.label).join(', ')}.`,
    cell: { r, c },
    column: 'role',
  });
  return 'delta';
}

/**
 * Drop overrides whose point no longer exists. Without this, deleting a
 * category and adding one back later resurrects a color the author set on
 * something else entirely.
 */
function pruneOverrides(
  overrides: GridSeries['pointOverrides'],
  liveKeys: string[],
): GridSeries['pointOverrides'] {
  if (!overrides) return undefined;
  const live = new Set(liveKeys);
  const kept = Object.entries(overrides).filter(([k]) => live.has(k));
  return kept.length ? Object.fromEntries(kept) : undefined;
}
