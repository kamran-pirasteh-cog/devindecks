'use client';

/**
 * The editor store IS the command layer. Every mutation — whether triggered by
 * a toolbar button, a drag on the canvas, the inspector, or (later) Devin — goes
 * through one of these actions. That gives us free, coherent undo/redo and
 * guarantees the AI can never do anything the UI can't.
 *
 * History is snapshot-based: `commit()` clones the deck before a mutation so we
 * can step back. Transient drags call the mutating action with `transient=true`
 * to avoid flooding history, then commit once on drop.
 *
 * The snapshot for a transient burst is taken at its START, not at the closing
 * commit — see `beginChange`. Taking it at the end would snapshot a deck the
 * preview had already changed, so undo would land mid-drag (or, for a slider or
 * a chart cell, appear to do nothing at all).
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';
import {
  DEFAULT_DESIGN_SYSTEM,
  EMU_PER_POINT,
  expandSelection,
  inchesToEmu,
  isTitleRole,
  marginBox,
  marginGuides,
  outerGroupId,
  ROUNDABLE_PRESETS,
  selectionUnits,
  supportsTurn,
  unionRect,
  type BulletKind,
  type Crop,
  type Deck,
  type DesignSystem,
  type EMU,
  type Fill,
  type LabelFont,
  type Outline,
  type Paragraph,
  type Rect,
  migrateDeck,
  reidentifyCharts,
  type ChartInstance,
  type ChartSpec,
  type Slide,
  type SlideElement,
  type TextRun,
  type VerticalAnchor,
  showsPageNumbers,
} from '@/model';
import { compileChart } from '@/chart/compile';
import { snapQuarterTurn } from '@/chart/turn';
import { nextRotation, normalizeDeg } from '@/editor/rotateStep';
import {
  applyChartFormat,
  applyChartTextFormat,
  chartFontFromRun,
  runSizeOf,
  chartById,
  chartElementRects,
  chartElementIdsBefore,
  chartsForElements,
  clearChartFormatting,
  deleteChartParts,
  detachChartFrom,
  insertChartInto,
  recompileInto,
  removeChartFrom,
  repairChartSelection,
  resizeChartFrames,
  syncChartGeometry,
  translateChartFrames,
} from './chartActions';
import { clampLevel } from '@/render/bullets';
import { applyFormat, extractFormat, type ElementFormat } from '@/editor/elementFormat';
import { formatRange, locateRun } from '@/editor/textRange';
import {
  eyebrowElement,
  eyebrowOrigin,
  eyebrowSlotAction,
  makeEyebrow,
  titleYUnderEyebrow,
} from '@/editor/eyebrow';
import {
  makeSticky,
  stickyGrowth,
  stickyNoteOf,
  stickyOrigin,
  syncStickyGeometry,
  STICKY_TEXT_ROLE,
} from '@/editor/sticky';

export type AlignMode =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom';

/**
 * PowerPoint's "increase/decrease font size" buttons step through this preset
 * list. 26 is ours rather than PowerPoint's — the size menu offers it, so the
 * shortcut has to be able to land on it too.
 */
export const FONT_SIZE_STEPS = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 26, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96,
];

function nextFontSize(current: number, dir: 'up' | 'down'): number {
  if (dir === 'up') {
    const next = FONT_SIZE_STEPS.find((n) => n > current);
    return next ?? current;
  }
  const prev = [...FONT_SIZE_STEPS].reverse().find((n) => n < current);
  return prev ?? current;
}

/** How far each successive paste steps clear of the one before it. */
const PASTE_STEP = inchesToEmu(0.1);

/** A detached deep copy — the deck holds only plain JSON, so this is enough. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A detached, freshly identified copy of a slide — what a duplicate or a slide
 * paste drops into the deck.
 *
 * Chart-owned element ids encode which chart and part they are, so they can't
 * be randomized: `reidentifyCharts` regenerates them from a fresh chart id
 * instead, and everything else re-keys as usual. Group ids are left alone —
 * a group never spans slides, so a whole-slide copy carries a whole group.
 */
function freshSlideCopy(slide: Slide): Slide {
  const copy: Slide = clone(slide);
  copy.id = `s-${nanoid(8)}`;
  copy.elements = copy.elements.map((e) => (e.chartRef ? e : { ...e, id: `${e.id}-${nanoid(4)}` }));
  return reidentifyCharts(copy);
}

/**
 * What a cut or copy puts on the clipboard: detached copies, never live
 * references into a slide.
 *
 * Charts are carried as their SPEC rather than as the rectangles they compiled
 * to, because a chart's elements are owned by the chart — pasting the shapes
 * alone would hand them to the original chart, which would delete them on its
 * next recompile.
 */
interface ObjectClipboard {
  elements: SlideElement[];
  charts: Array<{ spec: ChartSpec; frame: Rect }>;
  /** The slide it was taken from: pasting back onto it steps clear of the original. */
  sourceSlideId: string;
  /** Pastes made onto that source slide, so a run of ⌘V fans out instead of stacking. */
  pastes: number;
}

interface EditorState {
  deck: Deck;
  designSystem: DesignSystem;
  currentSlideId: string;
  selectedIds: string[];
  editingId: string | null;

  // slide (filmstrip) multi-selection
  selectedSlideIds: string[];
  slideSelectionAnchor: string | null;

  past: Deck[];
  future: Deck[];

  /**
   * The deck as it stood before the current transient burst (a drag, a slider,
   * live typing in a chart cell). Held out of `past` until the burst commits,
   * because a burst the user abandons shouldn't cost an undo step. Never
   * persisted — see `beginChange`.
   */
  transientBase: Deck | null;

  /**
   * Format painter buffer. Deliberately outside the deck: it's a scratch
   * register, not document state, so it survives undo and isn't autosaved.
   */
  formatClipboard: ElementFormat | null;

  /**
   * Cut/copy buffer for whole objects. Outside the deck for the same reason as
   * the format painter — which is what lets you cut, undo the cut, and still
   * paste — and detached from the slide it came from, so the copy doesn't
   * change when the original does.
   */
  clipboard: ObjectClipboard | null;

  /**
   * Cut/copy buffer for whole slides, filled from the filmstrip. Separate from
   * the object clipboard so a copied slide isn't lost the moment you copy a box
   * on the canvas, and outside the deck for the same reason as both of the
   * others — it survives undo and isn't autosaved.
   */
  slideClipboard: Slide[] | null;

  /**
   * Whether the margin guides are painted on the canvas. View state, not deck
   * state: hiding the guides doesn't stop objects snapping to them, exactly as
   * PowerPoint's guides behave.
   */
  showGuides: boolean;

  /**
   * A just-inserted text box whose model rect is still the factory's default.
   * `autofit: 'resize'` means "the box is the text's size", but only the canvas
   * can measure type, so it does the fit as soon as the node exists and clears
   * this. Transient view state — never in the deck, never undone on its own.
   */
  pendingFitId: string | null;
  clearPendingFit: () => void;

  /**
   * The picture currently in crop mode, if any. View state, like `editingId`:
   * the crop itself lives on the element and is undoable, but "the crop handles
   * are showing" is not something you undo into.
   */
  croppingId: string | null;
  setCropping: (id: string | null) => void;
  /**
   * Commit a crop. Rect and insets always move together — dragging a handle
   * trims the picture without shifting the pixels that survive — so they're one
   * action and one history step. `crop` of `undefined` clears back to the plain
   * cover fit.
   */
  setCrop: (id: string, crop: Crop | undefined, rect?: Rect, transient?: boolean) => void;

  // selection
  /** Select these ids, grown so no group is ever half-selected. */
  select: (ids: string[], additive?: boolean) => void;
  /**
   * Select exactly these ids, group membership ignored — the "click again to
   * reach into a group" path. Everything else should use `select`.
   */
  selectExact: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setEditing: (id: string | null) => void;
  /**
   * Open `id` for editing with `text` already typed into it — the keystroke that
   * asked for the editor, which would otherwise be eaten by the mount.
   *
   * The character goes into the MODEL rather than into the editable: the editor
   * paints its DOM from the model on mount (twice, under StrictMode), so
   * anything inserted into the DOM around that mount is painted over.
   */
  beginEditWith: (id: string, text: string) => void;
  setCurrentSlide: (id: string) => void;
  stepSlide: (delta: number) => void;
  setTitle: (title: string) => void;
  toggleGuides: () => void;
  /** Turn deck-wide page numbers on or off. Deck state, so it's undoable. */
  togglePageNumbers: () => void;

