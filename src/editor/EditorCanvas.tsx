'use client';

/**
 * The editing canvas. Renders the active slide's elements as positioned DOM
 * nodes (reusing <ElementVisual> so the canvas === preview === export) and
 * layers selection/transform interaction on top:
 *
 *  - Selecto: marquee multi-select with FULL-ENCLOSURE semantics (hitRate 100,
 *    selectFromInside=false) — PowerPoint behavior, not Google's intersection.
 *  - Moveable: drag / resize / rotate for the current selection, with snapping
 *    to sibling elements, slide edges and center.
 *
 * All geometry changes are converted from px back into EMU and written through
 * the store's command actions, so undo/redo and the model stay authoritative.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { ElementVisual, PageNumber, slideBackgroundHex } from '@/render/SlideView';
import {
  isShape,
  isText,
  marginGuides,
  outerGroupId,
  pxToEmu,
  resolveColor,
  selectionUnit,
  textInsetBox,
  unionRect,
  type Rect,
  isGridSpec,
  elementIdFor,
  legendSeriesKey,
  supportsTurn,
  type ChartInstance,
  showsPageNumbers,
} from '@/model';
import { useEditor } from '@/store/editorStore';
import { legendBoxAt } from '@/store/chartActions';
import { SelectionFormatBar } from './SelectionFormatBar';
import { ArrangeBar } from './ArrangeBar';
import { TextEditor } from './TextEditor';
import { CropOverlay } from './CropOverlay';
import { CanvasContextMenu, contextMenuItems, type MenuItem } from './CanvasContextMenu';
import { ChartDatasheetPanel } from './chart/ChartDatasheetPanel';
import { ChartPartPopover } from './chart/ChartPartPopover';
import { shiftClickParts, toggleClickParts } from './chart/partSelect';
import { hitTestChart } from './chart/previewHitTest';
import {
  ChartPartHighlights,
  LegendDropZones,
  nearestLegendSide,
  type LegendSide,
} from './chart/ChartPartOverlay';
import { CommentPins } from './CommentPins';
import { makeTitle } from './factories';
import { inRect, titleBandPx, titleElement, titleSlotAction } from './titleSlot';
import { MOVEABLE_Z, OVERLAY_Z } from './layers';
import { measureTextFitPx } from './fitToText';
import { resizeFactor } from './groupResize';
import { layoutFrame, turnRect, snapQuarterTurn } from '@/chart/turn';

const CANVAS_PAD = 48;

/**
 * How far off a chart part still counts as on it — see `refineChartHit`. Matches
 * the slop the preview clicks with, and the minimum box the hover ring is drawn
 * at (`ChartPartHighlights`), so what lights up is what a click would take.
 */
const CHART_HIT_SLOP_PX = 6;

/**
 * Editor chrome that floats over the slide — the format/arrange bars, the
 * comment pins and the crop handles. A press on any of it acts ON the
 * selection, so it must never change it, and must never be read as the start of
 * a marquee.
 */
const CHROME_SELECTOR =
  '.dd-format-bar, .dd-comment-pin, .dd-crop-overlay, .dd-context-menu, .dd-add-title';

/** Rotations are stored 0–359, so 1° and 361° are the same stored value. */
const normalizeDeg = (d: number) => ((Math.round(d) % 360) + 360) % 360;

/**
 * The eighth-turns a free rotate is magnetic to. Anything upright, on its side
 * or on a clean diagonal is almost always what the author meant, so the handle
 * catches near those angles — but only near them, so 37° is still reachable.
 */
const SNAP_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315, 360];

/**
 * Client coordinates of whatever event drove a gesture.
 *
 * Duck-typed rather than `instanceof MouseEvent`: Moveable hands back whatever
 * Gesto captured — a mouse event, a touch event, or its own synthetic object —
 * and an `instanceof` check quietly answers "no pointer" for two of the three.
 */
const pointerPos = (ev: unknown): { x: number; y: number } | null => {
  const e = ev as { clientX?: number; clientY?: number } | null | undefined;
  return typeof e?.clientX === 'number' && typeof e.clientY === 'number'
    ? { x: e.clientX, y: e.clientY }
    : null;
};

/**
 * What a mousedown on an already-selected object means once the mouse comes
 * back up without having dragged: 'only' collapses a multi-selection to the
 * object (its group, if it has one), 'toggle' is the shift-click case, and
 * 'member' reaches INTO a selected group to pick out the one object clicked.
 */
type DeferredSelect = 'toggle' | 'only' | 'member';

