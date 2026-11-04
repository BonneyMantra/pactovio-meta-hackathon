import type { Env } from '@pactovio/contracts/env';

/** A durable step. The Workflow passes `step.do`; tests and replays pass `(n, fn) => fn()`. Results must be small JSON. */
export type Stepper = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export interface RunCtx {
  env: Env;
  runId: string;
  workspaceId: string;
  tenderId: string;
  /** Test seam: replaces the HTTP client for every model call and web search. */
  fetch?: typeof fetch;
}

export const inlineStep: Stepper = (_name, fn) => fn();

/** Drafts per lot written during a run. More are written on demand through POST /answers/draft. */
export const MAX_DRAFTS_PER_LOT = 5;
