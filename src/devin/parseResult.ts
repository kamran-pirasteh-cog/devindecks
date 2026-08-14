/**
 * Reading Devin's answer back into the datasheet.
 *
 * Same doctrine as `model/ingest.ts`: never throw, never drop a row, report
 * rather than repair. An agent's output is exactly the kind of input that will
 * be almost-right — a missing column, a stray fence, a number as a string —
 * and silently coercing it is how wrong figures end up on a slide with nobody
 * noticing.
 */
import {
  columnsFor,
  EMPTY,
  sheetSchemaFor,
  sheetSeriesFor,
  type CellValue,
  type ChartSpec,
  type SheetDiagnostic,
  type SheetModel,
} from '@/model';
import { parseClipboardTable } from '@/sheet/sheetClipboard';
import { coerceCell } from '@/sheet/sheetCoerce';
import { chartResultContract } from './contract';

export interface RowSource {
  url?: string;
  note?: string;
  confidence?: string;
}

export interface DevinResult {
  /** A sheet ready to preview and apply, or null when nothing parsed. */
  sheet: SheetModel | null;
  sources: RowSource[];
  notes?: string;
  unresolved: string[];
  diagnostics: SheetDiagnostic[];
}

export function parseDevinChartResult(text: string, spec: ChartSpec): DevinResult {
  const diagnostics: SheetDiagnostic[] = [];
  const schema = sheetSchemaFor(spec);
  const series = sheetSeriesFor(spec);
  const contract = chartResultContract(
    schema,
    series.map((s) => s.key),
  );

  const json = extractJson(text);
  const table = json
    ? rowsFromJson(json, contract.columns, contract.contractId, diagnostics)
    : rowsFromDelimited(text, contract.columns, diagnostics);

  if (!table) {
    diagnostics.push({
      severity: 'error',
      code: 'unreadable',
      message: "Couldn't read this as JSON or as CSV/TSV.",
    });
    return { sheet: null, sources: [], unresolved: [], diagnostics };
  }

  const columns = columnsFor(schema, series);
  const rows: CellValue[][] = table.rows.map((raw, r) =>
    columns.map((col, c) => {
      // Contract column names line up with display columns by position; the
      // key columns come first, then per-series, then extras.
      const name = contract.columns[c];
      const value = name === undefined ? undefined : raw[name];
      if (value === undefined) {
        if (col.required) {
          diagnostics.push({
            severity: 'error',
            code: 'missing-required-column',
            message: `Row ${r + 1} has no "${name ?? col.header}".`,
            cell: { r, c },
            column: col.key,
          });
        }
        return EMPTY;
      }
      if (value === null) {
        diagnostics.push({
          severity: 'warning',
          code: 'null-value',
          message: `Row ${r + 1}: "${col.header}" came back as not available.`,
          cell: { r, c },
        });
        return EMPTY;
      }
      const { value: cell } = coerceCell(String(value), col.type);
      if (cell.kind === 'invalid') {
        diagnostics.push({
          severity: 'error',
          code: 'value-not-a-number',
          message: `Row ${r + 1}: "${value}" isn't a valid ${col.type}.`,
          cell: { r, c },
          column: col.key,
        });
      }
      return cell;
    }),
  );

  for (const [i, s] of table.sources.entries()) {
    if (!s.url) {
      diagnostics.push({
        severity: 'warning',
        code: 'unsourced-row',
        message: `Row ${i + 1} has no source URL.`,
        cell: { r: i, c: 0 },
      });
    }
  }

  return {
    sheet: { schema, columns, series, rows, bandValues: {} },
    sources: table.sources,
    notes: table.notes,
    unresolved: table.unresolved,
    diagnostics,
  };
}

/* ------------------------------------------------------------------ */

interface ParsedTable {
  rows: Record<string, unknown>[];
  sources: RowSource[];
  notes?: string;
  unresolved: string[];
}

/** Accept raw JSON or JSON inside a fence — agents emit both. */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];
  for (const c of candidates) {
    const trimmed = c.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return Array.isArray(parsed) ? { rows: parsed } : (parsed as Record<string, unknown>);
      }
    } catch {
      // Fall through to the next candidate; a failed parse isn't an error yet.
    }
  }
  return null;
}

function rowsFromJson(
  json: Record<string, unknown>,
  columns: string[],
  contractId: string,
  diagnostics: SheetDiagnostic[],
): ParsedTable | null {
  if (json.contractId && json.contractId !== contractId) {
    // A mismatch usually means the chart changed after the prompt was copied.
    // Worth flagging loudly, but the data may still be usable.
    diagnostics.push({
      severity: 'warning',
      code: 'contract-mismatch',
      message: `This answer is for "${String(json.contractId)}" but the chart now expects "${contractId}". Check the columns before applying.`,
    });
  }

  const raw = json.rows;
  if (!Array.isArray(raw)) return null;

  const known = new Set([...columns, 'source_url', 'source_note', 'confidence']);
  const unknown = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  const sources: RowSource[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    for (const k of Object.keys(row)) if (!known.has(k)) unknown.add(k);
    rows.push(row);
    sources.push({
      url: typeof row.source_url === 'string' ? row.source_url : undefined,
      note: typeof row.source_note === 'string' ? row.source_note : undefined,
      confidence: typeof row.confidence === 'string' ? row.confidence : undefined,
    });
  }

  if (unknown.size) {
    diagnostics.push({
      severity: 'warning',
      code: 'unknown-column',
      message: `Ignored unexpected field${unknown.size > 1 ? 's' : ''}: ${[...unknown].join(', ')}.`,
    });
  }

  return {
    rows,
    sources,
    notes: typeof json.notes === 'string' ? json.notes : undefined,
    unresolved: Array.isArray(json.unresolved) ? json.unresolved.map(String) : [],
  };
}

/** The CSV fallback, through the same parser the clipboard uses. */
function rowsFromDelimited(
  text: string,
  columns: string[],
  diagnostics: SheetDiagnostic[],
): ParsedTable | null {
  const fenced = /```(?:csv|tsv)?\s*([\s\S]*?)```/.exec(text);
  const table = parseClipboardTable((fenced?.[1] ?? text).trim());
  if (table.length < 2) return null;

  const header = table[0].map((h) => h.trim());
  const missing = columns.filter((c) => !header.includes(c));
  if (missing.length) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-required-column',
      message: `The CSV header is missing: ${missing.join(', ')}.`,
    });
  }

  const rows: Record<string, unknown>[] = [];
  const sources: RowSource[] = [];
  for (const line of table.slice(1)) {
    if (line.every((v) => !v.trim())) continue;
    if (line.length !== header.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'row-length-mismatch',
        message: `A row has ${line.length} value(s) for ${header.length} columns.`,
      });
    }
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => (row[h] = line[i] ?? null));
    rows.push(row);
    sources.push({
      url: String(row.source_url ?? '') || undefined,
      note: String(row.source_note ?? '') || undefined,
      confidence: String(row.confidence ?? '') || undefined,
    });
  }

  return { rows, sources, unresolved: [] };
}
