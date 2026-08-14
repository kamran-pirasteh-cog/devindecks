'use client';

/**
 * The datasheet.
 *
 * A real spreadsheet, hand-rolled: type-ahead overwrite, ranges, ⌘-arrow jumps,
 * Excel/Sheets paste that grows the grid, fill, drag-reorder, resizable columns,
 * right-click row and column edits, and a local undo ring. No library, because
 * nothing in this repo brings one and a data grid is mostly keyboard semantics
 * anyway.
 *
 * Four decisions worth knowing:
 *
 * - **One `<input>` for the whole grid**, rendered into the active cell. An
 *   input per cell is what makes hand-rolled grids crawl at a few hundred
 *   cells, and it's also why the old modal couldn't do type-ahead overwrite.
 * - **Undo is local and stops propagation.** The editor's global ⌘Z would
 *   otherwise pop deck history at the same time, and one keystroke would undo
 *   two things.
 * - **The grid renders past the data.** Blank rows and columns are selectable
 *   and typeable and become real on the first keystroke — see `gridExtent`.
 *   Nobody should have to find a button to add a row.
 * - **Column widths are view state.** Columns are derived from the schema and
 *   the series list, so a width stored on the model would be rebuilt away by
 *   the next rename; here it's keyed by column key in local state instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cellText,
  EMPTY,
  inRange,
  rangeBounds,
  resolveColor,
  type CellAddress,
  type DesignSystem,
  type SheetColumn,
  type SheetDiagnostic,
  type SheetModel,
} from '@/model';
import { editText, formatCell, coerceCell } from './sheetCoerce';
import { parseClipboardTable, serializeTable } from './sheetClipboard';
import {
  addSeries,
  clearRange,
  deleteRows,
  deleteSeries,
  fillRange,
  insertRow,
  insertSeries,
  moveRow,
  moveSeries,
  pasteTable,
  renameSeries,
  setCell,
} from './sheetOps';
import {
  columnAt,
  gridExtent,
  isPhantom,
  materialize,
  seriesIndexAt,
  type GridExtent,
} from './gridExtent';
import {
  advance,
  move,
  reconcileSelection,
  selectColumn,
  selectRow,
  singleCell,
  type SheetSelection,
} from './selection';

export interface SheetGridProps {
  sheet: SheetModel;
  ds: DesignSystem;
  /**
   * `transient` means "the user is mid-gesture" — the caller should update the
   * live preview but not push a history entry, exactly like a canvas drag.
   */
  onChange: (next: SheetModel, opts: { transient: boolean }) => void;
  /**
   * Every keystroke inside the cell editor, before it's committed. This is what
   * makes the chart move as you type rather than only when you press Enter —
   * the caller debounces it into a transient update.
   */
  onLiveEdit?: (next: SheetModel) => void;
  diagnostics?: SheetDiagnostic[];
  onPickSeriesColor?: (seriesKey: string) => void;
}

const HISTORY_LIMIT = 50;

const GUTTER_W = 34;
/**
 * Narrow by default, and widened per column by dragging. Labels and numbers in a
 * chart's datasheet are short — "FY24", "1,240" — so a wide default just means
 * fewer columns on screen and more scrolling.
 */
const DEFAULT_TEXT_W = 124;
const DEFAULT_NUMBER_W = 80;
/** Blank columns are narrower still: they hold nothing yet. */
const SPACER_W = 72;
const MIN_COL_W = 56;
/**
 * One row height for every row, data or blank, set explicitly rather than left
 * to the content. A `<select>` in a Kind cell is taller than a line of text, so
 * intrinsic heights make the filled rows visibly taller than the blank ones and
 * the grid stops reading as a grid.
 */
const ROW_H = 26;

/** Phantom columns have no model key, so they need one for the width map. */
const widthKey = (sheet: SheetModel, extent: GridExtent, c: number): string =>
  c < extent.realCols ? (sheet.columns[c]?.key ?? `c${c}`) : `phantom:${c - extent.realCols}`;

/**
 * A right-click. `row` and `column` come from the gutter and the headers and
 * offer only that axis; `cell` comes from the grid body and offers both, like
 * Excel's cell menu.
 */
interface Menu {
  kind: 'row' | 'column' | 'cell';
  r: number;
  c: number;
  x: number;
  y: number;
}

