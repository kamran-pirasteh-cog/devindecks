/**
 * Chart spec -> datasheet schema.
 *
 * This is the single table that decides what columns a chart type shows. A
 * scatter gets X and Y, a bubble adds Size, a waterfall adds a Kind dropdown,
 * a Mekko gets a column-width band. Adding a chart type is one case here — the
 * grid component itself never changes.
 *
 * Two schemas come out of it. `sheetSchemaFor` is the CANONICAL one — one
 * record per row — and it is what the Devin contract is generated from.
 * `datasheetSchemaFor` is what the editor's grid renders, and for a category
 * grid that is the canonical schema transposed; see `transposesInDatasheet`.
 */
import { GANTT_ITEM_FORM_OPTIONS, WATERFALL_ROLE_OPTIONS } from './chart/roles';
import { dataShapeOf } from './chart/shape';
import {
  isButterflySpec,
  isGridSpec,
  isHorizontal,
  isSankeySpec,
  isWaterfallSpec,
  isGanttSpec,
  isXYSpec,
  type ChartSpec,
  type GanttGrain,
} from './chart/spec';
import { supportsOrientation, supportsTurn } from './chart/orientation';
import { comboDisplayOrder, comboSeriesMark } from './chart/combo';
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
        layout: 'recordsDown',
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
        layout: 'recordsDown',
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
        layout: 'recordsDown',
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
        layout: 'recordsDown',
        keyColumns: [text('label', 'Category')],
        perSeries: [num('value', 'Value')],
        extraColumns: [],
        bands: [],
        caps: { addRows: true, addSeries: true, reorderRows: true, reorderSeries: true, maxSeries: 2 },
      };

    /**
     * A schedule: one sheet row per TASK, and each of its bars is a "series".
     *
     * The alternative — one row per bar, joined by a Task column — loses on
     * four counts. Description cells belong to the task, so they would repeat
     * per bar with two of the three copies necessarily read-only, and the grid
     * gates editing per COLUMN. `moveRow` would stop meaning "reorder the
     * plan", because dragging a task would mean dragging N adjacent rows
     * atomically. Indent is a task property, repeated in three places that must
     * agree. And task identity would have to be matched by label, which is fine
     * for a Sankey node (a node IS its name) and wrong for a plan, where two
     * phases called "Build" are legitimate.
     *
     * Repeating the item slot through `perSeries` costs no new grid concepts:
     * `columnsFor`, `addSeries`/`moveSeries` and `gridExtent`'s phantom columns
     * already do all of it.
     *
     * Only `text` columns appear here. A derived column (Start / End /
     * Duration) is computed from the bars, and printing it beside the Start and
     * End cells it was computed from is the same fact twice, one copy of which
     * cannot be typed into.
     */
    case 'gantt': {
      const authored = isGanttSpec(spec) ? spec.columns.filter((c) => c.source === 'text') : [];
      const describe = (side: 'left' | 'right'): SheetColumn[] =>
        authored
          .filter((c) => c.side === side)
          .sort((a, b) => a.order - b.order)
          .map((c) => ({
            key: `desc.${c.key}`,
            header: c.header,
            type: 'text' as const,
            editable: true,
            renamable: true,
            removable: true,
          }));

      return {
        id: 'gantt',
        layout: 'recordsDown',
        keyColumns: [
          { key: 'label', header: 'Task', type: 'text', editable: true, required: true },
          ...describe('left'),
        ],
        perSeries: [
          {
            key: 'form',
            header: 'Type',
            type: 'enum',
            options: GANTT_ITEM_FORM_OPTIONS,
            editable: true,
          },
          { key: 'start', header: 'Start', type: 'date', dateGrain: 'day', editable: true },
          { key: 'end', header: 'End', type: 'date', dateGrain: 'day', editable: true },
          { key: 'text', header: 'Label', type: 'text', editable: true },
        ],
        extraColumns: describe('right'),
        bands: [],
        caps: {
          addRows: true,
          addSeries: true,
          reorderRows: true,
          reorderSeries: true,
          // Six bars on one row is already a busy row; past that the plan wants
          // another task, not another slot.
          maxSeries: 6,
          minRows: 1,
        },
      };
    }

    case 'grid':
    default: {
      const dated = isGridSpec(spec) && looksDated(spec.data.categories.map((c) => c.label));
      return {
        id: spec.kind === 'pie' || spec.kind === 'donut' ? 'pie' : 'grid',
        layout: 'recordsDown',
        keyColumns: [
          dated
            ? { key: 'label', header: 'Date', type: 'date', editable: true }
            : text('label', 'Category'),
        ],
        perSeries: [
          num('value', shape.valueHeader),
          // A dot plot's markers are a sequence — "was, is, target" — and the
          // question the reader asks of every one of them is "as of when". The
          // caption belongs next to the number it dates, so it is a column
          // beside it rather than a field in a properties panel. Other kinds
          // don't draw captions yet, so they don't offer the column.
          ...(spec.kind === 'dotplot' ? [text('note', 'Note')] : []),
        ],
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

/**
 * One vocabulary for calendar units, shared with the Gantt timescale — see
 * `GanttGrain`. `parseGrain` never returns `'half'`; no label pattern denotes
 * one, and a timescale band is the only thing that asks for it.
 */
export type DateGrain = GanttGrain;

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

/**
 * Recognise a single DAY, for a column that stores one.
 *
 * `parseGrain` answers "what period does this label denote", which is a
 * different question: it is asked of a category axis, where the author's
 * wording ("FY25") is the label and must survive. This is asked of a Gantt's
 * Start and End cells, where the answer has to be an actual date or the bar
 * cannot be placed.
 *
 * Same doctrine, and for the same reason stated on `parseGrain`: an explicit
 * pattern list, never `new Date(string)`. A period label is accepted and
 * promoted to its FIRST day, so typing "Q3 2026" into a Start cell means what
 * anyone would expect.
 */
export function parseDay(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoDay(Number(m[1]), Number(m[2]), Number(m[3]));

  // 14/3/2026 and 3/14/26 are the same six characters in two countries, so the
  // ambiguity is broken the only way that is not a guess: a value over 12 must
  // be the day, and otherwise US order wins, matching the pinned en-US locale.
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const year = Number(fullYear(m[3]));
    return a > 12 ? isoDay(year, b, a) : isoDay(year, a, b);
  }

  // 14 Mar 2026 · 14 March 26
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-]'?(\d{2,4})$/.exec(s);
  if (m) {
    const mo = monthIndex(m[2]);
    if (mo >= 0) return isoDay(Number(fullYear(m[3])), mo + 1, Number(m[1]));
  }

  // Mar 14, 2026 · March 14 2026
  m = /^([A-Za-z]{3,9})[\s-](\d{1,2}),?[\s-]'?(\d{2,4})$/.exec(s);
  if (m) {
    const mo = monthIndex(m[1]);
    if (mo >= 0) return isoDay(Number(fullYear(m[3])), mo + 1, Number(m[2]));
  }

  // A period is a legitimate thing to type into a date cell; take its first day.
  return parseGrain(s)?.iso ?? null;
}