  // element mutations (all commit unless transient)
  addElement: (el: SlideElement) => void;
  /**
   * Add several elements as ONE step — a callout card is four boxes that must
   * arrive, select and undo together, not four presses of ⌘Z.
   */
  addElements: (els: SlideElement[]) => void;
  /**
   * Insert an eyebrow above this slide's title and leave the caret in it,
   * nudging the title down to make room. One step: the mark, the type and the
   * title's new position arrive and undo together.
   */
  insertEyebrow: () => void;
  /**
   * Drop a sticky note on the current slide and leave the caret in it. One step,
   * for the same reason the eyebrow is one: the paper, the tape and the type
   * arrive and undo together.
   */
  insertSticky: () => void;
  /**
   * Resize the sticky that owns this text box so `textHeightEmu` of type fits —
   * the model half of "the note grows as you type". A no-op for any text box
   * that isn't a sticky's, and for a height the note already has, so it can be
   * called on every keystroke.
   */
  growSticky: (textId: string, textHeightEmu: EMU, transient?: boolean) => void;
  updateElement: (id: string, patch: Partial<SlideElement>, transient?: boolean) => void;
  setRect: (id: string, rect: Rect, transient?: boolean) => void;
  /** Commit several boxes at once (a group transform) as ONE history step. */
  setRects: (
    rects: { id: string; rect: Rect; rotation?: number }[],
    transient?: boolean,
  ) => void;
  moveBy: (ids: string[], dx: EMU, dy: EMU, transient?: boolean) => void;
  /**
   * Grow or shrink each box by the same amount, top-left pinned — the keyboard
   * counterpart to dragging the bottom-right handle.
   *
   * Pictures keep their aspect ratio unless `stretch` says otherwise: see
   * `keepRatioFactor`.
   */
  resizeBy: (
    ids: string[],
    dw: EMU,
    dh: EMU,
    opts?: { transient?: boolean; stretch?: boolean },
  ) => void;
  /**
   * Turn each box one step about its own centre — the keyboard counterpart to
   * the rotation handle. `dir` is 1 for clockwise, -1 for anticlockwise; the
   * angle it lands on is the next stop on the 22.5° grid (see `nextRotation`).
   */
  rotateBy: (ids: string[], dir: 1 | -1) => void;
  duplicateBy: (ids: string[], dx: EMU, dy: EMU) => void;
  setFill: (ids: string[], fill: Fill) => void;
  /**
   * Fill opacity, 0..1. Separate from `setFill` so changing it doesn't have to
   * know each element's color: an unfilled box gains no fill from this.
   */
  setFillAlpha: (ids: string[], alpha: number) => void;
  setOutline: (ids: string[], outline: Outline | undefined) => void;
  /**
   * Round or square the corners of rectangular shapes. Rounding is a preset
   * swap rather than a radius field: the model's geometry vocabulary is the
   * preset list, and both exporters speak it, so a rounded rect stays rounded
   * in PowerPoint instead of becoming a custom path.
   */
  setCornersRounded: (ids: string[], rounded: boolean) => void;
  patchRuns: (ids: string[], patch: Partial<TextRun>) => void;
  /**
   * PowerPoint's grow/shrink font. Each run steps from ITS OWN size, so a
   * selection holding a 40pt title and 14pt body keeps that relationship
   * instead of collapsing to one size.
   */
  stepFontSize: (ids: string[], dir: 'up' | 'down') => void;
  patchParagraphs: (ids: string[], patch: Partial<Omit<Paragraph, 'runs'>>) => void;
  /** Vertical anchor of the text inside its box (PowerPoint's bodyPr anchor). */
  setAnchor: (ids: string[], anchor: VerticalAnchor) => void;
  /** Turn a list style on for the selected boxes, or off if already on. */
  toggleBullet: (ids: string[], kind: BulletKind) => void;
  /** Nudge list indent level, clamped to the model's 0..4. */
  indentParagraphs: (ids: string[], delta: number) => void;
  deleteSelected: () => void;

  // object clipboard
  /** Copy the selection, then take it off the slide. */
  cutSelection: () => void;
  copySelection: () => void;
  /**
   * Drop the buffer onto the current slide and select what landed. Pasting back
   * onto the slide it came from offsets each copy; pasting anywhere else keeps
   * the objects where they sat, so a layout moved between slides stays put.
   */
  pasteClipboard: () => void;

  // format painter
  copyFormat: (id?: string) => void;
  pasteFormat: (ids?: string[]) => void;
  /** Sample the format of the run at a character offset inside one text body. */
  copyTextFormat: (id: string, offset: number, bias?: 'before' | 'after') => void;
  /** Stamp the buffered format onto the characters in `[start, end)`. */
  pasteTextFormat: (id: string, start: number, end: number) => void;

  // arrangement
  align: (mode: AlignMode) => void;
  /**
   * Scale + shift the slide's content (or just the selection) as ONE block
   * until it sits inside the margin guides.
   */
  fitToMargins: () => void;
  distribute: (axis: 'h' | 'v') => void;
  matchSize: () => void;
  matchFormat: () => void;
  reorder: (dir: 'front' | 'back' | 'forward' | 'backward') => void;
  /** ⌘G — bind the selected objects into one group. */
  group: () => void;
  /** ⌘⇧G — release the outermost group of everything selected. */
  ungroup: () => void;

  // slides
  addSlide: () => void;
  insertSlides: (slides: Slide[]) => void;
  duplicateSlide: (id: string) => void;
  deleteSlide: (id: string) => void;

  // charts
  /** Drop a new chart on the current slide and select it. */
  insertChart: (spec: ChartSpec, frame?: Rect) => void;
  /** Replace a chart's spec wholesale (the datasheet's save path). */
  updateChartSpec: (chartId: string, spec: ChartSpec, transient?: boolean) => void;
  /**
   * Mutate a chart's spec in place and recompile. The `transient` flag is the
   * same contract as a drag: skip history while the user is still typing, then
   * one commit when they stop.
   */
  patchChart: (chartId: string, fn: (spec: ChartSpec) => void, transient?: boolean) => void;
  /** Move/resize a chart as a unit, relaying out at the new size. */
  setChartFrame: (chartId: string, frame: Rect, transient?: boolean) => void;
  /**
   * Turn a chart to one of the four orientations. Any angle is accepted and
   * snapped — charts are never left at a diagonal.
   */
  setChartRotation: (chartId: string, deg: number) => void;
  recompileChart: (chartId: string) => void;
  /**
   * Drop the hand-applied colour and type off a chart and take the brand's
   * again. Data and the reader's choices stay — see `clearChartFormatting`.
   */
  resetChartFormatting: (chartId: string) => void;
  deleteChart: (chartId: string) => void;
  /** The chart a given element belongs to, or null. */
  chartOf: (elementId: string) => ChartInstance | null;

  // slide multi-selection (filmstrip)
  selectSlideRange: (id: string) => void;
  deleteSlides: (ids: string[]) => void;
  moveSlides: (ids: string[], beforeId: string | null) => void;
  /** Add or drop one slide from the filmstrip selection (⌘-click). */
  toggleSlideSelection: (id: string) => void;

  // slide clipboard
  /**
   * Copy whole slides. Defaults to the filmstrip selection, falling back to the
   * current slide, so ⌘C with one thumbnail focused does the obvious thing.
   */
  copySlides: (ids?: string[]) => void;
  cutSlides: (ids?: string[]) => void;
  /** Drop the buffered slides in after the current one and select them. */
  pasteSlides: () => void;

  // history
  commit: () => void;
  /**
   * The one entry point every mutating action uses. `transient` means "this is
   * a frame of a gesture, not a step" — the first such call banks the pre-burst
   * deck, the closing non-transient call turns it into the history entry.
   */
  beginChange: (transient?: boolean) => void;
  undo: () => void;
  redo: () => void;

  // helpers
  currentSlide: () => Slide;
}

const HISTORY_LIMIT = 100;

/**
 * Settle the view onto a deck we just stepped to.
 *
 * The current slide matters as much as the deck: undoing an "add slide" leaves
 * `currentSlideId` naming a slide that no longer exists, and while the canvas
 * falls back to the first slide, every mutating action looks the id up and
 * silently does nothing — the editor goes dead until you click the filmstrip.
 * Landing on the nearest surviving slide keeps the two in step.
 */
function landOn(
  s: {
    currentSlideId: string;
    selectedIds: string[];
    editingId: string | null;
    croppingId: string | null;
    selectedSlideIds: string[];
    slideSelectionAnchor: string | null;
  },
  deck: Deck,
): void {
  if (!deck.slides.some((sl) => sl.id === s.currentSlideId)) {
    s.currentSlideId = deck.slides[0]?.id ?? '';
  }
  s.selectedIds = [];
  s.editingId = null;
  s.croppingId = null;
  s.selectedSlideIds = [];
  s.slideSelectionAnchor = null;
}

/** Push one entry onto the undo ring and drop the redo branch. */
function pushPast(s: { past: Deck[]; future: Deck[] }, entry: Deck): void {
  s.past.push(entry);
  if (s.past.length > HISTORY_LIMIT) s.past.shift();
  s.future = [];
}

/**
 * Floor for a keyboard resize, ~1/20". Shrinking stops here rather than
 * inverting the box, so holding the key down can't lose an object.
 */
const MIN_SIZE: EMU = EMU_PER_POINT * 3.6;

/**
 * The single scale a keep-ratio resize applies, taken from whichever axis the
 * arrow drove.
 *
 * The floor is computed on the FACTOR rather than on each side: clamping w and
 * h separately is exactly what distorts a picture as it reaches the minimum —
 * the narrow side stops while the long one keeps shrinking.
 */
function keepRatioFactor(rect: Rect, dw: EMU, dh: EMU): number {
  const raw = dw !== 0 ? (rect.w + dw) / rect.w : (rect.h + dh) / rect.h;
  return Math.max(raw, MIN_SIZE / rect.w, MIN_SIZE / rect.h);
}

/**
 * Run a mutation that relayouts charts, and carry the selection across it.
 *
 * Every recompile can change which of a chart's elements exist, and the canvas
 * reads "the whole chart is selected" as "every one of its ids is selected", so
 * a selection left untouched here silently degrades into a drill-in on the
 * parts that happened to survive — see `repairChartSelection`.
 */
function withChartSelection(
  s: { selectedIds: string[] },
  slide: Slide,
  chartIds: string[],
  run: () => void,
): void {
  const before = chartElementIdsBefore(slide, chartIds);
  run();
  s.selectedIds = repairChartSelection(slide, before, s.selectedIds);
}

/**
 * Route a type change on chart parts into the spec, and hand back the ids that
 * were consumed so the ordinary element loop skips them.
 *
 * Wrapped in `withChartSelection` because the recompile it triggers changes
 * which parts exist — a bigger label can cost the chart a tick — and a
 * selection left holding retired ids stops reading as the chart.
 */
