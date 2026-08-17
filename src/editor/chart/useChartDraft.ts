'use client';

/**
 * The bridge between the datasheet and the store.
 *
 * The sheet is derived from the spec, so there's no second copy of the data to
 * keep in sync — an edit goes sheet -> spec -> store -> recompile -> back down.
 * The only local state is the debounce timer for live typing.
 *
 * Cadence, which is the whole point of this hook:
 *
 * - Keystrokes inside a cell fire `live`, debounced, as TRANSIENT patches. The
 *   chart animates; history stays clean.
 * - A committed edit (Enter, Tab, blur, paste, add row) is one non-transient
 *   patch, so one undo reverts one cell — what people expect.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  sheetFromSpec,
  specFromSheet,
  type ChartInstance,
  type SheetDiagnostic,
  type SheetModel,
} from '@/model';
import { useEditor } from '@/store/editorStore';

/** Long enough to coalesce fast typing, short enough to feel immediate. */
const LIVE_DEBOUNCE_MS = 120;

export interface ChartDraft {
  sheet: SheetModel;
  diagnostics: SheetDiagnostic[];
  /** A committed change: one history entry. */
  commit: (next: SheetModel) => void;
  /** A mid-keystroke change: preview only. */
  live: (next: SheetModel) => void;
}

export function useChartDraft(chart: ChartInstance): ChartDraft {
  const patchChart = useEditor((s) => s.patchChart);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<SheetModel | null>(null);

  // The grid follows the chart's rotation: turning the chart onto its side
  // turns the sheet with it, so the two read the same way round.
  const sheet = useMemo(
    () => sheetFromSpec(chart.spec, chart.rotation ?? 0),
    [chart.spec, chart.rotation],
  );

  const diagnostics = useMemo(
    () => specFromSheet(sheet, chart.spec).diagnostics,
    [sheet, chart.spec],
  );

  const write = useCallback(
    (next: SheetModel, transient: boolean) => {
      const { spec } = specFromSheet(next, chart.spec);
      patchChart(
        chart.id,
        (draft) => {
          // Replace the whole spec: the adapter has already merged the sheet's
          // data onto the existing styling, so this can't lose formatting.
          Object.assign(draft, spec);
        },
        transient,
      );
    },
    [chart.id, chart.spec, patchChart],
  );

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
  }, []);

  const commit = useCallback(
    (next: SheetModel) => {
      flush();
      write(next, false);
    },
    [flush, write],
  );

  const live = useCallback(
    (next: SheetModel) => {
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (pending.current) write(pending.current, true);
      }, LIVE_DEBOUNCE_MS);
    },
    [write],
  );

  // A pending preview must never outlive the panel: it would land on whatever
  // chart is selected next.
  useEffect(() => flush, [flush]);

  return { sheet, diagnostics, commit, live };
}
