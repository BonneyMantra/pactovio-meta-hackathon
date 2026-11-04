import { newId, HttpError } from '@pactovio/contracts';
import type { Env } from '@pactovio/contracts/env';
import type { RunState, StepRow } from './ctx';
import type { Proposal } from './schema';

export interface InputFile { key: string; filename: string; mime: string; size: number }
export interface ProposalInput { files: InputFile[]; text?: string; intake_id?: string }
export interface ProposalRow {
  id: string; workspace_id: string; title: string | null; status: 'queued' | 'running' | 'completed' | 'failed'; source: string; intake_id: string | null;
  input: ProposalInput; orchestrator: string | null; error: string | null; cost_usd: number; created_at: string; updated_at: string;
}
export interface StepView { name: string; status: string; models: string[]; tokens_in: number; tokens_out: number; cost_usd: number; ms: number; summary: string | null; started_at: string; finished_at: string | null }

const now = () => new Date().toISOString();
const SELECT = 'SELECT id, workspace_id, title, status, source, intake_id, input_json, orchestrator, error, cost_usd, created_at, updated_at FROM proposals';
type Raw = Omit<ProposalRow, 'input'> & { input_json: string };
const shape = (r: Raw): ProposalRow => { const { input_json, ...rest } = r; return { ...rest, input: JSON.parse(input_json) as ProposalInput }; };

export async function createProposal(env: Pick<Env, 'DB'>, workspaceId: string, o: { id?: string; source: string; input: ProposalInput; title?: string }): Promise<string> {
  const id = o.id ?? newId('quote').replace(/^quo_/, 'prp_');
  const t = now();
  await env.DB.prepare('INSERT INTO proposals (id, workspace_id, title, status, source, intake_id, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, workspaceId, o.title ?? null, 'queued', o.source, o.input.intake_id ?? null, JSON.stringify(o.input), t, t).run();
  return id;
}

/** Workspace-scoped lookup: another tenant's id is a 404, never a 403. */
export async function getProposalRow(env: Pick<Env, 'DB'>, workspaceId: string, id: string): Promise<ProposalRow> {
  const r = await env.DB.prepare(`${SELECT} WHERE id = ? AND workspace_id = ?`).bind(id, workspaceId).first<Raw>();
  if (!r) throw new HttpError(404, 'Proposal not found', 'not_found');
  return shape(r);
}
export async function listProposalRows(env: Pick<Env, 'DB'>, workspaceId: string, limit = 50): Promise<ProposalRow[]> {
  const rs = await env.DB.prepare(`${SELECT} WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`).bind(workspaceId, limit).all<Raw>();
  return rs.results.map(shape);
}

export async function loadProposalJson(env: Pick<Env, 'DB'>, workspaceId: string, id: string): Promise<{ proposal: Proposal | null; state: RunState | null }> {
  const r = await env.DB.prepare('SELECT proposal_json, state_json FROM proposals WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).first<{ proposal_json: string | null; state_json: string }>();
  if (!r) throw new HttpError(404, 'Proposal not found', 'not_found');
  return { proposal: r.proposal_json ? JSON.parse(r.proposal_json) as Proposal : null, state: r.state_json && r.state_json !== '{}' ? JSON.parse(r.state_json) as RunState : null };
}

export async function listSteps(env: Pick<Env, 'DB'>, workspaceId: string, id: string): Promise<StepView[]> {
  const rs = await env.DB.prepare('SELECT name, status, models_json, tokens_in, tokens_out, cost_usd, ms, summary, started_at, finished_at FROM proposal_steps WHERE proposal_id = ? AND workspace_id = ? ORDER BY started_at, rowid').bind(id, workspaceId).all<{ models_json: string } & Omit<StepView, 'models'>>();
  return rs.results.map(({ models_json, ...r }) => ({ ...r, models: JSON.parse(models_json) as string[] }));
}

/** Persistence callbacks the pipeline uses: state JSON on the proposal row and one upserted row per step (the UI polls these). */
export function persistence(env: Pick<Env, 'DB'>, workspaceId: string, proposalId: string) {
  return {
    async state(s: RunState): Promise<void> {
      await env.DB.prepare('UPDATE proposals SET state_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').bind(JSON.stringify(s), now(), proposalId, workspaceId).run();
    },
    async step(r: StepRow): Promise<void> {
      const t = now(); const done = r.status !== 'running';
      await env.DB.prepare(`INSERT INTO proposal_steps (id, proposal_id, workspace_id, name, status, models_json, tokens_in, tokens_out, cost_usd, ms, summary, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(proposal_id, name) DO UPDATE SET status = excluded.status, models_json = excluded.models_json, tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out,
          cost_usd = excluded.cost_usd, ms = excluded.ms, summary = excluded.summary, finished_at = excluded.finished_at`)
        .bind(`stp_${proposalId.slice(-8)}_${r.name}`, proposalId, workspaceId, r.name, r.status, JSON.stringify(r.models), r.tokensIn, r.tokensOut, r.costUsd, r.ms, r.summary ?? null, t, done ? t : null).run();
    },
  };
}
