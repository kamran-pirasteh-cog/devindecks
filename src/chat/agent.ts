/**
 * The agent loop, run in the browser.
 *
 * Ask the model → apply whatever tools it asked for against the editor store →
 * hand the results back → repeat until it stops asking. The deck never leaves
 * the browser: the server sees a snapshot of the open slide and the tool calls,
 * and applies nothing itself.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { useEditor } from '@/store/editorStore';
import { applyTool } from './apply';
import { deckSnapshot } from './context';

/**
 * How many rounds of tool calls one message may take. High enough for a real
 * multi-element edit, low enough that a model stuck in a loop stops costing
 * money — on the cap it's told to wrap up and answer.
 */
export const MAX_STEPS = 12;

const NUDGE =
  'You have reached the tool limit for this turn. Stop calling tools and tell the user what you ' +
  'changed and what is left to do.';

/**
 * What the user typed, with the state of the deck at that moment attached.
 *
 * Fresh per message rather than once per conversation: the user is editing the
 * same deck by hand between turns, and Devin acting on a snapshot from four
 * messages ago is how you get an edit applied to the wrong box.
 */
export function userTurn(text: string): Anthropic.MessageParam {
  const s = useEditor.getState();
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      {
        type: 'text',
        text: `<deck-state>\n${deckSnapshot(s.deck, s.currentSlideId, s.selectedIds)}\n</deck-state>`,
      },
    ],
  };
}

async function ask(messages: Anthropic.MessageParam[], signal?: AbortSignal) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });
  const data = (await res.json().catch(() => null)) as {
    content?: Anthropic.ContentBlock[];
    stop_reason?: string;
    error?: string;
  } | null;
  if (!res.ok || !data?.content) {
    throw new Error(data?.error ?? `Devin is unreachable (${res.status}).`);
  }
  if (data.stop_reason === 'refusal') throw new Error('Devin declined that request.');
  return data;
}

/** Run every tool call in one assistant turn and package the results. */
function applyCalls(content: Anthropic.ContentBlock[]): Anthropic.MessageParam {
  const results = content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((call) => {
      const out = applyTool(call.name, (call.input ?? {}) as Record<string, unknown>);
      return {
        type: 'tool_result' as const,
        tool_use_id: call.id,
        content: out.text,
        ...(out.isError ? { is_error: true } : {}),
      };
    });
  // All of a turn's results go back in ONE user message. Splitting them teaches
  // the model to stop asking for tools in parallel.
  return { role: 'user', content: results };
}

/**
 * Drive one exchange to completion, returning the grown history. `onProgress`
 * fires after every step so the panel can show tool calls as they land rather
 * than all at once at the end.
 */
export async function runAgent(
  history: Anthropic.MessageParam[],
  opts: { onProgress?: (messages: Anthropic.MessageParam[]) => void; signal?: AbortSignal } = {},
): Promise<Anthropic.MessageParam[]> {
  let messages = history;
  const advance = (next: Anthropic.MessageParam[]) => {
    messages = next;
    opts.onProgress?.(messages);
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await ask(messages, opts.signal);
    // The whole content array goes back, thinking blocks included — the API
    // needs them unaltered to continue the same turn.
    advance([...messages, { role: 'assistant', content: reply.content! }]);
    if (reply.stop_reason !== 'tool_use') return messages;
    advance([...messages, applyCalls(reply.content!)]);
  }

  advance([...messages, { role: 'user', content: [{ type: 'text', text: NUDGE }] }]);
  const last = await ask(messages, opts.signal);
  advance([...messages, { role: 'assistant', content: last.content! }]);
  return messages;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

export type TranscriptItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string }
  | { kind: 'tool'; key: string; label: string; detail: string; failed: boolean };

/** How a tool call reads in the panel — the change, not the call. */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  const n = (k: string) => (typeof input[k] === 'number' ? (input[k] as number) : undefined);
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  const count = Array.isArray(input.ids) ? input.ids.length : 0;
  const many = count === 1 ? '1 object' : `${count} objects`;
  switch (name) {
    case 'read_slide':
      return n('slide') ? `Reading slide ${n('slide')}` : 'Reading the slide';
    case 'goto_slide':
      return `Opening slide ${n('slide')}`;
    case 'add_slide':
      return 'Adding a slide';
    case 'duplicate_slide':
      return `Duplicating slide ${n('slide')}`;
    case 'delete_slide':
      return `Deleting slide ${n('slide')}`;
    case 'add_text':
      return `Adding text “${(s('text') ?? '').split('\n')[0].slice(0, 40)}”`;
    case 'add_shape':
      return `Adding a ${s('preset') ?? 'shape'}`;
    case 'set_text':
      return `Rewriting text to “${(s('text') ?? '').split('\n')[0].slice(0, 40)}”`;
    case 'style_text':
      return `Restyling text on ${many}`;
    case 'set_geometry':
      return `Repositioning ${many}`;
    case 'set_style':
      return `Recolouring ${many}`;
    case 'arrange':
      return `Arranging ${many}`;
    case 'delete_elements':
      return `Deleting ${many}`;
    case 'set_deck_title':
      return `Renaming the deck to “${s('title')}”`;
    default:
      return name;
  }
}

/**
 * The history as the panel shows it: what the user asked, what Devin said, and
 * a line per tool call. The deck-state block the user turn carries is dropped —
 * it's context for the model, not something anyone wants to read.
 */
export function transcript(messages: Anthropic.MessageParam[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  /** tool_use_id -> whether its result came back an error. */
  const failed = new Map<string, boolean>();
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const block of m.content) {
      if (block.type === 'tool_result') failed.set(block.tool_use_id, block.is_error === true);
    }
  }

  messages.forEach((m, i) => {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content } as const] : m.content;
    if (m.role === 'user') {
      // Tool-result turns are the loop talking to itself; the chips above them
      // already say what happened.
      if (blocks.some((b) => b.type === 'tool_result')) return;
      const first = blocks.find((b) => b.type === 'text');
      if (first && 'text' in first) out.push({ kind: 'user', key: `u${i}`, text: first.text });
      return;
    }
    blocks.forEach((b, j) => {
      if (b.type === 'text' && b.text.trim()) {
        out.push({ kind: 'assistant', key: `a${i}-${j}`, text: b.text });
      } else if (b.type === 'tool_use') {
        out.push({
          kind: 'tool',
          key: `t${b.id}`,
          label: toolLabel(b.name, (b.input ?? {}) as Record<string, unknown>),
          detail: JSON.stringify(b.input),
          failed: failed.get(b.id) === true,
        });
      }
    });
  });
  return out;
}
