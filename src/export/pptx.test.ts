/**
 * Exporter tests that read the WIRE, not the model.
 *
 * The round-trip in `import/pptx/import.test.ts` covers everything our own
 * importer can read back. These three can't be caught that way: they are
 * details our importer either normalizes away or never reads, and each one of
 * them was a visible difference between the canvas and the same deck after a
 * Google Slides import.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  inchesToEmu,
  ROUND_RECT_RADIUS_RATIO,
  SLIDE_16x9,
  token,
  type Deck,
  type SlideElement,
} from '@/model';
import { ZipArchive } from '@/import/zip';
import { attr, child, descendant, descendants, parseXml, path, type XmlNode } from '@/import/xml';
import { buildPptx } from './pptx';

const ds = DEFAULT_DESIGN_SYSTEM;

const deck = (elements: SlideElement[]): Deck => ({
  id: 'd',
  title: 'Wire',
  slideSize: SLIDE_16x9,
  slides: [{ id: 's1', elements }],
  designSystemId: ds.id,
  designSystemVersion: ds.version,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
});

async function slideXml(elements: SlideElement[]): Promise<XmlNode> {
  const buffer = (await buildPptx(deck(elements), ds).write({
    outputType: 'arraybuffer',
  })) as ArrayBuffer;
  const text = await ZipArchive.open(buffer).readText('ppt/slides/slide1.xml');
  return parseXml(text!);
}

const rect = { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(4), h: inchesToEmu(2) };

describe('shape geometry on the wire', () => {
  it('writes a roundRect radius rather than leaving OOXML its 1/6 default', async () => {
    const xml = await slideXml([
      {
        id: 'r',
        type: 'shape',
        preset: 'roundRect',
        rect,
        outline: { color: token('brand.accent'), widthEmu: inchesToEmu(0.02), dash: 'dash' },
      },
    ]);
    const gd = descendant(descendant(xml, 'prstGeom'), 'gd');
    expect(attr(descendant(xml, 'prstGeom'), 'prst')).toBe('roundRect');
    expect(attr(gd, 'name')).toBe('adj');
    // The 12% the canvas draws, in OOXML's hundred-thousandths of the shorter
    // side — NOT the 16667 a missing `adj` would inherit.
    expect(attr(gd, 'fmla')).toBe(`val ${Math.round(ROUND_RECT_RADIUS_RATIO * 100000)}`);
  });
});

describe('text bodies on the wire', () => {
  const body = (wrap: boolean, align: 'left' | 'center' | 'right') => ({
    wrap,
    insets: { l: inchesToEmu(0.2), t: inchesToEmu(0.05), r: 0, b: 0 },
    paragraphs: [{ align, runs: [{ text: 'Competitor A', font: 'Geist' as const, sizePt: 9 }] }],
  });

  it('maps insets onto the sides they name', async () => {
    const xml = await slideXml([{ id: 't', type: 'text', rect, body: body(true, 'left') }]);
    const bodyPr = descendant(xml, 'bodyPr');
    // pptxgenjs takes its margin array as [l, r, b, t] — 0.2in left and 0.05in
    // top must not arrive swapped.
    // pptxgenjs takes the array in points and writes EMU: 0.2in = 182880.
    expect(attr(bodyPr, 'lIns')).toBe(String(inchesToEmu(0.2)));
    expect(attr(bodyPr, 'tIns')).toBe(String(inchesToEmu(0.05)));
    expect(attr(bodyPr, 'rIns')).toBe('0');
    expect(attr(bodyPr, 'bIns')).toBe('0');
  });

  /**
   * The SHAPE's own xfrm — not the first one in the part, which belongs to the
   * spTree's group and sits at the origin.
   */
  const extent = (xml: XmlNode) => {
    const sp = descendants(xml, 'sp')[0];
    const xfrm = path(sp, 'spPr', 'xfrm');
    return {
      x: Number(attr(child(xfrm, 'off'), 'x')),
      cx: Number(attr(child(xfrm, 'ext'), 'cx')),
    };
  };

  it('leaves a wrapping box at exactly its rect', async () => {
    const { x, cx } = extent(
      await slideXml([{ id: 't', type: 'text', rect, body: body(true, 'left') }]),
    );
    expect(x).toBe(rect.x);
    expect(cx).toBe(rect.w);
  });

  it('grows a no-wrap box away from the edge its alignment pins it to', async () => {
    // Google Slides drops `wrap="none"` on import, so a box measured to its own
    // string wraps there and the second line lands on the entry beneath it.
    const left = extent(
      await slideXml([{ id: 't', type: 'text', rect, body: body(false, 'left') }]),
    );
    expect(left.x).toBe(rect.x);
    expect(left.cx).toBeGreaterThan(rect.w);

    const right = extent(
      await slideXml([{ id: 't', type: 'text', rect, body: body(false, 'right') }]),
    );
    expect(right.x).toBeLessThan(rect.x);
    expect(right.x + right.cx).toBe(rect.x + rect.w);

    // Centred text turns about its own centre, so both edges move together.
    const center = extent(
      await slideXml([{ id: 't', type: 'text', rect, body: body(false, 'center') }]),
    );
    expect(center.x + center.cx / 2).toBe(rect.x + rect.w / 2);
    expect(center.cx).toBeGreaterThan(left.cx);
  });

  it('leaves a no-wrap box that PAINTS at its rect — a fill would show the slack', async () => {
    const { x, cx } = extent(
      await slideXml([
        {
          id: 't',
          type: 'text',
          rect,
          fill: { kind: 'solid', color: token('surface.base') },
          body: body(false, 'left'),
        },
      ]),
    );
    expect(x).toBe(rect.x);
    expect(cx).toBe(rect.w);
  });
});

