import { describe, expect, it } from 'vitest';
import { SLIDE_16x9, inchesToEmu } from '@/model';
import type { Rect, SlideElement } from '@/model';
import {
  STICKY_NOTE_ROLE,
  STICKY_TAPE_ROLE,
  STICKY_TEXT_ROLE,
  isStickyPart,
  makeSticky,
  stickyGrowth,
  stickyNoteOf,
  stickyOrigin,
  stickyPad,
  stickyTapeRect,
  stickyTextRect,
  stickyTextTarget,
  syncStickyGeometry,
} from './sticky';

const parts = (els: SlideElement[]) => ({
  note: els.find((e) => e.role === STICKY_NOTE_ROLE)!,
  tape: els.find((e) => e.role === STICKY_TAPE_ROLE)!,
  text: els.find((e) => e.role === STICKY_TEXT_ROLE)!,
});

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * How far the tape's centre is from the note's, measured in the NOTE's own frame:
 * `along` runs across the note's top edge, `out` away from its centre. Tape stuck
 * on straight means along ≈ 0 and out ≈ half the note's height, at any angle.
 */
function tapeOffsetInNoteFrame(note: Rect, tape: Rect, deg: number) {
  const dx = centre(tape).x - centre(note).x;
  const dy = centre(tape).y - centre(note).y;
  const rad = (-deg * Math.PI) / 180;
  return {
    along: dx * Math.cos(rad) - dy * Math.sin(rad),
    out: -(dx * Math.sin(rad) + dy * Math.cos(rad)),
  };
}

describe('makeSticky', () => {
  const els = makeSticky({ x: inchesToEmu(9), y: inchesToEmu(0.5) });
  const { note, tape, text } = parts(els);

  it('is one group of paper, tape and type', () => {
    expect(els).toHaveLength(3);
    const gids = new Set(els.map((e) => e.groupIds?.[0]));
    expect(gids.size).toBe(1);
    expect([...gids][0]).toBeTruthy();
  });

  it('tilts all three parts by the same angle', () => {
    expect(new Set(els.map((e) => e.rotation)).size).toBe(1);
    expect(note.rotation).not.toBe(0);
  });

  it('straddles the note′s top edge with the tape, centred', () => {
    const off = tapeOffsetInNoteFrame(note.rect, tape.rect, note.rotation!);
    expect(Math.abs(off.along)).toBeLessThan(inchesToEmu(0.01));
    expect(off.out).toBeCloseTo(note.rect.h / 2, -2);
    // Half above the edge, half below: the tape holds the note to the slide.
    expect(tape.rect.h).toBeLessThan(note.rect.h);
    expect(tape.rect.w).toBeLessThan(note.rect.w / 2);
  });

  it('insets the type inside the paper, and leaves it empty', () => {
    expect(text.rect.w).toBeLessThan(note.rect.w);
    expect(text.rect.h).toBeLessThan(note.rect.h);
    expect(centre(text.rect).x).toBeCloseTo(centre(note.rect).x, -2);
    const runs = text.type === 'text' ? text.body.paragraphs[0].runs : [];
    expect(runs.map((r) => r.text).join('')).toBe('');
  });

  it('does not autofit — the note is grown instead of the text box', () => {
    expect(text.type === 'text' && text.body.autofit).toBe('none');
  });
});

describe('stickyOrigin', () => {
  it('lands inside the slide′s top-right corner', () => {
    const o = stickyOrigin([], SLIDE_16x9);
    expect(o.x).toBeGreaterThan(SLIDE_16x9.w / 2);
    expect(o.y).toBeLessThan(SLIDE_16x9.h / 4);
  });

  it('steps the next note clear of the one already there', () => {
    const first = stickyOrigin([], SLIDE_16x9);
    const second = stickyOrigin(makeSticky(first), SLIDE_16x9);
    expect(second.x).toBeLessThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });
});

