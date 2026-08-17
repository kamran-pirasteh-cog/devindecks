import { describe, expect, it } from 'vitest';
import type { SlideElement, TextElement } from '@/model';
import { layoutFrame, snapQuarterTurn, turnElements, turnRect } from './turn';

const FRAME = { x: 0, y: 0, w: 400, h: 200 };

const text = (over: Partial<TextElement> = {}): TextElement => ({
  id: 'c1::t',
  type: 'text',
  rect: { x: 0, y: 90, w: 80, h: 20 },
  body: {
    paragraphs: [{ align: 'right', runs: [{ text: '100' }] }],
    anchor: 'top',
  },
  ...over,
});

describe('snapQuarterTurn', () => {
  it('snaps any angle to the nearest orientation', () => {
    expect(snapQuarterTurn(0)).toBe(0);
    expect(snapQuarterTurn(37)).toBe(0);
    expect(snapQuarterTurn(46)).toBe(90);
    expect(snapQuarterTurn(200)).toBe(180);
    expect(snapQuarterTurn(350)).toBe(0);
  });

  it('normalizes negatives and multiple turns', () => {
    expect(snapQuarterTurn(-90)).toBe(270);
    expect(snapQuarterTurn(-1)).toBe(0);
    expect(snapQuarterTurn(450)).toBe(90);
  });
});

describe('turnRect', () => {
  it('orbits about the frame centre and keeps the size', () => {
    // A box on the left edge, vertically centred, ends up above the top edge.
    const { rect } = turnRect({ x: 0, y: 90, w: 80, h: 20 }, FRAME, 90);
    expect(rect).toEqual({ x: 160, y: -70, w: 80, h: 20 });
  });

  it('is the identity at 0 and an involution at 180', () => {
    const box = { x: 12, y: 34, w: 56, h: 78 };
    expect(turnRect(box, FRAME, 0).rect).toEqual(box);
    expect(turnRect(turnRect(box, FRAME, 180).rect, FRAME, 180).rect).toEqual(box);
  });

  it('returns to where it started after four quarter turns', () => {
    const box = { x: 12, y: 34, w: 56, h: 78 };
    let r = box;
    for (let i = 0; i < 4; i++) r = turnRect(r, FRAME, 90).rect;
    expect(r).toEqual(box);
  });
});

describe('turnElements', () => {
  it('is a no-op at 0°', () => {
    const els = [text()] as SlideElement[];
    expect(turnElements(els, FRAME, 0)).toBe(els);
  });

  it('turns shapes by the full angle', () => {
    const bar: SlideElement = {
      id: 'c1::b',
      type: 'shape',
      preset: 'rect',
      rect: { x: 0, y: 90, w: 80, h: 20 },
    };
    const [out] = turnElements([bar], FRAME, 90);
    expect(out.rotation).toBe(90);
    expect(out.rect).toEqual({ x: 160, y: -70, w: 80, h: 20 });
  });

  it('never leaves a label upside down, and swaps its alignment when it un-flips', () => {
    const [out] = turnElements([text()], FRAME, 180) as TextElement[];
    expect(out.rotation).toBeUndefined();
    // The box moved to the other side of the plot, so the label hugs the axis
    // from the other end — right-aligned becomes left-aligned.
    expect(out.body?.paragraphs[0].align).toBe('left');
    expect(out.body?.anchor).toBe('bottom');
    expect(out.rect).toEqual({ x: 320, y: 90, w: 80, h: 20 });
  });

  it('leaves a quarter-turned label reading down the side', () => {
    const [out] = turnElements([text()], FRAME, 90) as TextElement[];
    expect(out.rotation).toBe(90);
    expect(out.body?.paragraphs[0].align).toBe('right');
  });

  it('composes with a label the chart engine already rotated', () => {
    // A value-axis title is emitted at 270°; a 90° turn puts it upright again.
    const [out] = turnElements([text({ rotation: 270 })], FRAME, 90) as TextElement[];
    expect(out.rotation).toBe(0);
  });
});

describe('layoutFrame', () => {
  it('is the frame itself at 0° and 180°', () => {
    expect(layoutFrame(FRAME, 0)).toEqual(FRAME);
    expect(layoutFrame(FRAME, 180)).toEqual(FRAME);
  });

  it('transposes about the same centre at 90° and 270°', () => {
    // 400x200 at the origin -> 200x400, still centred on (200, 100).
    expect(layoutFrame(FRAME, 90)).toEqual({ x: 100, y: -100, w: 200, h: 400 });
    expect(layoutFrame(FRAME, 270)).toEqual(layoutFrame(FRAME, 90));
  });

  it('turns onto the frame it came from', () => {
    const laid = layoutFrame(FRAME, 90);
    const { rect } = turnRect(laid, laid, 90);
    // Same box, drawn on its side: the sides swap, the centre doesn't move.
    expect(rect.x + rect.w / 2).toBe(FRAME.x + FRAME.w / 2);
    expect(rect.y + rect.h / 2).toBe(FRAME.y + FRAME.h / 2);
  });
});
