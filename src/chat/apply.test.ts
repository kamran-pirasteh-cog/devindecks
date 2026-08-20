import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_SYSTEM,
  defaultChartSpec,
  emuToInches,
  inchesToEmu,
  type ColumnBarSpec,
  type Deck,
  type ShapeElement,
  type SlideElement,
  type TextElement,
} from '@/model';
import { loadDeck, useEditor } from '@/store/editorStore';
import { applyTool } from './apply';
import { clearAttachments, putAttachment } from './attachments';
import { bodyText } from './context';

const SIZE = { w: 12_192_000, h: 6_858_000 };

function text(id: string, words: string, over: Partial<TextElement> = {}): TextElement {
  return {
    id,
    type: 'text',
    role: 'body',
    rect: { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(4), h: inchesToEmu(1) },
    body: {
      paragraphs: words.split('\n').map((line) => ({
        runs: [{ text: line, sizePt: 14, bold: true, color: { kind: 'token', token: 'ink.muted' } }],
        align: 'right',
        bullet: 'bullet',
      })),
    },
    ...over,
  };
}

function deck(elements: SlideElement[]): Deck {
  return {
    id: 'd1',
    title: 'Deck',
    slideSize: SIZE,
    slides: [
      { id: 's1', elements },
      { id: 's2', elements: [] },
    ],
    designSystemId: 'ds.default',
    designSystemVersion: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

const s = () => useEditor.getState();
const elements = () => s().currentSlide().elements;
const byId = (id: string) => elements().find((e) => e.id === id)!;

beforeEach(() => {
  loadDeck(deck([text('t1', 'Old title')]), DEFAULT_DESIGN_SYSTEM);
});

describe('reading', () => {
  it('describes the open slide, with geometry in inches', () => {
    const out = applyTool('read_slide', {});
    expect(out.isError).toBeUndefined();
    const parsed = JSON.parse(out.text);
    expect(parsed.slide).toBe(1);
    expect(parsed.elements[0]).toMatchObject({ id: 't1', text: 'Old title', rect: { x: 1, y: 1, w: 4 } });
  });

  it('names the real range when asked for a slide that isn’t there', () => {
    const out = applyTool('read_slide', { slide: 9 });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('the deck has 2');
  });

  it('refuses a tool it doesn’t have', () => {
    expect(applyTool('reticulate_splines', {}).isError).toBe(true);
  });
});

describe('text', () => {
  it('adds a text box styled from the design system role', () => {
    const out = applyTool('add_text', {
      text: 'Revenue is up',
      x_in: 2,
      y_in: 3,
      w_in: 6,
      role: 'title',
    });
    expect(out.isError).toBeUndefined();
    const added = elements().at(-1) as TextElement;
    expect(added.role).toBe('title');
    expect(bodyText(added.body)).toBe('Revenue is up');
    expect(added.body.paragraphs[0].runs[0].sizePt).toBe(DEFAULT_DESIGN_SYSTEM.type.title.sizePt);
    expect(emuToInches(added.rect.x)).toBeCloseTo(2);
    // No height given, so the box is left to take the text's own.
    expect(added.body.autofit).toBe('resize');
  });

  it('keeps the formatting of the paragraph it replaces, and extends the last one', () => {
    applyTool('set_text', { id: 't1', text: 'New title\nA second line' });
    const el = byId('t1') as TextElement;
    expect(bodyText(el.body)).toBe('New title\nA second line');
    // Both paragraphs inherit the original's run styling and bullet.
    for (const p of el.body.paragraphs) {
      expect(p.runs[0]).toMatchObject({ sizePt: 14, bold: true });
      expect(p.bullet).toBe('bullet');
      expect(p.align).toBe('right');
    }
  });

  it('restyles runs and paragraphs together', () => {
    applyTool('style_text', { ids: ['t1'], size_pt: 32, bold: false, align: 'center', color: 'brand.accent' });
    const el = byId('t1') as TextElement;
    expect(el.body.paragraphs[0].runs[0]).toMatchObject({ sizePt: 32, bold: false });
    expect(el.body.paragraphs[0].runs[0].color).toEqual({ kind: 'token', token: 'brand.accent' });
    expect(el.body.paragraphs[0].align).toBe('center');
  });

  it('refuses a colour token the deck doesn’t define, rather than painting it black', () => {
    const out = applyTool('style_text', { ids: ['t1'], color: 'brand.chartreuse' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('ink.strong');
    expect((byId('t1') as TextElement).body.paragraphs[0].runs[0].color).toEqual({
      kind: 'token',
      token: 'ink.muted',
    });
  });

  it('takes a literal hex, and rejects a malformed one', () => {
    expect(applyTool('style_text', { ids: ['t1'], color: '#2600ff' }).isError).toBeUndefined();
    expect((byId('t1') as TextElement).body.paragraphs[0].runs[0].color).toEqual({
      kind: 'hex',
      hex: '#2600FF',
    });
    expect(applyTool('style_text', { ids: ['t1'], color: '#xyz' }).isError).toBe(true);
  });

  it('says so when the ids aren’t on the open slide', () => {
    const out = applyTool('set_text', { id: 'nope', text: 'hi' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('read_slide');
  });

  it('leaves chart primitives alone', () => {
    loadDeck(
      deck([text('t1', 'Bar label', { chartRef: { chartId: 'c1', part: 'title' } })]),
      DEFAULT_DESIGN_SYSTEM,
    );
    const out = applyTool('set_text', { id: 't1', text: 'nope' });
    expect(out.isError).toBe(true);
    expect(bodyText((byId('t1') as TextElement).body)).toBe('Bar label');
  });
});

describe('shapes and geometry', () => {
  it('adds a shape with centred text', () => {
    applyTool('add_shape', {
      preset: 'roundRect',
      x_in: 1,
      y_in: 1,
      w_in: 3,
      h_in: 2,
      fill: 'brand.accent',
      text: 'KPI',
    });
    const added = elements().at(-1) as ShapeElement;
    expect(added.preset).toBe('roundRect');
    expect(added.fill).toEqual({ kind: 'solid', color: { kind: 'token', token: 'brand.accent' } });
    expect(added.body?.anchor).toBe('middle');
    expect(added.body?.paragraphs[0].align).toBe('center');
  });

  it('moves relatively and resizes absolutely in the same call', () => {
    applyTool('set_geometry', { ids: ['t1'], dx_in: 1, w_in: 8 });
    const r = byId('t1').rect;
    expect(emuToInches(r.x)).toBeCloseTo(2);
    expect(emuToInches(r.w)).toBeCloseTo(8);
    // y and h were not named, so they are untouched.
    expect(emuToInches(r.y)).toBeCloseTo(1);
    expect(emuToInches(r.h)).toBeCloseTo(1);
  });

  it('centres one object against the slide', () => {
    applyTool('arrange', { ids: ['t1'], align: 'hcenter' });
    const r = byId('t1').rect;
    expect(emuToInches(r.x + r.w / 2)).toBeCloseTo(emuToInches(SIZE.w) / 2);
  });

  it('deletes through the selection, like the canvas does', () => {
    applyTool('delete_elements', { ids: ['t1'] });
    expect(elements()).toHaveLength(0);
  });
});

describe('slides', () => {
  it('inserts after the slide named, and opens it', () => {
    applyTool('add_slide', { after: 2 });
    expect(s().deck.slides).toHaveLength(3);
    expect(s().currentSlideId).toBe(s().deck.slides[2].id);
  });

  it('opens a slide and hands back what is on it', () => {
    const out = applyTool('goto_slide', { slide: 2 });
    expect(s().currentSlideId).toBe('s2');
    expect(out.text).toContain('"slide": 2');
  });

  it('keeps the last slide', () => {
    applyTool('delete_slide', { slide: 2 });
    const out = applyTool('delete_slide', { slide: 1 });
    expect(out.isError).toBe(true);
    expect(s().deck.slides).toHaveLength(1);
  });
});

describe('undo', () => {
  it('makes every edit one step, so ⌘Z walks back through them', () => {
    applyTool('set_text', { id: 't1', text: 'First' });
    applyTool('set_text', { id: 't1', text: 'Second' });
    s().undo();
    expect(bodyText((byId('t1') as TextElement).body)).toBe('First');
    s().undo();
    expect(bodyText((byId('t1') as TextElement).body)).toBe('Old title');
  });
});

describe('refreshing figures', () => {
  const CSV_HEADER =
    'ref,page,label,current_value,new_value,unit,as_of,source_url,source_note,confidence,notes';

  /** A deck with one chart on page 1 and a KPI line on page 2. */
  function refreshDeck() {
    const spec = defaultChartSpec('column', 'clustered') as ColumnBarSpec;
    spec.data.categories = [
      { key: 'c0', label: 'FY24' },
      { key: 'c1', label: 'FY25' },
    ];
    spec.data.series = [{ key: 's0', name: 'Revenue', values: [100, 120] }];
    const kpi: TextElement = {
      id: 'k1',
      type: 'text',
      role: 'kpi.value',
      rect: { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(4), h: inchesToEmu(1) },
      body: {
        paragraphs: [
          {
            runs: [
              { text: 'ARR of ', sizePt: 14 },
              { text: '$4.2M', sizePt: 28, bold: true, color: { kind: 'token', token: 'brand.accent' } },
              { text: ' and climbing', sizePt: 14 },
            ],
          },
        ],
      },
    };
    return {
      ...deck([]),
      slides: [
        {
          id: 's1',
          elements: [],
          charts: [
            {
              id: 'ch_1',
              groupId: 'g1',
              frame: { x: inchesToEmu(1), y: inchesToEmu(1), w: inchesToEmu(6), h: inchesToEmu(4) },
              spec,
            },
          ],
        },
        { id: 's2', elements: [kpi] },
      ],
    } as Deck;
  }

  const attach = (...rows: string[]) => putAttachment([CSV_HEADER, ...rows].join('\n'), 'refresh-csv').id;

  const seriesValues = () =>
    (useEditor.getState().deck.slides[0].charts![0].spec as ColumnBarSpec).data.series[0].values;
  const kpiRuns = () => {
    const el = useEditor.getState().deck.slides[1].elements[0] as TextElement;
    return el.body.paragraphs[0].runs;
  };

  beforeEach(() => {
    clearAttachments();
    loadDeck(refreshDeck(), DEFAULT_DESIGN_SYSTEM);
  });

  it('previews without touching the deck', () => {
    const out = applyTool('preview_number_refresh', {
      csv_id: attach('p1/c:ch_1/s0/c0,1,x,100,140,,,,,reported,'),
    });
    expect(out.isError).toBeFalsy();
    expect(out.text).toContain('Nothing has been changed yet');
    expect(seriesValues()).toEqual([100, 120]);
  });

  it('writes a chart figure into the series the ref names', () => {
    applyTool('apply_number_refresh', { csv_id: attach('p1/c:ch_1/s0/c1,1,x,120,155,,,,,reported,') });
    expect(seriesValues()).toEqual([100, 155]);
  });

  it('replaces a figure in a sentence without disturbing the runs around it', () => {
    applyTool('apply_number_refresh', { csv_id: attach('p2/t:k1/n0,2,x,4200000,4900000,,,,,reported,') });
    expect(kpiRuns().map((r) => r.text)).toEqual(['ARR of ', '$4.9M', ' and climbing']);
    // The whole point: the figure changed and nothing about how it looks did.
    expect(kpiRuns()[1]).toMatchObject({ sizePt: 28, bold: true, color: { kind: 'token', token: 'brand.accent' } });
  });

  it('leaves the user on the slide they started on', () => {
    useEditor.getState().setCurrentSlide('s1');
    applyTool('apply_number_refresh', { csv_id: attach('p2/t:k1/n0,2,x,4200000,4900000,,,,,reported,') });
    expect(useEditor.getState().currentSlideId).toBe('s1');
  });

  it('takes a whole refresh back in one undo', () => {
    applyTool('apply_number_refresh', {
      csv_id: attach(
        'p1/c:ch_1/s0/c0,1,x,100,140,,,,,reported,',
        'p1/c:ch_1/s0/c1,1,x,120,155,,,,,reported,',
        'p2/t:k1/n0,2,x,4200000,4900000,,,,,reported,',
      ),
    });
    expect(seriesValues()).toEqual([140, 155]);
    useEditor.getState().undo();
    expect(seriesValues()).toEqual([100, 120]);
    expect(kpiRuns()[1].text).toBe('$4.2M');
  });

  it('applies only the refs it was given', () => {
    applyTool('apply_number_refresh', {
      csv_id: attach('p1/c:ch_1/s0/c0,1,x,100,140,,,,,reported,', 'p1/c:ch_1/s0/c1,1,x,120,155,,,,,reported,'),
      refs: ['p1/c:ch_1/s0/c0'],
    });
    expect(seriesValues()).toEqual([140, 120]);
  });

  it('reports what it could not apply instead of applying it anyway', () => {
    const out = applyTool('apply_number_refresh', {
      csv_id: attach('p1/c:ch_1/s0/c0,1,x,100,42%,,,,,reported,', 'p9/c:gone/s0/c0,9,x,1,2,,,,,reported,'),
    });
    expect(seriesValues()).toEqual([100, 120]);
    expect(out.text).toContain('percent sign');
    expect(out.text).toContain('Nothing in this deck has the ref');
  });

  it('names the figures the CSV never checked', () => {
    const out = applyTool('preview_number_refresh', {
      csv_id: attach('p1/c:ch_1/s0/c0,1,x,100,140,,,,,reported,'),
    });
    expect(out.text).toContain('never checked');
    expect(out.text).toContain('p2/t:k1/n0');
  });

  it('refuses an id it was never given', () => {
    expect(applyTool('preview_number_refresh', { csv_id: 'att_nope' }).isError).toBe(true);
  });
});