function withChartTextFormat(
  s: { selectedIds: string[]; designSystem: DesignSystem },
  slide: Slide,
  ids: string[],
  fontFor: (el: SlideElement) => LabelFont | null,
): Set<string> {
  const chartIds = chartsForElements(slide, ids).map((c) => c.id);
  if (!chartIds.length) return new Set();
  let claimed: string[] = [];
  withChartSelection(s, slide, chartIds, () => {
    claimed = applyChartTextFormat(slide, ids, s.designSystem, fontFor);
  });
  return new Set(claimed);
}

function slideById(deck: Deck, id: string): Slide | undefined {
  return deck.slides.find((s) => s.id === id);
}

/**
 * Where a chart lands when it's inserted with no box of its own: centred, and
 * leaving a title's worth of room at the top. Sized off the slide rather than
 * hard-coded so 4:3 decks get a sensible box too.
 */
function defaultChartFrame(slideSize: { w: EMU; h: EMU }): Rect {
  const w = Math.round(slideSize.w * 0.72);
  const h = Math.round(slideSize.h * 0.62);
  return {
    x: Math.round((slideSize.w - w) / 2),
    y: Math.round(slideSize.h * 0.26),
    w,
    h,
  };
}

/** Selection split into groups-as-one-box + loose elements, with their bounds. */
function unitBoxes(state: EditorState, ids: string[]) {
  const els = slideById(state.deck, state.currentSlideId)?.elements ?? [];
  return selectionUnits(els, ids)
    .map((unit) => ({ ids: unit, r: unionRect(els, unit) }))
    .filter((b): b is { ids: string[]; r: NonNullable<typeof b.r> } => !!b.r);
}

/**
 * Translate whole units — every member of a group moves by the same delta.
 *
 * A chart is one such unit (its parts share a group), and its FRAME has to
 * travel with them: the elements are only a rendering of the frame, so a chart
 * left behind by its frame snaps back to where it was the moment anything
 * recompiles it. This is the same move the drag and nudge paths make — see
 * `translateChartFrames`. Only a chart whose every part is in the shift counts:
 * aligning a lone bar is a part-level edit, and dragging the whole chart after
 * it would be wrong.
 */
const shiftUnits =
  (shifts: { ids: string[]; dx: number; dy: number }[]) => (s: EditorState) => {
    const slide = slideById(s.deck, s.currentSlideId);
    if (!slide) return;
    for (const { ids, dx, dy } of shifts) {
      if (!dx && !dy) continue;
      const moving = new Set(ids);
      const whole = chartsForElements(slide, ids)
        .filter((c) =>
          slide.elements.every((e) => e.chartRef?.chartId !== c.id || moving.has(e.id)),
        )
        .map((c) => c.id);
      for (const el of slide.elements) {
        if (!ids.includes(el.id)) continue;
        el.rect.x += dx;
        el.rect.y += dy;
      }
      translateChartFrames(
        slide,
        slide.elements.filter((e) => whole.includes(e.chartRef?.chartId ?? '')).map((e) => e.id),
        dx,
        dy,
      );
    }
  };

type ImmerSet = (updater: (draft: EditorState) => void) => void;
type Initializer = (set: ImmerSet, get: () => EditorState) => EditorState;

/**
 * Every write in the store goes out through the `set` this hands the actions, and
 * every write ends with the current slide's stickies put back together — see
 * `syncStickyGeometry`.
 *
 * A sticky is one object made of three primitives, and the alternative is
 * chasing its tape through every gesture that can move geometry (drag, group
 * resize at an angle, rotate, nudge, align, match-size, undo…) — which is how
 * the tape comes unstuck in the first place. Cheap enough to do unconditionally:
 * it walks one slide's elements and touches nothing on a slide with no stickies.
 */
const withStickySync =
  (init: Initializer): Initializer =>
  (set, get) =>
    init((updater) => {
      set((s) => {
        updater(s);
        const slide = slideById(s.deck, s.currentSlideId);
        if (slide) syncStickyGeometry(slide.elements);
      });
    }, get);

