import type { Env } from '@pactovio/contracts/env';
import { getProposalRow, startProposal } from '@pactovio/proposal';
import { loadBrain, proposalIndex } from './brain-store';
import type { BrainSummary, ProposalRunInput, ProposalRunStatus } from './autopilot-seams';

const MAX_PAST = 60;

/** Workflow A's bid engine: copy the emailed attachments out of R2 and start the same ProposalRunWorkflow chat uploads use. */
export async function realStartProposalRun(env: Env, workspaceId: string, input: ProposalRunInput) {
  const files: { filename: string; mime: string; bytes: Uint8Array }[] = [];
  for (const f of input.files) {
    const o = await env.FILES.get(f.r2Key);
    if (o) files.push({ filename: f.filename, mime: f.mimetype, bytes: new Uint8Array(await o.arrayBuffer()) });
  }
  const r = await startProposal(env, workspaceId, { source: 'autopilot', files, text: input.text, intakeId: input.intakeId, title: input.title });
  return { runId: r.proposalId, proposalId: r.proposalId, status: 'queued' as const };
}

const STATUS: Record<string, ProposalRunStatus> = { queued: 'queued', running: 'running', completed: 'ready', failed: 'failed' };

/** The proposal id doubles as the run id: its row status is the run status. */
export async function realReadProposalRun(env: Env, workspaceId: string, runId: string) {
  const row = await getProposalRow(env, workspaceId, runId);
  return { status: STATUS[row.status] ?? 'running', proposalId: row.id };
}

/** Company Brain summary from the onboarding pane's tables (company_brain + learned brain_documents joined with CRM outcomes). */
export async function realGetBrain(env: Env, workspaceId: string): Promise<BrainSummary | null> {
  const [brain, index] = await Promise.all([loadBrain(env.DB, workspaceId), proposalIndex(env.DB, workspaceId)]);
  if (!brain.proposals_learned && !index.length) return null;
  const stats = brain.stats;
  return {
    proposals_learned: brain.proposals_learned || index.length,
    top_products: (stats?.top_products ?? []).map((p) => ({ sku: p.sku, name: p.description, count: p.proposals })),
    by_solution_type: stats?.by_solution_type,
    by_sector: (stats?.by_sector ?? []).map((s) => ({ sector: s.sector, count: s.count })),
    past_proposals: index.slice(0, MAX_PAST).map((p) => ({ ref: p.ref, client: p.client, solution_type: p.solution_type })),
    win_rate: stats?.win_rate ?? null,
  };
}
