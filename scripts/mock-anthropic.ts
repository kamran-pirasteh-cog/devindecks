/**
 * A stand-in for the Anthropic API, so the chat column can be driven end to end
 * without a key (or a bill).
 *
 * Point the SDK at it and every other link in the chain stays real: the route,
 * the browser agent loop, `applyTool`, the store, undo, autosave, the panel.
 * Only the model is fake.
 *
 *   npm run dev:mock        # this server plus `next dev`
 *
 * What it replies with, given the last user message:
 *   - one or more `/tool <name> <json>` lines  -> exactly those tool calls
 *   - a few keywords (slide, title, align...)  -> a canned scenario, below
 *   - anything else                            -> a text turn that echoes back
 *     what it saw, including whether the deck-state block arrived
 * A turn carrying tool results always gets a plain text turn back, which is
 * what ends the loop in `runAgent`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown };

/* ------------------------------------------------------------------ */
/* Deciding what to say                                               */
/* ------------------------------------------------------------------ */

/** `/tool add_text {"text":"Hi","x_in":1,"y_in":1,"w_in":6}`, one per line. */
function directives(text: string): Block[] {
  const out: Block[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*\/tool\s+(\w+)\s*(\{.*\})?\s*$/.exec(line);
    if (!m) continue;
    let input: unknown = {};
    if (m[2]) {
      try {
        input = JSON.parse(m[2]);
      } catch {
        return [{ type: 'text', text: `That isn’t valid JSON: ${m[2]}` }];
      }
    }
    out.push({ type: 'tool_use', name: m[1], input });
  }
  return out;
}

/**
 * Enough canned scenarios that the panel's own suggestion chips do something.
 * Keyed on words, not exact strings, so paraphrases still land.
 */
function scenario(text: string): Block[] | null {
  const t = text.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  if (has('add a slide', 'new slide')) {
    return [
      { type: 'text', text: 'Adding one at the end.' },
      { type: 'tool_use', name: 'add_slide', input: {} },
    ];
  }
  if (has('retitle', 'rename', 'title')) {
    return [
      { type: 'tool_use', name: 'read_slide', input: {} },
      { type: 'tool_use', name: 'set_deck_title', input: { title: 'Mocked deck title' } },
    ];
  }
  if (has('align', 'line up', 'tidy')) {
    return [{ type: 'tool_use', name: 'read_slide', input: {} }];
  }
  if (has('takeaway', 'add text', 'caption')) {
    return [
      {
        type: 'tool_use',
        name: 'add_text',
        input: { text: 'Mocked takeaway line.', x_in: 0.6, y_in: 6.4, w_in: 12, role: 'caption' },
      },
    ];
  }
  if (has('two things', 'both')) {
    return [
      { type: 'tool_use', name: 'add_slide', input: {} },
      { type: 'tool_use', name: 'set_deck_title', input: { title: 'Two calls at once' } },
    ];
  }
  return null;
}

function lastUserText(messages: { role: string; content: unknown }[]): {
  text: string;
  isToolResult: boolean;
  sawDeckState: boolean;
} {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const blocks = Array.isArray(last?.content)
    ? (last!.content as { type: string; text?: string }[])
    : [{ type: 'text', text: String(last?.content ?? '') }];
  return {
    text: blocks.find((b) => b.type === 'text')?.text ?? '',
    isToolResult: blocks.some((b) => b.type === 'tool_result'),
    sawDeckState: blocks.some((b) => b.text?.includes('<deck-state>')),
  };
}

function reply(body: { messages?: { role: string; content: unknown }[] }): Block[] {
  const messages = body.messages ?? [];
  const { text, isToolResult, sawDeckState } = lastUserText(messages);

  // Tool results come back to us; answering in prose is what stops the loop.
  if (isToolResult) {
    return [{ type: 'text', text: 'Done — that’s applied to the deck. (mock)' }];
  }

  const asked = directives(text);
  if (asked.length) return asked;

  const canned = scenario(text);
  if (canned) return canned;

  return [
    {
      type: 'text',
      text:
        `Mock Anthropic here. You said: “${text.slice(0, 200)}”.\n\n` +
        `Deck state ${sawDeckState ? 'arrived with the turn' : 'was MISSING'}; ` +
        `${messages.length} message(s) in history.\n\n` +
        'To exercise a tool, send a line like `/tool add_slide {}` or ' +
        '`/tool add_text {"text":"Hi","x_in":1,"y_in":1,"w_in":6}`.',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Serialising it as the SDK expects                                  */
/* ------------------------------------------------------------------ */

let counter = 0;

/** The route uses `messages.stream()`, so the answer has to arrive as SSE. */
function writeStream(res: ServerResponse, blocks: Block[]) {
  const id = `msg_mock_${++counter}`;
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const usage = {
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  send('message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-mock',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage,
    },
  });

  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      send('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      send('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      });
    } else {
      send('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: `toolu_mock_${id}_${index}`,
          name: block.name,
          input: {},
        },
      });
      send('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
    }
    send('content_block_stop', { type: 'content_block_stop', index });
  });

  send('message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
    },
    usage,
  });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

/* ------------------------------------------------------------------ */

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

createServer(async (req, res) => {
  if (!req.url?.startsWith('/v1/messages') || req.method !== 'POST') {
    res.writeHead(404).end('{"type":"error"}');
    return;
  }
  let body: { messages?: { role: string; content: unknown }[] } = {};
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    /* an empty body just gets the default reply */
  }
  const blocks = reply(body);
  console.log(
    `[mock] -> ${blocks.map((b) => (b.type === 'text' ? 'text' : `${b.name}()`)).join(', ')}`,
  );
  writeStream(res, blocks);
}).listen(PORT, () => {
  console.log(`[mock] Anthropic stand-in on http://127.0.0.1:${PORT}`);
});
