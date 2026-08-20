/**
 * Executing a tool call against the editor.
 *
 * Everything here goes through the store's own actions — the same ones the
 * toolbar and the keyboard call. Nothing in this file writes to `deck` itself.
 * That's what makes a Devin edit indistinguishable from a hand edit: it lands
 * in the undo stack, it autosaves, and it can't produce a shape the UI couldn't
 * have produced.
 *
 * Tool calls run on the CLIENT, not on the server route — the deck lives in
 * browser storage and in this store, so the server has nothing to apply them
 * to. The route is a proxy for the API key and nothing more.
 */
import {
  inchesToEmu,
  pointsToEmu,
  resolveTypeRole,
  type BulletKind,
  type ColorRef,
  type DesignSystem,
  type EMU,
  type FontFamily,
  type Paragraph,
  type ParaAlign,
  type Rect,
  type ShapeElement,
  type ShapePreset,
  type SlideElement,
  type TextBody,
  type TextElement,
  type TextRun,
  type VerticalAnchor,
} from '@/model';
import { newId, useEditor, type EditorState } from '@/store/editorStore';
import { describeSlide } from './context';
import { getAttachment } from './attachments';
import {
  bodyWithNumber,
  describePlan,
  parseRefreshCsv,
  planRefresh,
  writeToSpec,
  type PlanEntry,
  type RefreshPlan,
} from '@/devin/applyRefresh';

export interface ToolOutcome {
  text: string;
  isError?: boolean;
}

const ok = (text: string): ToolOutcome => ({ text });
const err = (text: string): ToolOutcome => ({ text: `Error: ${text}`, isError: true });

/** Tool inputs arrive as JSON, so every read is a narrowing. */
type Input = Record<string, unknown>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * A colour reference from what the model wrote. Unknown token ids are refused
 * rather than resolved: `resolveColor` falls back to black, so accepting one
 * would paint something the wrong colour and report success.
 */
function colorRef(raw: string, ds: DesignSystem): ColorRef | string {
  const v = raw.trim();
  if (v.startsWith('#')) {
    return /^#[0-9a-fA-F]{6}$/.test(v) ? { kind: 'hex', hex: v.toUpperCase() } : `"${v}" is not a 6-digit hex colour.`;
  }
  if (ds.colors.some((c) => c.id === v)) return { kind: 'token', token: v };
  return `No colour token "${v}". This deck has: ${ds.colors.map((c) => c.id).join(', ')}.`;
}

/** Paragraphs built from plain text, one per line. */
function paragraphsFrom(text: string, run: Omit<TextRun, 'text'>, align?: ParaAlign, bullet?: BulletKind): Paragraph[] {
  return text.split('\n').map((line) => ({
    runs: [{ ...run, text: line }],
    ...(align ? { align } : {}),
    ...(bullet ? { bullet } : {}),
  }));
}

/**
 * New words in an existing box, keeping how it looked. Paragraph N inherits
 * paragraph N's formatting; extra lines inherit the last one's — which is what
 * makes "add a third bullet" keep the bullet.
 */
function retext(body: TextBody, text: string): TextBody {
  const lines = text.split('\n');
  const old = body.paragraphs;
  return {
    ...body,
    paragraphs: lines.map((line, i) => {
      const model = old[Math.min(i, old.length - 1)];
      const run = model?.runs.find((r) => r.text.length) ?? model?.runs[0];
      const paraProps = { ...model };
      delete (paraProps as Partial<Paragraph>).runs;
      return { ...paraProps, runs: [{ ...(run ?? {}), text: line }] };
    }),
  };
}

/**
 * The design system's own type role, so an added title matches the deck's. The
 * name the agent hands us is looked up rather than matched against a hardcoded
 * five: roles an admin adds are exactly the ones no list here would know, and a
 * slot role that names no type role (`decoration`) still falls back to body.
 */
function runStyleFor(role: string | undefined, ds: DesignSystem): Omit<TextRun, 'text'> {
  const spec = resolveTypeRole(ds, role);
  return {
    font: spec.font,
    sizePt: spec.sizePt,
    ...(spec.bold ? { bold: true } : {}),
    ...(spec.weight ? { weight: spec.weight } : {}),
    color: { kind: 'token', token: spec.colorToken },
  };
}

