import { modelsDisabled, OFF_MESSAGE, LIMIT_MESSAGE, reserve, settle } from './budget';

/** Env slice the Meta media clients need. Same names as the Worker env. */
export interface MetaEnv {
  META_API_KEY?: string;
  DB?: D1Database;
  CACHE?: KVNamespace;
  ENVIRONMENT?: string;
  MODELS_DISABLED?: string;
  MODEL_DAILY_CAP_USD?: string;
}
export const META_BASE = 'https://api.meta.ai/v1';

/** Error shaped like the budget refusal so `isBudgetError` / `budgetMessage` recognise it. */
function budgetError(message: string, code: 'models_off' | 'cap_daily'): Error {
  return Object.assign(new Error(message), { status: 402, code });
}

export class MetaApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Run a per-unit-priced call (image, segmentation, audio) under the same kill switch and daily cap as token calls:
 * reserve the cost first, refund it if the call fails. `usd` is the list price of the call.
 */
export async function metered<T>(env: MetaEnv, usd: number, fn: () => Promise<T>): Promise<T> {
  if (await modelsDisabled(env)) throw budgetError(OFF_MESSAGE, 'models_off');
  if (!(await reserve(env, usd))) throw budgetError(LIMIT_MESSAGE, 'cap_daily');
  try { return await fn(); } catch (e) { await settle(env, -usd); throw e; }
}

export interface MetaRequest { path: string; init: RequestInit; fetchImpl?: typeof fetch }

/** Authenticated request to the Meta Model API. Non-2xx becomes MetaApiError with a trimmed message. */
export async function metaFetch(env: MetaEnv, r: MetaRequest): Promise<Response> {
  if (!env.META_API_KEY) throw new Error('META_API_KEY is not configured');
  const headers = new Headers(r.init.headers);
  headers.set('authorization', `Bearer ${env.META_API_KEY}`);
  const res = await (r.fetchImpl ?? fetch)(`${META_BASE}${r.path}`, { ...r.init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text) as { error?: { message?: string } }; msg = j.error?.message ?? msg; } catch { /* keep raw */ }
    throw new MetaApiError(res.status, `Meta API ${res.status}: ${msg}`);
  }
  return res;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