export const useEditor = create<EditorState>()(
  immer(
    withStickySync((set, get) => ({
    deck: emptyDeck(),
    designSystem: DEFAULT_DESIGN_SYSTEM,
    currentSlideId: '',
    selectedIds: [],
    editingId: null,
    croppingId: null,
    selectedSlideIds: [],
    slideSelectionAnchor: null,
    past: [],
    future: [],
    transientBase: null,
    formatClipboard: null,
    clipboard: null,
    slideClipboard: null,
    showGuides: true,
    pendingFitId: null,

    clearPendingFit() {
      set((s) => {
        s.pendingFitId = null;
      });
    },

    setCropping(id) {
      set((s) => {
        s.croppingId = id;
        // Cropping acts on one picture, so entering the mode selects it — the
        // format bar and the overlay would otherwise disagree about the target.
        if (id && !s.selectedIds.includes(id)) s.selectedIds = [id];
      });
    },

    setCrop(id, crop, rect, transient = false) {
      get().beginChange(transient);
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const el = slide?.elements.find((e) => e.id === id);
        if (!el || el.type !== 'picture') return;
        el.crop = crop;
        if (rect) el.rect = rect;
      });
    },

    toggleGuides() {
      set((s) => {
        s.showGuides = !s.showGuides;
      });
    },

    currentSlide() {
      const { deck, currentSlideId } = get();
      return slideById(deck, currentSlideId) ?? deck.slides[0];
    },

    /**
     * Grouping lives here rather than at the call sites: a group is only a
     * group if EVERY path into the selection — click, shift-click, marquee,
     * Devin — treats it as one object.
     */
    select(ids, additive = false) {
      set((s) => {
        const els = slideById(s.deck, s.currentSlideId)?.elements ?? [];
        const grown = expandSelection(els, ids);
        s.selectedIds = additive
          ? Array.from(new Set([...s.selectedIds, ...grown]))
          : grown;
        if (!additive) s.editingId = null;
      });
    },

    selectExact(ids) {
      set((s) => {
        s.selectedIds = ids;
        s.editingId = null;
        s.croppingId = null;
      });
    },

    /** Shift-click: the whole group joins or leaves, never one member of it. */
    toggleSelect(id) {
      set((s) => {
        const els = slideById(s.deck, s.currentSlideId)?.elements ?? [];
        const unit = expandSelection(els, [id]);
        const on = unit.every((x) => s.selectedIds.includes(x));
        s.selectedIds = on
          ? s.selectedIds.filter((x) => !unit.includes(x))
          : [...s.selectedIds, ...unit.filter((x) => !s.selectedIds.includes(x))];
      });
    },

    clearSelection() {
      set((s) => {
        s.selectedIds = [];
        s.editingId = null;
        s.croppingId = null;
      });
    },

    setEditing(id) {
      set((s) => {
        s.editingId = id;
        if (id && !s.selectedIds.includes(id)) s.selectedIds = [id];
      });
    },

    beginEditWith(id, text) {
      // One step: the character and the open belong to the same keystroke, and
      // ⌘Z takes the note back to what it said before it was typed on.
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const el = slide?.elements.find((e) => e.id === id);
        const body = el && 'body' in el ? el.body : undefined;
        if (body) {
          // Appended to the last run, which is where the caret lands — the
          // editor collapses its selection to the end of the last paragraph.
          const para = body.paragraphs[body.paragraphs.length - 1];
          if (!para) body.paragraphs.push({ runs: [{ text }] });
          else if (!para.runs.length) para.runs.push({ text });
          else para.runs[para.runs.length - 1].text += text;
          s.deck.updatedAt = new Date(0).toISOString();
        }
        s.editingId = id;
        if (!s.selectedIds.includes(id)) s.selectedIds = [id];
      });
    },

    setCurrentSlide(id) {
      set((s) => {
        s.currentSlideId = id;
        s.selectedIds = [];
        s.editingId = null;
        s.croppingId = null;
        s.selectedSlideIds = [id];
        s.slideSelectionAnchor = id;
      });
    },

    /** Move `delta` slides from the current one, clamped at both ends. */
    stepSlide(delta) {
      const { deck, currentSlideId, setCurrentSlide } = get();
      const i = deck.slides.findIndex((sl) => sl.id === currentSlideId);
      const next = deck.slides[i + delta];
      if (next) setCurrentSlide(next.id);
    },

    selectSlideRange(id) {
      set((s) => {
        const ids = s.deck.slides.map((sl) => sl.id);
        const anchor = s.slideSelectionAnchor ?? s.currentSlideId;
        const anchorIdx = ids.indexOf(anchor);
        const clickedIdx = ids.indexOf(id);
        if (anchorIdx < 0 || clickedIdx < 0) {
          s.selectedSlideIds = [id];
          s.slideSelectionAnchor = id;
          return;
        }
        const [lo, hi] = anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
        s.selectedSlideIds = ids.slice(lo, hi + 1);
        s.currentSlideId = id;
        s.selectedIds = [];
        s.editingId = null;
        s.croppingId = null;
      });
    },

    /**
     * One flag for the whole deck — there is nothing to stamp onto individual
     * slides, because the numbers are derived at render time from each slide's
     * index (see `model/pageNumbers.ts`). That's what keeps them correct
     * through every insert, delete and reorder without a renumbering pass.
     *
     * Written against `showsPageNumbers`, not the raw flag: unset means on, so
     * `!s.deck.pageNumbers` would turn a fresh deck's numbers "on" while they
     * were already showing, and the first click would look like a no-op.
     */
    togglePageNumbers() {
      get().commit();
      set((s) => {
        s.deck.pageNumbers = !showsPageNumbers(s.deck);
      });
    },

    setTitle(title) {
      set((s) => {
        s.deck.title = title;
      });
    },

    addSlide() {
      get().commit();
      const id = `s-${nanoid(8)}`;
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => sl.id === s.currentSlideId);
        const slide: Slide = { id, elements: [] };
        s.deck.slides.splice(idx + 1, 0, slide);
        s.currentSlideId = id;
        s.selectedIds = [];
      });
    },

    insertSlides(slides) {
      get().commit();
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => sl.id === s.currentSlideId);
        s.deck.slides.splice(idx + 1, 0, ...slides);
        s.currentSlideId = slides[0]?.id ?? s.currentSlideId;
        s.selectedIds = [];
      });
    },


    /* ---- charts ---- */

    insertChart(spec, frame) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        const box = frame ?? defaultChartFrame(s.deck.slideSize);
        const chart = insertChartInto(slide, spec, box, s.designSystem);
        // Select the whole chart, which is its group — the same thing a click
        // on the canvas would select.
        s.selectedIds = slide.elements
          .filter((e) => e.chartRef?.chartId === chart.id)
          .map((e) => e.id);
        s.editingId = null;
        s.croppingId = null;
      });
    },

    updateChartSpec(chartId, spec, transient = false) {
      get().beginChange(transient);
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const chart = slide && chartById(slide, chartId);
        if (!slide || !chart) return;
        chart.spec = spec;
        withChartSelection(s, slide, [chartId], () =>
          recompileInto(slide, chartId, s.designSystem),
        );
      });
    },

    patchChart(chartId, fn, transient = false) {
      get().beginChange(transient);
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const chart = slide && chartById(slide, chartId);
        if (!slide || !chart) return;
        fn(chart.spec);
        withChartSelection(s, slide, [chartId], () =>
          recompileInto(slide, chartId, s.designSystem),
        );
      });
    },

    setChartFrame(chartId, frame, transient = false) {
      get().beginChange(transient);
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const chart = slide && chartById(slide, chartId);
        if (!slide || !chart) return;
        chart.frame = frame;
        // The relayout is what breaks the selection: a taller plot wants a
        // different number of ticks, so the ids the drag started on are not the
        // ids it ends on.
        withChartSelection(s, slide, [chartId], () =>
          recompileInto(slide, chartId, s.designSystem),
        );
      });
    },

    setChartRotation(chartId, deg) {
      const rotation = snapQuarterTurn(deg);
      // A gesture that lands back on the orientation it started from isn't an
      // edit, and shouldn't cost an undo step.
      const current = (() => {
        const s = get();
        const slide = slideById(s.deck, s.currentSlideId);
        return slide ? chartById(slide, chartId) : null;
      })();
      // An x/y plot has no side to lie on — see `supportsTurn`.
      if (!current || !supportsTurn(current.spec.kind)) return;
      if ((current.rotation ?? 0) === rotation) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const chart = slide && chartById(slide, chartId);
        if (!slide || !chart) return;
        chart.rotation = rotation || undefined;
        withChartSelection(s, slide, [chartId], () =>
          recompileInto(slide, chartId, s.designSystem),
        );
      });
    },

    recompileChart(chartId) {
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        withChartSelection(s, slide, [chartId], () =>
          recompileInto(slide, chartId, s.designSystem),
        );
      });
    },

    resetChartFormatting(chartId) {
      const s0 = get();
      const slide0 = slideById(s0.deck, s0.currentSlideId);
      const chart0 = slide0 && chartById(slide0, chartId);
      if (!chart0) return;
      // Probe a copy first: a chart that was never restyled shouldn't cost an
      // undo step for a button press that changes nothing.
      if (!clearChartFormatting(JSON.parse(JSON.stringify(chart0.spec)))) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const chart = slide && chartById(slide, chartId);
        if (!slide || !chart) return;
        clearChartFormatting(chart.spec);
        // Type comes back at the brand's size, so the parts change shape and
        // count — same reason a resize repairs the selection.
        withChartSelection(s, slide, [chartId], () =>
          recompileInto(slide, chartId, s.designSystem),
        );
      });
    },

    deleteChart(chartId) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        removeChartFrom(slide, chartId);
        s.selectedIds = [];
      });
    },

    chartOf(elementId) {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      const chartId = slide?.elements.find((e) => e.id === elementId)?.chartRef?.chartId;
      return (chartId && slide && chartById(slide, chartId)) || null;
    },

    duplicateSlide(id) {
      get().commit();
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => sl.id === id);
        if (idx < 0) return;
        const copy = freshSlideCopy(s.deck.slides[idx]);
        s.deck.slides.splice(idx + 1, 0, copy);
        s.currentSlideId = copy.id;
        s.selectedIds = [];
        s.selectedSlideIds = [copy.id];
        s.slideSelectionAnchor = copy.id;
      });
    },

    deleteSlide(id) {
      get().deleteSlides([id]);
    },

    deleteSlides(ids) {
      const idSet = new Set(ids);
      const { deck } = get();
      const remaining = deck.slides.filter((sl) => !idSet.has(sl.id));
      if (remaining.length === 0) return;
      get().commit();
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => idSet.has(sl.id));
        const wasCurrentDeleted = idSet.has(s.currentSlideId);
        s.deck.slides = s.deck.slides.filter((sl) => !idSet.has(sl.id));
        if (wasCurrentDeleted) {
          s.currentSlideId = s.deck.slides[Math.max(0, Math.min(idx, s.deck.slides.length - 1))].id;
        }
        s.selectedIds = [];
        s.selectedSlideIds = [];
        s.slideSelectionAnchor = null;
      });
    },

    toggleSlideSelection(id) {
      set((s) => {
        const current = s.selectedSlideIds.length ? s.selectedSlideIds : [s.currentSlideId];
        const next = current.includes(id)
          ? current.filter((sid) => sid !== id)
          : [...current, id];
        // Never leave the strip with nothing selected: ⌘-clicking the last
        // remaining thumbnail keeps it, the way it stays put in Finder.
        if (!next.length) return;
        // Deck order, not click order — every consumer (copy, move, delete)
        // wants the slides in the order they appear.
        const order = s.deck.slides.map((sl) => sl.id);
        s.selectedSlideIds = order.filter((sid) => next.includes(sid));
        s.currentSlideId = next.includes(id) ? id : s.selectedSlideIds[0];
        s.slideSelectionAnchor = id;
        s.selectedIds = [];
        s.editingId = null;
        s.croppingId = null;
      });
    },

    copySlides(ids) {
      const { deck, selectedSlideIds, currentSlideId } = get();
      const wanted = new Set(ids ?? (selectedSlideIds.length ? selectedSlideIds : [currentSlideId]));
      // Deck order, so a multi-slide paste lands in the order it was taken.
      const slides = deck.slides.filter((sl) => wanted.has(sl.id)).map(clone);
      if (!slides.length) return;
      set((s) => {
        s.slideClipboard = slides;
      });
    },

    cutSlides(ids) {
      const { deck, selectedSlideIds, currentSlideId } = get();
      const targets = ids ?? (selectedSlideIds.length ? selectedSlideIds : [currentSlideId]);
      // A deck must keep a slide, and `deleteSlides` refuses to empty it — so
      // refuse the copy too, rather than buffering a cut that never happened.
      if (deck.slides.every((sl) => targets.includes(sl.id))) return;
      const before = get().slideClipboard;
      get().copySlides(targets);
      if (get().slideClipboard === before) return;
      get().deleteSlides(targets);
    },

    pasteSlides() {
      const clip = get().slideClipboard;
      if (!clip?.length) return;
      get().commit();
      // Fresh ids on every paste, so pasting the same buffer twice gives two
      // independent slides rather than two views of one.
      const copies = clip.map(freshSlideCopy);
      set((s) => {
        const idx = s.deck.slides.findIndex((sl) => sl.id === s.currentSlideId);
        s.deck.slides.splice(idx + 1, 0, ...copies);
        s.currentSlideId = copies[0].id;
        s.selectedSlideIds = copies.map((sl) => sl.id);
        s.slideSelectionAnchor = copies[0].id;
        s.selectedIds = [];
        s.editingId = null;
        s.croppingId = null;
      });
    },

    moveSlides(ids, beforeId) {
      if (ids.length === 0) return;
      get().commit();
      set((s) => {
        const idSet = new Set(ids);
        const moved = s.deck.slides.filter((sl) => idSet.has(sl.id));
        if (moved.length === 0) return;
        const rest = s.deck.slides.filter((sl) => !idSet.has(sl.id));
        const insertAt = beforeId ? rest.findIndex((sl) => sl.id === beforeId) : -1;
        rest.splice(insertAt < 0 ? rest.length : insertAt, 0, ...moved);
        s.deck.slides = rest;
      });
    },

    commit() {
      set((s) => {
        pushPast(s, JSON.parse(JSON.stringify(s.deck)));
        s.transientBase = null;
      });
    },

    beginChange(transient = false) {
      set((s) => {
        if (transient) {
          // Only the FIRST frame of the burst banks anything; the rest are
          // previews on top of a deck we've already saved.
          if (!s.transientBase) s.transientBase = JSON.parse(JSON.stringify(s.deck));
          return;
        }
        // Closing a burst: the entry is the deck as it was before the preview
        // started, so one undo steps over the whole gesture.
        pushPast(s, s.transientBase ?? JSON.parse(JSON.stringify(s.deck)));
        s.transientBase = null;
      });
    },

    addElement(el) {
      get().commit();
      const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (slide) slide.elements.push(el);
        s.selectedIds = [el.id];
        s.deck.updatedAt = new Date(0).toISOString();
        // A text box arrives at a nominal size; the canvas measures the type and
        // shrinks it onto the text, so the selection you land on hugs it.
        s.pendingFitId = body?.autofit === 'resize' ? el.id : null;
      });
    },

    addElements(els) {
      if (!els.length) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        slide.elements.push(...els);
        s.selectedIds = els.map((el) => el.id);
        s.deck.updatedAt = new Date(0).toISOString();
        // Unlike a lone text box, a multi-part object arrives already sized by
        // whatever built it, so there is nothing to shrink-wrap here.
        s.pendingFitId = null;
      });
    },

    /**
     * The eyebrow command. Adding one is never JUST an insert — the line has to
     * come from somewhere, so the title moves down out of its way — which is why
     * this is an action rather than an `addElements` call from the toolbar.
     *
     * An empty eyebrow already sitting there is re-opened instead of duplicated,
     * exactly as the empty title slot is (see `eyebrowSlotAction`).
     */
    insertEyebrow() {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide) return;
      const action = eyebrowSlotAction(slide.elements);
      if (action === 'none') return;
      if (action === 'edit') {
        const existing = eyebrowElement(slide.elements);
        if (existing) get().setEditing(existing.id);
        return;
      }

      const els = makeEyebrow(
        s.designSystem,
        eyebrowOrigin(slide.elements),
        slide.background,
        undefined,
        s.deck.slideSize,
      );
      const text = els.find((el) => el.type === 'text');
      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        sl.elements.push(...els);
        for (const el of sl.elements) {
          // Only a title still hanging in the band moves; one dragged lower on a
          // section slide is already clear of the eyebrow and stays put.
          if (el.type === 'text' && isTitleRole(el.role)) {
            el.rect.y = titleYUnderEyebrow(d.designSystem, el.rect.y);
          }
        }
        d.selectedIds = els.map((el) => el.id);
        // Both boxes are sized by `makeEyebrow`; nothing to shrink-wrap.
        d.pendingFitId = null;
        d.deck.updatedAt = new Date(0).toISOString();
      });
      // Straight into typing — the click that asks for an eyebrow is followed by
      // the words, not by hunting for the box.
      if (text) get().setEditing(text.id);
    },

    /**
     * The sticky command. `makeSticky` builds all three boxes, so this is only
     * about where the note lands and that the caret follows it in.
     */
    insertSticky() {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide) return;
      const els = makeSticky(stickyOrigin(slide.elements, s.deck.slideSize));
      const text = els.find((el) => el.role === STICKY_TEXT_ROLE);
      get().addElements(els);
      // Straight into typing, exactly as an eyebrow does — a blank note is a
      // question, not a deliverable.
      if (text) get().setEditing(text.id);
    },

    growSticky(textId, textHeightEmu, transient = false) {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide) return;
      const note = stickyNoteOf(slide.elements, textId);
      if (!note) return;
      const rect = stickyGrowth(note.rect, textHeightEmu, note.rotation ?? 0);
      // Called on every keystroke, and most of them don't add a line: a write
      // that changes nothing would still open a transient burst. Only the NOTE
      // is written — the text box follows it out of `syncStickyGeometry`.
      if (rect.h === note.rect.h) return;
      get().setRects([{ id: note.id, rect }], transient);
    },

    updateElement(id, patch, transient = false) {
      get().beginChange(transient);
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        const el = slide?.elements.find((e) => e.id === id);
        if (el) Object.assign(el, patch);
      });
    },

    setRect(id, rect, transient = false) {
      get().setRects([{ id, rect }], transient);
    },

    /**
     * Many boxes in one commit, so a group resize or rotate is a single undo
     * step. `rotation` is optional because a resize leaves angles alone.
     *
     * Charts ride along: their elements move like any other, and then
     * `syncChartGeometry` follows the change onto the chart's frame — a drag
     * just translates it, a resize relayouts, so a chart never ends up with
     * stretched 6pt type.
     */
    setRects(rects, transient = false) {
      if (!rects.length) return;
      get().beginChange(transient);
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        const charts = chartsForElements(
          slide,
          rects.map((r) => r.id),
        );
        const before = new Map(charts.map((c) => [c.id, chartElementRects(slide, c.id)]));

        for (const { id, rect, rotation } of rects) {
          const el = slide.elements.find((e) => e.id === id);
          if (!el) continue;
          el.rect = rect;
          if (rotation !== undefined) el.rotation = rotation;
        }

        // Captured before the relayout, which changes the element set.
        const owned = chartElementIdsBefore(slide, charts.map((c) => c.id));

        for (const chart of charts) {
          syncChartGeometry(slide, chart.id, before.get(chart.id) ?? [], s.designSystem);
        }

        s.selectedIds = repairChartSelection(slide, owned, s.selectedIds);
      });
    },

    moveBy(ids, dx, dy, transient = false) {
      get().beginChange(transient);
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (ids.includes(el.id)) {
            el.rect.x += dx;
            el.rect.y += dy;
          }
        }
        // A pure translation: the elements are already right, so move the frame
        // with them rather than paying for a relayout that changes nothing.
        translateChartFrames(slide, ids, dx, dy);
      });
    },

    resizeBy(ids, dw, dh, opts = {}) {
      const { transient = false, stretch = false } = opts;
      get().beginChange(transient);
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        // A chart is resized through its FRAME, not by inflating each of its
        // parts and inferring the frame back from them — see `resizeChartFrames`
        // for why that inference belongs only to the drag path.
        const charts = chartsForElements(slide, ids);
        const chartIds = new Set(charts.map((c) => c.id));
        // Which ids each chart owned before the relayout renames its parts out
        // from under the selection — see `repairChartSelection`.
        const owned = chartElementIdsBefore(slide, charts.map((c) => c.id));

        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          if (el.chartRef && chartIds.has(el.chartRef.chartId)) continue;
          // A picture is the one thing a one-axis resize visibly ruins. Its
          // source is fitted to the rect — cover when uncropped, stretched onto
          // the crop plane when not — so widening the box alone widens the face
          // in it. Both axes scale together instead, from whichever arrow was
          // pressed, which is what PowerPoint's "lock aspect ratio" (on by
          // default for pictures) does. ⌥ asks for the old stretch.
          // One axis driving, which is all the keyboard ever sends.
          const oneAxis = (dw !== 0) !== (dh !== 0);
          const keepRatio =
            el.type === 'picture' && !stretch && oneAxis && el.rect.w > 0 && el.rect.h > 0;
          if (keepRatio) {
            const factor = keepRatioFactor(el.rect, dw, dh);
            el.rect.w = Math.round(el.rect.w * factor);
            el.rect.h = Math.round(el.rect.h * factor);
            continue;
          }
          el.rect.w = Math.max(MIN_SIZE, el.rect.w + dw);
          el.rect.h = Math.max(MIN_SIZE, el.rect.h + dh);
        }

        resizeChartFrames(slide, ids, dw, dh, s.designSystem, MIN_SIZE);
        s.selectedIds = repairChartSelection(slide, owned, s.selectedIds);
      });
    },

    rotateBy(ids, dir) {
      const slide = slideById(get().deck, get().currentSlideId);
      // A chart part is laid out inside its frame and replaced on the next
      // recompile, so spinning one on its own would only skew a label off its
      // bar. A chart turns as a whole object, in quarter turns, through
      // `setChartRotation` — free rotation stops at its edge.
      const targets = (slide?.elements ?? []).filter((el) => ids.includes(el.id) && !el.chartRef);
      if (!targets.length) return;
      // One delta for the whole selection, taken from the first box: several
      // boxes turn TOGETHER, so they have to share an angle even when they
      // started at different ones.
      const from = targets[0].rotation ?? 0;
      const delta = nextRotation(from, dir) - from;
      // The selection turns about its own centre, so each member both spins and
      // orbits — the same thing the rotation handle does to a group, and the
      // only version that keeps a sticky's note, tape and text together.
      const box = unionRect(
        targets,
        targets.map((t) => t.id),
      )!;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const rad = (delta * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ids_ = new Set(targets.map((t) => t.id));

      get().commit();
      set((s) => {
        const sl = slideById(s.deck, s.currentSlideId);
        if (!sl) return;
        for (const el of sl.elements) {
          if (!ids_.has(el.id)) continue;
          const deg = normalizeDeg((el.rotation ?? 0) + delta);
          // Upright is the absence of an angle, so a turn back to it leaves the
          // element as it was found rather than carrying a 0 around.
          el.rotation = deg || undefined;
          if (targets.length < 2) continue;
          const ex = el.rect.x + el.rect.w / 2 - cx;
          const ey = el.rect.y + el.rect.h / 2 - cy;
          el.rect.x = Math.round(cx + ex * cos - ey * sin - el.rect.w / 2);
          el.rect.y = Math.round(cy + ex * sin + ey * cos - el.rect.h / 2);
        }
      });
    },

    duplicateBy(ids, dx, dy) {
      const slide = slideById(get().deck, get().currentSlideId);
      if (!slide?.elements.some((e) => ids.includes(e.id))) return;
      get().commit();
      const newIds: string[] = [];
      // Copies of a group form their OWN group: same shape, new ids, so
      // ungrouping or dragging the copy can't reach back into the original.
      const gidMap = new Map<string, string>();
      const remapGid = (g: string) => {
        const next = gidMap.get(g) ?? `g-${nanoid(8)}`;
        gidMap.set(g, next);
        return next;
      };
      set((s) => {
        const sl = slideById(s.deck, s.currentSlideId);
        if (!sl) return;

        // A duplicated chart has to become its OWN chart, not a second copy of
        // the same one: element ids encode their chart, so cloning them would
        // hand the copies to the original, which would then delete them on its
        // next recompile.
        for (const chart of chartsForElements(sl, ids)) {
          const copy = insertChartInto(
            sl,
            JSON.parse(JSON.stringify(chart.spec)),
            { ...chart.frame, x: chart.frame.x + dx, y: chart.frame.y + dy },
            s.designSystem,
          );
          newIds.push(
            ...sl.elements.filter((e) => e.chartRef?.chartId === copy.id).map((e) => e.id),
          );
        }

        for (const el of sl.elements.filter((e) => ids.includes(e.id) && !e.chartRef)) {
          const copy: SlideElement = JSON.parse(JSON.stringify(el));
          copy.id = `${el.id}-${nanoid(4)}`;
          if (copy.groupIds) copy.groupIds = copy.groupIds.map(remapGid);
          copy.rect = { ...copy.rect, x: copy.rect.x + dx, y: copy.rect.y + dy };
          sl.elements.push(copy);
          newIds.push(copy.id);
        }
        s.selectedIds = newIds;
      });
    },

    /**
     * Recoloring a chart part writes to the SPEC, not to the rectangle — a fill
     * on the element would be erased by the next recompile, so the color would
     * survive right up until the user edited the data.
     */
    setFill(ids, fill) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        if (applyChartFormat(slide, ids, { fill })) {
          const charts = chartsForElements(slide, ids);
          withChartSelection(
            s,
            slide,
            charts.map((c) => c.id),
            () => {
              for (const chart of charts) recompileInto(slide, chart.id, s.designSystem);
            },
          );
          return;
        }
        for (const el of slide.elements) {
          if (ids.includes(el.id) && (el.type === 'text' || el.type === 'shape')) {
            el.fill = fill;
          }
        }
      });
    },

    setFillAlpha(ids, alpha) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          if (el.type !== 'text' && el.type !== 'shape') continue;
          if (el.fill?.kind !== 'solid') continue;
          el.fill = { ...el.fill, alpha };
        }
      });
    },

    setOutline(ids, outline) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        if (applyChartFormat(slide, ids, { outline })) {
          const charts = chartsForElements(slide, ids);
          withChartSelection(
            s,
            slide,
            charts.map((c) => c.id),
            () => {
              for (const chart of charts) recompileInto(slide, chart.id, s.designSystem);
            },
          );
          return;
        }
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          if (el.type === 'line') {
            if (outline) el.outline = outline;
          } else if (el.type === 'text' || el.type === 'shape' || el.type === 'picture') {
            el.outline = outline;
          }
        }
      });
    },

    setCornersRounded(ids, rounded) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id) || el.type !== 'shape') continue;
          if (!ROUNDABLE_PRESETS.includes(el.preset)) continue;
          // A pill is already as round as a rectangle gets, so rounding leaves
          // it alone; squaring it flattens it like any other rounded box.
          el.preset = rounded ? (el.preset === 'pill' ? 'pill' : 'roundRect') : 'rect';
        }
      });
    },

    patchRuns(ids, patch) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        // A chart part's type belongs to the spec, not to the box the compiler
        // emitted — see `applyChartTextFormat`. Those ids drop out here.
        const claimed = withChartTextFormat(s, slide, ids, () =>
          chartFontFromRun(patch),
        );
        for (const el of slide.elements) {
          if (!ids.includes(el.id) || claimed.has(el.id)) continue;
          const body = el.type === 'text' ? el.body : el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          for (const p of body.paragraphs) {
            for (const r of p.runs) Object.assign(r, patch);
          }
        }
      });
    },

    stepFontSize(ids, dir) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        // Each chart part steps from the size it is DRAWN at, so a part still
        // on the brand's size steps from that rather than from a guess.
        const claimed = withChartTextFormat(s, slide, ids, (el) => {
          const from = runSizeOf(el);
          return from === undefined ? null : { sizePt: nextFontSize(from, dir) };
        });
        for (const el of slide.elements) {
          if (!ids.includes(el.id) || claimed.has(el.id)) continue;
          const body = el.type === 'text' ? el.body : el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          for (const p of body.paragraphs) {
            for (const r of p.runs) {
              r.sizePt = nextFontSize(r.sizePt ?? s.designSystem.type.body.sizePt, dir);
            }
          }
        }
      });
    },

    patchParagraphs(ids, patch) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          const body = el.type === 'text' ? el.body : el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          for (const p of body.paragraphs) Object.assign(p, patch);
        }
      });
    },

    setAnchor(ids, anchor) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          body.anchor = anchor;
        }
      });
    },

    /**
     * PowerPoint's bullet/numbering buttons: pressing the one a box already
     * uses clears it, pressing the other switches list style. "Already uses"
     * means every paragraph in every targeted box, so a box with a mixed or
     * plain body turns fully into a list on the first press.
     */
    toggleBullet(ids, kind) {
      const slide = slideById(get().deck, get().currentSlideId);
      const bodies =
        slide?.elements
          .filter((el) => ids.includes(el.id))
          .map((el) => (el.type === 'text' || el.type === 'shape' ? el.body : undefined))
          .filter((b): b is NonNullable<typeof b> => !!b) ?? [];
      const paras = bodies.flatMap((b) => b.paragraphs);
      if (!paras.length) return;
      const allOn = paras.every((p) => p.bullet === kind);
      get().patchParagraphs(ids, { bullet: allOn ? 'none' : kind });
    },

    indentParagraphs(ids, delta) {
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (!ids.includes(el.id)) continue;
          const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
          if (!body) continue;
          for (const p of body.paragraphs) p.level = clampLevel((p.level ?? 0) + delta);
        }
      });
    },

    copySelection() {
      const { selectedIds, currentSlideId, deck } = get();
      const slide = slideById(deck, currentSlideId);
      if (!slide || !selectedIds.length) return;

      // Chart parts are carried as the chart, not as their rectangles — see
      // `ObjectClipboard`.
      const charts = chartsForElements(slide, selectedIds).map((c) => ({
        spec: clone(c.spec),
        frame: { ...c.frame },
      }));
      const elements = slide.elements
        .filter((e) => selectedIds.includes(e.id) && !e.chartRef)
        .map(clone);
      if (!elements.length && !charts.length) return;

      set((s) => {
        s.clipboard = { elements, charts, sourceSlideId: slide.id, pastes: 0 };
      });
    },

    cutSelection() {
      const before = get().clipboard;
      get().copySelection();
      // Nothing copyable under the selection means nothing to cut: leave both
      // the slide and the buffer as they were.
      if (get().clipboard === before) return;
      get().deleteSelected();
    },

    pasteClipboard() {
      const clip = get().clipboard;
      if (!clip) return;
      get().commit();

      // Back onto its own slide, each paste steps clear of the last so the
      // copies fan out instead of hiding under one another.
      const onSource = get().currentSlideId === clip.sourceSlideId;
      const step = onSource ? PASTE_STEP * (clip.pastes + 1) : 0;

      // Pasted groups are their OWN groups, exactly as duplicates are: shared
      // group ids would let ungrouping the copy reach into the original.
      const gidMap = new Map<string, string>();
      const remapGid = (g: string) => {
        const next = gidMap.get(g) ?? `g-${nanoid(8)}`;
        gidMap.set(g, next);
        return next;
      };

      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        const newIds: string[] = [];

        for (const chart of clip.charts) {
          const copy = insertChartInto(
            slide,
            clone(chart.spec),
            { ...chart.frame, x: chart.frame.x + step, y: chart.frame.y + step },
            s.designSystem,
          );
          newIds.push(
            ...slide.elements.filter((e) => e.chartRef?.chartId === copy.id).map((e) => e.id),
          );
        }

        for (const el of clip.elements) {
          const copy = clone(el);
          copy.id = `${el.id}-${nanoid(4)}`;
          if (copy.groupIds) copy.groupIds = copy.groupIds.map(remapGid);
          copy.rect = { ...copy.rect, x: copy.rect.x + step, y: copy.rect.y + step };
          slide.elements.push(copy);
          newIds.push(copy.id);
        }

        s.selectedIds = newIds;
        s.editingId = null;
        s.croppingId = null;
        if (onSource) s.clipboard = { ...clip, pastes: clip.pastes + 1 };
      });
    },

    /**
     * Pick up the formatting of one element. Defaults to the first selected
     * element (PowerPoint samples a single source, never a mixed selection).
     */
    copyFormat(id) {
      const s = get();
      const sourceId = id ?? s.selectedIds[0];
      if (!sourceId) return;
      const el = slideById(s.deck, s.currentSlideId)?.elements.find((e) => e.id === sourceId);
      if (!el) return;
      set((d) => {
        d.formatClipboard = extractFormat(el);
      });
    },

    /** Stamp the buffered formatting onto every selected element. */
    pasteFormat(ids) {
      const s = get();
      const fmt = s.formatClipboard;
      const targets = ids ?? s.selectedIds;
      if (!fmt || targets.length === 0) return;
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide?.elements.some((e) => targets.includes(e.id))) return;
      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        for (const el of sl.elements) {
          if (targets.includes(el.id)) applyFormat(el, fmt);
        }
      });
    },

    /**
     * The in-editor half of the painter: sample the run the cursor is in, not
     * the box's first run, so ⌘⌥C over an italic word picks up that word.
     */
    copyTextFormat(id, offset, bias = 'after') {
      const s = get();
      const el = slideById(s.deck, s.currentSlideId)?.elements.find((e) => e.id === id);
      if (!el) return;
      const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
      const at = body ? locateRun(body.paragraphs, offset, bias) : null;
      set((d) => {
        d.formatClipboard = extractFormat(el, at ?? undefined);
      });
    },

    /**
     * Restyle a character range instead of the whole box. Only the character
     * and paragraph halves of the buffered format travel — fill, outline and
     * the text-box properties describe the box, which a selection isn't.
     */
    pasteTextFormat(id, start, end) {
      const s = get();
      const fmt = s.formatClipboard;
      if (!fmt?.run || end <= start) return;
      const el = slideById(s.deck, s.currentSlideId)?.elements.find((e) => e.id === id);
      const body = el && (el.type === 'text' || el.type === 'shape') ? el.body : undefined;
      if (!body) return;
      const paragraphs = formatRange(body.paragraphs, start, end, fmt);
      if (JSON.stringify(paragraphs) === JSON.stringify(body.paragraphs)) return;
      get().commit();
      set((d) => {
        const target = slideById(d.deck, d.currentSlideId)?.elements.find((e) => e.id === id);
        const live = target && 'body' in target ? target.body : undefined;
        if (live) live.paragraphs = paragraphs;
      });
    },

    deleteSelected() {
      const { selectedIds } = get();
      if (selectedIds.length === 0) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        // A chart part is deleted in the SPEC — see `deleteChartParts`. Only a
        // whole-chart selection removes the chart, and a part that has no spec
        // switch is left alone; either way the primitives of a chart that still
        // exists are never spliced out from under it, or the next recompile
        // would put them straight back.
        deleteChartParts(slide, selectedIds, s.designSystem);
        const live = new Set((slide.charts ?? []).map((c) => c.id));
        slide.elements = slide.elements.filter(
          (e) => !selectedIds.includes(e.id) || live.has(e.chartRef?.chartId ?? ''),
        );
        s.selectedIds = [];
        s.editingId = null;
        s.croppingId = null;
      });
    },

    /**
     * Aligns SELECTION UNITS, not elements: a group is one box that slides
     * bodily to the edge, exactly as PowerPoint treats it. For a selection with
     * no groups in it this is the old element-wise behaviour unchanged.
     *
     * ONE unit selected, the edge modes walk exactly as several do: the mode
     * names a DIRECTION OF TRAVEL and each press takes the next line that way,
     * so ⌘↑ on a body box mid-slide goes content-top guide → the title band's
     * own top guide → the top of the slide, and stops there. Every guide on the
     * way is a stop, including the top margin — a press never travels back
     * against the arrow to reach the "canonical" guide for the mode, because
     * ⌘↑ moving an object DOWN reads as a bug.
     *
     * The ONE exception is having nothing that way at all, which is what an
     * object overhanging the paper has: there the press lands it ON the guide
     * the mode names — left/right guides, the bottom guide, the content-top
     * guide below the title band for top — pulling it back onto the frame.
     * The centre modes don't walk; with one unit they centre on the paper.
     *
     * With SEVERAL units, each
     * press slides the selection to the next line it meets going that way.
     *
     *   1. objects not yet flush → line them up on their own outermost edge
     *   2. flush → travel to the next stop: a margin guide, the content-top
     *      guide, or the slide edge, whichever comes first
     *   3. …repeat, one line per press, until there is nothing further that way,
     *      where it stops dead rather than cycling
     *
     * A stop counts when EITHER edge of the selection can land on it — a block
     * overhanging the left guide moves right onto that guide (its left edge),
     * and keeps going to the right guide (its right edge) and then the paper's
     * right edge. Moves that would carry the selection off the slide are not
     * offered, which is what makes the walk terminate.
     *
     * Every step past the first moves the whole selection by ONE shift (they
     * share the edge by then), so the layout inside it survives the trip.
     *
     * The centre modes never escalate: they centre on the selection's own span
     * with several units, and on the slide with one.
     */
    align(mode) {
      const s = get();
      const { selectedIds } = s;
      const boxes = unitBoxes(s, selectedIds);
      if (boxes.length === 0) return;

      /** Half a point — under this two edges are the same edge to any eye. */
      const EPS = EMU_PER_POINT / 2;

      // One unit, centre mode: the selection's own span is the object itself, so
      // "centre" can only mean the paper's middle.
      if (boxes.length === 1 && (mode === 'hcenter' || mode === 'vcenter')) {
        const { ids, r } = boxes[0];
        const { w: sw, h: sh } = s.deck.slideSize;
        const d = mode === 'hcenter' ? sw / 2 - r.w / 2 - r.x : sh / 2 - r.h / 2 - r.y;
        if (Math.abs(d) <= EPS) return; // already there — no undo step for a no-op
        get().commit();
        set(shiftUnits([mode === 'hcenter' ? { ids, dx: d, dy: 0 } : { ids, dx: 0, dy: d }]));
        return;
      }

      if (mode === 'hcenter' || mode === 'vcenter') {
        const lo = mode === 'hcenter'
          ? Math.min(...boxes.map((b) => b.r.x))
          : Math.min(...boxes.map((b) => b.r.y));
        const hi = mode === 'hcenter'
          ? Math.max(...boxes.map((b) => b.r.x + b.r.w))
          : Math.max(...boxes.map((b) => b.r.y + b.r.h));
        const centre = (lo + hi) / 2;
        get().commit();
        set(shiftUnits(boxes.map((b) => {
          const d = mode === 'hcenter'
            ? centre - b.r.w / 2 - b.r.x
            : centre - b.r.h / 2 - b.r.y;
          return mode === 'hcenter' ? { ids: b.ids, dx: d, dy: 0 } : { ids: b.ids, dx: 0, dy: d };
        })));
        return;
      }

      const horizontal = mode === 'left' || mode === 'right';
      /** −1 travels toward the top-left corner, +1 toward the bottom-right. */
      const dir = mode === 'left' || mode === 'top' ? -1 : 1;
      const edgeOf = (r: Rect) =>
        mode === 'left' ? r.x : mode === 'right' ? r.x + r.w : mode === 'top' ? r.y : r.y + r.h;
      const shift = (d: number) =>
        boxes.map((b) => (horizontal ? { ids: b.ids, dx: d, dy: 0 } : { ids: b.ids, dx: 0, dy: d }));

      // Step 1: pull the selection flush before it starts travelling.
      const edges = boxes.map((b) => edgeOf(b.r));
      if (Math.max(...edges) - Math.min(...edges) > EPS) {
        const target = dir < 0 ? Math.min(...edges) : Math.max(...edges);
        get().commit();
        set(shiftUnits(boxes.map((b) => {
          const d = target - edgeOf(b.r);
          return horizontal ? { ids: b.ids, dx: d, dy: 0 } : { ids: b.ids, dx: 0, dy: d };
        })));
        return;
      }

      // Steps 2+: the lines the selection can come to rest on, in this axis.
      //
      // Every line has a SIDE — the side its content belongs on — and takes the
      // selection edge that lands it there: the left guide and the paper's left
      // edge take the left edge, the right guide and right paper edge take the
      // right, and going down the page the top and content-top guides take the
      // top edge while the bottom guide takes the bottom. Without that, both
      // edges would want each line and the selection would stop on every guide
      // twice, once hanging off each side of it.
      const guides = marginGuides(s.deck.slideSize);
      const size = horizontal ? s.deck.slideSize.w : s.deck.slideSize.h;
      const lines = horizontal ? guides.vertical : guides.horizontal;
      type Stop = { at: number; on: 'lo' | 'hi' };
      const stops: Stop[] = [
        { at: 0, on: 'lo' },
        // The last guide on each axis (right / bottom) closes the frame; the
        // ones before it (left, and top + content-top) open it.
        ...lines.map((at, i): Stop => ({ at, on: i < lines.length - 1 ? 'lo' : 'hi' })),
        { at: size, on: 'hi' },
      ];

      const lo = Math.min(...boxes.map((b) => (horizontal ? b.r.x : b.r.y)));
      const hi = Math.max(...boxes.map((b) => (horizontal ? b.r.x + b.r.w : b.r.y + b.r.h)));
      // Anything bigger than the slide can never sit inside it, so it is exempt
      // from the containment rule — otherwise it could never move at all.
      const oversized = hi - lo > size;

      let best: number | null = null;
      for (const stop of stops) {
        const from = stop.on === 'lo' ? lo : hi;
        const d = stop.at - from;
        if (d * dir <= EPS) continue; // not a move, or not the way we're going
        if (!oversized && (lo + d < -EPS || hi + d > size + EPS)) continue;
        if (best === null || Math.abs(d) < Math.abs(best)) best = d;
      }
      if (best === null) {
        // Nothing further that way. With several units that is the end of the
        // walk, and with one resting on the slide edge it is too — it stops dead
        // rather than cycling back inward.
        //
        // The exception is a single object hanging OFF the paper on that side:
        // there is no line out there to travel to, so the press pulls it back
        // ONTO the guide the mode names instead of doing nothing.
        if (boxes.length !== 1) return;
        const overhangs = dir < 0 ? lo < -EPS : hi > size + EPS;
        if (!overhangs) return;
        const { ids, r } = boxes[0];
        const [left, right] = guides.vertical;
        // horizontal[1] is the content-top guide, the dotted line under the
        // title band: that is where a body box belongs, since hanging it off the
        // paper's top margin would put it inside the title.
        const [, contentTop, bottom] = guides.horizontal;
        const d =
          mode === 'left' ? left - r.x
          : mode === 'right' ? right - (r.x + r.w)
          : mode === 'top' ? contentTop - r.y
          : bottom - (r.y + r.h);
        if (Math.abs(d) <= EPS) return; // already there — no undo step for a no-op
        get().commit();
        set(shiftUnits([horizontal ? { ids, dx: d, dy: 0 } : { ids, dx: 0, dy: d }]));
        return;
      }

      get().commit();
      set(shiftUnits(shift(best)));
    },

    /**
     * PowerPoint has no equivalent: one press pulls everything that overhangs
     * back inside the safe area. Deliberately ONE uniform transform over the
     * whole content bounding box rather than per-object clamping — relative
     * positions, gaps and alignments survive, so a laid-out slide stays laid
     * out and only its overall size/position changes.
     *
     * Two rules, because a title and the body it heads want different things:
     *
     * - Titles park in the top-left corner of the safe area — top edge on the
     *   top guide, left edge on the left guide. A title is the one object on
     *   the slide whose position is a brand rule, not a layout choice.
     * - Everything else is scaled as ONE block until it spans the left AND
     *   right guides exactly — the body column always measures the full text
     *   width — and shrunk vertically only if it overhangs top or bottom.
     *
     * Scaling the body as one block rather than clamping objects one by one
     * keeps relative positions, gaps and alignments intact, so a laid-out
     * slide stays laid out and only its overall size changes. Horizontally
     * this stretches as well as shrinks (the block must REACH both guides);
     * vertically it only ever shrinks, so a short slide isn't smeared down
     * the page.
     *
     * Geometry only: font sizes are left alone, exactly like dragging a
     * group's handle.
     */
    fitToMargins() {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide?.elements.length) return;
      // A selection means "fit these"; otherwise the whole slide.
      const ids = s.selectedIds.length
        ? expandSelection(slide.elements, s.selectedIds)
        : slide.elements.map((e) => e.id);
      const inScope = new Set(ids);

      const frame = marginBox(s.deck.slideSize);
      if (frame.w <= 0 || frame.h <= 0) return;
      const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

      // A grouped title moves with its group, not on its own — pulling one
      // member into the corner would tear the group apart.
      const titleIds = new Set(
        slide.elements
          .filter((e) => inScope.has(e.id) && isTitleRole(e.role) && !e.groupIds?.length)
          .map((e) => e.id),
      );
      const bodyIds = ids.filter((id) => !titleIds.has(id));
      const box = unionRect(slide.elements, bodyIds);

      // Body: span the guides horizontally, shrink to fit vertically.
      let sx = 1;
      let sy = 1;
      let x = box?.x ?? 0;
      let y = box?.y ?? 0;
      if (box && box.w > 0 && box.h > 0) {
        sx = frame.w / box.w;
        sy = Math.min(1, frame.h / box.h);
        x = frame.x;
        y = clamp(box.y + box.h / 2 - (box.h * sy) / 2, frame.y, frame.y + frame.h - box.h * sy);
      }

      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        for (const el of sl.elements) {
          if (titleIds.has(el.id)) {
            // Never let a title hang past the right guide either.
            el.rect = {
              x: frame.x,
              y: frame.y,
              w: Math.min(el.rect.w, frame.w),
              h: el.rect.h,
            };
          } else if (box && inScope.has(el.id)) {
            el.rect = {
              x: Math.round(x + (el.rect.x - box.x) * sx),
              y: Math.round(y + (el.rect.y - box.y) * sy),
              w: Math.round(el.rect.w * sx),
              h: Math.round(el.rect.h * sy),
            };
          }
        }
      });
    },

    distribute(axis) {
      const { selectedIds } = get();
      const boxes = unitBoxes(get(), selectedIds).sort((a, b) =>
        axis === 'h' ? a.r.x - b.r.x : a.r.y - b.r.y,
      );
      if (boxes.length < 3) return;
      const at = (b: (typeof boxes)[number]) => (axis === 'h' ? b.r.x : b.r.y);
      const start = at(boxes[0]);
      const step = (at(boxes[boxes.length - 1]) - start) / (boxes.length - 1);
      const shifts = boxes.map((b, i) => {
        const delta = Math.round(start + step * i) - at(b);
        return { ids: b.ids, dx: axis === 'h' ? delta : 0, dy: axis === 'h' ? 0 : delta };
      });
      get().commit();
      set(shiftUnits(shifts));
    },

    group() {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide) return;
      const ids = expandSelection(slide.elements, s.selectedIds);
      if (selectionUnits(slide.elements, ids).length < 2) return;
      const gid = `g-${nanoid(8)}`;
      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        const sel = new Set(ids);
        for (const el of sl.elements) {
          if (sel.has(el.id)) el.groupIds = [gid, ...(el.groupIds ?? [])];
        }
        // PowerPoint also makes the members contiguous in z-order, stacked at
        // the depth of the topmost one — otherwise "bring to front" on the
        // group would be the only way to stop other objects sitting inside it.
        const top = sl.elements.reduce((acc, el, i) => (sel.has(el.id) ? i : acc), -1);
        const moved = sl.elements.filter((el) => sel.has(el.id));
        const rest = sl.elements.filter((el) => !sel.has(el.id));
        rest.splice(Math.max(0, top - moved.length + 1), 0, ...moved);
        sl.elements = rest;
        d.selectedIds = moved.map((el) => el.id);
        d.editingId = null;
        d.croppingId = null;
      });
    },

    /**
     * Releases one level only — the outermost group of whatever is selected —
     * so ungrouping a group of groups leaves the inner ones intact, and the
     * freed objects stay selected ready to be regrouped or moved.
     */
    ungroup() {
      const s = get();
      const slide = slideById(s.deck, s.currentSlideId);
      if (!slide) return;
      const gids = new Set<string>();
      for (const el of slide.elements) {
        if (!s.selectedIds.includes(el.id)) continue;
        const gid = outerGroupId(el);
        if (gid) gids.add(gid);
      }
      if (!gids.size) return;
      get().commit();
      set((d) => {
        const sl = slideById(d.deck, d.currentSlideId);
        if (!sl) return;
        // Ungrouping a live chart means "break it apart": once the pieces are
        // loose there's no honest way to fold hand edits back into a spec, so
        // say so by detaching rather than regenerating over the user's work on
        // the next recompile.
        for (const chart of (sl.charts ?? []).filter((c) => gids.has(c.groupId))) {
          detachChartFrom(sl, chart.id);
        }
        const freed: string[] = [];
        for (const el of sl.elements) {
          const gid = outerGroupId(el);
          if (!gid || !gids.has(gid)) continue;
          const rest = el.groupIds!.slice(1);
          if (rest.length) el.groupIds = rest;
          else delete el.groupIds;
          freed.push(el.id);
        }
        d.selectedIds = Array.from(new Set([...d.selectedIds, ...freed]));
      });
    },

    /**
     * PowerPoint's Arrange > Size: every other selected object takes the
     * reference object's width AND height. The reference is the first object in
     * the selection — the same rule the format painter follows.
     */
    matchSize() {
      const { selectedIds } = get();
      if (selectedIds.length < 2) return;
      const ref = slideById(get().deck, get().currentSlideId)?.elements.find(
        (e) => e.id === selectedIds[0],
      );
      if (!ref) return;
      const { w, h } = ref.rect;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (el.id === ref.id || !selectedIds.includes(el.id)) continue;
          el.rect.w = w;
          el.rect.h = h;
        }
      });
    },

    /**
     * Stamp the first selected object's formatting onto the rest — the format
     * painter without the two-step, for when the source is already in the
     * selection. Deliberately does NOT touch `formatClipboard`: the painter's
     * buffer is the user's, and picking up a format here would silently
     * overwrite whatever they had loaded.
     */
    matchFormat() {
      const { selectedIds } = get();
      if (selectedIds.length < 2) return;
      const ref = slideById(get().deck, get().currentSlideId)?.elements.find(
        (e) => e.id === selectedIds[0],
      );
      if (!ref) return;
      const fmt = extractFormat(ref);
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        for (const el of slide.elements) {
          if (el.id === ref.id || !selectedIds.includes(el.id)) continue;
          applyFormat(el, fmt);
        }
      });
    },

    reorder(dir) {
      const { selectedIds } = get();
      if (selectedIds.length === 0) return;
      get().commit();
      set((s) => {
        const slide = slideById(s.deck, s.currentSlideId);
        if (!slide) return;
        const arr = slide.elements;
        const sel = new Set(selectedIds);
        if (dir === 'front') {
          const moved = arr.filter((e) => sel.has(e.id));
          slide.elements = [...arr.filter((e) => !sel.has(e.id)), ...moved];
        } else if (dir === 'back') {
          const moved = arr.filter((e) => sel.has(e.id));
          slide.elements = [...moved, ...arr.filter((e) => !sel.has(e.id))];
        } else if (dir === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) {
              [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
            }
          }
        } else if (dir === 'backward') {
          for (let i = 1; i < arr.length; i++) {
            if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) {
              [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
            }
          }
        }
      });
    },

    undo() {
      set((s) => {
        // An in-flight preview is part of the step being undone, so it goes
        // back with it rather than leaking into the next entry.
        const prev = s.past.pop();
        if (!prev) return;
        const current = s.transientBase ?? (JSON.parse(JSON.stringify(s.deck)) as Deck);
        s.transientBase = null;
        s.future.push(current);
        s.deck = prev;
        landOn(s, prev);
      });
    },

    redo() {
      set((s) => {
        const next = s.future.pop();
        if (!next) return;
        s.transientBase = null;
        s.past.push(JSON.parse(JSON.stringify(s.deck)));
        s.deck = next;
        landOn(s, next);
      });
    },
    })),
  ),
);

