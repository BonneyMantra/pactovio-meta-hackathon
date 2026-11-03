import OpenAI from 'openai';
import type { ModelEnv } from '@pactovio/contracts/env';
import type { CallOptions, ModelRole } from './types';
import { budgetedFetch } from './budget';
import { DEFAULT_LANES, laneApiKey, laneBaseURL, laneId, resolveLane, type Lane } from './providers';

/** Default lane per role (provider, model, effort). Kept under the old name for callers that need a default model id. */
export const DEFAULT_MODELS: Record<ModelRole, string> = Object.fromEntries(
  (Object.keys(DEFAULT_LANES) as ModelRole[]).map((r) => [r, DEFAULT_LANES[r].model]),
) as Record<ModelRole, string>;

/** Bare model id (what goes in the request body) for a role. */
export function modelFor(env: ModelEnv, role: ModelRole, override?: string): string {
  return resolveLane(env, role, override).model;
}
/** `<provider>:<model>` for a role: the label recorded in StepRecord.model. */
export function laneIdFor(env: ModelEnv, role: ModelRole, override?: string): string {
  return laneId(resolveLane(env, role, override));
}

/** OpenAI SDK pointed at the lane's provider (default: the reason lane). */
export function makeClient(env: ModelEnv, fetchImpl?: typeof fetch, timeoutMs?: number, lane: Lane = resolveLane(env, 'reason')): OpenAI {
  return new OpenAI({
    apiKey: laneApiKey(env, lane),
    baseURL: laneBaseURL(env, lane),
    // Every request goes through the kill switch and the daily spend cap (see budget.ts).
    fetch: budgetedFetch(env as never, fetchImpl ?? ((i: RequestInfo | URL, init?: RequestInit) => fetch(i, init))),
    maxRetries: timeoutMs ? 1 : 2,
    timeout: timeoutMs ?? 120_000,
  });
}

/** Client for a call: provider chosen from the call's role (or explicit model override). */
export const client = (o: Pick<CallOptions, 'env' | 'fetch' | 'timeoutMs' | 'role' | 'model'>) =>
  makeClient(o.env, o.fetch, o.timeoutMs, resolveLane(o.env, o.role ?? 'reason', o.model));
