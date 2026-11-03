/** Worker environment. Import from '@pactovio/contracts/env' (types only, needs @cloudflare/workers-types). */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  CACHE: KVNamespace;
  PACK_RUN: Workflow;
  SCAN: Workflow;
  INTAKE: Workflow;
  AGENT: DurableObjectNamespace;
  EVENTS: Queue<unknown>;

  // Vars (wrangler.toml [vars])
  ENVIRONMENT?: string;
  MODEL_REASON?: string;
  MODEL_AGENT?: string;
  MODEL_FAST?: string;
  /** Lane overrides: "<provider>:<model>[@reasoning_effort]". Providers: meta (default), fireworks, baseten, modal. */
  LANE_REASON?: string;
  LANE_AGENT?: string;
  LANE_FAST?: string;
  LANE_VISION?: string;
  /** Per-deployment OpenAI-compatible base URLs for Baseten and Modal lanes. */
  BASETEN_BASE_URL?: string;
  MODAL_BASE_URL?: string;
  /** Public origin used to build approve/decline and OAuth callback links outside a request (queue consumer). */
  PUBLIC_ORIGIN?: string;
  DODO_BRAND_ID?: string;
  DODO_API_BASE?: string;

  // Secrets (wrangler secret put / .dev.vars)
  AUTH_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  META_API_KEY?: string;
  FIREWORKS_API_KEY?: string;
  BASETEN_API_KEY?: string;
  MODAL_API_KEY?: string;
  TAVILY_API_KEY?: string;
  COMPOSIO_API_KEY?: string;
  /** Set true only after configuring the project callback verifier URL. */
  COMPOSIO_CALLBACK_VERIFIER_ENABLED?: string;
  /** Signing secret of the Composio project webhook subscription (verifies /webhooks/composio). */
  COMPOSIO_WEBHOOK_SECRET?: string;
  DODO_PAYMENTS_API_KEY?: string;
  DODO_WEBHOOK_SECRET?: string;
  WEBHOOK_SIGNING_SECRET?: string;
}

export type ModelEnv = Pick<Env,
  | 'MODEL_REASON' | 'MODEL_AGENT' | 'MODEL_FAST'
  | 'LANE_REASON' | 'LANE_AGENT' | 'LANE_FAST' | 'LANE_VISION'
  | 'META_API_KEY' | 'FIREWORKS_API_KEY' | 'BASETEN_API_KEY' | 'MODAL_API_KEY'
  | 'BASETEN_BASE_URL' | 'MODAL_BASE_URL'>;
