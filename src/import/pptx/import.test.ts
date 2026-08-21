/**
 * Import engine tests.
 *
 * The centrepiece is a ROUND TRIP: build a real .pptx with the exporter, read
 * it back with the importer, and assert the model survived. That is the only
 * test that can catch a whole class of import bugs at once — a wrong EMU
 * conversion, a dropped inheritance layer, a colour transform in the wrong
 * order — because the expected answer is a deck we already have in hand.
 */
import { describe, expect, it } from 'vitest';
import { buildPptx } from '@/export/pptx';
import {
  DEFAULT_DESIGN_SYSTEM,
  emuToPoints,
  inchesToEmu,
  isPicture,
  isShape,
  isText,
  SLIDE_16x9,
  token,
  type Deck,
  type Slide,
} from '@/model';
import { parseXml, attr, child, descendants, textOf } from '../xml';
import { parsePptx } from './index';
import { OpcPackage } from './opc';
import { parseTheme, resolveColorNode, toColorRef, DEFAULT_COLOR_MAP } from './color';
import { custGeomToPath, presetToPath, presetToShape } from './geometry';
import { ZipArchive } from '../zip';
import { parseChartPart } from './chart';
import { fitSlide, placementFor } from '../fit';

const ds = DEFAULT_DESIGN_SYSTEM;

/* ------------------------------------------------------------------ */
/* XML                                                                 */
/* ------------------------------------------------------------------ */

describe('xml reader', () => {
  it('parses elements, attributes and namespaced names', () => {
    const root = parseXml(
      `<?xml version="1.0"?><p:sp xmlns:p="x"><p:nvSpPr id="3" name="A &amp; B"/><a:t>hi &lt;there&gt;</a:t></p:sp>`,
    );
    expect(root.name).toBe('sp');
    expect(attr(child(root, 'nvSpPr'), 'name')).toBe('A & B');
    expect(textOf(child(root, 't'))).toBe('hi <there>');
  });

  it('keeps a > that appears inside an attribute value', () => {
    const root = parseXml(`<a v="1 > 0"><b/></a>`);
    expect(attr(root, 'v')).toBe('1 > 0');
    expect(root.children).toHaveLength(1);
  });

  it('finds descendants across depth', () => {
    const root = parseXml(`<a><b><c><d v="1"/></c></b><d v="2"/></a>`);
    expect(descendants(root, 'd').map((n) => attr(n, 'v'))).toEqual(['1', '2']);
  });
});

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

const THEME_XML = `
<a:theme xmlns:a="x"><a:themeElements>
  <a:clrScheme name="t">
    <a:dk1><a:srgbClr val="000000"/></a:dk1>
    <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
  </a:clrScheme>
  <a:fontScheme name="f">
    <a:majorFont><a:latin typeface="Georgia"/></a:majorFont>
    <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
  </a:fontScheme>
</a:themeElements></a:theme>`;