export function EditorCanvas() {
  const deck = useEditor((s) => s.deck);
  const ds = useEditor((s) => s.designSystem);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const editingId = useEditor((s) => s.editingId);
  const croppingId = useEditor((s) => s.croppingId);
  const showGuides = useEditor((s) => s.showGuides);
  const pendingFitId = useEditor((s) => s.pendingFitId);

  const slide = deck.slides.find((s) => s.id === currentSlideId) ?? deck.slides[0];

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const selectoRef = useRef<Selecto>(null);
  const nodeMap = useRef<Map<string, HTMLElement>>(new Map());
  // Bumped to re-render after `nodeMap` gains a node the current render needed
  // but couldn't see — see the layout effect below.
  const [, setNodeTick] = useState(0);

  const [width, setWidth] = useState(900);
  // Selecto reads dragContainer once, when it is constructed, so the marquee
  // root has to be a real node on the render that mounts it — not a ref.
  const [dragRoot, setDragRoot] = useState<HTMLElement | null>(null);
  // Per-element boxes painted during a resize, keyed by element id. A single
  // resize writes one entry; a group resize writes one per selected element,
  // since dragging one group handle rescales all of them together.
  const [liveResize, setLiveResize] = useState<Record<
    string,
    { x: number; y: number; w: number; h: number }
  > | null>(null);
  // The latest frame of a group resize, kept as a ref so onResizeGroupEnd can
  // commit exactly what was painted without depending on child lastEvents.
  const groupResizeRef = useRef<{ id: string; rect: Rect }[]>([]);
  // Each member's box as it was when the group resize began, in canvas px.
  // Every frame is computed from these rather than from the previous frame, so
  // scaling stays exact instead of accumulating rounding drift.
  const groupResizeStartRef = useRef<
    { id: string; x: number; y: number; w: number; h: number }[]
  >([]);
  /**
   * Where the pointer grabbed the handle, in client px.
   *
   * The fallback for an axis Moveable declines to measure: a group holding a
   * chart comes back 0 tall and with a height delta of 0 every frame, so
   * without this the vertical half of the gesture is simply dead. The pointer
   * is the one thing that is always true about a drag.
   */
  const groupResizeGrabRef = useRef<{ x: number; y: number } | null>(null);
  // PowerPoint-style resize modifiers: Shift keeps aspect ratio (keepRatio prop,
  // must be a live value so react-moveable re-reads it every frame), Ctrl
  // resizes from the center (via onBeforeResize's per-frame setFixedDirection).
  const [keepRatioActive, setKeepRatioActive] = useState(false);
  const resizeFromCenterRef = useRef(false);
  const resizeModifierCleanupRef = useRef<(() => void) | null>(null);
  // PowerPoint-style drag modifiers: Shift constrains movement to the
  // horizontal/vertical axis; ⌘/Ctrl drops a copy instead of moving the
  // original, and the two combine (⌘⇧-drag = duplicate along one axis).
  //
  // The axis lock is state, not a ref, because Moveable has to apply it ITSELF
  // (see `throttleDragRotate`). Zeroing the cross axis in `onDrag` after the
  // fact would paint the right thing but leave Moveable measuring the pointer's
  // undropped drift — and a rect it believes has wandered off the row no longer
  // overlaps that row, so the equal-spacing guides stop matching and a
  // shift-drag silently loses the snapping a plain drag has.
  const [dragAxisLock, setDragAxisLock] = useState(false);
  const dragDuplicateRef = useRef(false);
  const dragModifierCleanupRef = useRef<(() => void) | null>(null);
  // Live previews of the copies a ⌘-drag is about to drop: DOM clones of the
  // dragged elements that follow the cursor while the originals stay put. Held
  // in a layer React renders empty and never reconciles, so appending to it
  // can't fight the reconciler.
  const ghostLayerRef = useRef<HTMLDivElement>(null);
  const dragGhostsRef = useRef<Map<HTMLElement, HTMLElement>>(new Map());
  // A selection change that mousedown on an already-selected element implies,
  // held until mouseup so it can be dropped if the gesture turns into a drag.
  const pendingSelectRef = useRef<{ id: string; mode: DeferredSelect } | null>(null);
  /**
   * The chart part a shift-click measures its range from: the last one clicked
   * without a modifier. Held here rather than in the store because it is a
   * property of this gesture stream, not of the document — nothing outside the
   * canvas has an opinion about where a range started, and `shiftClickParts`
   * ignores it once it leaves the selection anyway.
   */
  const partAnchorRef = useRef<string | null>(null);
  /**
   * The chart whose datasheet is open. Held by id rather than by object so the
   * panel always reads the live instance out of the store — a stale copy would
   * show the data as it was when the panel opened.
   */
  const [openChartId, setOpenChartId] = useState<string | null>(null);

  /**
   * The open right-click menu: where it sits, and the items the selection it
   * was opened on offered. The items are snapshotted with the position because
   * running one (crop, say) changes the state they were derived from.
   */
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // A menu describes one selection on one slide; either changing under it (an
  // undo, a delete, arrow-keying to the next slide) leaves it describing
  // nothing. Opening it can't trip this: the press that changes the selection
  // renders before the contextmenu event that sets the menu.
  useEffect(() => setMenu(null), [currentSlideId, selectedIds]);

  /**
   * Dragging a data label moves it in the SPEC, as an offset from where the
   * layout put it, not in the element — the next recompile would otherwise
   * snap it straight back. The offset also pins the label, so the collision
   * solver routes other labels around it instead of shoving it aside.
   *
   * Returns true when it handled the drag.
   */
  const nudgeChartLabel = (id: string, dx: number, dy: number): boolean => {
    const el = store().deck.slides
      .find((sl) => sl.id === store().currentSlideId)
      ?.elements.find((e) => e.id === id);
    const ref = el?.chartRef;
    if (ref?.part !== 'label') return false;
    store().patchChart(ref.chartId, (spec) => {
      if (!isGridSpec(spec)) return;
      const series = spec.data.series.find((s) => s.key === ref.series);
      if (!series) return;
      series.pointOverrides ??= {};
      const prior = series.pointOverrides[ref.point] ?? {};
      const offset = prior.labelOffset ?? { dx: 0, dy: 0 };
      series.pointOverrides[ref.point] = {
        ...prior,
        labelOffset: { dx: offset.dx + dx, dy: offset.dy + dy },
      };
    });
    return true;
  };
  // Live rotation angle during a rotate gesture — rendered instead of the
  // model's value so the object turns under the cursor, not on mouseup.
  const [liveRotate, setLiveRotate] = useState<{ id: string; deg: number } | null>(null);
  /**
   * The chart part under the pointer, for the hover tint.
   *
   * Held here rather than on the elements themselves because a chart part has
   * no hover state of its own to give: the compiled rects are painted by
   * `SlideView`, which knows nothing about the editor. See `ChartPartHighlights`
   * for why a chart needs the affordance at all.
   */
  const [hoverPartId, setHoverPartId] = useState<string | null>(null);
  /**
   * Whether the pointer is in the title band of a slide that has no title yet —
   * the hover that offers to add one. See `titleSlot`.
   */
  const [titleSlotHover, setTitleSlotHover] = useState(false);
  /** A legend mid-drag, and the side it would snap to if dropped now. */
  /**
   * A legend mid-drag: which side it would land on, and — for the two positions
   * inside the plot — the box it would actually occupy, asked of the compiler
   * once when the drag starts. See `legendBoxAt`.
   */
  const [legendDrag, setLegendDrag] = useState<{
    chartId: string;
    side: LegendSide;
    inside: Partial<Record<LegendSide, Rect>>;
  } | null>(null);
  // Ctrl/⌘ + wheel zoom, as a multiple of the fit-to-window width.
  const [zoom, setZoom] = useState(1);
  const zoomAnchorRef = useRef<{ fx: number; fy: number; clientX: number; clientY: number } | null>(
    null,
  );
  // Turns a stream of wheel deltas into at most one slide step per gesture.
  // Deltas are normalized to pixels first: trackpads report pixels, but plenty
  // of mice report lines (deltaY ≈ 3 per notch) or pages, and an un-normalized
  // threshold makes those mice feel like the wheel barely does anything.
  // The threshold is then low enough that one notch — or the gentlest trackpad
  // nudge — steps immediately. After a step the wheel is blocked until the
  // event stream goes quiet, which swallows the long inertial tail of a
  // trackpad flick without also swallowing distinct mouse notches: inertia
  // events arrive continuously (gaps of a few ms), separate notches don't.
  // Accumulation only exists for sub-threshold deltas within one gesture, so
  // it resets once the wheel is quiet.
  const wheelStepRef = useRef(
    (() => {
      const QUIET = 80; // gap that ends a continuous stream, ms
      let acc = 0;
      let last = 0;
      let blocked = false;
      return {
        step(e: WheelEvent): -1 | 0 | 1 {
          const px =
            e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
          const now = performance.now();
          const gap = now - last;
          last = now;
          if (blocked) {
            if (gap < QUIET) return 0;
            blocked = false;
          }
          if (gap > 150 || (acc !== 0 && Math.sign(px) !== Math.sign(acc))) acc = 0;
          acc += px;
          if (Math.abs(acc) < 8) return 0;
          const dir = acc > 0 ? 1 : -1;
          acc = 0;
          blocked = true;
          return dir;
        },
        /** Drop whatever the stream had built up, as if the wheel went quiet. */
        reset() {
          acc = 0;
          last = 0;
          blocked = false;
        },
      };
    })(),
  );

  // True while a mouse button is held anywhere: a drag, resize, rotate or
  // marquee is in flight. Tracked here rather than in each Moveable/Selecto
  // handler because every gesture on the canvas begins with a press, and the
  // wheel has to be frozen for all of them — see `onWheel`.
  const pointerHeldRef = useRef(false);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.button === 0) pointerHeldRef.current = true;
    };
    const up = () => {
      pointerHeldRef.current = false;
      // The press swallowed part of a wheel stream, so start the next gesture
      // from zero instead of stepping the instant the button comes up.
      wheelStepRef.current.reset();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);

  useLayoutEffect(() => {
    setDragRoot(wrapRef.current);
  }, []);

  // Fit slide width to the available area.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const avail = el.clientWidth - CANVAS_PAD * 2;
      const byHeight = (el.clientHeight - CANVAS_PAD * 2) * (slide ? deck.slideSize.w / deck.slideSize.h : 16 / 9);
      setWidth(Math.max(320, Math.min(avail, byHeight)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [deck.slideSize.w, deck.slideSize.h, slide]);

  // Ctrl/⌘ + wheel zooms the slide; a plain wheel moves through the deck.
  // Registered natively because React's own wheel listener is passive —
  // preventDefault there is ignored and the browser would page-zoom instead.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Mid-gesture the wheel is never a request to move: the deltas are a
      // trackpad's inertial tail or a stray second finger, and acting on them
      // yanks the slide out from under the drag — `stepSlide` switches slides
      // AND clears the selection, so the objects being moved are simply gone.
      // Zoom is out too: it rescales the canvas the gesture measured itself
      // against. The workspace is frozen until the button comes up.
      if (pointerHeldRef.current) {
        e.preventDefault();
        return;
      }
      if (!e.ctrlKey && !e.metaKey) {
        // Zoomed in far enough that the slide overflows? Let the wheel pan it,
        // and only page the deck once that edge is reached.
        const max = el.scrollHeight - el.clientHeight;
        if (max > 1 && ((e.deltaY < 0 && el.scrollTop > 0) || (e.deltaY > 0 && el.scrollTop < max)))
          return;
        e.preventDefault();
        const dir = wheelStepRef.current.step(e);
        if (!dir) return;
        useEditor.getState().stepSlide(dir);
        return;
      }
      e.preventDefault();
      const canvas = canvasRef.current;
      if (canvas) {
        // Remember which point of the slide is under the cursor so the layout
        // effect below can keep it there after the resize.
        const r = canvas.getBoundingClientRect();
        zoomAnchorRef.current = {
          fx: (e.clientX - r.left) / r.width,
          fy: (e.clientY - r.top) / r.height,
          clientX: e.clientX,
          clientY: e.clientY,
        };
      }
      setZoom((z) => Math.min(8, Math.max(0.25, z * Math.exp(-e.deltaY / 400))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the pointer's slide position under the pointer across a zoom step.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    zoomAnchorRef.current = null;
    if (!anchor || !wrap || !canvas) return;
    const r = canvas.getBoundingClientRect();
    wrap.scrollLeft += r.left + anchor.fx * r.width - anchor.clientX;
    wrap.scrollTop += r.top + anchor.fy * r.height - anchor.clientY;
  }, [zoom]);

  const scale = (width * zoom) / deck.slideSize.w;
  const displayWidth = deck.slideSize.w * scale;
  const height = deck.slideSize.h * scale;

  // The brand safe area, in canvas px. Objects snap to these lines whether or
  // not they're painted, so a hidden guide still lays the slide out correctly.
  const margins = marginGuides(deck.slideSize);
  const marginX = margins.vertical.map((x) => x * scale);
  const marginY = margins.horizontal.map((y) => y * scale);
  // The title band in canvas px — the hover region that offers to add a title,
  // and where that button is drawn.
  const titleBand = titleBandPx(deck.slideSize, scale);

  // Every shape's text area, as snap lines — so a text box dragged onto a shape
  // clicks into the same thin inset the shape's own text would use, and text
  // sits identically inside every shape on the deck.
  //
  // Only while text is what's being dragged: for a shape or picture these lines
  // are meaningless, and four extra lines per shape would fight the ordinary
  // edge snapping on a busy slide.
  const draggingText =
    selectedIds.length > 0 &&
    selectedIds.every((id) => {
      const el = slide?.elements.find((e) => e.id === id);
      return el ? isText(el) : false;
    });
  const shapeInset = { x: [] as number[], y: [] as number[] };
  if (draggingText && slide) {
    for (const el of slide.elements) {
      if (!isShape(el) || selectedIds.includes(el.id) || el.rotation) continue;
      const box = textInsetBox(el.rect, el.body?.insets);
      shapeInset.x.push(box.x * scale, (box.x + box.w) * scale);
      shapeInset.y.push(box.y * scale, (box.y + box.h) * scale);
    }
  }

  // Keep the overlay glued to the element after ANY model change — inspector
  // edits, undo/redo, a drag commit — so handles never drift from the object.
  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [selectedIds, width, zoom, deck]);

  /**
   * The chart that IS the whole selection, if any.
   *
   * A chart is thirty-odd elements. Handing all of them to Moveable draws
   * thirty-odd control boxes and a hundred snap lines on top of the chart —
   * unreadable, and it makes a simple drag look broken. A chart is one object
   * to the person looking at it, so it gets one target: its backdrop, which
   * covers the whole frame by construction.
   */
  /**
   * Ids the selection names that still exist. A recompile can retire a part
   * mid-selection, and a selection holding one dead id would otherwise stop
   * looking like a chart selection at all.
   */
  const liveSelectedIds = slide
    ? selectedIds.filter((id) => slide.elements.some((e) => e.id === id))
    : [];

  const selectionChart =
    slide?.charts?.find(
      (c) =>
        liveSelectedIds.length > 0 &&
        liveSelectedIds.every(
          (id) => slide.elements.find((e) => e.id === id)?.chartRef?.chartId === c.id,
        ),
    ) ?? null;

  /**
   * True when the WHOLE chart is selected, rather than parts drilled into.
   *
   * think-cell's model, which is the one being copied: a chart is one object
   * until you click into it, and from then on the thing under the cursor is a
   * segment, a label, an axis — addressable on its own. So "the chart is the
   * selection" has to mean every part, not merely "everything selected happens
   * to belong to this chart"; the looser test made a single selected bar keep
   * drawing the chart's own control box, so drilling in worked in the store and
   * was invisible on the canvas.
   */
  /**
   * Stated as "every part is selected" rather than "the counts match": a
   * relayout can retire an id the selection still names (a tick fewer, a
   * suppressed label), and comparing counts made that stale entry read as a
   * drill-in — which is how a resize could leave the control box collapsed onto
   * a single axis rule. `repairChartSelection` keeps the store's list honest;
   * this keeps the canvas honest even if it lags by a commit.
   */
  const wholeChartSelected =
    !!selectionChart &&
    !!slide &&
    slide.elements
      .filter((e) => e.chartRef?.chartId === selectionChart.id)
      .every((e) => selectedIds.includes(e.id));

  const soleChart = wholeChartSelected ? selectionChart : null;

  /** The chart being edited from the inside, if any. */
  const chartPart = wholeChartSelected ? null : selectionChart;

  /**
   * A chart part's geometry is DERIVED — the compiler solves it from the data
   * and the frame on every recompile. Dragging a bar or resizing a tick would
   * write a rect that the next keystroke in the datasheet silently discards, so
   * parts are selectable and formattable but not transformable. Data labels are
   * the one exception: their offset is a real spec field (`labelOffset`), which
   * is what `nudgeChartLabel` writes.
   */
  const chartPartLabelsOnly =
    !!chartPart &&
    !!slide &&
    selectedIds.every(
      (id) => slide.elements.find((e) => e.id === id)?.chartRef?.part === 'label',
    );

  /** Where the part panel hangs: the bounds of everything drilled into, in EMU. */
  const chartPartBox = chartPart && slide ? unionRect(slide.elements, selectedIds) : null;

  const chartBackdropId = soleChart ? `${soleChart.id}::plot` : null;

  /**
   * Every node of the chart being dragged as one target.
   *
   * Moveable only knows about the backdrop, so the rest of the chart has to be
   * carried along by hand during the gesture — otherwise the bars sit still
   * while an empty rectangle slides away from them.
   */
  const chartNodes = (): { node: HTMLElement; rect: Rect }[] => {
    if (!soleChart || !slide) return [];
    return slide.elements
      .filter((e) => e.chartRef?.chartId === soleChart.id)
      .map((e) => ({ node: nodeMap.current.get(e.id), rect: e.rect }))
      .filter((x): x is { node: HTMLElement; rect: Rect } => !!x.node);
  };

  /**
   * True while the chart's own rotate handle is being dragged.
   *
   * A quarter turn re-solves the whole layout in the transposed frame, so a
   * part-by-part preview shows a picture the drop will never produce — the same
   * reason a chart resize isn't previewed either.
   *
   * So the gesture shows the BOX turning and nothing else: the backdrop is the
   * chart's own frame and Moveable's target, so it takes the live angle and
   * carries the control box and its handles round with it, which is what makes
   * it clear how far the drag has gone. Every other part holds its last good
   * rendering, and the new layout appears in one step on release.
   */
  const chartTurning = !!(soleChart && liveRotate && liveRotate.id === chartBackdropId);

  /** The picture in crop mode, if it's still on this slide. */
  const croppingPicture = (() => {
    const el = croppingId ? slide?.elements.find((e) => e.id === croppingId) : undefined;
    return el?.type === 'picture' ? el : null;
  })();

  /** What Moveable actually transforms: one node for a chart, else the selection. */
  const targetIds = chartBackdropId ? [chartBackdropId] : selectedIds;

  const selectedNodes = targetIds
    .map((id) => nodeMap.current.get(id))
    .filter(Boolean) as HTMLElement[];

  /**
   * Which handles a straight line gets.
   *
   * A line has zero extent on its cross axis (see `makeLine`), so the control
   * box collapses onto it: all eight handles pile onto one segment, three of
   * them two-deep, and the box reads as a stray blue rule rather than as a
   * selection. Worse, the pile is ambiguous — grabbing "the top" of a
   * horizontal line is a coin flip between `n` and `s`, and either one drags
   * the line open into a rectangle it can never be again.
   *
   * A 1-D object only has ends, so it gets its ends and nothing else, which is
   * also what PowerPoint puts on a line. Charts are excluded: their target is
   * the backdrop, which always has both dimensions.
   */
  const lineHandles = (() => {
    if (soleChart || selectedIds.length !== 1) return null;
    const el = slide?.elements.find((e) => e.id === selectedIds[0]);
    if (!el) return null;
    if (el.rect.h === 0 && el.rect.w > 0) return ['w', 'e'];
    if (el.rect.w === 0 && el.rect.h > 0) return ['n', 's'];
    return null;
  })();

  const guidelineNodes = slide
    ? slide.elements
        .filter((e) => !selectedIds.includes(e.id))
        .map((e) => nodeMap.current.get(e.id))
        .filter(Boolean) as HTMLElement[]
    : [];

  // `nodeMap` is a ref, so an element that is created and selected in the same
  // commit (duplicate, paste, insert) has no node yet when `selectedNodes` is
  // computed — its ref callback only runs after the render. Moveable is gated
  // on `selectedNodes`, so it wouldn't mount at all, and pressing the new
  // object couldn't move it: Selecto's replay path only fires for objects that
  // AREN'T selected yet, and this one already is. Render once more now that the
  // refs have landed. Self-limiting — the next pass finds every node.
  useLayoutEffect(() => {
    if (targetIds.filter((id) => nodeMap.current.has(id)).length !== selectedNodes.length) {
      setNodeTick((t) => t + 1);
    }
  });

  const store = useEditor.getState;

  const findEl = (id: string) =>
    store()
      .deck.slides.find((s) => s.id === currentSlideId)
      ?.elements.find((x) => x.id === id);

  /**
   * What drilling into a chart actually selects.
   *
   * A legend key means "this series", the way it does in think-cell: the swatch
   * stands for every bar of that series, so selecting the one rectangle in the
   * legend would be a trap — recoloring it would repaint a 6px square and
   * nothing else on the slide.
   */
  const chartDrillIds = (id: string): string[] => {
    const els = slide?.elements ?? [];
    const ref = els.find((e) => e.id === id)?.chartRef;
    if (ref?.part !== 'legend.item') return [id];
    const key = legendSeriesKey(ref);
    const marks = els
      .filter(
        (e) =>
          e.chartRef?.part === 'mark' &&
          e.chartRef.chartId === ref.chartId &&
          e.chartRef.series === key,
      )
      .map((e) => e.id);
    return marks.length ? marks : [id];
  };

  /** The side a pointer at these client coordinates would drop the legend on. */
  const legendSideAt = (chart: ChartInstance, clientX: number, clientY: number): LegendSide => {
    const box = canvasRef.current?.getBoundingClientRect();
    const f = chart.frame;
    return nearestLegendSide(
      { x: f.x * scale, y: f.y * scale, w: f.w * scale, h: f.h * scale },
      clientX - (box?.left ?? 0),
      clientY - (box?.top ?? 0),
    );
  };

  /**
   * Press on a legend: either a drag to another side, or a plain click.
   *
   * Which one it is isn't known until the pointer moves, so the selection is
   * deferred exactly the way `deferSelect` defers it for an ordinary object —
   * committing the click on mousedown would reselect the series under the drag
   * and swap the highlight out from under the gesture.
   *
   * The legend can only land on one of four sides (`LegendSpec.position`), so
   * the drag never moves anything: it lights the target side and writes the
   * spec on release. A free-floating legend would be a rect the next recompile
   * throws away — the same reason no other part is draggable.
   */
  const armLegendDrag = (e: React.MouseEvent, chart: ChartInstance, id: string) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    // Solved once, on the first move rather than on every one: the two boxes
    // depend on the chart, not on the pointer.
    let inside: Partial<Record<LegendSide, Rect>> = {};

    const move = (ev: MouseEvent) => {
      // A few px of travel before this becomes a drag: a legend entry is a
      // small target and a click on one always jitters slightly.
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      if (!dragging) {
        inside = {
          insideTopLeft: legendBoxAt(chart, ds, 'insideTopLeft'),
          insideTopRight: legendBoxAt(chart, ds, 'insideTopRight'),
        };
      }
      dragging = true;
      setLegendDrag({
        chartId: chart.id,
        side: legendSideAt(chart, ev.clientX, ev.clientY),
        inside,
      });
    };

    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (!dragging) {
        store().selectExact(chartDrillIds(id));
        return;
      }
      const side = legendSideAt(chart, ev.clientX, ev.clientY);
      setLegendDrag(null);
      store().patchChart(chart.id, (s) => {
        s.legend.position = side;
        // Dropping a legend somewhere is an unambiguous "I want the legend".
        s.legend.show = true;
      });
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const deferSelect = (id: string, mode: DeferredSelect) => {
    pendingSelectRef.current = { id, mode };
    const finalize = () => {
      const pending = pendingSelectRef.current;
      pendingSelectRef.current = null;
      window.removeEventListener('mouseup', finalize);
      if (pending?.id !== id) return;
      if (pending.mode === 'toggle') store().toggleSelect(id);
      else if (pending.mode === 'member') store().selectExact(chartDrillIds(id));
      else store().select([id]);
    };
    window.addEventListener('mouseup', finalize);
  };

  const attachDragModifiers = (inputEvent: any) => {
    dragModifierCleanupRef.current?.();
    // ⌘ (Ctrl off Apple platforms) rather than Ctrl everywhere: Ctrl-drag on a
    // Mac is a right-click, so it can't be held through a drag.
    const apply = (shift: boolean, mod: boolean) => {
      setDragAxisLock(shift);
      dragDuplicateRef.current = mod;
      // PowerPoint's copy cursor. Set on <body> so it wins over the element's
      // own `cursor: move` for the whole gesture, wherever the pointer goes.
      document.body.style.cursor = mod ? 'copy' : '';
    };
    const sync = (ke: KeyboardEvent) => apply(ke.shiftKey, ke.metaKey || ke.ctrlKey);
    apply(!!inputEvent?.shiftKey, !!(inputEvent?.metaKey || inputEvent?.ctrlKey));
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    dragModifierCleanupRef.current = () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
    };
  };
  const detachDragModifiers = () => {
    dragModifierCleanupRef.current?.();
    dragModifierCleanupRef.current = null;
    setDragAxisLock(false);
    dragDuplicateRef.current = false;
    document.body.style.cursor = '';
  };
  /**
   * Hand the dragged element to the compositor for the length of the gesture.
   *
   * A drag only mutates `transform`, but without a promotion hint Chrome keeps
   * the element on a shared layer and re-rasterizes it every frame — and text
   * is the most expensive thing on the slide to raster. The box tracked the
   * cursor while the glyphs inside it visibly trailed behind. `will-change`
   * makes the per-frame change compositor-only.
   *
   * Set imperatively, not through React state: a re-render mid-gesture would
   * rewrite the transform back to the model's committed position and the
   * element would snap to its origin for a frame.
   */
  const promoteForGesture = (targets: (HTMLElement | SVGElement)[]) => {
    targets.forEach((t) => {
      t.style.willChange = 'transform';
    });
  };
  const demoteAfterGesture = (targets: (HTMLElement | SVGElement)[]) => {
    targets.forEach((t) => {
      t.style.willChange = '';
    });
  };

  /**
   * Fit every selected text-bearing element's box to its own text, keeping the
   * top-left corner put (PowerPoint's "resize shape to fit text" anchor).
   * Non-text elements in the selection are left alone.
   */
  const fitToText = (id: string, transient = false) => {
    const el = findEl(id);
    const node = nodeMap.current.get(id);
    if (!el || !node) return;
    if (!(el.type === 'text' || (el.type === 'shape' && el.body))) return;
    const fit = measureTextFitPx(node, el.rect.w * scale);
    if (!fit) return;
    const rect: Rect = {
      x: el.rect.x,
      y: el.rect.y,
      w: pxToEmu(fit.w, scale),
      h: pxToEmu(fit.h, scale),
    };
    if (rect.w === el.rect.w && rect.h === el.rect.h) return;
    store().setRect(id, rect, transient);
  };

  const fitSelectionToText = () => {
    selectedIds.forEach((id) => fitToText(id));
    moveableRef.current?.updateRect();
  };

  /**
   * Shrink a just-inserted text box onto its own text, so the selection you
   * land on hugs the type instead of the factory's nominal box. The measurement
   * needs the rendered node, which only exists here — and only once the webfont
   * has landed, or it would size the box to the fallback face.
   *
   * Transient: it's part of inserting the box, not a second step to undo.
   */
  useEffect(() => {
    if (!pendingFitId || !nodeMap.current.has(pendingFitId)) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      fitToText(pendingFitId, true);
      moveableRef.current?.updateRect();
      store().clearPendingFit();
    });
    return () => {
      cancelled = true;
    };
    // `fitToText` closes over this render's scale and deck; both are deps here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFitId, scale, deck]);

  /**
   * Start tracking the resize modifiers (Shift = keep ratio, ⌘/Ctrl = resize
   * about the centre) for the length of a gesture. Shared by the single and
   * group paths so a multi-selection honours the same keys.
   */
  const beginResize = (inputEvent: any) => {
    pendingSelectRef.current = null;
    resizeModifierCleanupRef.current?.();
    const syncModifiers = (ke: KeyboardEvent) => {
      setKeepRatioActive(ke.shiftKey);
      resizeFromCenterRef.current = ke.metaKey || ke.ctrlKey;
    };
    setKeepRatioActive(!!inputEvent?.shiftKey);
    resizeFromCenterRef.current = !!(inputEvent?.metaKey || inputEvent?.ctrlKey);
    window.addEventListener('keydown', syncModifiers);
    window.addEventListener('keyup', syncModifiers);
    resizeModifierCleanupRef.current = () => {
      window.removeEventListener('keydown', syncModifiers);
      window.removeEventListener('keyup', syncModifiers);
    };
  };
  const endResize = () => {
    resizeModifierCleanupRef.current?.();
    resizeModifierCleanupRef.current = null;
    setKeepRatioActive(false);
    resizeFromCenterRef.current = false;
  };

  /**
   * Paint one element's frame of a resize and report the box in canvas px, so
   * the same code serves a lone element and each member of a group resize.
   */
  /**
   * The chart's geometry when a resize began, in px.
   *
   * A chart resize relayouts on drop — text has to keep its point size, and a
   * taller plot wants a different number of gridlines — so there is no affine
   * preview that tells the truth. Scaling every part with the box was tried and
   * is worse than no preview at all: type keeps its point size while its box
   * stretches, so labels ride out of their bars and collide, and what you watch
   * for the length of the drag is a chart that looks broken. The chart now sits
   * still and only the box tracks the handle; the relayout lands on release.
   */
  const chartResizeStartRef = useRef<{
    /** The chart's orientation, so a turned chart previews turned. */
    rotation: number;
    /**
     * The box the parts were laid out in — the frame transposed at 90°/270°,
     * see `layoutFrame`. Dragging the right-hand handle of a turned chart makes
     * its layout TALLER, so the scale factors have to be taken here rather than
     * from the frame, or every part slides out of the box as you drag.
     */
    layout: { x: number; y: number; w: number; h: number };
    /**
     * The backdrop only — the one node that IS the frame, so it can follow the
     * handle without any part of the chart being distorted. Kept as a list, and
     * in the chart's UNROTATED frame with the angle it is drawn at, because the
     * turn still has to be undone and re-applied for a turned chart.
     */
    nodes: { node: HTMLElement; x: number; y: number; w: number; h: number; spin: number }[];
  } | null>(null);

  const paintChartResize = (ev: any) => {
    const start = chartResizeStartRef.current;
    if (!start) return;
    const [dx, dy] = ev.drag.dist as [number, number];
    // Moveable reports the size of the TARGET — the backdrop's own box, before
    // its rotation — and a translate in the parent's space. The backdrop of a
    // turned chart IS the layout box (`layoutFrame`), so what arrives here is
    // already layout space and must not be transposed a second time. Reading
    // it as the frame swapped the two axes on every quarter-turned chart: the
    // handle went down, the chart came back wider.
    const layout = {
      x: start.layout.x + dx,
      y: start.layout.y + dy,
      w: ev.width,
      h: ev.height,
    };
    const sx = start.layout.w > 0 ? layout.w / start.layout.w : 1;
    const sy = start.layout.h > 0 ? layout.h / start.layout.h : 1;

    for (const n of start.nodes) {
      const local = {
        x: layout.x + (n.x - start.layout.x) * sx,
        y: layout.y + (n.y - start.layout.y) * sy,
        w: n.w * sx,
        h: n.h * sy,
      };
      const { rect } = turnRect(local, layout, start.rotation);
      n.node.style.width = `${rect.w}px`;
      n.node.style.height = `${rect.h}px`;
      n.node.style.transform = `translate(${rect.x}px, ${rect.y}px)${
        n.spin ? ` rotate(${n.spin}deg)` : ''
      }`;
    }
  };

  /**
   * Hand the chart's nodes back to React, at the size the model now says.
   *
   * `paintChartResize` writes `width`/`height` inline, over the values React put
   * there. React diffs its own props, not the DOM, so it only rewrites a size
   * the recompile actually changed — and a resize on one axis leaves the other
   * untouched. So neither leaving the paint nor deleting it works: the first
   * pins parts at their drag size, the second collapses every part on the
   * unchanged axis to zero. That's the selection box coming out of a resize as a
   * bare line, and the stale outlines around labels; both are one desync.
   *
   * Writing the committed size back is what actually resolves it — the DOM and
   * React's picture of it agree, whichever way the drag went. Must run AFTER the
   * commit, or "committed" is still the size the drag started from.
   */
  const settleChartResizePaint = () => {
    const start = chartResizeStartRef.current;
    if (!start) return;
    for (const n of start.nodes) {
      // A relayout retires parts (a tick fewer at a shorter height), and their
      // nodes are on their way out — nothing to restore them to.
      const el = findEl(n.node.dataset.id!);
      if (!el) {
        n.node.style.removeProperty('width');
        n.node.style.removeProperty('height');
        continue;
      }
      n.node.style.width = `${el.rect.w * scale}px`;
      n.node.style.height = `${el.rect.h * scale}px`;
    }
    chartResizeStartRef.current = null;
  };

  const paintResizeFrame = (ev: any) => {
    const target = ev.target as HTMLElement;
    const id = target.dataset.id;
    const el = id ? findEl(id) : undefined;
    if (!id || !el) return null;
    target.style.width = `${ev.width}px`;
    target.style.height = `${ev.height}px`;
    target.style.transform = ev.drag.transform;
    const [dx, dy] = ev.drag.dist as [number, number];
    return {
      id,
      box: {
        x: el.rect.x * scale + dx,
        y: el.rect.y * scale + dy,
        w: ev.width as number,
        h: ev.height as number,
      },
    };
  };

  /**
   * Repaint a node at its committed position.
   *
   * Needed after a ⌘-drag: the dragged node IS the original, which stays where
   * it was, so its React props are unchanged and React never rewrites the style
   * attribute — leaving the transform the drag painted, i.e. the original
   * sitting on top of the copy that was just dropped there.
   */
  const restoreCommittedTransform = (target: HTMLElement) => {
    const el = findEl(target.dataset.id!);
    if (!el) return;
    target.style.transform = `translate(${el.rect.x * scale}px, ${el.rect.y * scale}px)${
      el.rotation ? ` rotate(${el.rotation}deg)` : ''
    }`;
  };

  /**
   * Paint the stand-in a duplicate-drag leaves behind: a clone of the object,
   * pinned at the committed position it is being copied FROM.
   *
   * The real node keeps moving under the cursor, exactly as in a plain drag.
   * That's what makes ⌘-drag feel like PowerPoint's: Moveable's selection box
   * and its snap guides track the actual DOM node, so painting the copy instead
   * left the indicator and every snap line behind on the stationary original.
   * The commit in `onDragEnd` is what makes the moved node the original again
   * and the object under the cursor the new copy — pixel-identical either way.
   *
   * Clones are created lazily on the first frame that ⌘ is held, so a plain
   * drag never pays for them, and ⌘ can be pressed or released mid-drag.
   */
  const paintGhost = (target: HTMLElement) => {
    const el = findEl(target.dataset.id!);
    const layer = ghostLayerRef.current;
    if (!el || !layer) return;
    let ghost = dragGhostsRef.current.get(target);
    if (!ghost) {
      ghost = target.cloneNode(true) as HTMLElement;
      // A clone is decoration only: it must not be hit-testable (Selecto and
      // resolveMouseDown both look for `.dd-el`) and must not answer to an id.
      ghost.classList.remove('dd-el');
      delete ghost.dataset.id;
      ghost.style.pointerEvents = 'none';
      layer.appendChild(ghost);
      dragGhostsRef.current.set(target, ghost);
    }
    // Recomputed every frame rather than only on create: a zoom step mid-drag
    // changes `scale`, and a stale ghost would drift off its own origin.
    ghost.style.transform = `translate(${el.rect.x * scale}px, ${el.rect.y * scale}px)${
      el.rotation ? ` rotate(${el.rotation}deg)` : ''
    }`;
  };
  const clearGhosts = () => {
    dragGhostsRef.current.forEach((ghost) => ghost.remove());
    dragGhostsRef.current.clear();
  };

  /**
   * The element under a viewport point, or undefined for empty space.
   *
   * Walks UP from each hit node rather than looking for `.dd-el` in the list
   * itself: a line's wrapper box is zero-thickness on its cross axis, and a
   * zero-area box is never returned by elementsFromPoint even when its
   * overflowing stroke is what got hit. Only the inner <svg>/<line> shows up, so
   * matching the list directly picked whatever full-size element happened to sit
   * under the line instead.
   */
  /**
   * The object under a point — looking THROUGH Moveable's overlay, which covers
   * whatever it targets, but never through the editor's own floating chrome.
   *
   * The distinction matters: a press on the format bar or the chart-part panel
   * is aimed AT that panel, so reporting the bar sitting behind it would make
   * every click on a control also reselect the thing it was about to format.
   */
  const elementAtPoint = (clientX: number, clientY: number): HTMLElement | undefined => {
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      const n = node as HTMLElement;
      if (n.closest?.(CHROME_SELECTOR)) return undefined;
      const el = n.closest?.('.dd-el') as HTMLElement | null;
      if (el) return el;
    }
    return undefined;
  };

  /**
   * The part a pointer inside a chart is really aimed at.
   *
   * The DOM can only answer with a box it painted, and the chart's backdrop is
   * one box covering the whole frame — so everywhere that isn't a bar or a
   * number comes back as "the plot", including the axis gutters. A value axis is
   * usually drawn as nothing but its tick labels, a tenth of an inch tall with
   * an inch of blank between them, so aiming at the axis and hitting the axis
   * were two different things: the click landed on the backdrop and selected the
   * whole chart instead of opening the axis panel.
   *
   * Only the backdrop gives way. A press on a mark, a label or a legend key is
   * already exact, and the geometry test is the same one the preview clicks
   * through — `hitTestChart`, which knows an axis is a band and gives the small
   * parts slop — so the canvas and the preview now answer a click the same way.
   */
  const refineChartHit = (
    id: string | undefined,
    clientX: number,
    clientY: number,
  ): string | undefined => {
    if (!id || !slide || !selectionChart) return id;
    const ref = slide.elements.find((x) => x.id === id)?.chartRef;
    if (ref?.chartId !== selectionChart.id || ref.part !== 'plot') return id;
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return id;
    const hit = hitTestChart(
      slide.elements.filter((x) => x.chartRef?.chartId === selectionChart.id),
      pxToEmu(clientX - box.left, scale),
      pxToEmu(clientY - box.top, scale),
      pxToEmu(CHART_HIT_SLOP_PX, scale),
    );
    return hit ? elementIdFor(hit) : id;
  };

  /**
   * Single source of truth for what a mousedown selects. It runs in the CAPTURE
   * phase on the whole canvas area because Moveable's overlay (the group drag
   * area in particular) swallows mousedown before it can reach the element or
   * the canvas underneath — so neither can be trusted to report the hit.
   * PowerPoint semantics: a plain click selects exactly what is under the
   * pointer and nothing else, empty space (on or off the slide) clears, Shift
   * adds/removes.
   */
  const resolveMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Handles/rotation knobs are transform gestures — leave them to Moveable.
    if (typeof target.className === 'string' && /moveable-(control|rotation|line)/.test(target.className)) {
      return;
    }
    // The bars and comment pins act ON the selection, so using them must never
    // change it — without this the click lands on empty workspace and clears.
    if (target.closest?.(CHROME_SELECTOR)) return;

    // Take DOM focus for the canvas. Moveable calls preventDefault on mousedown,
    // which cancels the browser's own focus move, so focus stayed wherever it
    // last was — a font-size field, the chat box, the slide-title input. The
    // window-level Delete/Backspace handler treats a focused input as typing and
    // bails, which is why deleting a freshly clicked object worked only
    // sometimes. Skipped while text is being edited: the editable is inside the
    // canvas and must keep the caret.
    if (!editingId) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== wrapRef.current) active.blur();
      wrapRef.current?.focus({ preventScroll: true });
    }

    const id = refineChartHit(
      elementAtPoint(e.clientX, e.clientY)?.dataset.id,
      e.clientX,
      e.clientY,
    );

    // Right-click opens the context menu on whatever is under the pointer; it
    // must never shrink an existing multi-selection the menu is about to act on.
    if (e.button === 2) {
      if (id && !selectedIds.includes(id)) store().select([id]);
      return;
    }
    if (e.button !== 0) return;

    if (!id) {
      if (!e.shiftKey) store().clearSelection();
      return;
    }
    if (id === editingId) return;

    // A legend is the one chart part with somewhere to go, so a press on one
    // is claimed before the ordinary selection rules see it — see
    // `armLegendDrag`, which decides between the drag and the click on move.
    const pressedRef = (slide?.elements ?? []).find((x) => x.id === id)?.chartRef;
    // An unmodified click is where the next range will be measured from.
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) partAnchorRef.current = id;
    if (
      selectionChart &&
      pressedRef?.chartId === selectionChart.id &&
      (pressedRef.part === 'legend.item' || pressedRef.part === 'legend.box') &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      armLegendDrag(e, selectionChart, id);
      return;
    }

    // Groups are one object to a click: `store().select` grows any id into its
    // whole group. The two exceptions below are PowerPoint's way INTO a group —
    // click the group, then click the member you want.
    const els = slide?.elements ?? [];
    const unit = selectionUnit(els, id);
    const inGroup = unit.length > 1;
    const wholeGroupSelected =
      inGroup && selectedIds.length === unit.length && unit.every((x) => selectedIds.includes(x));
    // Already reached inside this group (one member selected)? Then clicking a
    // sibling picks that sibling, rather than bouncing back out to the group.
    const drilledInHere =
      inGroup &&
      selectedIds.length === 1 &&
      selectedIds[0] !== id &&
      unit.includes(selectedIds[0]) &&
      outerGroupId(els.find((x) => x.id === selectedIds[0])!) === outerGroupId(els.find((x) => x.id === id)!);

    if (drilledInHere && !e.shiftKey) {
      store().selectExact(chartDrillIds(id));
      return;
    }

    // Already inside a chart: the modifiers gather PARTS, not the chart. The
    // ordinary shift branch below grows any id into its whole group, and a
    // chart's group is all thirty-odd of its parts — which is how shift-click
    // on a second bar used to jump straight back out to the whole chart, with
    // no way to format three of anything at once. Shift takes the range from
    // the anchor, ⌘/Ctrl takes one part at a time — see `partSelect`.
    if (chartPart && (e.shiftKey || e.metaKey || e.ctrlKey) && pressedRef?.chartId === chartPart.id) {
      const parts = els.filter((x) => x.chartRef?.chartId === chartPart.id);
      store().selectExact(
        e.shiftKey
          ? shiftClickParts(id, selectedIds, partAnchorRef.current, parts)
          : toggleClickParts(id, selectedIds, parts),
      );
      // ⌘-click moves the anchor to what it picked; shift-click leaves it, so
      // the next shift-click re-measures the same range rather than ratcheting.
      if (!e.shiftKey) partAnchorRef.current = id;
      return;
    }

    // Moveable listens for the press on its TARGET node, and a selected chart's
    // target is its backdrop — which every mark is painted on top of. So a
    // press on a bar, a slice or a ribbon never reaches Moveable and no drag
    // ever starts. Most charts hide that: the plot is mostly bare backdrop, so
    // the press usually lands somewhere draggable. A Sankey's ribbons cover
    // nearly the whole plot, and the chart simply could not be moved — every
    // attempt came back as the drill-in deferred below. Hand the press over.
    //
    // Synchronously, unlike Selecto's replay for an object that ISN'T selected
    // yet: that one waits a frame for the selection to commit and Moveable to
    // mount, and here the target — the backdrop — is already Moveable's.
    if (soleChart && id !== chartBackdropId && selectedIds.includes(id)) {
      moveableRef.current?.dragStart(e.nativeEvent);
    }

    // Mousedown on something already selected is ambiguous with the start of a
    // drag (a plain drag moves the whole group, a shift-drag axis-locks), so
    // defer the selection change to mouseup and drop it if a drag begins.
    if (selectedIds.includes(id)) {
      if (e.shiftKey) deferSelect(id, 'toggle');
      else if (wholeGroupSelected) deferSelect(id, 'member');
      else if (selectedIds.length > 1) deferSelect(id, 'only');
    } else if (e.shiftKey) {
      store().toggleSelect(id);
    } else {
      store().select([id]);
    }
  };

  /**
   * Fill the slide's empty title slot and leave the caret in it, so the click
   * that asks for a title is followed by typing the title — not by hunting for
   * the box and double-clicking it. A title box that exists but is still
   * wordless is re-opened rather than duplicated (see `titleSlotAction`).
   */
  const addTitle = () => {
    setTitleSlotHover(false);
    const s = store();
    const els = s.deck.slides.find((sl) => sl.id === s.currentSlideId)?.elements ?? [];
    const action = titleSlotAction(els);
    if (action === 'none') return;
    const el = action === 'edit' ? titleElement(els) : makeTitle(s.designSystem, s.deck.slideSize);
    if (!el) return;
    if (action === 'edit') s.select([el.id]);
    else s.addElement(el);
    store().setEditing(el.id);
  };

  if (!slide) return null;

  // Zoomed past the window the slide has to be pannable, so the surround
  // scrolls; `m-auto` on the canvas keeps it centred while it still fits.
  return (
    <div
      ref={wrapRef}
      // Focusable so a canvas click can pull focus off whatever field had it;
      // -1 keeps it out of the tab order, and no ring is drawn for it.
      tabIndex={-1}
      className="relative flex h-full w-full items-center justify-center overflow-auto bg-zinc-200/70 p-12 outline-none dark:bg-zinc-800"
      onMouseDownCapture={resolveMouseDown}
      onDoubleClickCapture={(e) => {
        const t = e.target as HTMLElement;
        if (typeof t.className !== 'string') return;
        // Double-tapping the rotation handle returns the object to upright.
        if (t.className.includes('moveable-rotation')) {
          e.preventDefault();
          e.stopPropagation();
          // A chart's angle lives on the chart; zeroing its primitives would
          // last only until the next recompile.
          if (soleChart) store().setChartRotation(soleChart.id, 0);
          else selectedIds.forEach((id) => store().updateElement(id, { rotation: 0 }));
          moveableRef.current?.updateRect();
          return;
        }
        // …and the bottom-right handle shrink-wraps the box to its text.
        if (t.className.includes('moveable-control') && t.dataset.direction === 'se') {
          e.preventDefault();
          e.stopPropagation();
          fitSelectionToText();
        }
      }}
    >
      {/* The slide plus its two floating bars: format above the top-right
          corner, arrange down the right edge. Both are absolutely positioned so
          selecting something doesn't shove the slide around; they sit in the
          workspace padding, which is why the arrange bar is a single narrow
          column. */}
      <div className="relative m-auto shrink-0" style={{ width: displayWidth }}>
        {/* Both bars clear Moveable's control box (`OVERLAY_Z`, see `layers.ts`).
            They are stacking contexts, so anything they open — the swatch
            popovers — rides along instead of being sliced by the selection
            outline of the object it is formatting. */}
        {/* Spans the slide (`left-0 right-0`) rather than shrinking to the bar,
            so the bar has a definite width to wrap against; `justify-end` still
            holds it flush to the right edge. `pointer-events-none` keeps the now
            slide-wide strip from swallowing presses on the empty space above the
            slide, which is one of the ways you clear a selection. */}
        <div
          className="pointer-events-none absolute bottom-full left-0 right-0 mb-2 flex justify-end"
          style={{ zIndex: OVERLAY_Z }}
        >
          <SelectionFormatBar onOpenChartData={setOpenChartId} />
        </div>
        <div className="absolute left-full top-0 ml-1.5 flex" style={{ zIndex: OVERLAY_Z }}>
          <ArrangeBar />
        </div>
        <div
          ref={canvasRef}
          className="dd-canvas group relative shrink-0 select-none shadow-xl ring-1 ring-black/10"
          style={{
            width: displayWidth,
            height,
            background:
              slide.background?.kind === 'solid'
                ? resolveColor(slide.background.color, ds)
                : '#ffffff',
          }}
          // Which part of the selected chart the pointer is over. Only tracked
          // while a chart is the selection — hit-testing every mousemove over
          // an ordinary slide would be work nobody asked for, and a chart the
          // user hasn't touched has no parts to offer yet.
          onMouseMove={(e) => {
            // An untitled slide's empty title band offers to fill itself.
            // Mid-gesture or mid-edit the offer would be noise, so it is only
            // ever made to a pointer resting quietly in the band.
            const box = canvasRef.current?.getBoundingClientRect();
            let overBand = false;
            if (
              box &&
              !editingId &&
              !croppingId &&
              !legendDrag &&
              !liveRotate &&
              !liveResize &&
              inRect(titleBand, e.clientX - box.left, e.clientY - box.top)
            ) {
              const els = slide?.elements ?? [];
              const action = titleSlotAction(els);
              // Bare band only: a pointer over an object in the band is aimed
              // at that object. The wordless title box is the exception — it
              // covers the band it sits in, and re-opening it is the whole
              // point of the offer.
              const hit = elementAtPoint(e.clientX, e.clientY)?.dataset.id;
              overBand =
                action !== 'none' &&
                (!hit || (action === 'edit' && hit === titleElement(els)?.id));
            }
            if (overBand !== titleSlotHover) setTitleSlotHover(overBand);

            if (!selectionChart || legendDrag || liveRotate || liveResize) {
              if (hoverPartId) setHoverPartId(null);
              return;
            }
            const el = elementAtPoint(e.clientX, e.clientY);
            const hitId = refineChartHit(el?.dataset.id, e.clientX, e.clientY) ?? null;
            const ref = hitId
              ? slide?.elements.find((x) => x.id === hitId)?.chartRef
              : undefined;
            const next = ref?.chartId === selectionChart.id ? hitId : null;
            if (next !== hoverPartId) setHoverPartId(next);
          }}
          onMouseLeave={() => {
            setHoverPartId(null);
            setTitleSlotHover(false);
          }}
          // The browser's menu is suppressed everywhere on the slide, and ours
          // takes over for the selection that has commands worth reaching at the
          // pointer (see `contextMenuItems`). Text being edited is the
          // exception: the native menu is how you reach spellcheck and
          // paste-as-plain-text.
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest?.('[contenteditable="true"]')) return;
            e.preventDefault();
            // Mid-crop the handles own the picture; a menu offering "Crop"
            // again would be noise.
            if (croppingId) return;
            // Only over an object. Right-clicking bare canvas leaves the
            // selection alone (see `resolveMouseDown`), so without this the
            // empty slide would offer to crop an image somewhere off under the
            // pointer's elbow.
            if (!elementAtPoint(e.clientX, e.clientY)) return;
            // `resolveMouseDown` has already made the right-clicked object the
            // selection, so this reads the selection the user is pointing at.
            const els = slide?.elements ?? [];
            const items = contextMenuItems(
              store().selectedIds.map((id) => els.find((el) => el.id === id)).filter(Boolean) as typeof els,
            );
            if (items.length) setMenu({ x: e.clientX, y: e.clientY, items });
          }}
        >
        {/* The margin frame. Painted under the elements (DOM order — the element
            boxes carry no z-index) and never hit-testable, so it can't eat a
            marquee drag on empty canvas. The content-top line is dashed to read
            as the softer of the two: a suggestion, not the safe-area edge. */}
        {showGuides ? (
          <div className="pointer-events-none absolute inset-0">
            {marginX.map((x) => (
              <div
                key={`gx-${x}`}
                className="absolute top-0 bottom-0 w-px bg-sky-400/45"
                style={{ left: x }}
              />
            ))}
            {marginY.map((y, i) => (
              <div
                key={`gy-${y}`}
                className={`absolute right-0 left-0 h-px ${
                  i === 1 ? 'bg-sky-400/25' : 'bg-sky-400/45'
                }`}
                style={{
                  top: y,
                  ...(i === 1
                    ? {
                        background:
                          'repeating-linear-gradient(to right, rgb(56 189 248 / 0.45) 0 6px, transparent 6px 12px)',
                      }
                    : null),
                }}
              />
            ))}
          </div>
        ) : null}

        {/* Empty in JSX on purpose: `paintGhost` appends duplicate-drag previews
            here, and React never reconciles the children of a node it renders
            childless. Shares the elements' coordinate origin. */}
        <div ref={ghostLayerRef} className="pointer-events-none absolute inset-0 z-10" />

        {slide.elements.map((el) => {
          const isEditing = editingId === el.id;
          // Mid-crop the overlay paints this picture itself, whole and dimmed
          // outside the trim. Leaving the element painted too would show the
          // pre-crop box at full strength through the dimmed part.
          const isCropping = croppingId === el.id;
          const live = liveResize?.[el.id] ?? null;
          // A part of the chart being turned: held at its committed transform
          // for the whole gesture, so the chart snaps to its re-solved layout in
          // one step on release. See `chartTurning`.
          const turning = chartTurning && soleChart && el.chartRef?.chartId === soleChart.id;
          const boxX = live ? live.x : el.rect.x * scale;
          const boxY = live ? live.y : el.rect.y * scale;
          const boxW = live ? live.w : el.rect.w * scale;
          const boxH = live ? live.h : el.rect.h * scale;
          // Mid-rotation the live angle wins, so the object turns with the
          // handle instead of snapping into place on mouseup.
          const spinDeg =
            !turning && liveRotate?.id === el.id ? liveRotate.deg : (el.rotation ?? 0);
          return (
            <div
              key={el.id}
              data-id={el.id}
              ref={(node) => {
                if (node) nodeMap.current.set(el.id, node);
                else nodeMap.current.delete(el.id);
              }}
              className="dd-el absolute left-0 top-0"
              style={{
                width: boxW,
                height: boxH,
                // Position via transform ONLY. React owns the transform string, so
                // it always overwrites anything Moveable applies mid-drag — no
                // leftover translate, no post-drag jump, overlay stays aligned.
                transform: `translate(${boxX}px, ${boxY}px)${
                  spinDeg ? ` rotate(${spinDeg}deg)` : ''
                }`,
                transformOrigin: 'center center',
                cursor: 'move',
                visibility: isCropping ? 'hidden' : undefined,
              }}
              onDoubleClick={(e) => {
                // A chart's parts are text and shapes too, but double-clicking
                // one means "edit the chart's data", not "edit this label".
                if (el.chartRef) {
                  e.stopPropagation();
                  setOpenChartId(el.chartRef.chartId);
                  return;
                }
                if (el.type === 'text' || (el.type === 'shape' && el.body)) {
                  e.stopPropagation();
                  store().setEditing(el.id);
                  return;
                }
                // Double-clicking a picture crops it — the same "go one level
                // in" gesture that opens a text box or a chart's data.
                if (el.type === 'picture') {
                  e.stopPropagation();
                  store().setCropping(el.id);
                }
              }}
            >
              <ElementVisual
                el={el}
                ds={ds}
                scale={scale}
                hideBody={isEditing}
                sizeOverridePx={live ? { w: live.w, h: live.h } : undefined}
              />
              {isEditing && (el.type === 'text' || el.type === 'shape') ? (
                <TextEditor el={el} scale={scale} />
              ) : null}
            </div>
          );
        })}

        {/* The page number, if the deck has them on. Deliberately NOT an
            element: it isn't selectable, movable or deletable, and it re-reads
            the slide's index every render, so the deck renumbers as you add,
            delete and reorder slides. */}
        {showsPageNumbers(deck) ? (
          <PageNumber
            index={deck.slides.findIndex((s) => s.id === slide.id)}
            count={deck.slides.length}
            backgroundHex={slideBackgroundHex(slide, ds)}
            ds={ds}
            scale={scale}
          />
        ) : null}

        {/* An untitled slide's empty title band, offered rather than explained:
            hover the band and the one thing that belongs there is one click
            away, parked where the brand puts a title. Chrome, not an element —
            `dd-add-title` is in CHROME_SELECTOR, so pressing it neither clears
            the selection nor starts a marquee. */}
        {titleSlotHover ? (
          <div
            className="dd-add-title absolute"
            style={{ left: titleBand.x, top: titleBand.y, zIndex: OVERLAY_Z }}
          >
            <button
              onClick={addTitle}
              title="Give this slide a title"
              className="flex items-center gap-1.5 rounded-md border border-dashed border-zinc-400 bg-white/90 px-2 py-1 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur hover:border-solid hover:border-sky-500 hover:text-sky-600 dark:border-zinc-500 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:text-sky-400"
            >
              <span className="text-sm leading-none">+</span>
              Add title
            </button>
          </div>
        ) : null}

        {/* Comment markers for this slide, above the elements they annotate. */}
        <CommentPins slide={slide} scale={scale} />

        {/* What the pointer is about to hit inside the selected chart, and what
            it already hit. Above Moveable's control box, which for a chart part
            is a box with every handle disabled — see `ChartPartHighlights`. */}
        {selectionChart ? (
          <ChartPartHighlights
            slide={slide}
            chartId={selectionChart.id}
            selectedIds={selectedIds}
            hoverId={hoverPartId}
            // The whole chart selected is Moveable's control box to draw; ringing
            // all forty of its parts as well would be a chart made of rings.
            showSelection={!!chartPart}
            scale={scale}
          />
        ) : null}

        {/* The four sides a dragged legend can land on. */}
        {legendDrag && selectionChart?.id === legendDrag.chartId ? (
          <LegendDropZones
            chart={selectionChart}
            active={legendDrag.side}
            inside={legendDrag.inside}
            scale={scale}
          />
        ) : null}

        {/* Formatting for whatever part of a chart the user drilled into. Sits
            inside the slide, anchored to the part, so the controls arrive where
            the eye already is — see `ChartPartPopover`. */}
        {chartPart && chartPartBox ? (
          <ChartPartPopover
            chart={chartPart}
            slide={slide}
            selectedIds={selectedIds}
            ds={ds}
            anchor={{
              x: chartPartBox.x * scale,
              y: chartPartBox.y * scale,
              w: chartPartBox.w * scale,
              h: chartPartBox.h * scale,
            }}
            canvas={{ w: displayWidth, h: height }}
          />
        ) : null}

        {/* Live angle readout, pinned above the object being rotated. */}
        {(() => {
          if (!liveRotate) return null;
          const el = slide.elements.find((x) => x.id === liveRotate.id);
          if (!el) return null;
          return (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-md bg-zinc-900/90 px-2 py-1 text-xs font-medium tabular-nums text-white"
              style={{
                left: (el.rect.x + el.rect.w / 2) * scale,
                top: el.rect.y * scale - 32,
              }}
            >
              {normalizeDeg(liveRotate.deg)}°
            </div>
          );
        })()}

        {/* The box a chart is being turned in.

            The chart itself holds still for the whole gesture (see
            `chartTurning`), and Moveable's own box can't help: it is drawn from
            the target's matrix, which nothing rotates until the drop, and it
            ignores `updateRect` mid-gesture. So the frame is drawn here at the
            live angle, handle and all, and Moveable's box is hidden underneath
            it — this is the one thing on screen that says how far round the drag
            has got. */}
        {chartTurning && soleChart && liveRotate ? (
          <div
            className="pointer-events-none absolute border border-sky-400"
            style={{
              left: soleChart.frame.x * scale,
              top: soleChart.frame.y * scale,
              width: soleChart.frame.w * scale,
              height: soleChart.frame.h * scale,
              transform: `rotate(${liveRotate.deg}deg)`,
              transformOrigin: 'center center',
              zIndex: MOVEABLE_Z,
            }}
          >
            {/* The rotate handle, turning with the box it belongs to. */}
            <div className="absolute -top-10 left-1/2 h-10 w-px -translate-x-1/2 bg-sky-400" />
            <div className="absolute -top-[46px] left-1/2 size-3 -translate-x-1/2 rounded-full border border-sky-400 bg-white" />
          </div>
        ) : null}

        {/* Crop handles for the picture being cropped. Replaces the transform
            box below — a crop trims the box, so the two would fight over the
            same corners. */}
        {croppingPicture ? <CropOverlay el={croppingPicture} scale={scale} /> : null}

        {/* Transform controls for the current selection. */}
        {selectedNodes.length > 0 && !editingId && !croppingPicture ? (
          <Moveable
            ref={moveableRef}
            target={selectedNodes}
            // Mid-turn the drawn box above replaces this one, which is stuck at
            // the angle the gesture started from. Hidden, not unmounted: it is
            // the thing tracking the pointer.
            className={chartTurning ? 'opacity-0' : undefined}
            // See `chartPartLabelsOnly`: a drilled-into part is selectable and
            // formattable, but its box belongs to the compiler.
            draggable={!chartPart || chartPartLabelsOnly}
            resizable={!chartPart}
            // A scatter or bubble plot has no side to lie on, so it gets no
            // rotate handle at all — see `supportsTurn`.
            rotatable={!chartPart && (!soleChart || supportsTurn(soleChart.spec.kind))}
            keepRatio={keepRatioActive}
            renderDirections={lineHandles ?? ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
            origin={false}
            throttleDrag={0}
            throttleResize={0}
            // Shift-drag: quantize the drag DIRECTION to the four axes, which is
            // the axis lock — and Moveable applies it before it snaps, so the
            // rect it measures is the rect the user sees and the alignment and
            // equal-spacing guides keep working exactly as on a plain drag.
            throttleDragRotate={dragAxisLock ? 90 : 0}
            // Charts snap to the four orientations — a chart at 37° is a
            // mistake, not a design. Everything else rotates freely.
            throttleRotate={soleChart ? 90 : 0}
            // Everything else is free, but magnetic to the eighth-turns.
            snapRotationDegrees={soleChart ? undefined : SNAP_ANGLES}
            snapRotationThreshold={6}
            // Snapping a bar to the slide's margins would be meaningless — the
            // only thing a part can do is nudge a label a few px off its anchor.
            snappable={!chartPart}
            snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            snapThreshold={6}
            elementGuidelines={guidelineNodes}
            verticalGuidelines={[0, displayWidth / 2, displayWidth, ...marginX, ...shapeInset.x]}
            horizontalGuidelines={[0, height / 2, height, ...marginY, ...shapeInset.y]}
            // During interaction we only paint the transform for smoothness; the
            // model is written once on end from the delta (dist), then React
            // re-renders the authoritative transform. No baking, no leftover.
            onDragStart={(e) => {
              attachDragModifiers(e.inputEvent);
              promoteForGesture([e.target as HTMLElement]);
            }}
            onDrag={(e) => {
              // Moveable raises dragStart on plain mousedown, so movement — not
              // the gesture starting — is what cancels a deferred reselect.
              pendingSelectRef.current = null;
              const id = (e.target as HTMLElement).dataset.id!;
              const el = findEl(id);
              if (!el) return;
              const [dx, dy] = e.dist as [number, number];
              // ⌘ held: pin a stand-in at the origin, then move the node itself
              // as usual, so the selection box and snap guides come along.
              if (dragDuplicateRef.current) paintGhost(e.target as HTMLElement);
              else clearGhosts();
              e.target.style.transform = `translate(${el.rect.x * scale + dx}px, ${el.rect.y * scale + dy}px)${
                el.rotation ? ` rotate(${el.rotation}deg)` : ''
              }`;
              // The chart's other parts aren't Moveable targets, so move them
              // with it or only the backdrop appears to travel.
              if (soleChart) {
                for (const { node, rect } of chartNodes()) {
                  if (node === e.target) continue;
                  // Each part keeps its own angle: a turned chart, or just a
                  // rotated axis title, would otherwise snap upright for the
                  // duration of the drag and jump back on drop.
                  const spin = findEl(node.dataset.id!)?.rotation ?? 0;
                  node.style.transform = `translate(${rect.x * scale + dx}px, ${
                    rect.y * scale + dy
                  }px)${spin ? ` rotate(${spin}deg)` : ''}`;
                }
              }
            }}
            onDragEnd={(e) => {
              const wasDuplicate = dragDuplicateRef.current;
              detachDragModifiers();
              clearGhosts();
              demoteAfterGesture([e.target as HTMLElement]);
              const last = e.lastEvent;
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              const [dx, dy] = last.dist as [number, number];
              if (wasDuplicate) {
                if (!dx && !dy) {
                  restoreCommittedTransform(e.target as HTMLElement);
                  return;
                }
                store().duplicateBy([id], pxToEmu(dx, scale), pxToEmu(dy, scale));
                restoreCommittedTransform(e.target as HTMLElement);
              } else if (soleChart) {
                // One command for the whole chart, so it's one undo step and
                // the frame follows the elements.
                const ids = chartNodes().map(({ node }) => node.dataset.id!);
                store().moveBy(ids, pxToEmu(dx, scale), pxToEmu(dy, scale));
              } else if (!nudgeChartLabel(id, pxToEmu(dx, scale), pxToEmu(dy, scale))) {
                store().moveBy([id], pxToEmu(dx, scale), pxToEmu(dy, scale));
              }
            }}
            onDragGroupStart={(e) => {
              attachDragModifiers(e.inputEvent);
              promoteForGesture(e.events.map((ev) => ev.target as HTMLElement));
            }}
            onDragGroup={(e) => {
              pendingSelectRef.current = null;
              const first = e.events[0];
              if (!first) return;
              const [dx, dy] = first.dist as [number, number];
              if (dragDuplicateRef.current)
                e.events.forEach((ev) => paintGhost(ev.target as HTMLElement));
              else clearGhosts();
              e.events.forEach((ev) => {
                const id = (ev.target as HTMLElement).dataset.id!;
                const el = findEl(id);
                if (!el) return;
                ev.target.style.transform = `translate(${el.rect.x * scale + dx}px, ${el.rect.y * scale + dy}px)${
                  el.rotation ? ` rotate(${el.rotation}deg)` : ''
                }`;
              });
            }}
            onDragGroupEnd={(e) => {
              const wasDuplicate = dragDuplicateRef.current;
              detachDragModifiers();
              clearGhosts();
              demoteAfterGesture(e.events.map((ev) => ev.target as HTMLElement));
              const last = e.events[0]?.lastEvent;
              if (!last) return;
              const [dx, dy] = last.dist as [number, number];
              if (wasDuplicate) {
                if (dx || dy)
                  store().duplicateBy(selectedIds, pxToEmu(dx, scale), pxToEmu(dy, scale));
                e.events.forEach((ev) => restoreCommittedTransform(ev.target as HTMLElement));
              } else {
                store().moveBy(selectedIds, pxToEmu(dx, scale), pxToEmu(dy, scale));
              }
            }}
            onResizeStart={(e) => {
              beginResize(e.inputEvent);
              if (!soleChart) {
                chartResizeStartRef.current = null;
                return;
              }
              const rotation = snapQuarterTurn(soleChart.rotation ?? 0);
              const framePx = {
                x: soleChart.frame.x * scale,
                y: soleChart.frame.y * scale,
                w: soleChart.frame.w * scale,
                h: soleChart.frame.h * scale,
              };
              const layoutPx = layoutFrame(framePx, rotation);
              chartResizeStartRef.current = {
                rotation,
                layout: layoutPx,
                // The backdrop alone. A resize is not an affine transform of a
                // chart — it relayouts — so previewing one part-by-part shows a
                // picture the drop will never produce. The box follows the
                // handle, the chart holds its last good rendering, and the new
                // layout appears in one step on release.
                nodes: chartNodes()
                  .filter(({ node }) => node.dataset.id === chartBackdropId)
                  .map(({ node, rect }) => {
                    // Undo the chart's turn to get back to layout space; the
                    // frame's centre is the same point either way round.
                    const { rect: local } = turnRect(
                      {
                        x: rect.x * scale,
                        y: rect.y * scale,
                        w: rect.w * scale,
                        h: rect.h * scale,
                      },
                      layoutPx,
                      (360 - rotation) % 360,
                    );
                    return {
                      node,
                      ...local,
                      spin: findEl(node.dataset.id!)?.rotation ?? 0,
                    };
                  }),
              };
            }}
            onBeforeResize={(e) => {
              e.setFixedDirection(resizeFromCenterRef.current ? [0, 0] : e.startFixedDirection);
            }}
            onResize={(e) => {
              if (soleChart) {
                paintChartResize(e);
                return;
              }
              const painted = paintResizeFrame(e);
              if (painted) setLiveResize({ [painted.id]: painted.box });
            }}
            onResizeEnd={(e) => {
              endResize();
              const last = e.lastEvent;
              setLiveResize(null);
              if (!last) {
                settleChartResizePaint();
                return;
              }
              const id = (e.target as HTMLElement).dataset.id!;
              const el = findEl(id);
              if (!el) {
                settleChartResizePaint();
                return;
              }
              const [dx, dy] = last.drag.dist as [number, number];
              const rect = {
                x: el.rect.x + pxToEmu(dx, scale),
                y: el.rect.y + pxToEmu(dy, scale),
                w: pxToEmu(last.width, scale),
                h: pxToEmu(last.height, scale),
              };
              if (soleChart) {
                // The backdrop IS the frame, so resizing it resizes the chart —
                // which relayouts rather than stretching 9pt type to 14.
                //
                // At a quarter turn the backdrop is the frame TRANSPOSED (see
                // `layoutFrame`), and both the rect above and Moveable's
                // width/height are in that turned box's own space. `layoutFrame`
                // is its own inverse — transpose about the same centre — so one
                // more application maps the dragged box back onto the frame.
                // Without it a drag down the page committed a wider chart.
                store().setChartFrame(
                  soleChart.id,
                  layoutFrame(rect, snapQuarterTurn(soleChart.rotation ?? 0)),
                );
                settleChartResizePaint();
              } else {
                store().setRect(id, rect);
              }
            }}
            // Group resize, PowerPoint-style: the selection scales as ONE
            // object. Dragging a handle applies the same scale factors to every
            // selected object's SIZE *and* to its OFFSET from the group box's
            // fixed edge, so the members keep their relative spacing and the
            // group's outline tracks the handle exactly — a 2× wider group has
            // members twice as wide and twice as far apart.
            //
            // Moveable's per-target child events are deliberately unused: only
            // the group box's own dimensions are read, to derive the factors.
            onResizeGroupStart={(e) => {
              beginResize(e.inputEvent);
              groupResizeRef.current = [];
              groupResizeGrabRef.current = pointerPos(e.inputEvent);
              groupResizeStartRef.current = e.targets
                .map((t) => {
                  const id = (t as HTMLElement).dataset.id;
                  const el = id ? findEl(id) : undefined;
                  return el
                    ? {
                        id: el.id,
                        x: el.rect.x * scale,
                        y: el.rect.y * scale,
                        w: el.rect.w * scale,
                        h: el.rect.h * scale,
                      }
                    : null;
                })
                .filter(Boolean) as typeof groupResizeStartRef.current;
            }}
            onBeforeResizeGroup={(e) => {
              e.setFixedDirection(resizeFromCenterRef.current ? [0, 0] : e.startFixedDirection);
            }}
            onResizeGroup={(e) => {
              // The group box's start size, recovered from this frame rather
              // than measured up front: `dist` is the change since the gesture
              // began, so `start + dist` is exactly where the box is now.
              const [distW, distH] = e.dist as [number, number];
              // Which edges the drag holds still. A handle on an edge (dir 0 on
              // that axis) only scales that axis when Shift forces the ratio, so
              // there's no meaningful edge to pin — grow about the centre, as
              // ⌘/Ctrl does on both axes.
              const [dirX, dirY] = e.direction as [number, number];
              const fromCenter = resizeFromCenterRef.current;
              // The group box as it stood when the gesture began — the frame
              // every member's offset is measured against.
              const starts = groupResizeStartRef.current;
              const bounds = (get: (s: (typeof starts)[number]) => [number, number]) => {
                const lo = Math.min(...starts.map((s) => get(s)[0]));
                const hi = Math.max(...starts.map((s) => get(s)[0] + get(s)[1]));
                return [lo, hi] as const;
              };
              const [gx0, gx1] = bounds((s) => [s.x, s.w]);
              const [gy0, gy1] = bounds((s) => [s.y, s.h]);

              /**
               * How far the handle has travelled on an axis Moveable isn't
               * measuring. A `se` handle pulled down 40px makes the box 40px
               * taller; a `n` handle pulled down makes it 40px shorter, hence
               * the direction; ⌘ grows both edges at once, hence the doubling.
               * An edge handle (dir 0) has no say on its cross axis at all.
               */
              const grab = groupResizeGrabRef.current;
              const pointer = pointerPos(e.inputEvent);
              const byPointer = (dir: number, from: number, to: number) =>
                !dir || !grab || !pointer ? 0 : dir * (to - from) * (fromCenter ? 2 : 1);

              // Measured against the MODEL's start bounds, not against the box
              // Moveable measures — which comes back 0 tall for a selection
              // holding a chart. See `resizeFactor`.
              // The pointer only stands in where the live measurement is dead;
              // where Moveable is measuring, its delta carries the snapping.
              const sx = resizeFactor(
                gx1 - gx0,
                e.width,
                e.width > 0 ? distW : byPointer(dirX, grab?.x ?? 0, pointer?.x ?? 0) || distW,
              );
              const sy = resizeFactor(
                gy1 - gy0,
                e.height,
                e.height > 0 ? distH : byPointer(dirY, grab?.y ?? 0, pointer?.y ?? 0) || distH,
              );
              // The point that stays put: the held edge, or the group's centre
              // when the drag grows about it. Positions scale about it too,
              // which is what makes the selection behave as one object.
              const pivot = (dir: number, lo: number, hi: number) =>
                fromCenter || dir === 0 ? (lo + hi) / 2 : dir > 0 ? lo : hi;
              const px = pivot(dirX, gx0, gx1);
              const py = pivot(dirY, gy0, gy1);

              const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
              const rects: { id: string; rect: Rect }[] = [];
              groupResizeStartRef.current.forEach((start) => {
                // The 4px floor keeps an object grabbable, but a line is 0 on
                // its cross axis by definition — floor that and the line comes
                // out of the resize as a thin rectangle, permanently.
                const w = start.w === 0 ? 0 : Math.max(4, start.w * sx);
                const h = start.h === 0 ? 0 : Math.max(4, start.h * sy);
                const box = {
                  x: px + (start.x - px) * sx,
                  y: py + (start.y - py) * sy,
                  w,
                  h,
                };
                boxes[start.id] = box;
                rects.push({
                  id: start.id,
                  rect: {
                    x: pxToEmu(box.x, scale),
                    y: pxToEmu(box.y, scale),
                    w: pxToEmu(box.w, scale),
                    h: pxToEmu(box.h, scale),
                  },
                });
                // Paint immediately as well as through `liveResize`, so the
                // boxes track the handle without waiting on a React commit.
                const node = nodeMap.current.get(start.id);
                const el = findEl(start.id);
                if (!node) return;
                node.style.width = `${box.w}px`;
                node.style.height = `${box.h}px`;
                node.style.transform = `translate(${box.x}px, ${box.y}px)${
                  el?.rotation ? ` rotate(${el.rotation}deg)` : ''
                }`;
              });
              groupResizeRef.current = rects;
              setLiveResize(boxes);
            }}
            onResizeGroupEnd={() => {
              endResize();
              setLiveResize(null);
              const rects = groupResizeRef.current;
              groupResizeRef.current = [];
              groupResizeStartRef.current = [];
              store().setRects(rects);
              // The selection's bounds moved with the objects, and Moveable's
              // own group box was tracking the drag rather than the result.
              moveableRef.current?.updateRect();
            }}
            onRotateStart={() => {
              pendingSelectRef.current = null;
            }}
            onRotate={(e) => {
              // Paint the angle every frame — the model is written once on end.
              setLiveRotate({ id: (e.target as HTMLElement).dataset.id!, deg: e.rotation });
            }}
            onRotateEnd={(e) => {
              setLiveRotate(null);
              const last = e.lastEvent;
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              // The handle is on the backdrop, but the chart turns as one
              // object and the orientation belongs to the chart, not to a
              // rectangle that a recompile would replace.
              if (soleChart) {
                store().setChartRotation(soleChart.id, last.rotation);
                return;
              }
              store().updateElement(id, { rotation: normalizeDeg(last.rotation) });
            }}
            // Group rotate: the selection turns about ITS OWN centre, so each
            // member both spins and orbits. Moveable works out each member's
            // angle and offset; these handlers paint them and commit the pair
            // (position + rotation) in one history step.
            onRotateGroupStart={() => {
              pendingSelectRef.current = null;
            }}
            onRotateGroup={(e) => {
              e.events.forEach((ev) => {
                const target = ev.target as HTMLElement;
                const el = findEl(target.dataset.id!);
                if (!el) return;
                const [dx, dy] = ev.drag.dist as [number, number];
                target.style.transform = `translate(${el.rect.x * scale + dx}px, ${
                  el.rect.y * scale + dy
                }px) rotate(${ev.rotation}deg)`;
              });
            }}
            onRotateGroupEnd={(e) => {
              const rects: { id: string; rect: Rect; rotation: number }[] = [];
              e.events.forEach((ev) => {
                const last = ev.lastEvent;
                const id = (ev.target as HTMLElement).dataset.id;
                const el = id ? findEl(id) : undefined;
                if (!last || !id || !el) return;
                const [dx, dy] = last.drag.dist as [number, number];
                rects.push({
                  id,
                  rect: {
                    ...el.rect,
                    x: el.rect.x + pxToEmu(dx, scale),
                    y: el.rect.y + pxToEmu(dy, scale),
                  },
                  rotation: normalizeDeg(last.rotation),
                });
              });
              store().setRects(rects);
            }}
          />
        ) : null}

        {/* Mounted only once the workspace node exists — see `dragRoot`. */}
        {dragRoot ? (
          <Selecto
            ref={selectoRef}
            // The whole workspace, not just the slide: PowerPoint lets a
            // marquee start out in the grey surround and sweep onto the slide.
            dragContainer={dragRoot}
            selectableTargets={['.dd-el']}
            hitRate={100}
            selectFromInside={false}
            selectByClick={false}
            toggleContinueSelect={['shift']}
            onDragStart={(e) => {
              const inp = e.inputEvent as MouseEvent;
              const target = inp.target as HTMLElement;
              // Hit-test the point, not `target`: Moveable's own overlay covers
              // the element it targets, so `target` is the overlay rather than
              // the element on every press that lands on the selection.
              const hitId = elementAtPoint(inp.clientX, inp.clientY)?.dataset.id;
              if (
                moveableRef.current?.isMoveableElement(target) ||
                target.closest?.(CHROME_SELECTOR) ||
                hitId ||
                selectedNodes.some((n) => n === target || n.contains(target))
              ) {
                // A press on an object is a move, never a marquee.
                e.stop();
              }
              // Pressing an object that wasn't selected yet is the case that
              // used to need two clicks: `resolveMouseDown` selects it, but
              // Moveable is gated on there being a selection, so it only mounts
              // on the render that follows and never saw this mousedown. Replay
              // the press into it once it exists — otherwise the gesture is
              // dropped and the object doesn't move until you release and press
              // again. Deferred by a frame because the selection state has to
              // commit (and Moveable mount) first.
              if (hitId && !selectedIds.includes(hitId) && hitId !== editingId) {
                requestAnimationFrame(() => moveableRef.current?.dragStart(inp));
              }
            }}
            onSelectEnd={(e) => {
              // A click (not a marquee) also ends a Selecto gesture, and its
              // `selected` is just the pre-existing selection — applying it
              // would stomp the click's own selection change.
              if (e.isDragStartEnd) return;
              const ids = e.selected
                .map((n) => (n as HTMLElement).dataset.id)
                .filter(Boolean) as string[];
              store().select(ids);
            }}
          />
        ) : null}
        </div>
      </div>

      <ChartDatasheetHost
        chart={slide.charts?.find((c) => c.id === openChartId) ?? null}
        onClose={() => setOpenChartId(null)}
      />

      {menu ? (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={closeMenu}
        />
      ) : null}

    </div>
  );
}

/**
 * Renders the datasheet only while its chart still exists.
 *
 * The chart can vanish under an open panel — an undo, a delete, or switching
 * slides — and the panel must fold quietly rather than throw.
 */
function ChartDatasheetHost({
  chart,
  onClose,
}: {
  chart: ChartInstance | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!chart) onClose();
  }, [chart, onClose]);
  return chart ? <ChartDatasheetPanel chart={chart} onClose={onClose} /> : null;
}