describe('a Gantt on the wire', () => {
  /** Compiled once: what the exporter sees is `SlideElement[]`, not a spec. */
  const ganttElements = async () => {
    const { compileChart } = await import('@/chart/compile');
    const { defaultChartSpec, isGanttSpec, toEpochDay } = await import('@/model');
    const spec = defaultChartSpec('gantt');
    if (!isGanttSpec(spec)) throw new Error('not a gantt');
    // The sample is five plain bars by design; the shapes that exercise
    // `custGeom` are put on it here rather than expected of it.
    spec.items[0]!.shape = { form: 'summary' };
    spec.items[3]!.shape = { form: 'chevron' };
    spec.rows[0]!.label = 'Discovery';
    spec.links = [{ id: 'l1', from: 'i1', to: 'i2' }];
    spec.today = { show: true, at: toEpochDay(2026, 3, 2) };
    return compileChart(
      { id: 'ch1', groupId: 'g1', frame: { x: 0, y: 0, w: inchesToEmu(9), h: inchesToEmu(4) }, spec },
      ds,
    ).elements;
  };

  it('exports as ordinary shapes, with no chart part in the package', async () => {
    // A Gantt is picture-perfect rather than re-editable in PowerPoint: by
    // export time it is already `SlideElement[]`, so `buildPptx` has no chart
    // branch and needs none.
    const buffer = (await buildPptx(deck(await ganttElements()), ds).write({
      outputType: 'arraybuffer',
    })) as ArrayBuffer;
    const zip = ZipArchive.open(buffer);
    expect(await zip.readText('ppt/charts/chart1.xml')).toBeFalsy();
    expect(await zip.readText('ppt/slides/slide1.xml')).toBeTruthy();
  });

  it('writes a chevron and a summary as custom geometry', async () => {
    const xml = await slideXml(await ganttElements());
    // Neither is a preset PowerPoint has, so both ride out as `custGeom` —
    // which is why the placer emits them as paths rather than widening
    // `MarkerShape` and putting a chevron in a scatter's dropdown.
    expect(descendants(xml, 'custGeom').length).toBeGreaterThanOrEqual(2);
  });

  it('puts a head on the dependency arrow', async () => {
    const xml = await slideXml(await ganttElements());
    const heads = descendants(xml, 'tailEnd').filter((n) => attr(n, 'type') === 'triangle');
    expect(heads.length).toBeGreaterThan(0);
  });

  it('carries the description table out as real text', async () => {
    const xml = await slideXml(await ganttElements());
    const text = descendants(xml, 't').map((n) => n.text ?? '');
    expect(text).toContain('Discovery');
    expect(text).toContain('Owner');
  });
});
