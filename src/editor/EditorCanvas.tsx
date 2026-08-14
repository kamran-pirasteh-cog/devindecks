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
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  type Rect,
  isGridSpec,
  supportsTurn,
  type ChartInstance,
} from '@/model';
import { useEditor } from '@/store/editorStore';
import { SelectionFormatBar } from './SelectionFormatBar';
import { ArrangeBar } from './ArrangeBar';
import { TextEditor } from './TextEditor';
import { ChartDatasheetPanel } from './chart/ChartDatasheetPanel';
import { CommentPins } from './CommentPins';
import { measureTextFitPx } from './fitToText';
import { layoutFrame, previewTurn, turnRect, readableAngle, snapQuarterTurn } from '@/chart/turn';

const CANVAS_PAD = 48;

/**
 * Editor chrome that floats over the slide — the format/arrange bars and the
 * comment pins. A press on any of it acts ON the selection, so it must never
 * change it, and must never be read as the start of a marquee.
 */
const CHROME_SELECTOR = '.dd-format-bar, .dd-comment-pin';

/** Rotations are stored 0–359, so 1° and 361° are the same stored value. */
const normalizeDeg = (d: number) => ((Math.round(d) % 360) + 360) % 360;

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
  // PowerPoint-style resize modifiers: Shift keeps aspect ratio (keepRatio prop,
  // must be a live value so react-moveable re-reads it every frame), Ctrl
  // resizes from the center (via onBeforeResize's per-frame setFixedDirection).
  const [keepRatioActive, setKeepRatioActive] = useState(false);
  const resizeFromCenterRef = useRef(false);
  const resizeModifierCleanupRef = useRef<(() => void) | null>(null);
  // PowerPoint-style drag modifiers: Shift constrains movement to the
  // horizontal/vertical axis; ⌘/Ctrl drops a copy instead of moving the
  // original, and the two combine (⌘⇧-drag = duplicate along one axis).
  const dragAxisLockRef = useRef(false);
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
   * The chart whose datasheet is open. Held by id rather than by object so the
   * panel always reads the live instance out of the store — a stale copy would
   * show the data as it was when the panel opened.
   */
  const [openChartId, setOpenChartId] = useState<string | null>(null);

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
      return (e: WheelEvent): -1 | 0 | 1 => {
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
      };
    })(),
  );

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
      if (!e.ctrlKey && !e.metaKey) {
        // Zoomed in far enough that the slide overflows? Let the wheel pan it,
        // and only page the deck once that edge is reached.
        const max = el.scrollHeight - el.clientHeight;
        if (max > 1 && ((e.deltaY < 0 && el.scrollTop > 0) || (e.deltaY > 0 && el.scrollTop < max)))
          return;
        e.preventDefault();
        const dir = wheelStepRef.current(e);
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
  const soleChart =
    slide?.charts?.find(
      (c) =>
        selectedIds.length > 0 &&
        selectedIds.every(
          (id) => slide.elements.find((e) => e.id === id)?.chartRef?.chartId === c.id,
        ),
    ) ?? null;

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
   * Live quarter turn being dragged on the chart, relative to where it sits now.
   *
   * The rotate handle is on the backdrop, but a chart turns as one object, so
   * every one of its primitives is repainted from this delta with the same
   * maths `turnElements` will commit — no jump on mouseup.
   */
  const liveChartTurn =
    soleChart && liveRotate && liveRotate.id === chartBackdropId
      ? snapQuarterTurn(liveRotate.deg - (soleChart.rotation ?? 0))
      : null;

  /** What Moveable actually transforms: one node for a chart, else the selection. */
  const targetIds = chartBackdropId ? [chartBackdropId] : selectedIds;

  const selectedNodes = targetIds
    .map((id) => nodeMap.current.get(id))
    .filter(Boolean) as HTMLElement[];

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

  const deferSelect = (id: string, mode: DeferredSelect) => {
    pendingSelectRef.current = { id, mode };
    const finalize = () => {
      const pending = pendingSelectRef.current;
      pendingSelectRef.current = null;
      window.removeEventListener('mouseup', finalize);
      if (pending?.id !== id) return;
      if (pending.mode === 'toggle') store().toggleSelect(id);
      else if (pending.mode === 'member') store().selectExact([id]);
      else store().select([id]);
    };
    window.addEventListener('mouseup', finalize);
  };

  const attachDragModifiers = (inputEvent: any) => {
    dragModifierCleanupRef.current?.();
    // ⌘ (Ctrl off Apple platforms) rather than Ctrl everywhere: Ctrl-drag on a
    // Mac is a right-click, so it can't be held through a drag.
    const apply = (shift: boolean, mod: boolean) => {
      dragAxisLockRef.current = shift;
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
    dragAxisLockRef.current = false;
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
   * taller plot wants a different number of gridlines — but during the gesture
   * the honest preview is an affine one: every part moves and scales with the
   * box. Without this only the backdrop tracked the handle while the bars and
   * labels sat still, and the whole chart jumped at the end.
   */
  const chartResizeStartRef = useRef<{
    frame: { x: number; y: number; w: number; h: number };
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
     * Each part in the chart's UNROTATED frame, plus the angle it is drawn at.
     * Scaling happens in that space — the handle's width is the frame's width
     * whatever way round the chart is — and the turn is re-applied after.
     */
    nodes: { node: HTMLElement; x: number; y: number; w: number; h: number; spin: number }[];
  } | null>(null);

  const paintChartResize = (ev: any) => {
    const start = chartResizeStartRef.current;
    if (!start) return;
    const [dx, dy] = ev.drag.dist as [number, number];
    const x = start.frame.x + dx;
    const y = start.frame.y + dy;
    const frame = { x, y, w: ev.width, h: ev.height };
    const layout = layoutFrame(frame, start.rotation);
    const sx = start.layout.w > 0 ? layout.w / start.layout.w : 1;
    const sy = start.layout.h > 0 ? layout.h / start.layout.h : 1;

    for (const n of start.nodes) {
      // Glyphs keep their size regardless — font size comes from the model,
      // not from the box — so scaling a text box moves it without distorting
      // the type, which is a fair picture of where it will land.
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
   * Hand the chart's nodes back to React.
   *
   * `paintChartResize` writes `width`/`height` inline, and React never set
   * those — it positions elements with `transform` alone — so it has no reason
   * to rewrite them on the next render. Left behind, they pin every part at
   * whatever size the drag ended on, which is the stale outline you see around
   * labels after a resize.
   */
  const clearChartResizePaint = () => {
    const start = chartResizeStartRef.current;
    if (!start) return;
    for (const n of start.nodes) {
      n.node.style.removeProperty('width');
      n.node.style.removeProperty('height');
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

  const lockAxis = (dx: number, dy: number): [number, number] =>
    Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];

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
  const elementAtPoint = (clientX: number, clientY: number) =>
    document
      .elementsFromPoint(clientX, clientY)
      .map((n) => (n as HTMLElement).closest?.('.dd-el') as HTMLElement | null)
      .find(Boolean) as HTMLElement | undefined;

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

    const id = elementAtPoint(e.clientX, e.clientY)?.dataset.id;

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
      store().selectExact([id]);
      return;
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
        <div className="absolute bottom-full right-0 z-30 mb-2 flex justify-end">
          <SelectionFormatBar onOpenChartData={setOpenChartId} />
        </div>
        <div className="absolute left-full top-0 z-30 ml-1.5 flex">
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
          // Objects and empty canvas carry no menu of their own — the format and
          // arrange bars cover that — so the browser's is suppressed everywhere
          // on the slide. Text being edited is the exception: the native menu is
          // how you reach spellcheck and paste-as-plain-text.
          onContextMenu={(e) => {
            if (!(e.target as HTMLElement).closest?.('[contenteditable="true"]')) {
              e.preventDefault();
            }
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
          const live = liveResize?.[el.id] ?? null;
          // A chart mid-turn: this primitive orbits the frame's centre and
          // spins by the same quarter turn, kept inside the frame so the chart
          // turns in its box — the commit re-solves the layout, see `turn.ts`.
          const turning =
            liveChartTurn !== null && soleChart && el.chartRef?.chartId === soleChart.id
              ? previewTurn(el.rect, soleChart.frame, liveChartTurn)
              : null;
          const rect = turning ? turning.rect : el.rect;
          const boxX = live ? live.x : rect.x * scale;
          const boxY = live ? live.y : rect.y * scale;
          const boxW = live ? live.w : rect.w * scale;
          const boxH = live ? live.h : rect.h * scale;
          // Mid-rotation the live angle wins, so the object turns with the
          // handle instead of snapping into place on mouseup.
          const spinDeg = turning
            ? readableAngle((el.rotation ?? 0) + turning.spin, el.type === 'text')
            : liveRotate?.id === el.id
              ? liveRotate.deg
              : (el.rotation ?? 0);
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
        {deck.pageNumbers ? (
          <PageNumber
            index={deck.slides.findIndex((s) => s.id === slide.id)}
            count={deck.slides.length}
            backgroundHex={slideBackgroundHex(slide, ds)}
            ds={ds}
            scale={scale}
          />
        ) : null}

        {/* Comment markers for this slide, above the elements they annotate. */}
        <CommentPins slide={slide} scale={scale} />

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

        {/* Transform controls for the current selection. */}
        {selectedNodes.length > 0 && !editingId ? (
          <Moveable
            ref={moveableRef}
            target={selectedNodes}
            draggable
            resizable
            // A scatter or bubble plot has no side to lie on, so it gets no
            // rotate handle at all — see `supportsTurn`.
            rotatable={!soleChart || supportsTurn(soleChart.spec.kind)}
            keepRatio={keepRatioActive}
            origin={false}
            throttleDrag={0}
            throttleResize={0}
            // Charts snap to the four orientations — a chart at 37° is a
            // mistake, not a design. Everything else rotates freely.
            throttleRotate={soleChart ? 90 : 0}
            snappable
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
              const [dx, dy] = dragAxisLockRef.current
                ? lockAxis(e.dist[0], e.dist[1])
                : (e.dist as [number, number]);
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
              const wasAxisLocked = dragAxisLockRef.current;
              detachDragModifiers();
              clearGhosts();
              demoteAfterGesture([e.target as HTMLElement]);
              const last = e.lastEvent;
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              const [dx, dy] = wasAxisLocked
                ? lockAxis(last.dist[0], last.dist[1])
                : (last.dist as [number, number]);
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
              const [dx, dy] = dragAxisLockRef.current
                ? lockAxis(first.dist[0], first.dist[1])
                : (first.dist as [number, number]);
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
              const wasAxisLocked = dragAxisLockRef.current;
              detachDragModifiers();
              clearGhosts();
              demoteAfterGesture(e.events.map((ev) => ev.target as HTMLElement));
              const last = e.events[0]?.lastEvent;
              if (!last) return;
              const [dx, dy] = wasAxisLocked
                ? lockAxis(last.dist[0], last.dist[1])
                : (last.dist as [number, number]);
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
                frame: framePx,
                rotation,
                layout: layoutPx,
                nodes: chartNodes().map(({ node, rect }) => {
                  // Undo the chart's turn to get back to layout space; the
                  // frame's centre is the same point either way round.
                  const { rect: local } = turnRect(
                    { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale },
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
              clearChartResizePaint();
              const last = e.lastEvent;
              setLiveResize(null);
              if (!last) return;
              const id = (e.target as HTMLElement).dataset.id!;
              const el = findEl(id);
              if (!el) return;
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
                store().setChartFrame(soleChart.id, rect);
              } else {
                store().setRect(id, rect);
              }
            }}
            // Group resize, PowerPoint-style: dragging ONE handle of a
            // multi-selection applies the SAME scale factors to every selected
            // object, but each one is scaled about its OWN anchor corner — so
            // the objects change size in place and never move relative to each
            // other. (Google Slides instead rescales the selection's bounding
            // box, which slides the objects around; that is not what we want.)
            //
            // Moveable's per-target child events describe exactly that bounding
            // box behaviour, so they're deliberately unused here: only the group
            // box's own dimensions are read, to derive the scale factors.
            onResizeGroupStart={(e) => {
              beginResize(e.inputEvent);
              groupResizeRef.current = [];
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
              // began, so `width - dist` is exactly where it started.
              const [distW, distH] = e.dist as [number, number];
              const startW = e.width - distW;
              const startH = e.height - distH;
              const sx = startW > 0 ? e.width / startW : 1;
              const sy = startH > 0 ? e.height / startH : 1;
              // Which edges the drag holds still. A handle on an edge (dir 0 on
              // that axis) only scales that axis when Shift forces the ratio, so
              // there's no meaningful edge to pin — grow about the centre, as
              // ⌘/Ctrl does on both axes.
              const [dirX, dirY] = e.direction as [number, number];
              const fromCenter = resizeFromCenterRef.current;
              const anchor = (dir: number, from: number, size: number, next: number) =>
                fromCenter || dir === 0
                  ? from + (size - next) / 2
                  : dir > 0
                    ? from
                    : from + size - next;

              const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
              const rects: { id: string; rect: Rect }[] = [];
              groupResizeStartRef.current.forEach((start) => {
                const w = Math.max(4, start.w * sx);
                const h = Math.max(4, start.h * sy);
                const box = {
                  x: anchor(dirX, start.x, start.w, w),
                  y: anchor(dirY, start.y, start.h, h),
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