/** The elements these ids name on the open slide, and the ids that matched none. */
function resolve(s: EditorState, ids: string[]) {
  const on = s.currentSlide().elements;
  const found = ids.filter((id) => on.some((el) => el.id === id));
  const missing = ids.filter((id) => !found.includes(id));
  return { found, missing };
}

const slideIndex = (s: EditorState) => s.deck.slides.findIndex((sl) => sl.id === s.currentSlideId);

/** A 1-based slide number from the model, or an error naming the real range. */
function slideAt(s: EditorState, n: unknown): number | string {
  const i = num(n);
  if (i === undefined) return slideIndex(s);
  if (!Number.isInteger(i) || i < 1 || i > s.deck.slides.length) {
    return `No slide ${i}; the deck has ${s.deck.slides.length}.`;
  }
  return i - 1;
}

/**
 * Run one tool call. `get` is the store accessor — passed in rather than
 * imported at the call site so tests can drive this against a loaded deck
 * without a React tree.
 */
export function applyTool(name: string, input: Input, get: () => EditorState = useEditor.getState): ToolOutcome {
  try {
    return run(name, input, get);
  } catch (e) {
    return err((e as Error).message);
  }
}

function run(name: string, input: Input, get: () => EditorState): ToolOutcome {
  const s = get();

  switch (name) {
    /* ---- reading ---- */

    case 'read_slide': {
      const at = slideAt(s, input.slide);
      if (typeof at === 'string') return err(at);
      return ok(JSON.stringify(describeSlide(s.deck, at), null, 1));
    }

    /* ---- slides ---- */

    case 'goto_slide': {
      const at = slideAt(s, input.slide);
      if (typeof at === 'string') return err(at);
      s.setCurrentSlide(s.deck.slides[at].id);
      return ok(`Slide ${at + 1} is open.\n${JSON.stringify(describeSlide(get().deck, at), null, 1)}`);
    }

    case 'add_slide': {
      const at = slideAt(s, input.after);
      if (typeof at === 'string') return err(at);
      s.setCurrentSlide(s.deck.slides[at].id);
      get().addSlide();
      return ok(`Added an empty slide ${at + 2}, now open.`);
    }

    case 'duplicate_slide': {
      const at = slideAt(s, input.slide);
      if (typeof at === 'string') return err(at);
      s.duplicateSlide(s.deck.slides[at].id);
      return ok(`Copied slide ${at + 1}; the copy is slide ${at + 2} and is now open.`);
    }

    case 'delete_slide': {
      const at = slideAt(s, input.slide);
      if (typeof at === 'string') return err(at);
      if (s.deck.slides.length === 1) return err('This is the only slide — a deck keeps at least one.');
      s.deleteSlide(s.deck.slides[at].id);
      return ok(`Deleted slide ${at + 1}; ${get().deck.slides.length} left.`);
    }

    /* ---- adding elements ---- */

    case 'add_text': {
      const text = str(input.text);
      const x = num(input.x_in);
      const y = num(input.y_in);
      const w = num(input.w_in);
      if (text === undefined || x === undefined || y === undefined || w === undefined) {
        return err('add_text needs text, x_in, y_in and w_in.');
      }
      const role = str(input.role);
      const style = runStyleFor(role, s.designSystem);
      const rawColor = str(input.color);
      if (rawColor) {
        const c = colorRef(rawColor, s.designSystem);
        if (typeof c === 'string') return err(c);
        style.color = c;
      }
      const size = num(input.size_pt);
      if (size !== undefined) style.sizePt = size;
      if (bool(input.bold) !== undefined) style.bold = bool(input.bold);
      if (bool(input.italic) !== undefined) style.italic = bool(input.italic);
      // Bold is the 700 face, so a role that asks for a heavier weight must not
      // also carry `weight` — the two would disagree on export.
      if (style.bold) delete style.weight;

      const h = num(input.h_in);
      const el: TextElement = {
        id: newId('text'),
        type: 'text',
        ...(role ? { role } : {}),
        rect: { x: inchesToEmu(x), y: inchesToEmu(y), w: inchesToEmu(w), h: inchesToEmu(h ?? 0.6) },
        body: {
          anchor: 'top',
          // Without an explicit height the box takes the text's own — the same
          // deal the text tool gives a freshly dropped box.
          autofit: h === undefined ? 'resize' : 'none',
          paragraphs: paragraphsFrom(
            text,
            style,
            str(input.align) as ParaAlign | undefined,
            str(input.bullet) as BulletKind | undefined,
          ),
        },
      };
      s.addElement(el);
      return ok(`Added text ${el.id} on slide ${slideIndex(get()) + 1}.`);
    }

    case 'add_shape': {
      const preset = str(input.preset) as ShapePreset | undefined;
      const x = num(input.x_in);
      const y = num(input.y_in);
      const w = num(input.w_in);
      const h = num(input.h_in);
      if (!preset || x === undefined || y === undefined || w === undefined || h === undefined) {
        return err('add_shape needs preset, x_in, y_in, w_in and h_in.');
      }
      let fill: ColorRef = { kind: 'token', token: 'surface.subtle' };
      const rawFill = str(input.fill);
      if (rawFill) {
        const c = colorRef(rawFill, s.designSystem);
        if (typeof c === 'string') return err(c);
        fill = c;
      }
      const label = str(input.text);
      let textColor: ColorRef = { kind: 'token', token: 'ink.strong' };
      const rawTextColor = str(input.text_color);
      if (rawTextColor) {
        const c = colorRef(rawTextColor, s.designSystem);
        if (typeof c === 'string') return err(c);
        textColor = c;
      }
      const el: ShapeElement = {
        id: newId('shape'),
        type: 'shape',
        preset,
        rect: { x: inchesToEmu(x), y: inchesToEmu(y), w: inchesToEmu(w), h: inchesToEmu(h) },
        fill: { kind: 'solid', color: fill },
        ...(label
          ? {
              body: {
                anchor: 'middle' as VerticalAnchor,
                paragraphs: paragraphsFrom(
                  label,
                  {
                    font: s.designSystem.fonts.body,
                    sizePt: num(input.size_pt) ?? s.designSystem.type.body.sizePt,
                    color: textColor,
                  },
                  'center',
                ),
              },
            }
          : {}),
      };
      s.addElement(el);
      return ok(`Added ${preset} ${el.id} on slide ${slideIndex(get()) + 1}.`);
    }

    /* ---- editing elements ---- */

    case 'set_text': {
      const id = str(input.id);
      const text = str(input.text);
      if (!id || text === undefined) return err('set_text needs id and text.');
      const el = s.currentSlide().elements.find((e) => e.id === id);
      if (!el) return err(`No element ${id} on the open slide — call read_slide first.`);
      if (el.chartRef) return err(`${id} is part of a chart; the next recompile would overwrite it.`);
      if (el.type !== 'text' && el.type !== 'shape') return err(`A ${el.type} holds no text.`);
      const body: TextBody = el.body ?? { paragraphs: [] };
      s.updateElement(id, { body: retext(body, text) } as Partial<SlideElement>);
      return ok(`${id} now reads ${JSON.stringify(text)}.`);
    }

    case 'style_text': {
      const { found, missing } = resolve(s, strs(input.ids));
      if (!found.length) return err(`None of those ids are on the open slide${missing.length ? ` (${missing.join(', ')})` : ''}.`);

      const patch: Partial<TextRun> = {};
      const size = num(input.size_pt);
      if (size !== undefined) patch.sizePt = size;
      if (bool(input.bold) !== undefined) {
        patch.bold = bool(input.bold);
        // See `add_text`: `weight` and `bold` must not both claim the face.
        patch.weight = undefined;
      }
      if (bool(input.italic) !== undefined) patch.italic = bool(input.italic);
      if (bool(input.underline) !== undefined) patch.underline = bool(input.underline);
      const rawColor = str(input.color);
      if (rawColor) {
        const c = colorRef(rawColor, s.designSystem);
        if (typeof c === 'string') return err(c);
        patch.color = c;
      }
      const font = str(input.font);
      if (font) patch.font = font as FontFamily;
      if (Object.keys(patch).length) s.patchRuns(found, patch);

      const align = str(input.align) as ParaAlign | undefined;
      const bullet = str(input.bullet) as BulletKind | undefined;
      if (align || bullet) {
        get().patchParagraphs(found, { ...(align ? { align } : {}), ...(bullet ? { bullet } : {}) });
      }
      const anchor = str(input.anchor) as VerticalAnchor | undefined;
      if (anchor) get().setAnchor(found, anchor);

      return ok(`Restyled ${found.join(', ')}.${missing.length ? ` Not found: ${missing.join(', ')}.` : ''}`);
    }

    case 'set_geometry': {
      const { found, missing } = resolve(s, strs(input.ids));
      if (!found.length) return err(`None of those ids are on the open slide${missing.length ? ` (${missing.join(', ')})` : ''}.`);

      const dx = num(input.dx_in);
      const dy = num(input.dy_in);
      if (dx !== undefined || dy !== undefined) {
        s.moveBy(found, inchesToEmu(dx ?? 0) as EMU, inchesToEmu(dy ?? 0) as EMU);
      }

      const x = num(input.x_in);
      const y = num(input.y_in);
      const w = num(input.w_in);
      const h = num(input.h_in);
      if (x !== undefined || y !== undefined || w !== undefined || h !== undefined) {
        for (const id of found) {
          const el = get().currentSlide().elements.find((e) => e.id === id)!;
          const rect: Rect = {
            x: x === undefined ? el.rect.x : inchesToEmu(x),
            y: y === undefined ? el.rect.y : inchesToEmu(y),
            w: w === undefined ? el.rect.w : inchesToEmu(w),
            h: h === undefined ? el.rect.h : inchesToEmu(h),
          };
          get().setRect(id, rect);
        }
      }

      const rotation = num(input.rotation);
      if (rotation !== undefined) {
        for (const id of found) get().updateElement(id, { rotation } as Partial<SlideElement>);
      }
      return ok(`Moved ${found.join(', ')}.${missing.length ? ` Not found: ${missing.join(', ')}.` : ''}`);
    }

    case 'set_style': {
      const { found, missing } = resolve(s, strs(input.ids));
      if (!found.length) return err(`None of those ids are on the open slide${missing.length ? ` (${missing.join(', ')})` : ''}.`);

      if (bool(input.fill_none)) {
        s.setFill(found, { kind: 'none' });
      } else {
        const rawFill = str(input.fill);
        if (rawFill) {
          const c = colorRef(rawFill, s.designSystem);
          if (typeof c === 'string') return err(c);
          get().setFill(found, { kind: 'solid', color: c });
        }
      }
      const alpha = num(input.fill_alpha);
      if (alpha !== undefined) get().setFillAlpha(found, Math.min(1, Math.max(0, alpha)));

      if (bool(input.outline_none)) {
        get().setOutline(found, undefined);
      } else {
        const rawOutline = str(input.outline);
        const width = num(input.outline_width_pt);
        const dash = str(input.outline_dash);
        if (rawOutline || width !== undefined || dash) {
          const c = rawOutline
            ? colorRef(rawOutline, s.designSystem)
            : ({ kind: 'token', token: 'line.default' } as ColorRef);
          if (typeof c === 'string') return err(c);
          get().setOutline(found, {
            color: c,
            widthEmu: pointsToEmu(width ?? 1),
            dash: (dash as 'solid' | 'dash' | 'dot') ?? 'solid',
          });
        }
      }

      const rounded = bool(input.rounded);
      if (rounded !== undefined) get().setCornersRounded(found, rounded);

      return ok(`Restyled ${found.join(', ')}.${missing.length ? ` Not found: ${missing.join(', ')}.` : ''}`);
    }

    case 'arrange': {
      const { found, missing } = resolve(s, strs(input.ids));
      if (!found.length) return err(`None of those ids are on the open slide${missing.length ? ` (${missing.join(', ')})` : ''}.`);
      // align/distribute/reorder all act on the SELECTION, exactly as the
      // Arrange bar does — so the tool selects first and leaves the selection
      // behind, which is also what the user expects to see afterwards.
      s.select(found);
      const align = str(input.align);
      const distribute = str(input.distribute);
      const order = str(input.order);
      if (align) get().align(align as Parameters<EditorState['align']>[0]);
      if (distribute === 'h' || distribute === 'v') get().distribute(distribute);
      if (order) get().reorder(order as Parameters<EditorState['reorder']>[0]);
      if (!align && !distribute && !order) return err('arrange needs one of align, distribute or order.');
      return ok(`Arranged ${found.join(', ')}.`);
    }

    case 'delete_elements': {
      const { found, missing } = resolve(s, strs(input.ids));
      if (!found.length) return err(`None of those ids are on the open slide${missing.length ? ` (${missing.join(', ')})` : ''}.`);
      s.select(found);
      get().deleteSelected();
      return ok(`Deleted ${found.join(', ')}.`);
    }

    /* ---- refreshing figures ---- */

    case 'preview_number_refresh':
    case 'apply_number_refresh': {
      const id = str(input.csv_id);
      if (!id) return err(`${name} needs csv_id — the id from the attachment marker in the message.`);
      const attachment = getAttachment(id);
      if (!attachment) {
        return err(`No attachment "${id}". Use the id exactly as the marker in the user's message writes it.`);
      }
      const { rows, problems } = parseRefreshCsv(attachment.text);
      if (!rows.length) {
        return err(`Couldn't read that CSV. ${problems.join(' ')}`);
      }
      const plan = planRefresh(s.deck, rows);
      const preamble = problems.length ? `${problems.join(' ')}\n\n` : '';

      if (name === 'preview_number_refresh') {
        return ok(`${preamble}Nothing has been changed yet.\n${describePlan(plan)}`);
      }

      const only = strs(input.refs);
      const applied = applyRefreshPlan(plan, only.length ? new Set(only) : undefined, get);
      return ok(
        `${preamble}${describePlan({ ...plan, entries: applied.entries, counts: applied.counts }, { applied: true })}` +
          `\n\nAll of it is one undo step (⌘Z).`,
      );
    }

    case 'set_deck_title': {
      const title = str(input.title);
      if (!title) return err('set_deck_title needs a title.');
      s.setTitle(title);
      return ok(`Renamed the document to "${title}".`);
    }

    default:
      return err(`No such tool "${name}".`);
  }
}

