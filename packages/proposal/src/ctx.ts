import type { z } from 'zod';
import type { Env } from '@pactovio/contracts/env';
import { chatJSON, type ChatMessage, type ModelRole, type StepRecord } from '@pactovio/models';
import type { BrainData } from './brain';
import type { CatalogueItem } from './catalogue';
import type { RfqRead, StepName } from './schema';

export interface RfqFile { filename: string; mime: string; bytes: Uint8Array }
export interface RunState {
  rfq?: RfqRead;
  selection?: import('./select').Selection;
  bom?: import('./bom').BomResult;
  design?: import('./design').DesignResult;
  floorplan?: import('./floorplan').FloorplanResult | { skipped: string };
  compliance?: import('./compliance').ComplianceRow[];
  visual?: { image_key: string; prompt: string } | { skipped: string };
  claims?: import('./claims').ClaimReport;
  /** Which model drove each step (orchestrator or direct), for the UI. */
  models: Record<string, string[]>;
}

export interface StepAcc { models: Set<string>; tokensIn: number; tokensOut: number; costUsd: number; ms: number }
export interface StepRow { name: StepName | 'orchestrate'; status: 'running' | 'ok' | 'error' | 'skipped'; models: string[]; tokensIn: number; tokensOut: number; costUsd: number; ms: number; summary?: string }

export interface RunCtx {
  env: Env;
  workspaceId: string;
  proposalId: string;
  files: RfqFile[];
  catalogue: CatalogueItem[];
  brain: BrainData;
  state: RunState;
  /** Persist state and step rows. Injected by the store so tests can run in memory. */
  persist: { state(s: RunState): Promise<void>; step(r: StepRow): Promise<void> };
  /** R2 write for generated images and original drawings. */
  fetchImpl?: typeof fetch;
  acc?: StepAcc;
}

/** Fold a model call (Spark, SAM, Image...) into the step currently running. */
export function addUsage(ctx: RunCtx, u: { model: string; tokensIn?: number; tokensOut?: number; costUsd: number; ms: number }): void {
  const a = ctx.acc;
  if (!a) return;
  a.models.add(u.model); a.tokensIn += u.tokensIn ?? 0; a.tokensOut += u.tokensOut ?? 0; a.costUsd += u.costUsd; a.ms += u.ms;
}
export const onModelStep = (ctx: RunCtx) => (s: StepRecord): void => addUsage(ctx, { model: s.model, tokensIn: s.tokensIn, tokensOut: s.tokensOut, costUsd: s.costUsd, ms: s.ms });

/** Structured Spark call inside a step; usage is attributed to the running step. */
export async function ask<S extends z.ZodType>(ctx: RunCtx, schema: S, o: { purpose: string; role?: ModelRole; messages: ChatMessage[]; maxTokens: number; name?: string; timeoutMs?: number }): Promise<z.output<S>> {
  const { data } = await chatJSON(schema, {
    env: ctx.env, role: o.role ?? 'reason', purpose: o.purpose, messages: o.messages, maxTokens: o.maxTokens,
    schemaName: o.name, onStep: onModelStep(ctx), fetch: ctx.fetchImpl, timeoutMs: o.timeoutMs ?? 110_000,
  });
  return data;
}

/** Run one pipeline step: skips when `done()` already holds (resume / orchestrator re-call), records timing, models and cost. */
export async function runStep(ctx: RunCtx, name: StepName, done: () => boolean, fn: () => Promise<string>): Promise<string> {
  if (done()) return 'already done';
  const acc: StepAcc = { models: new Set(), tokensIn: 0, tokensOut: 0, costUsd: 0, ms: 0 };
  const t0 = Date.now();
  const row = (status: StepRow['status'], summary?: string): StepRow => ({ name, status, models: [...acc.models], tokensIn: acc.tokensIn, tokensOut: acc.tokensOut, costUsd: Number(acc.costUsd.toFixed(6)), ms: Date.now() - t0, summary });
  await ctx.persist.step(row('running'));
  ctx.acc = acc;
  try {
    const summary = await fn();
    ctx.state.models[name] = [...acc.models];
    ctx.acc = undefined;
    await ctx.persist.state(ctx.state);
    await ctx.persist.step(row('ok', summary));
    return summary;
  } catch (e) {
    ctx.acc = undefined;
    const msg = e instanceof Error ? e.message.slice(0, 240) : 'step failed';
    await ctx.persist.step(row('error', msg));
    throw e;
  }
}