function emptyDeck(): Deck {
  return {
    id: 'deck-empty',
    title: 'Untitled',
    slideSize: { w: 12_192_000, h: 6_858_000 },
    slides: [{ id: 's1', elements: [] }],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** Seed the store with a deck (e.g. the sample or an imported one). */
/**
 * Load a deck into the editor, migrating it on the way in.
 *
 * Migration lives here rather than in the repository because it needs the
 * design system and a text measurer to recompile against, and this is the one
 * place both are already to hand. It's idempotent, so a deck that's already
 * current passes straight through.
 */
/**
 * `startAt` is the slide to open on — the one the user was last looking at in
 * this document. Ignored when that slide is gone (deleted in another tab, or a
 * different deck's id), which lands you on slide 1 rather than nowhere.
 */
export function loadDeck(deck: Deck, ds?: DesignSystem, startAt?: string | null) {
  const designSystem = ds ?? useEditor.getState().designSystem;
  const migrated = migrateDeck(deck, (chart) => compileChart(chart, designSystem).elements);
  const landing =
    (startAt && migrated.slides.some((sl) => sl.id === startAt) ? startAt : null) ??
    migrated.slides[0]?.id ??
    '';
  useEditor.setState((s) => ({
    ...s,
    deck: migrated,
    designSystem,
    currentSlideId: landing,
    selectedIds: [],
    editingId: null,
    croppingId: null,
    selectedSlideIds: [],
    slideSelectionAnchor: null,
    past: [],
    future: [],
    transientBase: null,
  }));
}

/** Factory for a new element id. */
export const newId = (prefix = 'el') => `${prefix}-${nanoid(8)}`;