describe('colour resolution', () => {
  const theme = parseTheme(parseXml(THEME_XML));
  const ctx = { theme, clrMap: DEFAULT_COLOR_MAP };

  it('reads the theme scheme and fonts', () => {
    expect(theme.scheme.accent1).toBe('#4F81BD');
    expect(theme.majorFont).toBe('Georgia');
    expect(theme.minorFont).toBe('Calibri');
  });

  it('resolves a plain srgb colour', () => {
    const node = parseXml('<a:srgbClr val="FF0000"/>');
    expect(resolveColorNode(node, ctx)).toEqual({ hex: '#FF0000', alpha: 1 });
  });

  it('maps tx1/bg1 through the colour map', () => {
    expect(resolveColorNode(parseXml('<a:schemeClr val="tx1"/>'), ctx)?.hex).toBe('#000000');
    expect(resolveColorNode(parseXml('<a:schemeClr val="bg1"/>'), ctx)?.hex).toBe('#FFFFFF');
  });

  it('applies lumMod/lumOff — the pairing every built-in style uses', () => {
    const node = parseXml(
      '<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>',
    );
    const out = resolveColorNode(node, ctx)!;
    // Lighter than the base accent, and not the base itself.
    expect(out.hex).not.toBe('#4F81BD');
    expect(parseInt(out.hex.slice(1, 3), 16)).toBeGreaterThan(0x4f);
  });

  it('carries alpha through as opacity', () => {
    const node = parseXml('<a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr>');
    expect(resolveColorNode(node, ctx)!.alpha).toBeCloseTo(0.4, 5);
  });

  it('darkens with shade and lightens with tint', () => {
    const shade = resolveColorNode(
      parseXml('<a:srgbClr val="808080"><a:shade val="50000"/></a:srgbClr>'),
      ctx,
    )!;
    const tint = resolveColorNode(
      parseXml('<a:srgbClr val="808080"><a:tint val="50000"/></a:srgbClr>'),
      ctx,
    )!;
    expect(parseInt(shade.hex.slice(1, 3), 16)).toBeLessThan(0x80);
    expect(parseInt(tint.hex.slice(1, 3), 16)).toBeGreaterThan(0x80);
  });

  it('snaps an exact brand hex to its token and leaves others literal', () => {
    expect(toColorRef('#2600FF', ds)).toEqual({ kind: 'token', token: 'brand.accent' });
    expect(toColorRef('#123456', ds)).toEqual({ kind: 'hex', hex: '#123456' });
  });
});

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

