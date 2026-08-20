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
  isGanttSpec,
  isGridSpec,
  isSankeySpec,
  isWaterfallSpec,
  isXYSpec,
  type ChartSpec,
  type GridSeries,
  type GanttItem,
  type GanttItemShape,
  type PointOverride,
  type WaterfallRole,
  type XYSeries,
} from './chart/spec';
import { GANTT_ITEM_FORM_OPTIONS, WATERFALL_ROLE_OPTIONS, type GanttItemForm } from './chart/roles';
import { comboDisplayOrder, comboSeriesMark } from './chart/combo';
import { datasheetSchemaFor, datasheetSeriesFor, parseDay, parseGrain } from './sheetSchema';
import { fromIso, toIso, type EpochDay } from './units';
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

const dayCell = (d: EpochDay | undefined): CellValue =>
  d === undefined || !Number.isFinite(d) ? EMPTY : { kind: 'date', iso: toIso(d) };

/* ------------------------------------------------------------------ */
/* spec -> sheet                                                      */
/* ------------------------------------------------------------------ */

/**
 * `turn` is the placed chart's quarter-turn rotation, which decides which way
 * round the grid is laid out — see `datasheetSchemaFor`. Callers holding a bare
 * spec (a template, a test) can leave it out and get the upright answer.
 */
