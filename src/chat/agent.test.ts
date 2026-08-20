import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { transcript } from './agent';

/** A conversation with one tool call in it, shaped exactly as the API returns. */
const HISTORY: Anthropic.MessageParam[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Retitle this slide' },
      { type: 'text', text: '<deck-state>\n{"deckTitle":"Deck"}\n</deck-state>' },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'tu_1', name: 'set_text', input: { id: 't1', text: 'Q3 results' } },
      { type: 'tool_use', id: 'tu_2', name: 'delete_elements', input: { ids: ['t2', 't3'] } },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tu_1', content: 't1 now reads "Q3 results".' },
      { type: 'tool_result', tool_use_id: 'tu_2', content: 'Error: no such element', is_error: true },
    ],
  },
  { role: 'assistant', content: [{ type: 'text', text: 'Retitled the slide.' }] },
];

describe('transcript', () => {
  const items = transcript(HISTORY);

  it('shows what the user typed, not the deck state stapled to it', () => {
    const user = items.filter((i) => i.kind === 'user');
    expect(user).toHaveLength(1);
    expect(user[0].text).toBe('Retitle this slide');
    expect(items.some((i) => 'text' in i && i.text.includes('deck-state'))).toBe(false);
  });

  it('turns tool calls into one line each, phrased as the change', () => {
    const tools = items.filter((i) => i.kind === 'tool');
    expect(tools.map((t) => t.label)).toEqual([
      'Rewriting text to “Q3 results”',
      'Deleting 2 objects',
    ]);
  });

  it('marks the call whose result came back an error', () => {
    const tools = items.filter((i) => i.kind === 'tool');
    expect(tools.map((t) => t.failed)).toEqual([false, true]);
  });

  it('drops the tool-result turn — the loop talking to itself', () => {
    expect(items.map((i) => i.kind)).toEqual(['user', 'tool', 'tool', 'assistant']);
  });

  it('skips empty thinking blocks rather than rendering blanks', () => {
    expect(items.filter((i) => i.kind === 'assistant')).toHaveLength(1);
  });
});