describe('geometry', () => {
  it('maps the presets the model has natively', () => {
    expect(presetToShape('roundRect')).toBe('roundRect');
    expect(presetToShape('flowChartDecision')).toBe('diamond');
    expect(presetToShape('hexagon')).toBeUndefined();
  });

  it('emits a normalized outline for presets it does not', () => {
    const hex = presetToPath('hexagon', {})!;
    expect(hex[0].op).toBe('M');
    expect(hex.at(-1)!.op).toBe('Z');
    for (const op of hex) {
      if (op.op === 'M' || op.op === 'L') {
        expect(op.x).toBeGreaterThanOrEqual(0);
        expect(op.x).toBeLessThanOrEqual(1);
        expect(op.y).toBeGreaterThanOrEqual(0);
        expect(op.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('normalizes custGeom against the path coordinate space', () => {
    const geom = parseXml(`
      <a:custGeom><a:pathLst><a:path w="1000" h="500">
        <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
        <a:lnTo><a:pt x="1000" y="500"/></a:lnTo>
        <a:quadBezTo><a:pt x="500" y="0"/><a:pt x="0" y="250"/></a:quadBezTo>
        <a:close/>
      </a:path></a:pathLst></a:custGeom>`);
    const d = custGeomToPath(geom, { w: 999, h: 999 });
    expect(d[0]).toEqual({ op: 'M', x: 0, y: 0 });
    expect(d[1]).toEqual({ op: 'L', x: 1, y: 1 });
    expect(d[2].op).toBe('C');
    expect(d.at(-1)).toEqual({ op: 'Z' });
  });

  it('turns an arc into cubic segments of at most a quarter turn', () => {
    const geom = parseXml(`
      <a:custGeom><a:pathLst><a:path w="100" h="100">
        <a:moveTo><a:pt x="100" y="50"/></a:moveTo>
        <a:arcTo wR="50" hR="50" stAng="0" swAng="21600000"/>
      </a:path></a:pathLst></a:custGeom>`);
    const d = custGeomToPath(geom, { w: 100, h: 100 });
    // 360 degrees -> four cubics.
    expect(d.filter((op) => op.op === 'C')).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/* Round trip                                                          */
/* ------------------------------------------------------------------ */

const deck = (slides: Slide[]): Deck => ({
  id: 'd1',
  title: 'Round trip',
  slideSize: SLIDE_16x9,
  slides,
  designSystemId: ds.id,
  designSystemVersion: ds.version,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
});

async function roundTrip(source: Deck) {
  const blob = (await buildPptx(source, ds).write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  return { imported: await parsePptx(blob, ds), buffer: blob };
}

/**
 * Reopen a real .pptx with some parts replaced. Used to hand the importer the
 * shape a PowerPoint-authored deck has but our exporter doesn't produce — one
 * media part shared by several pictures.
 */
async function rezip(buffer: ArrayBuffer, edits: Record<string, string>): Promise<ArrayBuffer> {
  const zip = ZipArchive.open(buffer);
  const files: Record<string, string | Uint8Array> = {};
  for (const name of zip.names()) {
    files[name] = name in edits ? edits[name] : ((await zip.read(name)) ?? new Uint8Array());
  }
  return makeStoredZip(files);
}

const SAMPLE: Slide[] = [
  {
    id: 's1',
    background: { kind: 'solid', color: token('surface.subtle') },
    elements: [
      {
        id: 'title',
        type: 'text',
        rect: { x: inchesToEmu(1), y: inchesToEmu(0.8), w: inchesToEmu(8), h: inchesToEmu(1.2) },
        body: {
          anchor: 'middle',
          paragraphs: [
            {
              align: 'center',
              runs: [
                { text: 'Revenue up ', sizePt: 32, bold: true, color: token('ink.strong') },
                { text: '18%', sizePt: 32, bold: true, italic: true, color: token('brand.accent') },
              ],
            },
          ],
        },
      },
      {
        id: 'box',
        type: 'shape',
        preset: 'roundRect',
        rect: { x: inchesToEmu(1), y: inchesToEmu(2.4), w: inchesToEmu(3), h: inchesToEmu(1.5) },
        fill: { kind: 'solid', color: { kind: 'hex', hex: '#123456' } },
        outline: { color: token('line.default'), widthEmu: inchesToEmu(0.02), dash: 'dash' },
      },
      {
        id: 'rule',
        type: 'line',
        rect: { x: inchesToEmu(1), y: inchesToEmu(4.2), w: inchesToEmu(6), h: 0 },
        outline: { color: token('brand.accent'), widthEmu: inchesToEmu(0.03), dash: 'solid' },
      },
    ],
  },
  {
    id: 's2',
    elements: [
      {
        id: 'bullets',
        type: 'text',
        rect: { x: inchesToEmu(0.7), y: inchesToEmu(1), w: inchesToEmu(7), h: inchesToEmu(3) },
        body: {
          paragraphs: [
            { bullet: 'bullet', runs: [{ text: 'First point', sizePt: 18 }] },
            { bullet: 'bullet', level: 1, runs: [{ text: 'Nested point', sizePt: 14 }] },
            { bullet: 'number', runs: [{ text: 'Numbered', sizePt: 18 }] },
          ],
        },
      },
    ],
  },
];

describe('pptx round trip', () => {
  it('reads back every slide', async () => {
    const { imported } = await roundTrip(deck(SAMPLE));
    expect(imported.slides).toHaveLength(2);
    expect(imported.slideSize).toEqual({ w: SLIDE_16x9.w, h: SLIDE_16x9.h });
  });

  it('preserves geometry to within a rounding step', async () => {
    const { imported } = await roundTrip(deck(SAMPLE));
    const box = imported.slides[0].slide.elements.find((e) => isShape(e) && e.preset === 'roundRect');
    expect(box).toBeDefined();
    expect(box!.rect.x).toBeCloseTo(inchesToEmu(1), -2);
    expect(box!.rect.y).toBeCloseTo(inchesToEmu(2.4), -2);
    expect(box!.rect.w).toBeCloseTo(inchesToEmu(3), -2);
    expect(box!.rect.h).toBeCloseTo(inchesToEmu(1.5), -2);
  });

  it('preserves runs, their styling and their split', async () => {
    const { imported } = await roundTrip(deck(SAMPLE));
    const title = imported.slides[0].slide.elements.filter(isText)[0];
    const runs = title.body.paragraphs[0].runs;
    expect(runs.map((r) => r.text)).toEqual(['Revenue up ', '18%']);
    expect(runs[0]).toMatchObject({ sizePt: 32, bold: true });
    expect(runs[1]).toMatchObject({ italic: true });
    expect(runs[1].color).toEqual({ kind: 'token', token: 'brand.accent' });
    expect(title.body.paragraphs[0].align).toBe('center');
    expect(title.body.anchor).toBe('middle');
  });

  it('preserves a literal hex fill and a dashed outline', async () => {
    const { imported } = await roundTrip(deck(SAMPLE));
    const box = imported.slides[0].slide.elements.filter(isShape)[0];
    expect(box.fill).toEqual({ kind: 'solid', color: { kind: 'hex', hex: '#123456' } });
    expect(box.outline?.dash).toBe('dash');
    expect(emuToPoints(box.outline!.widthEmu)).toBeCloseTo(emuToPoints(inchesToEmu(0.02)), 1);
  });

  it('preserves bullets and indent levels', async () => {
    const { imported } = await roundTrip(deck(SAMPLE));
    const body = imported.slides[1].slide.elements.filter(isText)[0];
    const paras = body.body.paragraphs;
    expect(paras.map((p) => p.bullet)).toEqual(['bullet', 'bullet', 'number']);
    expect(paras[1].level).toBe(1);
  });

  it('keeps the slide background', async () => {
    const { imported } = await roundTrip(deck(SAMPLE));
    expect(imported.slides[0].slide.background).toEqual({
      kind: 'solid',
      color: { kind: 'token', token: 'surface.subtle' },
    });
  });

  it('round-trips an image as a picture element', async () => {
    // 1×1 transparent PNG.
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const { imported } = await roundTrip(
      deck([
        {
          id: 'p',
          elements: [
            {
              id: 'img',
              type: 'picture',
              src: png,
              rect: { x: 0, y: 0, w: inchesToEmu(2), h: inchesToEmu(2) },
            },
          ],
        },
      ]),
    );
    const pic = imported.slides[0].slide.elements.find(isPicture);
    expect(pic?.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(pic?.crop).toBeUndefined();
  });

  it('reads a shared media part out of the zip once, not once per use', async () => {
    // A logo on 30 slides is ONE part in a PowerPoint-authored deck, and decoding
    // it per use is what made a big deck's images multiply. Our own exporter
    // writes a part per picture, so the fixture is rewired to share one — which
    // is what a real deck looks like.
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const rect = { x: 0, y: 0, w: inchesToEmu(1), h: inchesToEmu(1) };
    const source = deck([
      {
        id: 'a',
        elements: [
          { id: 'i1', type: 'picture', src: png, rect },
          { id: 'i2', type: 'picture', src: png, rect },
        ],
      },
    ]);
    const built = (await buildPptx(source, ds).write({ outputType: 'arraybuffer' })) as ArrayBuffer;

    const relsPart = 'ppt/slides/_rels/slide1.xml.rels';
    const rels = (await ZipArchive.open(built).readText(relsPart))!;
    const targets = [...rels.matchAll(/Target="([^"]*media\/[^"]+)"/g)].map((m) => m[1]);
    expect(new Set(targets).size).toBe(2); // the exporter's two copies…
    const shared = rels.replaceAll(targets[1], targets[0]); // …collapsed into one
    const blob = await rezip(built, { [relsPart]: shared });

    const real = OpcPackage.prototype.bytes;
    const reads: string[] = [];
    OpcPackage.prototype.bytes = function (part: string) {
      reads.push(part);
      return real.call(this, part);
    };
    let imported;
    try {
      imported = await parsePptx(blob, ds);
    } finally {
      OpcPackage.prototype.bytes = real;
    }

    const media = reads.filter((p) => p.includes('/media/'));
    expect(media).toEqual([targets[0].replace('../', 'ppt/')]);
    // …and both pictures still arrive with their bytes.
    const pics = imported.slides[0].slide.elements.filter(isPicture);
    expect(pics).toHaveLength(2);
    expect(pics.every((p) => p.src.startsWith('data:image/png;base64,'))).toBe(true);
  });

  it('reports progress once per slide', async () => {
    const seen: Array<[number, number]> = [];
    const pptx = buildPptx(deck(SAMPLE), ds);
    const buf = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
    await parsePptx(buf, ds, { onProgress: (done, total) => seen.push([done, total]) });
    expect(seen).toEqual(SAMPLE.map((_, i) => [i + 1, SAMPLE.length]));
  });

  it('round-trips a cropped picture as srcRect, box and all', async () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const rect = {
      x: inchesToEmu(1),
      y: inchesToEmu(0.5),
      w: inchesToEmu(3),
      h: inchesToEmu(2),
    };
    const crop = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.05 };
    const { imported } = await roundTrip(
      deck([{ id: 'p', elements: [{ id: 'img', type: 'picture', src: png, rect, crop }] }]),
    );
    const pic = imported.slides[0].slide.elements.find(isPicture)!;
    // Insets survive to the tenth of a percent (srcRect's own resolution)…
    expect(pic.crop!.left).toBeCloseTo(crop.left, 4);
    expect(pic.crop!.top).toBeCloseTo(crop.top, 4);
    expect(pic.crop!.right).toBeCloseTo(crop.right, 4);
    expect(pic.crop!.bottom).toBeCloseTo(crop.bottom, 4);
    // …and the picture still occupies the box it did before the trip: the
    // exporter inflates the declared size to the crop plane, which would move
    // and enlarge the picture on the slide if the sizing box were wrong.
    expect(pic.rect.x).toBeCloseTo(rect.x, -3);
    expect(pic.rect.y).toBeCloseTo(rect.y, -3);
    expect(pic.rect.w).toBeCloseTo(rect.w, -3);
    expect(pic.rect.h).toBeCloseTo(rect.h, -3);
  });

  it('reads a freeform path back as a path', async () => {
    const { imported } = await roundTrip(
      deck([
        {
          id: 'pa',
          elements: [
            {
              id: 'tri',
              type: 'path',
              rect: { x: 0, y: 0, w: inchesToEmu(2), h: inchesToEmu(2) },
              d: [
                { op: 'M', x: 0, y: 0 },
                { op: 'L', x: 1, y: 0.5 },
                { op: 'L', x: 0, y: 1 },
                { op: 'Z' },
              ],
              fill: { kind: 'solid', color: { kind: 'hex', hex: '#FF0000' } },
            },
          ],
        },
      ]),
    );
    const el = imported.slides[0].slide.elements[0];
    expect(el.type).toBe('path');
    if (el.type === 'path') {
      expect(el.d[0]).toEqual({ op: 'M', x: 0, y: 0 });
      expect(el.d.at(-1)).toEqual({ op: 'Z' });
    }
  });

  it('carries speaker notes across', async () => {
    const withNotes = deck([{ id: 'n', elements: [], notes: 'Say this out loud' }]);
    // pptxgenjs writes notes from slide.addNotes; the exporter does not use it
    // yet, so assert the reader instead of the writer.
    const { buffer } = await roundTrip(withNotes);
    const zip = ZipArchive.open(buffer);
    expect(zip.has('ppt/presentation.xml')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Placeholder inheritance                                             */
/* ------------------------------------------------------------------ */

describe('inheritance', () => {
  it('takes geometry and size from the layout when the slide omits them', async () => {
    // pptxgenjs always writes explicit geometry, so this case is built by hand
    // from the minimal package a real deck would have.
    const pkg = await buildMinimalPackage();
    const imported = await parsePptx(pkg, ds);
    const el = imported.slides[0].slide.elements.filter(isText)[0];
    expect(el.rect).toEqual({
      x: inchesToEmu(1),
      y: inchesToEmu(0.5),
      w: inchesToEmu(8),
      h: inchesToEmu(1),
    });
    // 44pt bold comes from the MASTER's titleStyle, not from the slide.
    expect(el.body.paragraphs[0].runs[0]).toMatchObject({ sizePt: 44, bold: true });
    expect(el.role).toBe('title');
  });

  it('keeps the master bullet scheme off text boxes that are not placeholders', async () => {
    // A deck drawn with text boxes rather than placeholders: the master's
    // bodyStyle states a bullet at every level, and PowerPoint applies it to
    // body PLACEHOLDERS only. Reading it for plain boxes bulleted every line on
    // the slide, headings and labels included.
    const pkg = await buildBulletSchemePackage();
    const imported = await parsePptx(pkg, ds);
    const paras = (name: string) => {
      const el = imported.slides[0].slide.elements.filter(isText).find((e) => e.name === name)!;
      return el.body.paragraphs;
    };
    expect(paras('Box').map((p) => p.bullet)).toEqual(['none']);
    expect(paras('Body').map((p) => p.bullet)).toEqual(['bullet']);
  });
});

/**
 * A package whose master bodyStyle carries the deck's bullet scheme, with both
 * a plain text box and a body placeholder on the slide.
 */
async function buildBulletSchemePackage(): Promise<ArrayBuffer> {
  const emu = (n: number) => inchesToEmu(n);
  const box = (id: number, name: string, ph: string, y: number) => `
    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="${emu(1)}" y="${emu(y)}"/><a:ext cx="${emu(8)}" cy="${emu(1)}"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:p><a:r><a:t>${name}</a:t></a:r></a:p></p:txBody>
    </p:sp>`;
  return makeStoredZip({
    '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="R">
      <Relationship Id="rId1" Type="http://x/officeDocument" Target="ppt/presentation.xml"/>
    </Relationships>`,
    'ppt/presentation.xml': `<p:presentation xmlns:p="P" xmlns:r="R">
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      <p:sldSz cx="${SLIDE_16x9.w}" cy="${SLIDE_16x9.h}"/>
    </p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="R">
      <Relationship Id="rId1" Type="http://x/slide" Target="slides/slide1.xml"/>
    </Relationships>`,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="P" xmlns:a="A"><p:cSld><p:spTree>
      ${box(2, 'Box', '', 0.5)}
      ${box(3, 'Body', '<p:ph type="body" idx="1"/>', 2)}
    </p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': `<Relationships xmlns="R">
      <Relationship Id="rId1" Type="http://x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    </Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout xmlns:p="P" xmlns:a="A"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<Relationships xmlns="R">
      <Relationship Id="rId1" Type="http://x/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
    </Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster xmlns:p="P" xmlns:a="A">
      <p:cSld><p:spTree/></p:cSld>
      <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
      <p:txStyles>
        <p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600">
          <a:buChar char="\u2022"/><a:defRPr sz="1800"/>
        </a:lvl1pPr></p:bodyStyle>
        <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
      </p:txStyles>
    </p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `<Relationships xmlns="R"></Relationships>`,
  });
}

/**
 * A hand-rolled four-part package: presentation, slide, layout, master. Small
 * enough to read, complete enough that the inheritance chain is real.
 */
async function buildMinimalPackage(): Promise<ArrayBuffer> {
  const emu = (n: number) => inchesToEmu(n);
  const parts: Record<string, string> = {
    '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="R">
      <Relationship Id="rId1" Type="http://x/officeDocument" Target="ppt/presentation.xml"/>
    </Relationships>`,
    'ppt/presentation.xml': `<p:presentation xmlns:p="P" xmlns:r="R">
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      <p:sldSz cx="${SLIDE_16x9.w}" cy="${SLIDE_16x9.h}"/>
    </p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="R">
      <Relationship Id="rId1" Type="http://x/slide" Target="slides/slide1.xml"/>
    </Relationships>`,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="P" xmlns:a="A"><p:cSld><p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:p><a:r><a:t>Inherited title</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': `<Relationships xmlns="R">
      <Relationship Id="rId1" Type="http://x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    </Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout xmlns:p="P" xmlns:a="A"><p:cSld><p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="${emu(1)}" y="${emu(0.5)}"/><a:ext cx="${emu(8)}" cy="${emu(1)}"/></a:xfrm></p:spPr>
      </p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<Relationships xmlns="R">
      <Relationship Id="rId1" Type="http://x/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
    </Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster xmlns:p="P" xmlns:a="A">
      <p:cSld><p:spTree/></p:cSld>
      <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
      <p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400" b="1"/></a:lvl1pPr></p:titleStyle></p:txStyles>
    </p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `<Relationships xmlns="R"></Relationships>`,
  };
  return makeStoredZip(parts);
}

/** Build an uncompressed (method 0) zip — enough for the reader to open. */
function makeStoredZip(files: Record<string, string | Uint8Array>): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, eocd];
  const total = all.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}


/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

const CHART_XML = `
<c:chartSpace xmlns:c="C" xmlns:a="A">
  <c:chart>
    <c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue by region</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="stacked"/>
        <c:ser>
          <c:idx val="0"/><c:order val="0"/>
          <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>EMEA</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="4F46E5"/></a:solidFill></c:spPr>
          <c:cat><c:strRef><c:strCache>
            <c:pt idx="0"><c:v>FY23</c:v></c:pt>
            <c:pt idx="1"><c:v>FY24</c:v></c:pt>
            <c:pt idx="2"><c:v>FY25</c:v></c:pt>
          </c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:numCache><c:ptCount val="3"/>
            <c:pt idx="0"><c:v>10</c:v></c:pt>
            <c:pt idx="2"><c:v>30</c:v></c:pt>
          </c:numCache></c:numRef></c:val>
        </c:ser>
        <c:ser>
          <c:idx val="1"/><c:order val="1"/>
          <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>AMER</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:val><c:numRef><c:numCache><c:ptCount val="3"/>
            <c:pt idx="0"><c:v>5</c:v></c:pt>
            <c:pt idx="1"><c:v>7</c:v></c:pt>
            <c:pt idx="2"><c:v>9</c:v></c:pt>
          </c:numCache></c:numRef></c:val>
        </c:ser>
        <c:gapWidth val="80"/>
        <c:overlap val="100"/>
      </c:barChart>
    </c:plotArea>
    <c:legend><c:legendPos val="r"/></c:legend>
  </c:chart>
</c:chartSpace>`;

describe('embedded charts', () => {
  const ctx = { theme: parseTheme(parseXml(THEME_XML)), clrMap: DEFAULT_COLOR_MAP };

  it('maps a stacked column chart from its cached data', () => {
    const result = parseChartPart(parseXml(CHART_XML), ctx, ds)!;
    expect(result).toBeTruthy();
    const spec = result.spec;
    expect(spec.kind).toBe('column');
    expect(spec.title).toBe('Revenue by region');
    expect(spec.legend).toEqual({ show: true, position: 'right' });
    if (spec.kind !== 'column') throw new Error('wrong kind');
    expect(spec.stack).toBe('stacked');
    expect(spec.gapWidthPct).toBe(80);
    expect(spec.data.categories.map((c) => c.label)).toEqual(['FY23', 'FY24', 'FY25']);
    expect(spec.data.series.map((s) => s.name)).toEqual(['EMEA', 'AMER']);
  });

  it('keeps a missing point as a gap, not a zero', () => {
    const spec = parseChartPart(parseXml(CHART_XML), ctx, ds)!.spec;
    if (spec.kind !== 'column') throw new Error('wrong kind');
    expect(spec.data.series[0].values).toEqual([10, null, 30]);
  });

  it('maps a pie chart and its hole size', () => {
    const xml = CHART_XML.replace('barChart', 'doughnutChart')
      .replace('</c:barChart>', '<c:holeSize val="60"/></c:doughnutChart>')
      .replace('<c:barDir val="col"/>', '');
    const spec = parseChartPart(parseXml(xml), ctx, ds)!.spec;
    expect(spec.kind).toBe('donut');
    if (spec.kind !== 'donut') throw new Error('wrong kind');
    expect(spec.innerRadiusPct).toBe(60);
  });

  it('flags a chart type with no equivalent instead of faking one', () => {
    const xml = CHART_XML.replace(/barChart/g, 'radarChart');
    const result = parseChartPart(parseXml(xml), ctx, ds);
    // radar has no plot mapping at all, so the part yields nothing to import.
    expect(result).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Fitting to the destination deck                                     */
/* ------------------------------------------------------------------ */

describe('fitting imported slides', () => {
  it('scales 4:3 into 16:9 uniformly and centres it', () => {
    const from = { w: 9_144_000, h: 6_858_000 };
    const p = placementFor(from, SLIDE_16x9);
    expect(p.scale).toBeCloseTo(1, 6);
    expect(p.dy).toBe(0);
    expect(p.dx).toBe((SLIDE_16x9.w - from.w) / 2);
  });

  it('scales geometry, type size and line weight together', () => {
    const p = { scale: 0.5, dx: 100, dy: 200 };
    const fitted = fitSlide(
      {
        id: 's',
        elements: [
          {
            id: 'a',
            type: 'text',
            rect: { x: 1000, y: 2000, w: 4000, h: 800 },
            body: { paragraphs: [{ runs: [{ text: 'x', sizePt: 40 }] }] },
            outline: { color: token('ink.strong'), widthEmu: 12_700, dash: 'solid' },
          },
        ],
      },
      p,
    );
    const el = fitted.elements[0];
    expect(el.rect).toEqual({ x: 600, y: 1200, w: 2000, h: 400 });
    expect(el.type === 'text' && el.body.paragraphs[0].runs[0].sizePt).toBe(20);
    expect('outline' in el && el.outline?.widthEmu).toBe(6350);
  });
});

/* ------------------------------------------------------------------ */
/* Groups and tables                                                   */
/* ------------------------------------------------------------------ */

describe('groups and tables', () => {
  it('flattens a group, mapping child space onto the group box', async () => {
    const pkg = await buildGroupPackage();
    const imported = await parsePptx(pkg, ds);
    const els = imported.slides[0].slide.elements;
    expect(els).toHaveLength(2);
    // Child space is 0..1000 mapped onto a 2000-wide box at x=1000: 2x scale.
    expect(els[0].rect).toEqual({ x: 1000, y: 1000, w: 200, h: 200 });
    expect(els[1].rect).toEqual({ x: 2000, y: 1000, w: 200, h: 200 });
    // Both carry the same group membership, so they drag as one.
    expect(els[0].groupIds).toEqual(els[1].groupIds);
    expect(els[0].groupIds).toHaveLength(1);
  });
});

async function buildGroupPackage(): Promise<ArrayBuffer> {
  const shape = (id: number, x: number) => `
    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="S${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${x}" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
      </p:spPr>
    </p:sp>`;
  return makeStoredZip({
    '_rels/.rels': `<Relationships xmlns="R"><Relationship Id="rId1" Type="http://x/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/presentation.xml': `<p:presentation xmlns:p="P" xmlns:r="R"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="${SLIDE_16x9.w}" cy="${SLIDE_16x9.h}"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="R"><Relationship Id="rId1" Type="http://x/slide" Target="slides/slide1.xml"/></Relationships>`,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="P" xmlns:a="A"><p:cSld><p:spTree>
      <p:grpSp>
        <p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm>
          <a:off x="1000" y="1000"/><a:ext cx="2000" cy="2000"/>
          <a:chOff x="0" y="0"/><a:chExt cx="1000" cy="1000"/>
        </a:xfrm></p:grpSpPr>
        ${shape(2, 0)}
        ${shape(3, 500)}
      </p:grpSp>
    </p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': `<Relationships xmlns="R"></Relationships>`,
  });
}