export function sheetFromSpec(spec: ChartSpec, turn = 0): SheetModel {
  const schema = datasheetSchemaFor(spec, turn);
  const series = datasheetSeriesFor(spec, turn);
  const columns = columnsFor(schema, series);
  const dateKey = schema.keyColumns[0]?.type === 'date';
  /** Does this kind's sheet carry a per-datum caption? See `sheetSchemaFor`. */
  const withNotes = schema.perSeries.some((c) => c.key === 'note');

  const keyCell = (label: string): CellValue => {
    if (!dateKey) return textCell(label);
    const parsed = parseGrain(label);
    // Keep the author's own wording ("FY25") rather than normalizing it to an
    // ISO date they never typed; the ISO form is derived where it's needed.
    return parsed ? { kind: 'text', text: label } : textCell(label);
  };

  const rows: CellValue[][] = [];
  const bandValues: Record<string, CellValue[]> = {};
  const rowMarks: (string | undefined)[] = [];
  const rowIndent: (number | undefined)[] = [];

  if (isGridSpec(spec) && schema.layout === 'seriesDown') {
    // Transposed: a row is a series, a column is a category. The category
    // labels aren't cells at all here — they're the column headers, carried by
    // `series` above.
    //
    // A combo's lines sink to the bottom and say so — see `comboDisplayOrder`.
    for (const s of comboOrdered(spec.data.series, spec)) {
      rows.push([
        textCell(s.name),
        ...spec.data.categories.flatMap((cat, ci) => [
          numCell(s.values[ci]),
          ...(withNotes ? [textCell(s.pointOverrides?.[cat.key]?.note ?? '')] : []),
        ]),
      ]);
      rowMarks.push(comboSeriesMark(spec, s.key));
    }
  } else if (isGridSpec(spec)) {
    for (const [ci, cat] of spec.data.categories.entries()) {
      rows.push([
        keyCell(cat.label),
        ...spec.data.series.flatMap((s) => [
          numCell(s.values[ci]),
          ...(withNotes ? [textCell(s.pointOverrides?.[cat.key]?.note ?? '')] : []),
        ]),
      ]);
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
  } else if (isGanttSpec(spec)) {
    // One row per task; its bars fill the repeated slot columns in order. The
    // slot INDEX is the item's index within its row, which is the contract
    // `specFromSheet` reuses keys through.
    const left = schema.keyColumns.slice(1);
    const right = schema.extraColumns;
    const authored = (rowKey: string, col: { key: string }): CellValue =>
      textCell(spec.cells?.[rowKey]?.[col.key.replace(/^desc\./, '')] ?? '');

    for (const row of spec.rows) {
      const items = spec.items.filter((i) => i.row === row.key);
      rows.push([
        textCell(row.label),
        ...left.map((c) => authored(row.key, c)),
        ...series.flatMap((_, i) => {
          const it = items[i];
          if (!it) return [EMPTY, EMPTY, EMPTY, EMPTY];
          return [
            { kind: 'enum' as const, value: it.shape.form },
            dayCell(it.from),
            // Shown INCLUSIVE, stored half-open — see `GanttItem.from`. A task
            // running to 1 Apr exclusive is one an author calls "ends 31 Mar",
            // and a sheet that says otherwise reads as an off-by-one bug.
            it.to === undefined ? EMPTY : dayCell(it.to - 1),
            textCell(it.label ?? ''),
          ];
        }),
        ...right.map((c) => authored(row.key, c)),
      ]);
      // The indent is attached to the task's NAME rather than being a column of
      // its own: it is a property of the row, and a column for it would be one
      // more thing to keep in step with the tree it describes.
      rowIndent.push(row.level || undefined);
    }
  }

  return {
    schema,
    columns,
    series,
    rows,
    bandValues,
    ...(rowMarks.some(Boolean) ? { rowMarks } : {}),
    ...(rowIndent.some((n) => n !== undefined) ? { rowIndent } : {}),
  };
}

/** A combo's series with its lines and areas last; anything else untouched. */
function comboOrdered<T>(series: T[], spec: ChartSpec): T[] {
  const order = comboDisplayOrder(spec);
  return order ? order.map((i) => series[i]!) : series;
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

  /** The caption cell at (row, column), or '' when the sheet has no such column. */
  const noteAt = (r: number, c: number): string =>
    c < 0 ? '' : cellText(rows[r]?.[c]).trim();

  const labelAt = (r: number, fallback: string): string => {
    const cell = rows[r]?.[0];
    const t = cellText(cell).trim();
    return t || fallback;
  };

  /* --- category grid, transposed: one row per series --- */
  if (isGridSpec(spec) && schema.layout === 'seriesDown') {
    // Category identity rides on the column group's key, so renaming a header
    // or dragging a column keeps every per-point override attached to it.
    spec.data.categories = sheet.series.map((s, i) => ({
      key: s.key,
      label: s.name.trim() || `Category ${i + 1}`,
    }));
    const liveKeys = spec.data.categories.map((c) => c.key);
    // One value column per category, addressed by key rather than by offset so
    // a reordered or deleted column can't shift values under their headers.
    const valueCols = sheet.series.map((s) =>
      colIndex((col) => col.seriesKey === s.key && col.field === 'value'),
    );
    const noteCols = sheet.series.map((s) =>
      colIndex((col) => col.seriesKey === s.key && col.field === 'note'),
    );

    // The rows arrive in the order the sheet showed them, which for a combo
    // sinks the lines below the columns — so the slot a row maps back onto is
    // that same order, and writing the series out in it settles the spec into
    // the order the sheet is already showing.
    const order = comboDisplayOrder(spec);
    const priorSeries = spec.data.series;

    spec.data.series = rows.map((_, r): GridSeries => {
      // Series identity is POSITIONAL here: a row carries no key, so a series
      // that moves takes its name and values with it while explicit formatting
      // stays with the slot — which is also how a palette assigns colour.
      const prior = priorSeries[order ? (order[r] ?? -1) : r];
      return {
        ...(prior ?? { key: `s-${nanoid(5)}`, name: '', values: [] }),
        key: prior?.key ?? `s-${nanoid(5)}`,
        name: labelAt(r, prior?.name || `Series ${r + 1}`),
        values: valueCols.map((c, ci) =>
          c < 0 ? null : readNumber(r, c, `${liveKeys[ci]}.value`),
        ),
        // A column here IS a category, so the caption cells for one series run
        // across its row.
        pointOverrides: withNotes(
          pruneOverrides(prior?.pointOverrides, liveKeys),
          noteCols.map((c, ci) => ({ key: liveKeys[ci]!, note: noteAt(r, c) })),
        ),
      };
    });
  } else if (isGridSpec(spec)) {
    const existing = spec.data.categories;
    spec.data.categories = rows.map((_, r) => ({
      // Reuse the key positionally so per-point overrides survive a rename.
      key: existing[r]?.key ?? `c-${nanoid(5)}`,
      label: labelAt(r, `Category ${r + 1}`),
    }));

    spec.data.series = sheet.series.map((s): GridSeries => {
      const prior = spec.data.series.find((x) => x.key === s.key);
      const c = colIndex((col) => col.seriesKey === s.key && col.field === 'value');
      const n = colIndex((col) => col.seriesKey === s.key && col.field === 'note');
      return {
        ...(prior ?? { key: s.key, name: s.name, values: [] }),
        key: s.key,
        name: s.name,
        values: rows.map((_, r) => (c < 0 ? null : readNumber(r, c, `${s.key}.value`))),
        pointOverrides: withNotes(
          pruneOverrides(prior?.pointOverrides, spec.data.categories.map((x) => x.key)),
          spec.data.categories.map((cat, r) => ({ key: cat.key, note: noteAt(r, n) })),
        ),
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
  } else if (isGanttSpec(spec)) {
    const priorRows = spec.rows;
    const priorItems = spec.items;
    const authored = [...schema.keyColumns.slice(1), ...schema.extraColumns];

    /** The day in this cell, or null with a diagnostic if it isn't one. */
    const readDay = (r: number, c: number, columnKey: string): EpochDay | null => {
      const cell = rows[r]?.[c];
      if (!cell || cell.kind === 'empty') return null;
      const iso = cell.kind === 'date' ? cell.iso : parseDay(cellText(cell));
      const day = iso ? fromIso(iso) : null;
      if (day === null) {
        diagnostics.push({
          severity: 'error',
          code: 'cell-not-a-date',
          message: `"${cellText(cell)}" isn't a date.`,
          cell: { r, c },
          column: columnKey,
        });
      }
      return day;
    };

    spec.rows = rows.map((_, r) => {
      const prior = priorRows[r];
      return {
        ...(prior ?? { key: `r-${nanoid(5)}`, label: '', level: 0 }),
        key: prior?.key ?? `r-${nanoid(5)}`,
        label: labelAt(r, `Task ${r + 1}`),
        // Indent is edited beside the name, not in a cell — the sheet carries
        // it back verbatim, and a level that jumps (0 straight to 2) is
        // clamped so the tree can always be walked.
        level: Math.max(0, Math.min(sheet.rowIndent?.[r] ?? prior?.level ?? 0, r === 0 ? 0 : 9)),
      };
    });

    const items: GanttItem[] = [];
    const cells: Record<string, Record<string, string>> = {};

    for (const [r, row] of spec.rows.entries()) {
      const was = priorItems.filter((i) => i.row === priorRows[r]?.key);

      for (const [si, s0] of sheet.series.entries()) {
        const fi = colIndex((col) => col.seriesKey === s0.key && col.field === 'form');
        const sti = colIndex((col) => col.seriesKey === s0.key && col.field === 'start');
        const eni = colIndex((col) => col.seriesKey === s0.key && col.field === 'end');
        const txi = colIndex((col) => col.seriesKey === s0.key && col.field === 'text');

        const formCell = rows[r]?.[fi];
        const rawForm = formCell && formCell.kind !== 'empty' ? cellText(formCell).trim() : '';
        const start = sti < 0 ? null : readDay(r, sti, `${s0.key}.start`);
        const endInclusive = eni < 0 ? null : readDay(r, eni, `${s0.key}.end`);
        const label = txi < 0 ? '' : cellText(rows[r]?.[txi]).trim();

        // An empty slot is NOT an item. A zero-width bar at the epoch is worse
        // than nothing: it draws, it can be selected, and it says nothing.
        if (!rawForm && start === null && endInclusive === null && !label) continue;

        const form = coerceForm(rawForm, r, fi, diagnostics);
        const prior = was[si];
        const from = start ?? prior?.from ?? spec.timescale.min ?? 0;

        let to: EpochDay | undefined;
        if (form === 'milestone') {
          // A milestone is a moment. An End typed against one is a real edit
          // that cannot be honoured, so it is reported rather than dropped in
          // silence — this file never drops input.
          if (endInclusive !== null) {
            diagnostics.push({
              severity: 'warning',
              code: 'milestone-has-end',
              message: `Row ${r + 1} is a milestone, so its End is ignored.`,
              cell: { r, c: eni },
            });
          }
        } else if (endInclusive !== null) {
          // Back to half-open, and never before the start: an inverted span
          // draws as a zero-width bar rather than a negative one.
          to = Math.max(from, endInclusive + 1);
          if (endInclusive + 1 < from) {
            diagnostics.push({
              severity: 'warning',
              code: 'end-before-start',
              message: `Row ${r + 1} ends before it starts.`,
              cell: { r, c: eni },
            });
          }
        } else {
          // A summary computes its span from its children; anything else with
          // no End is a day long, which is at least drawable.
          to = form === 'summary' ? undefined : from + 1;
        }

        items.push({
          ...(prior ?? {}),
          key: prior?.key ?? `g-${nanoid(5)}`,
          row: row.key,
          from,
          ...(to === undefined ? {} : { to }),
          shape: reshape(prior?.shape, form),
          ...(label ? { label } : {}),
        });
      }

      for (const col of authored) {
        const ci = colIndex((c) => c.key === col.key);
        const text = ci < 0 ? '' : cellText(rows[r]?.[ci]).trim();
        if (!text) continue;
        (cells[row.key] ??= {})[col.key.replace(/^desc\./, '')] = text;
      }
    }

    spec.items = items;
    spec.cells = cells;
  }

  return { spec, diagnostics };
}

/**
 * The item shape a Type cell names.
 *
 * Blank means a bar: a row with dates and no type typed is the ordinary case,
 * and demanding the word "bar" for it would be a form to fill in rather than a
 * schedule to write.
 */
function coerceForm(
  raw: string,
  r: number,
  c: number,
  diagnostics: SheetDiagnostic[],
): GanttItemForm {
  if (!raw) return 'bar';
  const hit = GANTT_ITEM_FORM_OPTIONS.find(
    (o) => o.value === raw.toLowerCase() || o.label.toLowerCase() === raw.toLowerCase(),
  );
  if (hit) return hit.value;
  diagnostics.push({
    severity: 'warning',
    code: 'unknown-item-type',
    message: `"${raw}" isn't a bar, chevron, milestone, summary or bracket.`,
    cell: { r, c },
  });
  return 'bar';
}

/**
 * Change an item's form while keeping the geometry that still applies.
 *
 * A chevron retyped to a bar and back should not lose its head length, and a
 * milestone retyped away and back should keep its marker — the datasheet edits
 * the FORM, and the rest of the shape is a formatting choice made elsewhere.
 */
function reshape(prior: GanttItemShape | undefined, form: GanttItemForm): GanttItemShape {
  if (prior?.form === form) return prior;
  switch (form) {
    case 'chevron':
      return { form };
    case 'milestone':
      return { form, marker: 'diamond' };
    case 'summary':
    case 'bracket':
      return { form };
    default:
      return { form: 'bar' };
  }
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
 * Fold the sheet's caption column back onto the series' per-point overrides.
 *
 * A blank cell DELETES the caption rather than storing an empty string, and an
 * override with nothing else left on it goes with it — otherwise clearing a
 * caption leaves the spec littered with entries that make an untouched point
 * indistinguishable from a hand-formatted one.
 */
function withNotes(
  overrides: GridSeries['pointOverrides'],
  notes: { key: string; note: string }[],
): GridSeries['pointOverrides'] {
  const next: Record<string, PointOverride> = { ...(overrides ?? {}) };
  for (const { key, note } of notes) {
    const prior = next[key];
    if (note) {
      next[key] = { ...prior, note };
    } else if (prior?.note !== undefined) {
      const rest = { ...prior };
      delete rest.note;
      if (Object.keys(rest).length) next[key] = rest;
      else delete next[key];
    }
  }
  return Object.keys(next).length ? next : undefined;
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