export function SheetGrid({
  sheet,
  ds,
  onChange,
  onLiveEdit,
  diagnostics = [],
  onPickSeriesColor,
}: SheetGridProps) {
  const [sel, setSel] = useState<SheetSelection>(() => singleCell({ r: 0, c: 0 }));
  const [editing, setEditing] = useState<{ addr: CellAddress; text: string } | null>(null);
  const [drag, setDrag] = useState<{ kind: 'row' | 'series'; from: number; to: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<Menu | null>(null);
  /** Set by the column menu's Rename, cleared once the header input takes it. */
  const [renaming, setRenaming] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useRef<{ past: SheetModel[]; future: SheetModel[] }>({ past: [], future: [] });
  const mouseDown = useRef(false);
  const editorOpen = useRef(false);
  const resizing = useRef<{ key: string; from: number; width: number } | null>(null);

  const { rows, columns } = sheet;

  /**
   * The grid pads its blank area out to whatever the panel is showing, so
   * resizing the panel yields more spreadsheet rather than more dead space.
   */
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setViewport((v) =>
        Math.abs(v.w - width) < 1 && Math.abs(v.h - height) < 1
          ? v
          : { w: width, h: height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Threaded into every `reconcileSelection` below as well as the render: a
  // commit that reconciled against the model's own size would yank a selection
  // out of the blank area and back onto the data.
  // Two rows' worth of slack: one for the sticky header the rows sit under, one
  // so a fractional viewport height doesn't put a scrollbar on a grid that has
  // nothing below the fold.
  const minRows = viewport.h ? Math.floor(viewport.h / ROW_H) - 2 : undefined;
  const extent = useMemo(() => gridExtent(sheet, { minRows }), [sheet, minRows]);

  const colWidth = useCallback(
    (c: number): number => {
      const stored = widths[widthKey(sheet, extent, c)];
      if (stored !== undefined) return stored;
      if (c >= extent.realCols) return SPACER_W;
      const col = columnAt(sheet, extent, c);
      return col?.widthPx ?? (col?.type === 'number' ? DEFAULT_NUMBER_W : DEFAULT_TEXT_W);
    },
    [extent, sheet, widths],
  );

  /**
   * Inert columns past the last phantom one, purely so the ruled plane reaches
   * the right edge. They can't be typed into — on a chart that takes no more
   * series there is nothing they could become — so they're decoration, and
   * counted here rather than in `gridExtent` for exactly that reason.
   */
  const fillers = useMemo(() => {
    if (!viewport.w) return 0;
    let used = GUTTER_W;
    for (let c = 0; c < extent.cols; c++) used += colWidth(c);
    // Floor, not ceil: one more than fits would push the grid into a horizontal
    // scrollbar over nothing. The trailing auto column absorbs the remainder,
    // which reads as a part-column at the edge exactly like Excel's.
    return Math.max(0, Math.floor((viewport.w - used) / SPACER_W));
  }, [colWidth, extent.cols, viewport.w]);

  /* ---- committing changes ---- */

  const apply = useCallback(
    (next: SheetModel, opts: { transient?: boolean; historic?: boolean } = {}) => {
      if (next === sheet) return;
      if (opts.historic !== false) {
        history.current.past.push(sheet);
        if (history.current.past.length > HISTORY_LIMIT) history.current.past.shift();
        history.current.future = [];
      }
      onChange(next, { transient: opts.transient ?? false });
      setSel((s) => reconcileSelection(next, s, gridExtent(next, { minRows })));
    },
    [minRows, sheet, onChange],
  );

  const undo = useCallback(() => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(sheet);
    onChange(prev, { transient: false });
    setSel((s) => reconcileSelection(prev, s, gridExtent(prev, { minRows })));
  }, [minRows, sheet, onChange]);

  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(sheet);
    onChange(next, { transient: false });
    setSel((s) => reconcileSelection(next, s, gridExtent(next, { minRows })));
  }, [minRows, sheet, onChange]);

  /* ---- editing ---- */

  const beginEdit = useCallback(
    (addr: CellAddress, seed?: string) => {
      const col = columnAt(sheet, extent, addr.c);
      if (!col || col.editable === false) return;
      const current = isPhantom(extent, addr) ? EMPTY : (rows[addr.r]?.[addr.c] ?? EMPTY);
      editorOpen.current = true;
      setEditing({ addr, text: seed ?? editText(current) });
    },
    [extent, rows, sheet],
  );

  const cancelEdit = useCallback(() => {
    editorOpen.current = false;
    setEditing(null);
  }, []);

  /**
   * Write the open cell back and close the editor.
   *
   * The side effects deliberately sit OUTSIDE any `setState` updater. React can
   * invoke an updater during a render pass, and committing to the store from
   * inside one updates the editor mid-render — which surfaces as "cannot update
   * a component while rendering a different component" and, worse, drops edits
   * non-deterministically under Strict Mode.
   *
   * `editorOpen` is a synchronous mirror of `editing`, because Enter both
   * commits and moves focus back to the grid — which fires the input's blur and
   * calls this a second time, with a `setEditing(null)` that React hasn't
   * applied yet. Writing twice was harmless; moving the cursor twice is not.
   */
  const commitEdit = useCallback(
    (then?: (s: SheetSelection) => SheetSelection) => {
      const open = editorOpen.current;
      editorOpen.current = false;
      if (editing && open) {
        const col = columnAt(sheet, extent, editing.addr.c);
        const { value, warning } = coerceCell(editing.text, col?.type ?? 'text');
        if (warning) setNotice(warning.message);

        // Tabbing through blank cells must not litter the sheet with rows and
        // series nobody asked for: only content makes a phantom cell real.
        const blankPhantom = value.kind === 'empty' && isPhantom(extent, editing.addr);
        if (!blankPhantom) {
          const grown = materialize(sheet, editing.addr);
          apply(setCell(grown.sheet, grown.addr.r, grown.addr.c, value));
          // Growing appends one row and one column rather than filling the gap
          // that was clicked in, so the cell just typed into is often above or
          // left of where the cursor was. Follow it.
          if (grown.addr.r !== editing.addr.r || grown.addr.c !== editing.addr.c) {
            setSel(singleCell(grown.addr));
          }
        }
      }
      setEditing(null);
      if (then) setSel((s) => then(s));
    },
    [apply, editing, extent, sheet],
  );

  /**
   * Focus the editor as soon as it appears, so the keystroke that opened it
   * lands inside rather than being swallowed by the container.
   *
   * Keyed off the CELL, not the text: re-running on every keystroke would reset
   * the caret to the end mid-word. The ref records which cell has already been
   * focused so the effect can depend on `editing` honestly and still fire once.
   */
  const focusedCell = useRef<string | null>(null);
  useEffect(() => {
    const key = editing ? `${editing.addr.r}:${editing.addr.c}` : null;
    if (!editing || !inputRef.current || focusedCell.current === key) {
      if (!editing) focusedCell.current = null;
      return;
    }
    focusedCell.current = key;
    inputRef.current.focus();
    inputRef.current.setSelectionRange(editing.text.length, editing.text.length);
  }, [editing]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /* ---- structural edits, shared by the menus and the footer ---- */

  const structure = useMemo(
    () => ({
      insertRowAt: (at: number) => apply(insertRow(sheet, Math.min(at, rows.length))),
      deleteRowRange: () => {
        const { r0, r1 } = rangeBounds(sel.range);
        if (r0 >= rows.length) return;
        apply(deleteRows(sheet, r0, Math.min(r1, rows.length - 1)));
      },
      insertColumnAt: (seriesIndex: number) => apply(insertSeries(sheet, seriesIndex)),
      deleteColumn: (seriesKey: string) => apply(deleteSeries(sheet, seriesKey)),
      clearColumn: (c: number) =>
        apply(
          clearRange(sheet, {
            anchor: { r: 0, c },
            focus: { r: Math.max(0, rows.length - 1), c },
          }),
        ),
      clearRow: (r: number) =>
        apply(
          clearRange(sheet, {
            anchor: { r, c: 0 },
            focus: { r, c: Math.max(0, columns.length - 1) },
          }),
        ),
    }),
    [apply, columns.length, rows.length, sel.range, sheet],
  );

  /* ---- keyboard ---- */

  const onKeyDown = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;

    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
        containerRef.current?.focus();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit((s) => advance(sheet, s, 'vertical', e.shiftKey, extent));
        containerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit((s) => advance(sheet, s, 'horizontal', e.shiftKey, extent));
        containerRef.current?.focus();
        return;
      }
      return;
    }

    // Local undo, and NOT the deck's — see the file header.
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo();
      else undo();
      return;
    }

    const dir =
      e.key === 'ArrowUp'
        ? 'up'
        : e.key === 'ArrowDown'
          ? 'down'
          : e.key === 'ArrowLeft'
            ? 'left'
            : e.key === 'ArrowRight'
              ? 'right'
              : null;

    if (dir) {
      e.preventDefault();
      setSel((s) => move(sheet, s, dir, { extend: e.shiftKey, toEdge: meta, extent }));
      return;
    }

    switch (e.key) {
      case 'Tab':
        // Must be prevented, or focus escapes the grid into the panel chrome.
        e.preventDefault();
        setSel((s) => advance(sheet, s, 'horizontal', e.shiftKey, extent));
        return;
      case 'Enter':
        e.preventDefault();
        setSel((s) => advance(sheet, s, 'vertical', e.shiftKey, extent));
        return;
      case 'F2':
        e.preventDefault();
        beginEdit(sel.active);
        return;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        apply(clearRange(sheet, sel.range));
        return;
      case 'Home':
        e.preventDefault();
        setSel(singleCell({ r: meta ? 0 : sel.active.r, c: 0 }));
        return;
      case 'End':
        e.preventDefault();
        setSel(
          singleCell({
            r: meta ? rows.length - 1 : sel.active.r,
            c: columns.length - 1,
          }),
        );
        return;
    }

    if (meta && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      apply(fillRange(sheet, sel.range, 'down'));
      return;
    }
    if (meta && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      apply(fillRange(sheet, sel.range, 'right'));
      return;
    }

    // Excel's row and column insert. Shift is part of both on a US layout
    // (⌘+ is ⌘⇧=), so the key is compared rather than the modifier.
    if (meta && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      structure.insertRowAt(sel.active.r);
      return;
    }

    // Type-ahead overwrite: a printable key replaces the cell and opens the
    // editor seeded with that character. The single highest-value behaviour
    // for making a grid feel real.
    if (!meta && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      beginEdit(sel.active, e.key);
    }
  };

  /* ---- clipboard ---- */

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    const { r0, r1, c0, c1 } = rangeBounds(sel.range);
    const block: string[][] = [];
    for (let r = r0; r <= r1; r++) {
      const line: string[] = [];
      for (let c = c0; c <= c1; c++) line.push(cellText(rows[r]?.[c]));
      block.push(line);
    }
    const { text, html } = serializeTable(block);
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', html);
  };

  const onCut = (e: React.ClipboardEvent) => {
    if (editing) return;
    onCopy(e);
    apply(clearRange(sheet, sel.range));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    const block = parseClipboardTable(e.clipboardData.getData('text/plain'));
    if (!block.length) return;
    // Pasting into the blank area is how a table gets appended to a sheet, so
    // the anchor has to exist before `pasteTable` addresses it.
    const anchored = materialize(sheet, sel.active);
    const result = pasteTable(anchored.sheet, anchored.addr, block, sel.range);
    apply(result.sheet);
    const messages = [
      result.usedHeaderRow ? 'Used the first pasted row as series names.' : null,
      result.grewRows ? `Added ${result.grewRows} row${result.grewRows > 1 ? 's' : ''}.` : null,
      ...result.warnings.map((w) => w.message),
    ].filter(Boolean);
    if (messages.length) setNotice(messages.join(' '));
  };

  /* ---- pointer ---- */

  const onCellDown = (r: number, c: number, e: React.MouseEvent) => {
    if (e.button === 2) return; // right-click opens a menu; it must not clear the block
    if (editing) commitEdit();
    mouseDown.current = true;
    setSel((s) =>
      e.shiftKey ? { active: s.active, range: { anchor: s.range.anchor, focus: { r, c } } } : singleCell({ r, c }),
    );
    containerRef.current?.focus();
  };

  const onCellEnter = (r: number, c: number) => {
    if (!mouseDown.current) return;
    setSel((s) => ({ active: s.active, range: { anchor: s.range.anchor, focus: { r, c } } }));
  };

  useEffect(() => {
    const up = () => {
      mouseDown.current = false;
      setDrag((d) => {
        if (!d) return null;
        if (d.from !== d.to) {
          apply(d.kind === 'row' ? moveRow(sheet, d.from, d.to) : moveSeries(sheet, d.from, d.to));
        }
        return null;
      });
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [apply, sheet]);

  /* ---- column resize ---- */

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = resizing.current;
      if (!g) return;
      const next = Math.max(MIN_COL_W, g.width + (e.clientX - g.from));
      setWidths((w) => (w[g.key] === next ? w : { ...w, [g.key]: next }));
    };
    const onUp = () => {
      resizing.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const startResize = (c: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key: widthKey(sheet, extent, c), from: e.clientX, width: colWidth(c) };
  };

  /* ---- context menu ---- */

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const openMenu = (kind: Menu['kind'], r: number, c: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind, r, c, x: e.clientX, y: e.clientY });
  };

  /* ---- diagnostics by cell ---- */

  const problems = useMemo(() => {
    const map = new Map<string, SheetDiagnostic>();
    for (const d of diagnostics) {
      if (d.cell) map.set(`${d.cell.r}:${d.cell.c}`, d);
    }
    return map;
  }, [diagnostics]);

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;

  /* ---- render ---- */

  const bandTop = sheet.schema.bands.filter((b) => b.placement === 'top');
  const allCols = Array.from({ length: extent.cols }, (_, c) => c);
  const fillerCols = Array.from({ length: fillers }, (_, i) => i);
  const canAddSeries =
    sheet.schema.caps.addSeries &&
    (sheet.schema.caps.maxSeries === undefined || sheet.series.length < sheet.schema.caps.maxSeries);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={containerRef}
        role="grid"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
          <colgroup>
            <col style={{ width: GUTTER_W }} />
            {allCols.map((c) => (
              <col key={c} style={{ width: colWidth(c) }} />
            ))}
            {fillerCols.map((i) => (
              <col key={`filler-${i}`} style={{ width: SPACER_W }} />
            ))}
            {/* Absorbs the last sliver so the columns keep the size they were
                dragged to instead of being stretched to fill. */}
            <col />
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr>
              <th className="border-b border-r border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800" />
              {allCols.map((c) =>
                c < extent.realCols ? (
                  <HeaderCell
                    key={columns[c]!.key}
                    col={columns[c]!}
                    ds={ds}
                    sheet={sheet}
                    dragging={drag?.kind === 'series' ? drag : null}
                    renaming={renaming === columns[c]!.key}
                    onRenamed={() => setRenaming(null)}
                    onSelect={() => setSel(selectColumn(sheet, c, extent))}
                    onContextMenu={openMenu('column', 0, c)}
                    onRename={(name) => apply(renameSeries(sheet, columns[c]!.seriesKey!, name))}
                    onDelete={() => apply(deleteSeries(sheet, columns[c]!.seriesKey!))}
                    onDragStart={(i) => setDrag({ kind: 'series', from: i, to: i })}
                    onDragOver={(i) => setDrag((d) => (d?.kind === 'series' ? { ...d, to: i } : d))}
                    onPickColor={onPickSeriesColor}
                    onResize={startResize(c)}
                  />
                ) : (
                  <PhantomHeaderCell
                    key={`phantom-${c}`}
                    label={
                      extent.perSeries > 1
                        ? (sheet.schema.perSeries[(c - extent.realCols) % extent.perSeries]?.header ??
                          '')
                        : ''
                    }
                    first={c === extent.realCols}
                    onSelect={() => setSel(selectColumn(sheet, c, extent))}
                    onContextMenu={openMenu('column', 0, c)}
                    onAdd={() => apply(addSeries(sheet))}
                    onResize={startResize(c)}
                  />
                ),
              )}
              {fillerCols.map((i) => (
                <th
                  key={`filler-${i}`}
                  className="border-b border-r border-zinc-200 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-800/50"
                />
              ))}
              <th className="border-b border-zinc-200 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-800/50" />
            </tr>
            {bandTop.map((band) => (
              <tr key={band.key}>
                <th className="border-b border-r border-zinc-200 bg-zinc-50 text-[9px] font-normal text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800">
                  ∑
                </th>
                <td
                  className="border-b border-zinc-200 bg-amber-50/60 px-1.5 py-1 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-amber-950/20"
                  title="Column widths are proportional to these values."
                >
                  {band.header}
                </td>
                {allCols.slice(1).map((c) => (
                  <td
                    key={c}
                    className="border-b border-zinc-200 bg-amber-50/60 px-1.5 py-1 dark:border-zinc-700 dark:bg-amber-950/20"
                  >
                    {c === 1
                      ? sheet.bandValues[band.key]?.map((v) => cellText(v)).join(' · ')
                      : null}
                  </td>
                ))}
                {fillerCols.map((i) => (
                  <td
                    key={`filler-${i}`}
                    className="border-b border-r border-zinc-200 bg-amber-50/60 dark:border-zinc-700 dark:bg-amber-950/20"
                  />
                ))}
                <td className="border-b border-zinc-200 bg-amber-50/60 dark:border-zinc-700 dark:bg-amber-950/20" />
              </tr>
            ))}
          </thead>

          <tbody>
            {Array.from({ length: extent.rows }, (_, r) => {
              const real = r < extent.realRows;
              return (
                <tr
                  key={r}
                  style={{ height: ROW_H }}
                  className={drag?.kind === 'row' && drag.to === r ? 'bg-indigo-50/60' : ''}
                >
                  <th
                    onMouseDown={(e) => {
                      if (e.button === 2) return;
                      setSel(selectRow(sheet, r, extent));
                      if (real) setDrag({ kind: 'row', from: r, to: r });
                    }}
                    onMouseEnter={() => setDrag((d) => (d?.kind === 'row' && real ? { ...d, to: r } : d))}
                    onContextMenu={openMenu('row', r, 0)}
                    title={real ? 'Drag to reorder · right-click for row actions' : undefined}
                    className={`select-none border-b border-r border-zinc-200 bg-zinc-50 text-center align-middle text-[10px] font-normal dark:border-zinc-700 dark:bg-zinc-800 ${
                      real
                        ? 'cursor-grab text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                        : 'text-zinc-300 dark:text-zinc-600'
                    }`}
                  >
                    {r + 1}
                  </th>

                  {allCols.map((c) => {
                    const col = columnAt(sheet, extent, c);
                    const value = rows[r]?.[c] ?? EMPTY;
                    const isActive = sel.active.r === r && sel.active.c === c;
                    const selected = inRange(sel.range, { r, c });
                    const problem = problems.get(`${r}:${c}`);
                    const invalid = value.kind === 'invalid';
                    const blank = !real || c >= extent.realCols;
                    return (
                      <td
                        key={c}
                        onMouseDown={(e) => onCellDown(r, c, e)}
                        onMouseEnter={() => onCellEnter(r, c)}
                        onDoubleClick={() => beginEdit({ r, c })}
                        onContextMenu={openMenu('cell', r, c)}
                        title={problem?.message}
                        className={[
                          // No vertical padding: the row height is fixed, so
                          // padding would just let a tall cell fight it.
                          'relative border-b border-r border-zinc-100 px-1.5 align-middle dark:border-zinc-800',
                          col?.type === 'number' ? 'text-right tabular-nums' : 'text-left',
                          selected ? 'bg-indigo-50 dark:bg-indigo-950/40' : '',
                          isActive ? 'outline outline-2 -outline-offset-2 outline-indigo-500' : '',
                          invalid || problem?.severity === 'error' ? 'text-red-600' : '',
                        ].join(' ')}
                      >
                        {isActive && editing ? (
                          <input
                            ref={inputRef}
                            value={editing.text}
                            onChange={(e) => {
                              const text = e.target.value;
                              setEditing({ addr: editing.addr, text });
                              // Feed the live preview without committing, so the
                              // chart moves as you type but history doesn't fill
                              // up with one entry per character. Skipped in the
                              // blank area: there's no cell to preview into
                              // until the edit is committed.
                              if (onLiveEdit && !isPhantom(extent, editing.addr)) {
                                const { value: v } = coerceCell(text, col?.type ?? 'text');
                                onLiveEdit(setCell(sheet, editing.addr.r, editing.addr.c, v));
                              }
                            }}
                            onBlur={() => commitEdit()}
                            className={`absolute inset-0 w-full bg-white px-1.5 outline-none dark:bg-zinc-900 ${
                              col?.type === 'number' ? 'text-right' : ''
                            }`}
                          />
                        ) : blank ? null : col?.type === 'enum' ? (
                          <select
                            value={cellText(value)}
                            onChange={(e) =>
                              apply(setCell(sheet, r, c, { kind: 'enum', value: e.target.value }))
                            }
                            className="h-5 w-full bg-transparent py-0 text-xs leading-none outline-none"
                          >
                            {col.options?.map((o) => (
                              <option key={o.value} value={o.value} title={o.hint}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="block truncate">{formatCell(value, col?.format)}</span>
                        )}
                        {(problem || invalid) && !isActive ? (
                          <span
                            className={`pointer-events-none absolute right-0 top-0 border-l-[5px] border-t-[5px] border-l-transparent ${
                              problem?.severity === 'warning'
                                ? 'border-t-amber-400'
                                : 'border-t-red-500'
                            }`}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                  {fillerCols.map((i) => (
                    <td
                      key={`filler-${i}`}
                      className="border-b border-r border-zinc-100 dark:border-zinc-800"
                    />
                  ))}
                  <td className="border-b border-zinc-100 dark:border-zinc-800" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: structural actions + diagnostics roll-up */}
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-2 py-1.5 text-[11px] dark:border-zinc-800">
        {sheet.schema.caps.addRows ? (
          <FooterButton onClick={() => structure.insertRowAt(rows.length)}>+ Row</FooterButton>
        ) : null}
        {canAddSeries ? (
          <FooterButton onClick={() => apply(addSeries(sheet))}>+ Column</FooterButton>
        ) : null}
        <FooterButton onClick={structure.deleteRowRange}>Delete rows</FooterButton>

        <span className="text-zinc-300 dark:text-zinc-600">
          Right-click a header or row number for more
        </span>

        <div className="ml-auto flex items-center gap-2 text-zinc-400">
          {errorCount || warnCount ? (
            <span className={errorCount ? 'text-red-600' : 'text-amber-600'}>
              {errorCount ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : ''}
              {errorCount && warnCount ? ' · ' : ''}
              {warnCount ? `${warnCount} warning${warnCount > 1 ? 's' : ''}` : ''}
            </span>
          ) : null}
          {notice ? <span className="max-w-[26rem] truncate text-zinc-500">{notice}</span> : null}
        </div>
      </div>

      {menu ? (
        <ContextMenu
          menu={menu}
          sheet={sheet}
          extent={extent}
          onClose={() => setMenu(null)}
          onInsertRow={structure.insertRowAt}
          onDeleteRow={(r) => apply(deleteRows(sheet, r))}
          onClearRow={structure.clearRow}
          onInsertColumn={structure.insertColumnAt}
          onDeleteColumn={structure.deleteColumn}
          onClearColumn={structure.clearColumn}
          onRenameColumn={(key) => setRenaming(key)}
          onAutoWidth={(c) =>
            setWidths((w) => {
              const next = { ...w };
              delete next[widthKey(sheet, extent, c)];
              return next;
            })
          }
        />
      ) : null}
    </div>
  );
}

function FooterButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-zinc-200 px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Headers                                                            */
/* ------------------------------------------------------------------ */

function ResizeHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <span
      onPointerDown={onPointerDown}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title="Drag to resize"
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-400/60"
    />
  );
}

function HeaderCell({
  col,
  ds,
  sheet,
  dragging,
  renaming,
  onRenamed,
  onSelect,
  onContextMenu,
  onRename,
  onDelete,
  onDragStart,
  onDragOver,
  onPickColor,
  onResize,
}: {
  col: SheetColumn;
  ds: DesignSystem;
  sheet: SheetModel;
  dragging: { from: number; to: number } | null;
  renaming: boolean;
  onRenamed: () => void;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragStart: (i: number) => void;
  onDragOver: (i: number) => void;
  onPickColor?: (seriesKey: string) => void;
  onResize: (e: React.PointerEvent) => void;
}) {
  const series = col.seriesKey ? sheet.series.find((s) => s.key === col.seriesKey) : undefined;
  const seriesIndex = col.seriesIndex ?? -1;
  // Only the first column of a multi-field series carries the name and controls;
  // repeating "Accounts" above X, Y and Size is noise.
  const owns = series !== undefined && col.field === sheet.schema.perSeries[0]?.key;
  const canDelete = owns && sheet.series.length > 1;

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!renaming || !nameRef.current) return;
    nameRef.current.focus();
    nameRef.current.select();
    onRenamed();
  }, [renaming, onRenamed]);

  return (
    <th
      onMouseDown={(e) => (e.button === 2 ? undefined : onSelect())}
      onMouseEnter={() => (dragging ? onDragOver(seriesIndex) : undefined)}
      onContextMenu={onContextMenu}
      className={`relative border-b border-r border-zinc-200 bg-zinc-50 px-1.5 py-1 text-left font-medium dark:border-zinc-700 dark:bg-zinc-800 ${
        dragging && dragging.to === seriesIndex && seriesIndex >= 0 ? 'bg-indigo-100 dark:bg-indigo-950' : ''
      }`}
    >
      <div className="flex items-center gap-1">
        {owns && sheet.schema.caps.reorderSeries ? (
          <span
            onMouseDown={(e) => {
              e.stopPropagation();
              onDragStart(seriesIndex);
            }}
            title="Drag to reorder series"
            className="cursor-grab select-none text-[9px] text-zinc-300 hover:text-zinc-500"
          >
            ⠿
          </span>
        ) : null}

        {owns && onPickColor ? (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onPickColor(series!.key)}
            title="Series color"
            className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
            style={{ background: series?.color ? resolveColor(series.color, ds) : 'transparent' }}
          />
        ) : null}

        {owns ? (
          <input
            ref={nameRef}
            value={series!.name}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => onRename(e.target.value)}
            className="w-full min-w-0 bg-transparent text-xs font-medium outline-none"
          />
        ) : (
          <span className="truncate text-[11px] text-zinc-500">{col.header}</span>
        )}

        {canDelete ? (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onDelete}
            title="Remove series"
            className="shrink-0 text-zinc-300 hover:text-red-500"
          >
            ×
          </button>
        ) : null}
      </div>
      {col.required ? <span className="sr-only">required</span> : null}
      <ResizeHandle onPointerDown={onResize} />
    </th>
  );
}

/**
 * A header over blank space. It shows nothing but a hover affordance — the
 * column beneath it exists as soon as something is typed into it, and the "+"
 * is only there for people who look for a button before they try typing.
 */
function PhantomHeaderCell({
  label,
  first,
  onSelect,
  onContextMenu,
  onAdd,
  onResize,
}: {
  label: string;
  first: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onAdd: () => void;
  onResize: (e: React.PointerEvent) => void;
}) {
  return (
    <th
      onMouseDown={(e) => (e.button === 2 ? undefined : onSelect())}
      onContextMenu={onContextMenu}
      className="group relative border-b border-r border-zinc-200 bg-zinc-50/60 px-1.5 py-1 text-left font-normal dark:border-zinc-700 dark:bg-zinc-800/50"
    >
      <div className="flex items-center gap-1 text-[11px] text-zinc-300 dark:text-zinc-600">
        <span className="truncate">{label}</span>
        {first ? (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onAdd}
            title="Add a column"
            className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 hover:text-indigo-500"
          >
            +
          </button>
        ) : null}
      </div>
      <ResizeHandle onPointerDown={onResize} />
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* Context menu                                                       */
/* ------------------------------------------------------------------ */

function ContextMenu({
  menu,
  sheet,
  extent,
  onClose,
  onInsertRow,
  onDeleteRow,
  onClearRow,
  onInsertColumn,
  onDeleteColumn,
  onClearColumn,
  onRenameColumn,
  onAutoWidth,
}: {
  menu: Menu;
  sheet: SheetModel;
  extent: GridExtent;
  onClose: () => void;
  onInsertRow: (at: number) => void;
  onDeleteRow: (r: number) => void;
  onClearRow: (r: number) => void;
  onInsertColumn: (seriesIndex: number) => void;
  onDeleteColumn: (seriesKey: string) => void;
  onClearColumn: (c: number) => void;
  onRenameColumn: (columnKey: string) => void;
  onAutoWidth: (c: number) => void;
}) {
  const { caps } = sheet.schema;
  const items: { label: string; run: () => void; danger?: boolean }[] = [];

  const { r, c } = menu;
  const wantsRows = menu.kind !== 'column';
  const wantsCols = menu.kind !== 'row';

  if (wantsRows) {
    const realRow = r < extent.realRows;
    if (caps.addRows) {
      // From the blank area both inserts mean "append": there is no row there
      // to be above or below.
      items.push({ label: 'Insert row above', run: () => onInsertRow(realRow ? r : extent.realRows) });
      items.push({
        label: 'Insert row below',
        run: () => onInsertRow(realRow ? r + 1 : extent.realRows),
      });
    }
    if (realRow && sheet.rows.length > (caps.minRows ?? 1)) {
      items.push({ label: 'Delete row', run: () => onDeleteRow(r), danger: true });
    }
  }

  if (wantsCols) {
    const col = c < extent.realCols ? sheet.columns[c] : undefined;
    const seriesIndex = seriesIndexAt(sheet, extent, c);
    const room = caps.maxSeries === undefined || sheet.series.length < caps.maxSeries;

    if (caps.addSeries && room && seriesIndex >= 0) {
      items.push({ label: 'Insert column left', run: () => onInsertColumn(seriesIndex) });
      items.push({ label: 'Insert column right', run: () => onInsertColumn(seriesIndex + 1) });
    }
    if (col?.seriesKey) {
      items.push({ label: 'Rename column', run: () => onRenameColumn(col.key) });
    }
    if (col && sheet.series.length > 1 && col.seriesKey) {
      items.push({
        label: 'Delete column',
        run: () => onDeleteColumn(col.seriesKey!),
        danger: true,
      });
    }
    if (col) items.push({ label: 'Reset width', run: () => onAutoWidth(c) });
  }

  if (menu.kind === 'row' && r < extent.realRows) {
    items.push({ label: 'Clear row', run: () => onClearRow(r) });
  }
  if (menu.kind === 'column' && c < extent.realCols) {
    items.push({ label: 'Clear column', run: () => onClearColumn(c) });
  }

  if (!items.length) return null;

  return (
    <div
      // Kept inside the grid rather than portalled: the datasheet panel is
      // already an overlay, and a portal to `body` would sit under it.
      className="fixed z-50 min-w-[10rem] overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-[11px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      style={{
        left: Math.min(menu.x, window.innerWidth - 180),
        top: Math.min(menu.y, window.innerHeight - items.length * 26 - 16),
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.run();
            onClose();
          }}
          className={`block w-full px-3 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            item.danger ? 'text-red-600' : 'text-zinc-700 dark:text-zinc-200'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