describe('stickyGrowth', () => {
  const note: Rect = { x: 1000, y: 2000, w: inchesToEmu(2.6), h: inchesToEmu(0.8) };

  it('takes the height the type needs, plus the note′s padding', () => {
    const grown = stickyGrowth(note, inchesToEmu(2));
    expect(grown.h).toBe(Math.round(inchesToEmu(2) + stickyPad(note).y * 2));
    expect(grown.w).toBe(note.w);
  });

  it('grows away from the top edge, which stays put', () => {
    const grown = stickyGrowth(note, inchesToEmu(2));
    expect(grown.y).toBe(note.y);
    expect(grown.x).toBe(note.x);
  });

  it('grows along the note′s own axis when it is stuck on at an angle', () => {
    // The top edge is what the tape holds, so it must not move — at 30° that
    // means the rect's x and y BOTH change as the paper extends downwards.
    const deg = 30;
    const grown = stickyGrowth(note, inchesToEmu(2), deg);
    const before = tapeOffsetInNoteFrame(note, stickyTapeRect(note, deg), deg);
    const after = tapeOffsetInNoteFrame(grown, stickyTapeRect(grown, deg), deg);
    // Within an EMU — 1/914400 of an inch — of exactly where it was.
    const was = stickyTapeRect(note, deg);
    const now = stickyTapeRect(grown, deg);
    expect(Math.abs(now.x - was.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(now.y - was.y)).toBeLessThanOrEqual(1);
    expect(now.w).toBe(was.w);
    expect(now.h).toBe(was.h);
    expect(after.along).toBeCloseTo(before.along, -2);
  });

  it('shrinks back as text is deleted, down to a floor', () => {
    const tall = stickyGrowth(note, inchesToEmu(2));
    expect(stickyGrowth(tall, inchesToEmu(0.2)).h).toBe(note.h);
  });

  it('never grows a deliberately small note back up to the floor', () => {
    const small: Rect = { x: 0, y: 0, w: inchesToEmu(1), h: inchesToEmu(0.4) };
    expect(stickyGrowth(small, 1).h).toBe(small.h);
  });
});

describe('syncStickyGeometry', () => {
  /** A sticky whose note has been moved, resized and turned under it. */
  const mangled = (rect: Rect, rotation: number) => {
    const els = makeSticky({ x: 0, y: 0 });
    const { note, tape, text } = parts(els);
    note.rect = rect;
    note.rotation = rotation;
    // The state a group resize at an angle leaves behind: members scaled in
    // SLIDE axes, so the tape is no longer on the edge it was stuck to.
    tape.rect = { x: rect.x, y: rect.y, w: 10, h: 10 };
    text.rect = { x: rect.x, y: rect.y, w: 10, h: 10 };
    tape.rotation = 0;
    text.rotation = 0;
    return els;
  };

  it('puts the tape back on the top edge, centred, at any angle', () => {
    for (const deg of [0, 2.6, 30, 45, 90, 180, 315]) {
      const rect: Rect = { x: inchesToEmu(3), y: inchesToEmu(2), w: inchesToEmu(4), h: inchesToEmu(2) };
      const els = mangled(rect, deg);
      syncStickyGeometry(els);
      const { note, tape } = parts(els);
      const off = tapeOffsetInNoteFrame(note.rect, tape.rect, deg);
      expect(Math.abs(off.along)).toBeLessThan(inchesToEmu(0.01));
      expect(off.out).toBeCloseTo(rect.h / 2, -2);
      expect(tape.rotation).toBe(deg);
    }
  });

  it('scales the tape and the padding with the note', () => {
    const small = mangled({ x: 0, y: 0, w: inchesToEmu(2), h: inchesToEmu(1) }, 0);
    const big = mangled({ x: 0, y: 0, w: inchesToEmu(4), h: inchesToEmu(2) }, 0);
    syncStickyGeometry(small);
    syncStickyGeometry(big);
    // Doubled to within a rounded EMU.
    expect(parts(big).tape.rect.w - parts(small).tape.rect.w * 2).toBeLessThanOrEqual(1);
    expect(parts(big).tape.rect.h - parts(small).tape.rect.h * 2).toBeLessThanOrEqual(1);
    const inset = (els: SlideElement[]) => parts(els).note.rect.w - parts(els).text.rect.w;
    expect(Math.abs(inset(big) - inset(small) * 2)).toBeLessThanOrEqual(1);
  });

  it('re-centres the type in the paper and matches its angle', () => {
    const rect: Rect = { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(3), h: inchesToEmu(2) };
    const els = mangled(rect, 12);
    syncStickyGeometry(els);
    const { note, text } = parts(els);
    expect(text.rect).toEqual(stickyTextRect(note.rect, 12));
    expect(text.rotation).toBe(12);
  });

  it('leaves a slide with no stickies alone', () => {
    const plain: SlideElement[] = [
      { id: 'p1', type: 'shape', preset: 'rect', rect: { x: 1, y: 2, w: 3, h: 4 } },
    ];
    const before = JSON.stringify(plain);
    syncStickyGeometry(plain);
    expect(JSON.stringify(plain)).toBe(before);
  });
});

describe('stickyTextTarget', () => {
  const els = makeSticky({ x: 0, y: 0 });
  const { note, tape, text } = parts(els);

  it('writes on the note whichever part was picked', () => {
    for (const part of [note, tape, text]) {
      expect(stickyTextTarget(els, [part.id])).toBe(text.id);
    }
  });

  it('finds the text through a whole-group selection', () => {
    expect(stickyTextTarget(els, els.map((e) => e.id))).toBe(text.id);
  });

  it('picks the note that was selected, not another on the slide', () => {
    const other = makeSticky({ x: inchesToEmu(1), y: inchesToEmu(3) });
    const slide = [...els, ...other];
    expect(stickyTextTarget(slide, [parts(other).note.id])).toBe(parts(other).text.id);
    expect(stickyNoteOf(slide, parts(other).text.id)?.id).toBe(parts(other).note.id);
  });

  it('is undefined for anything that is not a sticky', () => {
    const plain: SlideElement = {
      id: 'p1',
      type: 'shape',
      preset: 'rect',
      rect: { x: 0, y: 0, w: 10, h: 10 },
    };
    expect(stickyTextTarget([...els, plain], ['p1'])).toBeUndefined();
    expect(stickyTextTarget(els, [])).toBeUndefined();
    expect(stickyNoteOf([...els, plain], 'p1')).toBeUndefined();
    expect(isStickyPart(plain)).toBe(false);
    expect(isStickyPart(note)).toBe(true);
  });
});
