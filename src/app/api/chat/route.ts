/**
 * The one server-side hop in the chat loop: it holds the API key and nothing
 * else. Tools are DEFINED here (so the model sees them) but EXECUTED in the
 * browser — the deck lives in the editor store and in local storage, and the
 * server has no copy of it to act on. See `src/chat/apply.ts`.
 *
 * Requests are streamed to Anthropic and awaited whole, so a long turn can't
 * trip the SDK's HTTP timeout while the client still gets one plain JSON reply.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DECK_TOOLS } from '@/chat/tools';
import { SYSTEM_PROMPT } from '@/chat/prompt';

export const runtime = 'nodejs';
/** A turn with several tool calls behind it can think for a while. */
export const maxDuration = 300;

const MODEL = 'claude-opus-5';

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY is not set on the server, so Devin can’t be reached.' },
      { status: 503 },
    );
  }

  let messages: Anthropic.MessageParam[];
  try {
    const body = (await req.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json({ error: 'Expected a non-empty `messages` array.' }, { status: 400 });
    }
    messages = body.messages as Anthropic.MessageParam[];
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const client = new Anthropic();

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      // Frozen prompt + deterministic tool list = a stable cacheable prefix.
      // Everything that changes per turn rides in the messages.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: DECK_TOOLS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages,
    });
    const message = await stream.finalMessage();
    return Response.json({
      content: message.content,
      stop_reason: message.stop_reason,
      stop_details: message.stop_details,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: 'The server’s Anthropic API key was rejected.' }, { status: 502 });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'Rate limited by the API — try again in a moment.' }, { status: 429 });
    }
    if (e instanceof Anthropic.APIError) {
      return Response.json({ error: `Anthropic API error ${e.status}: ${e.message}` }, { status: 502 });
    }
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
