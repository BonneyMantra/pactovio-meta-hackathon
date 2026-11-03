import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { makeEnv } from '../../../apps/api/test/helpers';
import { chat, isBudgetError, LIMIT_MESSAGE, OFF_MESSAGE, spentTodayUsd } from '../src';

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()), 60_000);
afterAll(async () => dispose?.());

// A model-API stand-in that reports realistic prompt tokens (about 4 characters each) and 1,000 completion tokens per call.
function upstream(calls: { n: number }) {
  return (async (_url: string, init: RequestInit) => {
    calls.n++;
    const body = JSON.parse(init.body as string) as { input?: unknown; messages?: unknown };
    const promptTokens = Math.ceil(JSON.stringify(body.messages ?? body.input ?? '').length / 4);
    const json = { id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: promptTokens, completion_tokens: 1000 } };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('daily spend cap', () => {
  it('records actual cost at list prices, then refuses once the cap would be passed, without calling the provider', async () => {
    // Muse Spark at list price: ~8 prompt tokens x $1.25/M + 1,000 out x $4.25/M = about $0.0043 per call. Each request first
    // reserves its worst case (max_tokens plus the reasoning headroom, about $0.038), so a $0.06 cap admits a few calls and then refuses.
    const env = { ...base, ENVIRONMENT: 'production', MODEL_DAILY_CAP_USD: '0.06' } as Env;
    const calls = { n: 0 };
    const ask = () => chat({ env, role: 'reason', purpose: 'cap test', maxTokens: 1000, messages: [{ role: 'user', content: 'hi' }], fetch: upstream(calls) });
    await ask();
    expect(await spentTodayUsd(env)).toBeCloseTo(0.00426, 5); // settled to the actual tokens, not the estimate
    let refused: unknown = null;
    for (let i = 0; i < 10 && !refused; i++) { try { await ask(); } catch (e) { refused = e; } }
    expect(isBudgetError(refused)).toBe(true);
    expect(String((refused as Error).message)).toContain(LIMIT_MESSAGE);
    const before = calls.n;
    await expect(ask()).rejects.toSatisfy(isBudgetError);
    expect(calls.n).toBe(before); // the refused call never reached the provider
    expect(await spentTodayUsd(env)).toBeLessThanOrEqual(0.06);
  });

  it('the kill switch refuses every call', async () => {
    const env = { ...base, ENVIRONMENT: 'production', MODELS_DISABLED: '1' } as Env;
    const calls = { n: 0 };
    const err = await chat({ env, role: 'fast', purpose: 'kill switch', messages: [{ role: 'user', content: 'hi' }], fetch: upstream(calls) }).catch((e) => e);
    expect(isBudgetError(err)).toBe(true);
    expect(String(err.message)).toContain(OFF_MESSAGE);
    expect(calls.n).toBe(0);
  });
});