/**
 * Writing a plan into the deck.
 *
 * Every edit is `transient`, so the whole refresh banks ONE undo entry: the
 * closing `beginChange(false)` pushes the deck as it stood before the first
 * figure moved. Ten pages of numbers then step back with a single ⌘Z, which is
 * the only sane behaviour for an edit nobody watched happen.
 *
 * The open slide is restored afterwards — the store's chart and element actions
 * work on whichever slide is current, so applying has to walk the deck, and
 * leaving the user on page 14 would read as a bug.
 */
function applyRefreshPlan(
  plan: RefreshPlan,
  only: Set<string> | undefined,
  get: () => EditorState,
): { entries: PlanEntry[]; counts: RefreshPlan['counts'] } {
  const wanted = plan.entries.filter(
    (e) => e.status === 'change' && e.target && (!only || only.has(e.ref)),
  );
  const skipped = only
    ? plan.entries
        .filter((e) => e.status === 'change' && !only.has(e.ref))
        .map((e) => ({ ...e, status: 'unchanged' as const, reason: 'Not in the refs you asked for.' }))
    : [];

  const startedOn = get().currentSlideId;
  let wrote = 0;
  for (const entry of wanted) {
    const target = entry.target!;
    get().setCurrentSlide(target.slideId);
    if (target.kind === 'chart') {
      get().patchChart(target.chartId, (spec) => void writeToSpec(spec, target.parts, entry.next!), true);
    } else {
      const el = get().currentSlide().elements.find((e) => e.id === target.elementId);
      if (el?.type !== 'text') continue;
      const body = bodyWithNumber(el, target.site, target.text);
      if (!body) continue;
      get().updateElement(target.elementId, { body } as Partial<SlideElement>, true);
    }
    wrote += 1;
  }
  // Only close the burst if something opened it; `beginChange` with no
  // transient base would bank an undo entry for a no-op.
  if (wrote) get().beginChange(false);
  get().setCurrentSlide(startedOn);

  const entries = [...plan.entries.filter((e) => !skipped.some((s) => s.ref === e.ref)), ...skipped];
  const counts = { ...plan.counts, change: wrote, unchanged: plan.counts.unchanged + skipped.length };
  return { entries, counts };
}
