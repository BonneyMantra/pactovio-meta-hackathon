import type OpenAI from 'openai';
import { client } from './client';
import { laneId, laneParams, portableExtra, resolveLane, withReasoningHeadroom } from './providers';
import { costUsd } from './prices';
import { flexLimiter, liveLimiter } from './limiter';
import type { CallOptions, ChatMessage, ChatResult } from './types';

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

export interface ChatParams extends CallOptions {
  messages: ChatMessage[];
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | 'required';
  /** Extra request body fields (e.g. response_format). */
  extra?: Record<string, unknown>;
}

/**
 * One chat completion with limiter, per-role provider and reasoning effort, flex concurrency cap, and run_step logging.
 * Put the pack text FIRST in `messages` so later calls of a run reuse the prompt cache.
 */
export async function chat(p: ChatParams): Promise<ChatResult> {
  const role = p.role ?? 'reason';
  const lane = resolveLane(p.env, role, p.model);
  const model = lane.model;
  const label = laneId(lane);
  const limit = p.flex ? flexLimiter : liveLimiter;
  const maxTokens = withReasoningHeadroom(lane, p.maxTokens);
  const body: Record<string, unknown> = {
    model,
    messages: p.messages,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(p.tools?.length ? { tools: p.tools, tool_choice: p.toolChoice ?? 'auto' } : {}),
    // Meta: reasoning_effort per lane.
    ...laneParams(lane),
    ...portableExtra(lane, p.extra),
  };
  const t0 = Date.now();
  try {
    const res = await limit(() => client({ ...p, role }).chat.completions.create(body as never, { signal: p.signal })) as OpenAI.Chat.Completions.ChatCompletion;
    const ms = Date.now() - t0;
    const msg = res.choices[0]?.message;
    const usage = res.usage as (OpenAI.CompletionUsage & { prompt_tokens_details?: { cached_tokens?: number } }) | undefined;
    const tokensIn = usage?.prompt_tokens ?? 0;
    const tokensOut = usage?.completion_tokens ?? 0;
    const tokensCached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const cost = costUsd(model, tokensIn, tokensOut, tokensCached, !!p.flex);
    await p.onStep?.({ purpose: p.purpose, model: label, status: 'ok', tokensIn, tokensOut, tokensCached, ms, costUsd: cost });
    return {
      text: stripThinking(msg?.content ?? ''),
      model: label, tokensIn, tokensOut, tokensCached, ms, costUsd: cost,
      toolCalls: (msg?.tool_calls ?? []).flatMap((t) => (t.type === 'function' ? [{ id: t.id, name: t.function.name, arguments: t.function.arguments }] : [])),
      raw: res,
    };
  } catch (err) {
    await p.onStep?.({ purpose: p.purpose, model: label, status: 'error', tokensIn: 0, tokensOut: 0, tokensCached: 0, ms: Date.now() - t0, costUsd: 0, summary: err instanceof Error ? err.message.slice(0, 300) : 'error' });
    throw err;
  }
}

/** Remove `<think>...</think>` blocks that reasoning models may leak into content. */
export function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
