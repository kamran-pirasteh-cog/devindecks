/**
 * The tool surface Devin gets over a deck.
 *
 * Every tool here maps onto an action the store already exposes to the toolbar
 * and the keyboard — no tool reaches into the deck directly. That's the whole
 * safety property: Devin can only do what a person clicking the UI could do, so
 * an edit it makes is undoable, autosaved and export-safe by construction.
 *
 * Geometry is in INCHES rather than EMU. The model reasons about a 13.33 x 7.5
 * slide far better than about 12,192,000 x 6,858,000, and `apply.ts` does the
 * one multiplication on the way in.
 */
import type Anthropic from '@anthropic-ai/sdk';

/** Shared by every tool that takes a colour: a design-system token or a hex. */
const COLOR = {
  type: 'string',
  description:
    'A design system token id (preferred — e.g. "ink.strong", "brand.accent", "ink.muted", ' +
    '"surface.base", "surface.subtle", "line.default") or a literal hex like "#2600FF".',
} as const;

const IDS = {
  type: 'array',
  items: { type: 'string' },
  description: 'Element ids from read_slide.',
} as const;

export const DECK_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_slide',
    description:
      'Read one slide in full: every element with its id, type, role, geometry (inches), text ' +
      'and styling. Call this before editing a slide you have not seen, and again after a ' +
      'batch of edits if you need to check the result.',
    input_schema: {
      type: 'object',
      properties: {
        slide: {
          type: 'integer',
          description: '1-based slide number. Omit for the slide currently open.',
        },
      },
    },
  },
  {
    name: 'goto_slide',
    description: 'Open a slide in the editor. Edits apply to whichever slide is open.',
    input_schema: {
      type: 'object',
      properties: { slide: { type: 'integer', description: '1-based slide number.' } },
      required: ['slide'],
    },
  },
  {
    name: 'add_slide',
    description: 'Insert a new empty slide after the given slide and open it.',
    input_schema: {
      type: 'object',
      properties: {
        after: {
          type: 'integer',
          description: '1-based slide number to insert after. Omit for after the current slide.',
        },
      },
    },
  },
  {
    name: 'duplicate_slide',
    description: 'Copy a slide, placing the copy directly after it.',
    input_schema: {
      type: 'object',
      properties: { slide: { type: 'integer' } },
      required: ['slide'],
    },
  },
  {
    name: 'delete_slide',
    description: 'Delete a slide. The deck always keeps at least one slide.',
    input_schema: {
      type: 'object',
      properties: { slide: { type: 'integer' } },
      required: ['slide'],
    },
  },
  {
    name: 'add_text',
    description:
      'Add a text box to the open slide. Use "\\n" inside `text` for separate paragraphs. ' +
      'Prefer a role ("title", "subtitle", "body", "caption") so the deck\'s type ladder and ' +
      'reformat-to-template can recognise it.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        x_in: { type: 'number', description: 'Left edge, inches from the slide\'s left.' },
        y_in: { type: 'number', description: 'Top edge, inches from the slide\'s top.' },
        w_in: { type: 'number' },
        h_in: { type: 'number', description: 'Omit to let the box size itself to the text.' },
        size_pt: { type: 'number' },
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
        color: COLOR,
        role: { type: 'string', description: 'e.g. "title", "subtitle", "body", "caption".' },
        bullet: { type: 'string', enum: ['none', 'bullet', 'number'] },
      },
      required: ['text', 'x_in', 'y_in', 'w_in'],
    },
  },
  {
    name: 'add_shape',
    description:
      'Add an autoshape to the open slide, optionally with text centred in it. Only these ' +
      'presets exist — they are the ones that render identically in PowerPoint and Slides.',
    input_schema: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          enum: ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'rightArrow', 'chevron', 'pill'],
        },
        x_in: { type: 'number' },
        y_in: { type: 'number' },
        w_in: { type: 'number' },
        h_in: { type: 'number' },
        fill: COLOR,
        text: { type: 'string' },
        text_color: COLOR,
        size_pt: { type: 'number' },
      },
      required: ['preset', 'x_in', 'y_in', 'w_in', 'h_in'],
    },
  },
  {
    name: 'set_text',
    description:
      'Replace the words in a text box or a shape, keeping its existing formatting. Use "\\n" ' +
      'to separate paragraphs; each paragraph inherits the styling of the one it replaces.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, text: { type: 'string' } },
      required: ['id', 'text'],
    },
  },
  {
    name: 'style_text',
    description: 'Restyle every run of text in these elements. Omitted fields are left alone.',
    input_schema: {
      type: 'object',
      properties: {
        ids: IDS,
        size_pt: { type: 'number' },
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        underline: { type: 'boolean' },
        color: COLOR,
        font: { type: 'string', enum: ['Geist', 'Geist Mono', 'Source Serif 4'] },
        align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
        anchor: {
          type: 'string',
          enum: ['top', 'middle', 'bottom'],
          description: 'Vertical position of the text within its box.',
        },
        bullet: { type: 'string', enum: ['none', 'bullet', 'number'] },
      },
      required: ['ids'],
    },
  },
  {
    name: 'set_geometry',
    description:
      'Move, resize or rotate elements. `x_in`/`y_in` are absolute; `dx_in`/`dy_in` are ' +
      'relative nudges. With several ids, absolute coordinates set them all to the same place, ' +
      'so prefer relative moves for a group.',
    input_schema: {
      type: 'object',
      properties: {
        ids: IDS,
        x_in: { type: 'number' },
        y_in: { type: 'number' },
        dx_in: { type: 'number' },
        dy_in: { type: 'number' },
        w_in: { type: 'number' },
        h_in: { type: 'number' },
        rotation: { type: 'number', description: 'Clockwise degrees.' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'set_style',
    description: 'Set the fill and outline of shapes, text boxes, lines or pictures.',
    input_schema: {
      type: 'object',
      properties: {
        ids: IDS,
        fill: COLOR,
        fill_none: { type: 'boolean', description: 'Clear the fill entirely.' },
        fill_alpha: { type: 'number', description: 'Opacity 0..1.' },
        outline: COLOR,
        outline_width_pt: { type: 'number' },
        outline_dash: { type: 'string', enum: ['solid', 'dash', 'dot'] },
        outline_none: { type: 'boolean' },
        rounded: { type: 'boolean', description: 'Round or square the corners of a rectangle.' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'arrange',
    description:
      'Line elements up, space them evenly, or restack them. Alignment with one element ' +
      'selected measures against the slide margins; with several, against the selection.',
    input_schema: {
      type: 'object',
      properties: {
        ids: IDS,
        align: { type: 'string', enum: ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] },
        distribute: { type: 'string', enum: ['h', 'v'] },
        order: { type: 'string', enum: ['front', 'back', 'forward', 'backward'] },
      },
      required: ['ids'],
    },
  },
  {
    name: 'delete_elements',
    description: 'Remove elements from the open slide.',
    input_schema: {
      type: 'object',
      properties: { ids: IDS },
      required: ['ids'],
    },
  },
  {
    name: 'set_deck_title',
    description: 'Rename the document.',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  },
];

export const TOOL_NAMES = new Set(DECK_TOOLS.map((t) => t.name));
