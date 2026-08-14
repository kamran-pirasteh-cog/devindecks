/**
 * The return contract Devin is asked to fill in.
 *
 * Generated from the SAME `SheetSchema` the datasheet renders, which is why
 * "the answer pastes straight back into the grid" is a structural property
 * rather than a convention someone has to remember to maintain. Change the
 * grid's columns and the contract changes with them, in the same commit.
 */
import type { SheetSchema } from '@/model';

export interface ChartResultContract {
  /** Echoed back by Devin and checked on paste. */
  contractId: string;
  columns: string[];
  /** JSON Schema draft-07, ready to embed in the prompt. */
  jsonSchema: Record<string, unknown>;
  /** Fallback for when JSON is awkward — same columns, same order. */
  csvHeader: string[];
  /** One filled row, so the shape is unambiguous. Also self-validated in tests. */
  example: Record<string, unknown>;
}

/** Provenance columns every row carries, whatever the chart type. */
const SOURCE_COLUMNS = ['source_url', 'source_note', 'confidence'] as const;

export const CONFIDENCE_VALUES = ['reported', 'derived', 'estimated'] as const;

export function chartResultContract(schema: SheetSchema, seriesKeys: string[]): ChartResultContract {
  const dataColumns: { name: string; type: 'string' | 'number'; enum?: string[]; required: boolean }[] =
    [];

  for (const col of schema.keyColumns) {
    dataColumns.push({ name: col.key, type: 'string', required: true });
  }

  // One block of columns per series, named after the series so a human reading
  // the JSON can tell which is which.
  for (const key of seriesKeys) {
    for (const col of schema.perSeries) {
      dataColumns.push({
        name: seriesKeys.length === 1 && schema.perSeries.length === 1 ? col.key : `${key}_${col.key}`,
        type: 'number',
        required: col.required ?? false,
      });
    }
  }

  for (const col of schema.extraColumns) {
    dataColumns.push({
      name: col.key,
      type: col.type === 'number' ? 'number' : 'string',
      enum: col.options?.map((o) => o.value),
      required: col.required ?? false,
    });
  }

  const properties: Record<string, unknown> = {};
  for (const c of dataColumns) {
    properties[c.name] = c.enum
      ? { enum: c.enum }
      : // Every value is nullable on purpose: "not available" has to be
        // expressible, or the only way to answer is to invent a number.
        { type: [c.type, 'null'] };
  }
  properties.source_url = { type: ['string', 'null'] };
  properties.source_note = { type: ['string', 'null'] };
  properties.confidence = { enum: [...CONFIDENCE_VALUES] };

  const columns = dataColumns.map((c) => c.name);

  return {
    contractId: `${schema.id}@1`,
    columns,
    csvHeader: [...columns, ...SOURCE_COLUMNS],
    jsonSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['contractId', 'rows'],
      properties: {
        contractId: { const: `${schema.id}@1` },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            required: dataColumns.filter((c) => c.required).map((c) => c.name),
            properties,
            additionalProperties: false,
          },
        },
        notes: { type: 'string' },
        unresolved: { type: 'array', items: { type: 'string' } },
      },
    },
    example: exampleRow(schema, dataColumns),
  };
}

function exampleRow(
  schema: SheetSchema,
  dataColumns: { name: string; type: 'string' | 'number'; enum?: string[] }[],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const c of dataColumns) {
    row[c.name] = c.enum ? c.enum[0] : c.type === 'number' ? 1240 : 'FY25';
  }
  row.source_url = 'https://investors.example.com/annual-report-2025.pdf';
  row.source_note = 'Total revenue, page 42';
  row.confidence = 'reported';
  return {
    contractId: `${schema.id}@1`,
    rows: [row],
    notes: 'Anything the figures need caveating with.',
    unresolved: [],
  };
}
