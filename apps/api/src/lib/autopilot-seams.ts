import type { Env } from '@pactovio/contracts/env';

/**
 * Seams to the other Meta-hackathon workers. They are typed here so autopilot, tender fit and prospects build and test
 * without B1/B2 merged. The coordinator wires the real implementations after merge (see the two `register*` functions).
 */

export interface ProposalRunInput {
  intakeId: string;
  /** Attachments already stored in R2 by the intake pipeline. */
  files: { filename: string; mimetype: string; r2Key: string }[];
  /** Email subject + body (the RFQ text). */
  text: string;
}
export type ProposalRunStatus = 'queued' | 'running' | 'ready' | 'failed';
export interface ProposalRunHandle { runId: string; proposalId?: string | null; status?: ProposalRunStatus }

/** B2: packages/proposal startProposalRun. */
export type StartProposalRun = (env: Env, workspaceId: string, input: ProposalRunInput) => Promise<ProposalRunHandle>;
/** Optional B2 status reader, used to refresh Inbox rows that are still queued or running. */
export type ProposalRunReader = (env: Env, workspaceId: string, runId: string) => Promise<{ status: ProposalRunStatus; proposalId?: string | null }>;

let starter: StartProposalRun | null = null;
let reader: ProposalRunReader | null = null;
export const registerProposalRunner = (start: StartProposalRun, read?: ProposalRunReader) => { starter = start; reader = read ?? null; };
export const NOT_CONFIGURED = 'proposal_engine_not_configured';

/** Resolves to the registered B2 engine, else throws NOT_CONFIGURED (recorded honestly as `not_configured`, never faked). */
export async function startProposalRun(env: Env, workspaceId: string, input: ProposalRunInput): Promise<ProposalRunHandle> {
  if (!starter) throw new Error(NOT_CONFIGURED);
  return starter(env, workspaceId, input);
}
export async function readProposalRun(env: Env, workspaceId: string, runId: string) {
  return reader ? reader(env, workspaceId, runId) : null;
}

/** B1: Company Brain summary. Only the fields tender fit needs. */
export interface BrainSummary {
  proposals_learned: number;
  top_products: { sku: string; name?: string; count: number }[];
  by_solution_type?: Record<string, unknown>;
  by_sector: { sector: string; count: number }[];
  /** Past proposal refs the model may cite as evidence. */
  past_proposals: { ref: string; client?: string; solution_type?: string }[];
  win_rate?: number | null;
}
export type GetBrain = (env: Env, workspaceId: string) => Promise<BrainSummary | null>;
let brainReader: GetBrain | null = null;
export const registerBrainReader = (fn: GetBrain) => { brainReader = fn; };
/** Null until B1 is wired: fit then uses the workspace profile and real catalogue only. */
export async function getBrain(env: Env, workspaceId: string): Promise<BrainSummary | null> {
  if (!brainReader) return null;
  try { return await brainReader(env, workspaceId); } catch { return null; }
}