const monthIndex = (name: string): number =>
  MONTHS.findIndex((n) => n === name.slice(0, 3).toLowerCase());

/** Null rather than a rolled-over date: 31 February is a typo, not 3 March. */
const isoDay = (y: number, m: number, d: number): string | null =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : null;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const fullYear = (y: string): string => (y.length === 2 ? `20${y}` : y);

const quarterIso = (q: number, year: string): string =>
  `${fullYear(year)}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;

/* ------------------------------------------------------------------ */
/* The DATASHEET's schema — the canonical one, turned on its side       */
/* ------------------------------------------------------------------ */

/**
 * Which way do the CATEGORIES run in the picture?
 *
 * Two things decide it and they compose. Orientation is the first: a column
 * chart runs its categories across the bottom, a bar chart runs them down the
 * side. A quarter TURN of the whole chart is the second, and it swaps the
 * answer — a column chart turned 90° reads exactly like a bar chart.
 *
 * The turn only counts for a kind that can actually be turned — the compiler
 * ignores the rotation on the rest — and only where the categories run along
 * an AXIS. A pie can be turned, but turning it spins the wheel rather than
 * standing the categories on end, so its sheet stays as it was.
 */
export function categoriesRunDown(spec: ChartSpec, turn = 0): boolean {
  const turnable = supportsTurn(spec.kind) && supportsOrientation(spec.kind);
  const quarter = turnable ? ((((Math.round(turn / 90) * 90) % 360) + 360) % 360) : 0;
  const sideways = quarter === 90 || quarter === 270;
  // XOR: either one turns the categories on their side, both put them back.
  return isHorizontal(spec) !== sideways;
}

/**
 * Is this chart edited with its categories running ACROSS the sheet?
 *
 * Only the category grid, and only where nothing else in the sheet is indexed
 * by row. A Mekko's column-width band is one value per category and lives in a
 * row band, so transposing it would put the band at right angles to the thing
 * it sizes; it keeps the classic layout until the band can follow.
 *
 * And only while the categories really do run across the PICTURE. The whole
 * reason to transpose is that the sheet should read the way the chart reads;
 * on a bar chart, or on anything turned onto its side, that argument runs the
 * other way and the canonical one-row-per-category layout is the matching one.
 */
export function transposesInDatasheet(spec: ChartSpec, turn = 0): boolean {
  return (
    dataShapeOf(spec.kind).form === 'grid' &&
    spec.kind !== 'mekko' &&
    !categoriesRunDown(spec, turn)
  );
}

/**
 * The schema the datasheet renders, which is NOT always the schema Devin's
 * contract is generated from.
 *
 * A category grid is edited transposed — one row per series, one column per
 * category — because the category axis is nearly always time, and a reader who
 * sees FY23 → FY25 running left to right in the chart should not have to read
 * it top to bottom in the sheet directly beneath it. The research contract is
 * unaffected: an agent still returns one record per period, which is the shape
 * a source table comes in.
 *
 * That argument is about the DIRECTION the categories run, not about the chart
 * kind, so `turn` — the chart's quarter-turn rotation — belongs here: turning
 * the chart onto its side turns the sheet with it. Defaults to upright, for
 * the callers that hold a bare spec and no placed chart.
 */
export function datasheetSchemaFor(spec: ChartSpec, turn = 0): SheetSchema {
  const canonical = sheetSchemaFor(spec);
  if (!transposesInDatasheet(spec, turn)) return canonical;

  const shape = dataShapeOf(spec.kind);
  const single = shape.form === 'grid' && shape.seriesLimit === 1;

  return {
    ...canonical,
    layout: 'seriesDown',
    // The row key is now the series name; the category labels have moved up
    // into the column headers, where they are edited as headers.
    keyColumns: [text('series', 'Series')],
    perSeries: [
      num('value', shape.form === 'grid' ? shape.valueHeader : 'Value'),
      // The per-datum caption survives the transpose: a cell here is still one
      // (series, category) datum, so turning the chart onto its side must not
      // take the column away from the notes it is the only editor for.
      ...(canonical.perSeries.some((c) => c.key === 'note') ? [text('note', 'Note')] : []),
    ],
    extraColumns: [],
    bands: [],
    caps: {
      // Rows are series and columns are categories, so every cap swaps sides.
      addRows: !single,
      maxRows: shape.form === 'grid' ? shape.seriesLimit : undefined,
      reorderRows: !single,
      addSeries: true,
      reorderSeries: true,
      maxSeries: undefined,
      minRows: 1,
    },
  };
}

/**
 * The column groups the datasheet shows — categories when transposed.
 *
 * Untransposed, a combo's series ARE the columns, so the same rule the rows get
 * applies sideways: the lines sit past the columns and carry a badge saying so.
 */
export function datasheetSeriesFor(spec: ChartSpec, turn = 0): SheetSeries[] {
  if (transposesInDatasheet(spec, turn) && isGridSpec(spec)) {
    return spec.data.categories.map((c) => ({ key: c.key, name: c.label }));
  }
  const series = sheetSeriesFor(spec);
  const order = comboDisplayOrder(spec);
  return (order ? order.map((i) => series[i]!) : series).map((s) => {
    const badge = comboSeriesMark(spec, s.key);
    return badge ? { ...s, badge } : s;
  });
}

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
  if (isGanttSpec(spec)) {
    // One slot per bar on the busiest row, and at least one so a fresh chart
    // has somewhere to type. The slot INDEX is the item's index within its
    // row — see `specFromSheet`, which reuses keys positionally through it.
    const widest = spec.rows.reduce(
      (n, r) => Math.max(n, spec.items.filter((i) => i.row === r.key).length),
      0,
    );
    return Array.from({ length: Math.max(1, widest) }, (_, i) => ({
      key: `i${i}`,
      name: `Bar ${i + 1}`,
    }));
  }
  if (isButterflySpec(spec)) {
    return [...spec.left, ...spec.right].map((s) => ({ key: s.key, name: s.name }));
  }
  return [];
}
