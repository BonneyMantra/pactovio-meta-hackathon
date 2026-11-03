import { z } from 'zod';
import type { ModelEnv } from '@pactovio/contracts/env';
import type { ModelRole } from './types';

/**
 * Provider registry. Every provider is OpenAI-compatible, so switching a role to another provider is a config change
 * (LANE_<ROLE>=<provider>:<model>[@effort]), never a code change.
 */
export type ProviderId = 'meta' | 'fireworks' | 'baseten' | 'modal';
export interface Provider {
  /** Fixed base URL, or null when it is per-deployment and read from `baseURLEnv`. */
  baseURL: string | null;
  baseURLEnv?: string;
  /** Name of the Worker secret/env var holding the API key. */
  apiKeyEnvName: string;
  /** True when the provider accepts the `reasoning_effort` request field. */
  reasoningEffort: boolean;
  label: string;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  meta: { baseURL: 'https://api.meta.ai/v1', apiKeyEnvName: 'META_API_KEY', reasoningEffort: true, label: 'Meta' },
  fireworks: { baseURL: 'https://api.fireworks.ai/inference/v1', apiKeyEnvName: 'FIREWORKS_API_KEY', reasoningEffort: false, label: 'Fireworks' },
  baseten: { baseURL: null, baseURLEnv: 'BASETEN_BASE_URL', apiKeyEnvName: 'BASETEN_API_KEY', reasoningEffort: false, label: 'Baseten' },
  modal: { baseURL: null, baseURLEnv: 'MODAL_BASE_URL', apiKeyEnvName: 'MODAL_API_KEY', reasoningEffort: false, label: 'Modal' },
};
export const DEFAULT_PROVIDER: ProviderId = 'meta';

export const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface Lane { provider: ProviderId; model: string; effort?: Effort }

/** Meta trains on prompts sent to `*-contributor` models. Pactovio handles customers' commercial documents: never allowed. */
const LaneString = z.string().trim().min(1).max(200)
  .refine((s) => !/contributor/i.test(s), 'Contributor-mode models are not allowed: Meta may train on those prompts');

export const DEFAULT_LANES: Record<ModelRole, Lane> = {
  reason: { provider: 'meta', model: 'muse-spark-1.3', effort: 'high' },
  agent: { provider: 'meta', model: 'muse-spark-1.3', effort: 'medium' },
  fast: { provider: 'meta', model: 'muse-spark-1.3', effort: 'minimal' },
  vision: { provider: 'meta', model: 'muse-spark-1.3', effort: 'medium' },
};

const isProvider = (s: string): s is ProviderId => Object.prototype.hasOwnProperty.call(PROVIDERS, s);
const isEffort = (s: string): s is Effort => (EFFORTS as readonly string[]).includes(s);

/** Parse `<provider>:<model>[@effort]`. A bare model id (no known provider prefix) belongs to `fallbackProvider`. */
export function parseLane(input: string, fallbackProvider: ProviderId = DEFAULT_PROVIDER): Lane {
  const s = LaneString.parse(input);
  const at = s.lastIndexOf('@');
  let effort: Effort | undefined;
  let rest = s;
  if (at > 0) {
    const e = s.slice(at + 1).toLowerCase();
    if (!isEffort(e)) throw new Error(`Unknown reasoning effort "${s.slice(at + 1)}" (use ${EFFORTS.join(', ')})`);
    effort = e;
    rest = s.slice(0, at);
  }
  const colon = rest.indexOf(':');
  const head = colon > 0 ? rest.slice(0, colon).toLowerCase() : '';
  const provider = isProvider(head) ? head : fallbackProvider;
  const model = isProvider(head) ? rest.slice(colon + 1) : rest;
  if (!model) throw new Error(`Lane "${input}" has no model id`);
  return { provider, model, ...(effort ? { effort } : {}) };
}

const ENV_KEYS: Record<ModelRole, { lane: string; legacy: string | null }> = {
  reason: { lane: 'LANE_REASON', legacy: 'MODEL_REASON' },
  agent: { lane: 'LANE_AGENT', legacy: 'MODEL_AGENT' },
  fast: { lane: 'LANE_FAST', legacy: 'MODEL_FAST' },
  vision: { lane: 'LANE_VISION', legacy: null },
};
const read = (env: ModelEnv, k: string): string | undefined => (env as Record<string, string | undefined>)[k] || undefined;

/**
 * Resolve the lane for a role. Precedence: explicit override, LANE_<ROLE>, legacy MODEL_<ROLE>, default.
 * A legacy/override value without an effort inherits the role's default effort (Meta only).
 */
export function resolveLane(env: ModelEnv, role: ModelRole, override?: string): Lane {
  const def = DEFAULT_LANES[role];
  const k = ENV_KEYS[role];
  const raw = override || read(env, k.lane) || (k.legacy ? read(env, k.legacy) : undefined);
  const lane = raw ? parseLane(raw, def.provider) : def;
  const effort = lane.effort ?? (PROVIDERS[lane.provider].reasoningEffort ? def.effort : undefined);
  return { provider: lane.provider, model: lane.model, ...(effort ? { effort } : {}) };
}

/** `<provider>:<model>`: what StepRecord.model carries, so the UI can show "Muse Spark 1.3 · Meta". */
export const laneId = (l: Lane): string => `${l.provider}:${l.model}`;
/** Full lane string including effort; parseLane(formatLane(l)) round-trips. */
export const formatLane = (l: Lane): string => `${laneId(l)}${l.effort ? `@${l.effort}` : ''}`;

export function laneBaseURL(env: ModelEnv, l: Lane): string {
  const p = PROVIDERS[l.provider];
  const url = (p.baseURLEnv && read(env, p.baseURLEnv)) || p.baseURL;
  if (!url) throw new Error(`${p.baseURLEnv} is not configured for provider ${l.provider}`);
  return url;
}

export function laneApiKey(env: ModelEnv, l: Lane): string {
  const name = PROVIDERS[l.provider].apiKeyEnvName;
  const key = read(env, name);
  if (!key) throw new Error(`${name} is not configured`);
  return key;
}

/** True when the key (and base URL) for a role's provider are present. Cheap pre-check for "AI unavailable" states. */
export function laneConfigured(env: ModelEnv, role: ModelRole): boolean {
  try { const l = resolveLane(env, role); laneApiKey(env, l); laneBaseURL(env, l); return true; } catch { return false; }
}

/** Meta counts reasoning tokens inside max_tokens, so a small cap can leave content null. Headroom added per effort. */
const HEADROOM: Record<Effort, number> = { minimal: 400, low: 1200, medium: 3000, high: 8000, xhigh: 16000, max: 24000 };
export function withReasoningHeadroom(l: Lane, maxTokens: number | undefined): number | undefined {
  if (!maxTokens || !PROVIDERS[l.provider].reasoningEffort || !l.effort) return maxTokens;
  return maxTokens + HEADROOM[l.effort];
}

/** Provider-specific request fields: Meta lanes carry `reasoning_effort`; swap-ready lanes send none. */
export function laneParams(l: Lane): Record<string, unknown> {
  if (PROVIDERS[l.provider].reasoningEffort) return l.effort ? { reasoning_effort: l.effort } : {};
  return {};
}

/** Drop vendor-specific request fields that are not portable across OpenAI-compatible providers. */
export function portableExtra(_l: Lane, extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {};
  const { chat_template_kwargs: _drop, service_tier: _tier, ...rest } = extra;
  return rest;
}
