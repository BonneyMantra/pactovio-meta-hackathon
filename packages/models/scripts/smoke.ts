// Live smoke against the Meta Model API: fast, reason (json_schema), vision (public image URL), tool round trip.
// Usage: set -a; source .env.local; set +a; META_API_KEY=$PACTOVIO_META_MODEL_API_KEY npx tsx packages/models/scripts/smoke.ts
import { z } from 'zod';
import { chat, chatJSON, resolveLane, laneId, type ChatMessage } from '../src';

const env = { META_API_KEY: process.env.META_API_KEY ?? process.env.PACTOVIO_META_MODEL_API_KEY };
const out: Record<string, unknown>[] = [];
const run = async (name: string, role: 'fast' | 'reason' | 'vision' | 'agent', fn: () => Promise<Record<string, unknown>>) => {
  const t0 = Date.now();
  const lane = laneId(resolveLane(env, role));
  try {
    out.push({ name, lane, ok: true, ...(await fn()), ms: Date.now() - t0 });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    out.push({ name, lane, ok: false, ms: Date.now() - t0, status: err.status, error: String(err.message ?? e).slice(0, 300) });
  }
};
const Schema = z.object({ answer: z.number(), unit: z.string() });
const usage = (r: { tokensIn: number; tokensOut: number; costUsd: number }) => ({ tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd });

await run('fast', 'fast', async () => {
  const r = await chat({ env, role: 'fast', purpose: 'smoke', maxTokens: 40, temperature: 0, messages: [{ role: 'user', content: 'Reply with the single word: pong' }] });
  if (!r.text) throw new Error('empty content');
  return { text: r.text.slice(0, 40), ...usage(r) };
});
await run('reason json_schema', 'reason', async () => {
  const { data, result } = await chatJSON(Schema, { env, purpose: 'smoke', role: 'reason', maxTokens: 300, messages: [{ role: 'user', content: 'A tender lot runs 3 years with 4 quarterly payments per year. How many payments in total? Return JSON {answer, unit}.' }] });
  return { json: data, ...usage(result) };
});
await run('vision image_url', 'vision', async () => {
  const msg = { role: 'user', content: [
    { type: 'text', text: 'In one short sentence, what does this image show?' },
    { type: 'image_url', image_url: { url: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png' } },
  ] } as unknown as ChatMessage;
  const r = await chat({ env, role: 'vision', purpose: 'smoke', maxTokens: 120, messages: [msg] });
  if (!r.text) throw new Error('empty content');
  return { text: r.text.slice(0, 160), ...usage(r) };
});
await run('tool round trip', 'agent', async () => {
  const tools = [{ type: 'function' as const, function: { name: 'add', description: 'Add two numbers', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } } }];
  const messages: ChatMessage[] = [{ role: 'user', content: 'Use the add tool to add 2 and 3, then tell me the result.' }];
  const first = await chat({ env, role: 'agent', purpose: 'smoke', maxTokens: 200, messages, tools });
  const call = first.toolCalls[0];
  if (!call) throw new Error('no tool call returned');
  messages.push({ role: 'assistant', content: first.text || null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] });
  messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ sum: 5 }) });
  const second = await chat({ env, role: 'agent', purpose: 'smoke', maxTokens: 200, messages, tools });
  return { tool: call.name, args: call.arguments, final: second.text.slice(0, 120), tokensIn: first.tokensIn + second.tokensIn, tokensOut: first.tokensOut + second.tokensOut, costUsd: Number((first.costUsd + second.costUsd).toFixed(6)) };
});
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
