/**
 * Chart spec -> datasheet schema.
 *
 * This is the single table that decides what columns a chart type shows. A
 * scatter gets X and Y, a bubble adds Size, a waterfall adds a Kind dropdown,
 * a Mekko gets a column-width band. Adding a chart type is one case here — the
 * grid component itself never changes.
 */
import { WATERFALL_ROLE_OPTIONS } from './chart/roles';
import { dataShapeOf } from './chart/shape';
import {
  isButterflySpec,
  isGridSpec,
  isSankeySpec,
  isWaterfallSpec,
  isXYSpec,
  type ChartSpec,
} from './chart/spec';
import type { SheetColumn, SheetSchema, SheetSeries } from './sheet';

const text = (key: string, header: string): SheetColumn => ({
  key,
  header,
  type: 'text',
  editable: true,
});

const num = (key: string, header: string, required = false): SheetColumn => ({
  key,
  header,
  type: 'number',
  editable: true,
  required,
});

export function sheetSchemaFor(spec: ChartSpec): SheetSchema {
  const shape = dataShapeOf(spec.kind);

  switch (shape.form) {
    case 'xy': {
      const perSeries: SheetColumn[] = [num('x', 'X', true), num('y', 'Y', true)];
      if (shape.fields.includes('size')) perSeries.push(num('size', 'Size'));
      return {
        id: spec.kind,
        keyColumns: [text('label', 'Point')],
        perSeries,
        extraColumns: [],
        bands: [],
        caps: { addRows: true, addSeries: true, reorderRows: true, reorderSeries: true },
      };
    }

    case 'waterfall':
      return {
        id: 'waterfall',
        keyColumns: [text('label', 'Label')],
        perSeries: [num('value', 'Value')],
        extraColumns: [
          {
            key: 'role',
            header: 'Kind',
            type: 'enum',
            options: WATERFALL_ROLE_OPTIONS,
            editable: true,
            required: true,
          },
        ],
        bands: [],
        // A waterfall is one ledger. A second series has nowhere to go.
        caps: { addRows: true, addSeries: false, reorderRows: true, reorderSeries: false, maxSeries: 1 },
      };

    case 'sankey':
      return {
        id: 'sankey',
        // Two key columns: a flow is identified by both of its ends.
        keyColumns: [text('from', 'From'), text('to', 'To')],
        perSeries: [num('value', 'Value')],
        extraColumns: [],
        bands: [],
        // Every flow is one row of one ledger; there are no series to add.
        caps: { addRows: true, addSeries: false, reorderRows: true, reorderSeries: false, maxSeries: 1 },
      };

    case 'butterfly':
      return {
        id: 'butterfly',
        keyColumns: [text('label', 'Category')],
        perSeries: [num('value', 'Value')],
        extraColumns: [],
        bands: [],
        caps: { addRows: true, addSeries: true, reorderRows: true, reorderSeries: true, maxSeries: 2 },
      };

    case 'grid':
    default: {
      const dated = isGridSpec(spec) && looksDated(spec.data.categories.map((c) => c.label));
      return {
        id: spec.kind === 'pie' || spec.kind === 'donut' ? 'pie' : 'grid',
        keyColumns: [
          dated
            ? { key: 'label', header: 'Date', type: 'date', editable: true }
            : text('label', 'Category'),
        ],
        perSeries: [num('value', shape.valueHeader)],
        extraColumns: [],
        bands:
          spec.kind === 'mekko'
            ? [
                {
                  key: 'width',
                  header: 'Column width',
                  type: 'number',
                  placement: 'top',
                },
              ]
            : [],
        caps: {
          addRows: true,
          addSeries: shape.seriesLimit !== 1,
          reorderRows: true,
          reorderSeries: true,
          maxSeries: shape.seriesLimit,
        },
      };
    }
  }
}

/**
 * Does this category axis look like dates? If so the key column becomes a date
 * column, which unlocks date-aware paste and — more usefully — lets the Devin
 * prompt state the reporting grain instead of guessing.
 */
export function looksDated(labels: string[]): boolean {
  if (labels.length < 2) return false;
  const dated = labels.filter((l) => parseGrain(l) !== null).length;
  return dated / labels.length >= 0.8;
}

export type DateGrain = 'year' | 'quarter' | 'month' | 'week' | 'day';

/**
 * Recognise the period a label denotes. Deliberately an explicit pattern list:
 * `new Date(string)` is browser-dependent and happily parses "Enterprise" on
 * some engines, which would silently turn a segment axis into a time axis.
 */
export function parseGrain(label: string): { grain: DateGrain; iso: string } | null {
  const s = label.trim();

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { grain: 'day', iso: s };

  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return { grain: 'month', iso: `${m[1]}-${m[2]}-01` };

  m = /^(?:FY|CY)?\s?(\d{4})$/i.exec(s);
  if (m) return { grain: 'year', iso: `${m[1]}-01-01` };

  m = /^(?:FY|CY)?\s?'?(\d{2})$/i.exec(s);
  if (m && /^(?:FY|CY)/i.test(s)) return { grain: 'year', iso: `20${m[1]}-01-01` };

  // Q3 2024 · Q3'24 · 2024 Q3
  m = /^Q([1-4])\s?'?(\d{2,4})$/i.exec(s) ?? null;
  if (m) return { grain: 'quarter', iso: quarterIso(Number(m[1]), m[2]) };
  m = /^(\d{4})\s?Q([1-4])$/i.exec(s);
  if (m) return { grain: 'quarter', iso: quarterIso(Number(m[2]), m[1]) };

  // Jan 2024 · Jan-24 · January 2024
  m = /^([A-Za-z]{3,9})[\s-]'?(\d{2,4})$/.exec(s);
  if (m) {
    const month = MONTHS.findIndex((n) => n.startsWith(m![1].slice(0, 3).toLowerCase()));
    if (month >= 0) {
      return { grain: 'month', iso: `${fullYear(m[2])}-${String(month + 1).padStart(2, '0')}-01` };
    }
  }

  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const fullYear = (y: string): string => (y.length === 2 ? `20${y}` : y);

const quarterIso = (q: number, year: string): string =>
  `${fullYear(year)}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;

/** The series a sheet shows for this spec, in display order. */
export function sheetSeriesFor(spec: ChartSpec): SheetSeries[] {
  if (isGridSpec(spec)) {
    return spec.data.series.map((s) => ({
      key: s.key,
      name: s.name,
      color: s.format?.fill?.kind === 'solid' ? s.format.fill.color : undefined,
    }));
  }
  if (isXYSpec(spec)) {
    return spec.data.series.map((s) => ({
      key: s.key,
      name: s.name,
      color: s.format?.fill?.kind === 'solid' ? s.format.fill.color : undefined,
    }));
  }
  if (isWaterfallSpec(spec) || isSankeySpec(spec)) return [{ key: 's0', name: 'Value' }];
  if (isButterflySpec(spec)) {
    return [...spec.left, ...spec.right].map((s) => ({ key: s.key, name: s.name }));
  }
  return [];
}
