import { describe, expect, it } from 'vitest';
import type { ModelEnv } from '@pactovio/contracts/env';
import { chat, formatLane, laneApiKey, laneBaseURL, laneConfigured, laneId, laneParams, makeClient, parseLane, portableExtra, resolveLane, withReasoningHeadroom } from '../src';

const env = (e: Record<string, string>) => e as unknown as ModelEnv;

describe('parseLane', () => {
  it('parses provider, model and effort', () => {
    expect(parseLane('meta:muse-spark-1.3@high')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', effort: 'high' });
    expect(parseLane('fireworks:accounts/fireworks/models/llama-v3p3-70b-instruct')).toEqual({ provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct' });
  });
  it('treats a bare id as the fallback provider and keeps ids that contain colons or slashes', () => {
    expect(parseLane('muse-spark-1.2')).toEqual({ provider: 'meta', model: 'muse-spark-1.2' });
    expect(parseLane('accounts/acme/models/x', 'fireworks')).toEqual({ provider: 'fireworks', model: 'accounts/acme/models/x' });
    expect(parseLane('modal:org/model:tag@low')).toEqual({ provider: 'modal', model: 'org/model:tag', effort: 'low' });
  });
  it('rejects an unknown effort and an empty model', () => {
    expect(() => parseLane('meta:muse-spark-1.3@extreme')).toThrow(/effort/);
    expect(() => parseLane('meta:')).toThrow();
  });
  it('rejects every contributor-mode model (Meta may train on those prompts)', () => {
    expect(() => parseLane('meta:muse-spark-1.3-contributor')).toThrow(/Contributor/);
    expect(() => parseLane('muse-spark-1.2-contributor@high')).toThrow(/Contributor/);
    expect(() => parseLane('fireworks:Some-Contributor-Model')).toThrow(/Contributor/);
  });
  it('round-trips through formatLane', () => {
    const l = parseLane('meta:muse-spark-1.3@xhigh');
    expect(parseLane(formatLane(l))).toEqual(l);
    expect(laneId(l)).toBe('meta:muse-spark-1.3');
  });
});

describe('resolveLane', () => {
  it('defaults every text role to Muse Spark 1.3 on Meta with the specified efforts', () => {
    const e = env({});
    expect(resolveLane(e, 'reason')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', effort: 'high' });
    expect(resolveLane(e, 'agent')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', effort: 'medium' });
    expect(resolveLane(e, 'fast')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', effort: 'minimal' });
    expect(resolveLane(e, 'vision')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', effort: 'medium' });
  });
  it('lets LANE_* move one role to another provider without touching the others', () => {
    const e = env({ LANE_FAST: 'fireworks:accounts/fireworks/models/small', LANE_REASON: 'meta:muse-wonder-1.0@max' });
    expect(resolveLane(e, 'fast')).toEqual({ provider: 'fireworks', model: 'accounts/fireworks/models/small' });
    expect(resolveLane(e, 'reason')).toEqual({ provider: 'meta', model: 'muse-wonder-1.0', effort: 'max' });
    expect(resolveLane(e, 'agent').model).toBe('muse-spark-1.3');
  });
  it('inherits the role default effort on Meta when the lane omits one', () => {
    expect(resolveLane(env({ LANE_REASON: 'meta:muse-spark-1.2' }), 'reason')).toEqual({ provider: 'meta', model: 'muse-spark-1.2', effort: 'high' });
  });
  it('keeps the legacy MODEL_* variables working, below LANE_* and above the defaults', () => {
    expect(resolveLane(env({ MODEL_FAST: 'muse-spark-1.2' }), 'fast')).toEqual({ provider: 'meta', model: 'muse-spark-1.2', effort: 'minimal' });
    expect(resolveLane(env({ MODEL_FAST: 'muse-spark-1.2', LANE_FAST: 'meta:muse-spark-1.1@low' }), 'fast')).toEqual({ provider: 'meta', model: 'muse-spark-1.1', effort: 'low' });
  });
  it('an explicit override wins, and a contributor model is rejected there and in env', () => {
    expect(resolveLane(env({ LANE_AGENT: 'meta:muse-spark-1.1' }), 'agent', 'meta:muse-spark-1.2@low').model).toBe('muse-spark-1.2');
    expect(() => resolveLane(env({}), 'agent', 'meta:muse-spark-1.3-contributor')).toThrow(/Contributor/);
    expect(() => resolveLane(env({ LANE_FAST: 'meta:muse-spark-1.2-contributor' }), 'fast')).toThrow(/Contributor/);
    expect(() => resolveLane(env({ MODEL_REASON: 'muse-spark-1.3-contributor' }), 'reason')).toThrow(/Contributor/);
  });
});

describe('provider wiring', () => {
  it('uses fixed base URLs, per-deployment URLs from env, and the right key variable', () => {
    const e = env({ META_API_KEY: 'm', FIREWORKS_API_KEY: 'f', BASETEN_API_KEY: 'b', BASETEN_BASE_URL: 'https://model-abc.api.baseten.co/v1' });
    expect(laneBaseURL(e, parseLane('meta:x'))).toBe('https://api.meta.ai/v1');
    expect(laneBaseURL(e, parseLane('fireworks:x'))).toBe('https://api.fireworks.ai/inference/v1');
    expect(laneBaseURL(e, parseLane('baseten:x'))).toBe('https://model-abc.api.baseten.co/v1');
    expect(() => laneBaseURL(e, parseLane('modal:x'))).toThrow(/MODAL_BASE_URL/);
    expect(laneApiKey(e, parseLane('fireworks:x'))).toBe('f');
    expect(() => laneApiKey(e, parseLane('modal:x'))).toThrow(/MODAL_API_KEY/);
    expect(laneConfigured(e, 'fast')).toBe(true);
    expect(laneConfigured(env({}), 'fast')).toBe(false);
  });
  it('sends reasoning_effort only to providers that support it, and strips non-portable fields', () => {
    expect(laneParams(parseLane('meta:muse-spark-1.3@low'))).toEqual({ reasoning_effort: 'low' });
    expect(laneParams(parseLane('fireworks:x@low'))).toEqual({});
    expect(portableExtra(parseLane('meta:x'), { chat_template_kwargs: {}, service_tier: 'flex', response_format: 1 })).toEqual({ response_format: 1 });
  });
  it('adds reasoning headroom to max_tokens on Meta only', () => {
    expect(withReasoningHeadroom(parseLane('meta:muse-spark-1.3@minimal'), 100)).toBeGreaterThan(100);
    expect(withReasoningHeadroom(parseLane('fireworks:x'), 100)).toBe(100);
    expect(withReasoningHeadroom(parseLane('meta:muse-spark-1.3@high'), undefined)).toBeUndefined();
  });
  it('builds the client against the lane base URL and refuses a lane without a key', () => {
    expect(String(makeClient(env({ META_API_KEY: 'k' }), undefined, undefined, parseLane('meta:x')).baseURL)).toBe('https://api.meta.ai/v1');
    expect(() => makeClient(env({}), undefined, undefined, parseLane('fireworks:x'))).toThrow(/FIREWORKS_API_KEY/);
  });
  it('sends a request to the provider of the role and refuses contributor models before any network call', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    const e = env({ META_API_KEY: 'k', FIREWORKS_API_KEY: 'k', LANE_FAST: 'fireworks:small' });
    await chat({ env: e, role: 'fast', purpose: 'p', messages: [{ role: 'user', content: 'hi' }], fetch: f });
    await chat({ env: e, role: 'reason', purpose: 'p', messages: [{ role: 'user', content: 'hi' }], fetch: f });
    expect(urls[0]).toContain('api.fireworks.ai');
    expect(urls[1]).toContain('api.meta.ai');
    await expect(chat({ env: e, role: 'agent', model: 'meta:muse-spark-1.3-contributor', purpose: 'p', messages: [], fetch: f })).rejects.toThrow(/Contributor/);
    expect(urls).toHaveLength(2);
  });
});
