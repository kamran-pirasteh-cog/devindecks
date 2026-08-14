'use client';

/**
 * The datasheet.
 *
 * A real spreadsheet, hand-rolled: type-ahead overwrite, ranges, ⌘-arrow jumps,
 * Excel/Sheets paste that grows the grid, fill, drag-reorder, and a local undo
 * ring. No library, because nothing in this repo brings one and a data grid is
 * mostly keyboard semantics anyway.
 *
 * Two decisions worth knowing:
 *
 * - **One `<input>` for the whole grid**, rendered into the active cell. An
 *   input per cell is what makes hand-rolled grids crawl at a few hundred
 *   cells, and it's also why the old modal couldn't do type-ahead overwrite.
 * - **Undo is local and stops propagation.** The editor's global ⌘Z would
 *   otherwise pop deck history at the same time, and one keystroke would undo
 *   two things.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cellText,
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
  moveRow,
  moveSeries,
  pasteTable,
  renameSeries,
  setCell,
} from './sheetOps';
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

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useRef<{ past: SheetModel[]; future: SheetModel[] }>({ past: [], future: [] });
  const mouseDown = useRef(false);

  const { rows, columns } = sheet;

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
      setSel((s) => reconcileSelection(next, s));
    },
    [sheet, onChange],
  );

  const undo = useCallback(() => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(sheet);
    onChange(prev, { transient: false });
    setSel((s) => reconcileSelection(prev, s));
  }, [sheet, onChange]);

  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(sheet);
    onChange(next, { transient: false });
    setSel((s) => reconcileSelection(next, s));
  }, [sheet, onChange]);

  /* ---- editing ---- */

  const beginEdit = useCallback(
    (addr: CellAddress, seed?: string) => {
      const col = columns[addr.c];
      if (!col || col.editable === false) return;
      setEditing({ addr, text: seed ?? editText(rows[addr.r]?.[addr.c] ?? { kind: 'empty' }) });
    },
    [columns, rows],
  );

  /**
   * Write the open cell back and close the editor.
   *
   * The side effects deliberately sit OUTSIDE any `setState` updater. React can
   * invoke an updater during a render pass, and committing to the store from
   * inside one updates the editor mid-render — which surfaces as "cannot update
   * a component while rendering a different component" and, worse, drops edits
   * non-deterministically under Strict Mode.
   */
  const commitEdit = useCallback(
    (then?: (s: SheetSelection) => SheetSelection) => {
      if (editing) {
        const col = columns[editing.addr.c];
        const { value, warning } = coerceCell(editing.text, col?.type ?? 'text');
        if (warning) setNotice(warning.message);
        apply(setCell(sheet, editing.addr.r, editing.addr.c, value));
      }
      setEditing(null);
      if (then) setSel((s) => then(s));
    },
    [apply, columns, editing, sheet],
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

  /* ---- keyboard ---- */

  const onKeyDown = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;

    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEditing(null);
        containerRef.current?.focus();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit((s) => advance(sheet, s, 'vertical', e.shiftKey));
        containerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit((s) => advance(sheet, s, 'horizontal', e.shiftKey));
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
      setSel((s) => move(sheet, s, dir, { extend: e.shiftKey, toEdge: meta }));
      return;
    }

    switch (e.key) {
      case 'Tab':
        // Must be prevented, or focus escapes the grid into the panel chrome.
        e.preventDefault();
        setSel((s) => advance(sheet, s, 'horizontal', e.shiftKey));
        return;
      case 'Enter':
        e.preventDefault();
        setSel((s) => advance(sheet, s, 'vertical', e.shiftKey));
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
    const result = pasteTable(sheet, sel.active, block, sel.range);
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

  return (
    <div className="flex min-h-0 flex-col">
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
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-8 border-b border-r border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800" />
              {columns.map((col, c) => (
                <HeaderCell
                  key={col.key}
                  col={col}
                  index={c}
                  ds={ds}
                  sheet={sheet}
                  dragging={drag?.kind === 'series' ? drag : null}
                  onSelect={() => setSel(selectColumn(sheet, c))}
                  onRename={(name) => apply(renameSeries(sheet, col.seriesKey!, name))}
                  onDelete={() => apply(deleteSeries(sheet, col.seriesKey!))}
                  onDragStart={(i) => setDrag({ kind: 'series', from: i, to: i })}
                  onDragOver={(i) => setDrag((d) => (d?.kind === 'series' ? { ...d, to: i } : d))}
                  onPickColor={onPickSeriesColor}
                />
              ))}
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
                {columns.slice(1).map((col, i) => (
                  <td
                    key={col.key}
                    className="border-b border-zinc-200 bg-amber-50/60 px-1.5 py-1 dark:border-zinc-700 dark:bg-amber-950/20"
                  >
                    {i === 0
                      ? sheet.bandValues[band.key]?.map((v) => cellText(v)).join(' · ')
                      : null}
                  </td>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={drag?.kind === 'row' && drag.to === r ? 'bg-indigo-50/60' : ''}>
                <th
                  onMouseDown={() => {
                    setSel(selectRow(sheet, r));
                    setDrag({ kind: 'row', from: r, to: r });
                  }}
                  onMouseEnter={() => setDrag((d) => (d?.kind === 'row' ? { ...d, to: r } : d))}
                  title="Drag to reorder"
                  className="w-8 cursor-grab select-none border-b border-r border-zinc-200 bg-zinc-50 text-center text-[10px] font-normal text-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                >
                  {r + 1}
                </th>
                {row.map((value, c) => {
                  const col = columns[c];
                  const isActive = sel.active.r === r && sel.active.c === c;
                  const selected = inRange(sel.range, { r, c });
                  const problem = problems.get(`${r}:${c}`);
                  const invalid = value.kind === 'invalid';
                  return (
                    <td
                      key={col?.key ?? c}
                      onMouseDown={(e) => onCellDown(r, c, e)}
                      onMouseEnter={() => onCellEnter(r, c)}
                      onDoubleClick={() => beginEdit({ r, c })}
                      title={problem?.message}
                      className={[
                        'relative border-b border-r border-zinc-100 px-1.5 py-1 dark:border-zinc-800',
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
                            // up with one entry per character.
                            if (onLiveEdit) {
                              const { value } = coerceCell(text, col?.type ?? 'text');
                              onLiveEdit(setCell(sheet, editing.addr.r, editing.addr.c, value));
                            }
                          }}
                          onBlur={() => commitEdit()}
                          className={`absolute inset-0 w-full bg-white px-1.5 outline-none dark:bg-zinc-900 ${
                            col?.type === 'number' ? 'text-right' : ''
                          }`}
                        />
                      ) : col?.type === 'enum' ? (
                        <select
                          value={cellText(value)}
                          onChange={(e) =>
                            apply(setCell(sheet, r, c, { kind: 'enum', value: e.target.value }))
                          }
                          className="w-full bg-transparent text-xs outline-none"
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: structural actions + diagnostics roll-up */}
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-2 py-1.5 text-[11px] dark:border-zinc-800">
        {sheet.schema.caps.addRows ? (
          <FooterButton onClick={() => apply(insertRow(sheet, rows.length))}>+ Row</FooterButton>
        ) : null}
        {sheet.schema.caps.addSeries ? (
          <FooterButton onClick={() => apply(addSeries(sheet))}>+ Series</FooterButton>
        ) : null}
        <FooterButton
          onClick={() => {
            const { r0, r1 } = rangeBounds(sel.range);
            apply(deleteRows(sheet, r0, r1));
          }}
        >
          Delete rows
        </FooterButton>

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

function HeaderCell({
  col,
  index,
  ds,
  sheet,
  dragging,
  onSelect,
  onRename,
  onDelete,
  onDragStart,
  onDragOver,
  onPickColor,
}: {
  col: SheetColumn;
  index: number;
  ds: DesignSystem;
  sheet: SheetModel;
  dragging: { from: number; to: number } | null;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragStart: (i: number) => void;
  onDragOver: (i: number) => void;
  onPickColor?: (seriesKey: string) => void;
}) {
  const series = col.seriesKey ? sheet.series.find((s) => s.key === col.seriesKey) : undefined;
  const seriesIndex = col.seriesIndex ?? -1;
  // Only the first column of a multi-field series carries the name and controls;
  // repeating "Accounts" above X, Y and Size is noise.
  const owns = series !== undefined && col.field === sheet.schema.perSeries[0]?.key;
  const canDelete = owns && sheet.series.length > 1;

  return (
    <th
      onMouseDown={onSelect}
      onMouseEnter={() => (dragging ? onDragOver(seriesIndex) : undefined)}
      className={`min-w-[5.5rem] border-b border-r border-zinc-200 bg-zinc-50 px-1.5 py-1 text-left font-medium dark:border-zinc-700 dark:bg-zinc-800 ${
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
      <span className="sr-only">{index}</span>
    </th>
  );
}
