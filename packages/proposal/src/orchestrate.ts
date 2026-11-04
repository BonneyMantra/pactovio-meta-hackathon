import { z } from 'zod';
import { wonderLoop, type LoopTool, type StepRecord } from '@pactovio/models';
import { claimCheckStep } from './claims';
import { buildCompliance } from './compliance';
import type { RunCtx, StepRow } from './ctx';
import { composeBom } from './bom';
import { designArchitecture } from './design';
import { planFloor } from './floorplan';
import { readRfq } from './read';
import { selectSolution } from './select';
import { makeVisual } from './visual';
import type { StepName } from './schema';

type StepFn = (ctx: RunCtx) => Promise<string>;
/** Pipeline order, dependencies and whether a failure may be tolerated (decorative or optional-input steps). */
export const PIPELINE: { name: StepName; run: StepFn; optional: boolean; tool: string; about: string }[] = [
  { name: 'read_rfq', run: readRfq, optional: false, tool: 'read_rfq', about: 'Read the RFQ documents (PDF native) into a requirements list with page citations' },
  { name: 'select_solution', run: selectSolution, optional: false, tool: 'select_solution', about: 'Match requirements to the catalogue and to similar past proposals (needs read_rfq)' },
  { name: 'compose_bom', run: composeBom, optional: false, tool: 'compose_bom', about: 'Compose the BoM, custom engineering and totals in the company style (needs select_solution)' },
  { name: 'design_architecture', run: designArchitecture, optional: false, tool: 'design_architecture', about: 'Architecture graph and per-site zone/wiring map (needs compose_bom)' },
  { name: 'floor_plan', run: planFloor, optional: true, tool: 'place_on_floor_plan', about: 'SAM 3.1 finds objects on the floor-plan drawing; devices are placed relative to them (needs compose_bom)' },
  { name: 'compliance_matrix', run: buildCompliance, optional: false, tool: 'compliance_matrix', about: 'Complies/partial/deviation per requirement with page refs (needs compose_bom)' },
  { name: 'concept_visual', run: makeVisual, optional: true, tool: 'concept_visual', about: 'Muse Image concept visual (needs compose_bom)' },
  { name: 'claim_check', run: claimCheckStep, optional: false, tool: 'claim_check', about: 'Check every claim against evidence; strike unsupported sentences (run last, needs compliance_matrix)' },
];

const SYSTEM = `You are the bid-desk orchestrator for a B2B supplier. Produce a proposal from an RFQ by calling the tools below. Each tool performs one stage on the shared run and returns a one-line result. Order: read_rfq first, then select_solution, compose_bom; after compose_bom the stages design_architecture, place_on_floor_plan, compliance_matrix and concept_visual may be called in any order; claim_check last. Call one tool per turn. If a tool returns an error, continue with the others. When claim_check has returned, reply with the single word DONE.`;

export interface OrchestrationResult { orchestrator: string; wonderFailed: boolean; row: StepRow }

/**
 * Muse Wonder drives the stages as tools (Spark takes over if Wonder errors). Whatever the agent did not complete
 * is then run in canonical order, so a run always finishes; each stage is idempotent and records its own model and cost.
 */
export async function orchestrate(ctx: RunCtx, o: { forceSpark?: boolean } = {}): Promise<OrchestrationResult> {
  const t0 = Date.now();
  const usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, models: new Set<string>() };
  const onStep = (s: StepRecord) => { usage.tokensIn += s.tokensIn; usage.tokensOut += s.tokensOut; usage.costUsd += s.costUsd; usage.models.add(s.model); };
  const tools: LoopTool[] = PIPELINE.map((s) => ({
    name: s.tool, description: s.about, input: z.object({}),
    run: async () => {
      try { return { ok: true, result: await s.run(ctx) }; } catch (e) {
        const error = e instanceof Error ? e.message.slice(0, 160) : 'failed';
        if (s.name === 'floor_plan') ctx.state.floorplan = { skipped: error }; // optional: never retried by the sweep (SAM is billed per call)
        return { ok: false, error };
      }
    },
  }));
  let orchestrator = 'none'; let wonderFailed = false;
  try {
    const r = await wonderLoop({ env: ctx.env, purpose: 'Orchestrate proposal run', system: SYSTEM, task: 'Run the proposal pipeline for the RFQ documents already loaded.', tools, onStep, fetch: ctx.fetchImpl, forceSpark: o.forceSpark, maxSteps: 16 });
    orchestrator = r.orchestrator; wonderFailed = r.wonderFailed;
  } catch (e) {
    if ((e as { status?: number }).status === 402) throw e;
    orchestrator = 'code';
  }
  // Fallback sweep: finish whatever the agent skipped or that failed inside its tool call.
  for (const s of PIPELINE) {
    try { await s.run(ctx); } catch (e) {
      if (!s.optional) throw e;
      if (s.name === 'floor_plan') ctx.state.floorplan = { skipped: e instanceof Error ? e.message.slice(0, 160) : 'failed' };
    }
  }
  ctx.state.models.orchestrate = [orchestrator];
  const row: StepRow = { name: 'orchestrate', status: 'ok', models: [...usage.models], tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: Number(usage.costUsd.toFixed(6)), ms: Date.now() - t0, summary: `Orchestrated by ${orchestrator}${wonderFailed ? ' (Wonder unavailable, Spark fallback)' : ''}` };
  await ctx.persist.step(row);
  return { orchestrator, wonderFailed, row };
}
