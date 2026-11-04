import type { Env } from '@pactovio/contracts/env';
import { isBudgetError, budgetMessage } from '@pactovio/models';
import { assemble } from './assemble';
import { getBrain } from './brain';
import { loadCatalogue } from './catalogue';
import type { RfqFile, RunCtx, RunState } from './ctx';
import { orchestrate } from './orchestrate';
import { getProposalRow, loadProposalJson, persistence } from './store';

export interface RunParams { proposalId: string; workspaceId: string; forceSpark?: boolean }

async function loadFiles(env: Env, workspaceId: string, row: Awaited<ReturnType<typeof getProposalRow>>): Promise<RfqFile[]> {
  const files: RfqFile[] = [];
  for (const f of row.input.files) {
    if (!f.key.startsWith(`proposals/${workspaceId}/`) && !f.key.startsWith(`intake/`) && !f.key.startsWith(`${workspaceId}/`)) continue; // never read another tenant's object
    const o = await env.FILES.get(f.key);
    if (o) files.push({ filename: f.filename, mime: f.mime, bytes: new Uint8Array(await o.arrayBuffer()) });
  }
  if (row.input.text?.trim()) files.push({ filename: 'rfq-text.txt', mime: 'text/plain', bytes: new TextEncoder().encode(row.input.text) });
  return files;
}

/**
 * Run (or resume) a proposal. State is persisted after every stage, so a retried Workflow step skips finished stages.
 * Failure leaves the row `failed` with a client-safe message; partial state stays for inspection.
 */
export async function runProposal(env: Env, p: RunParams, hooks: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  const db = env.DB;
  const row = await getProposalRow(env, p.workspaceId, p.proposalId);
  await db.prepare("UPDATE proposals SET status = 'running', error = NULL, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), p.proposalId).run();
  try {
    const saved = (await loadProposalJson(env, p.workspaceId, p.proposalId)).state;
    const ctx: RunCtx = {
      env, workspaceId: p.workspaceId, proposalId: p.proposalId, files: await loadFiles(env, p.workspaceId, row),
      catalogue: await loadCatalogue(env, p.workspaceId), brain: await getBrain(env, p.workspaceId),
      state: saved ?? ({ models: {} } as RunState), persist: persistence(env, p.workspaceId, p.proposalId), fetchImpl: hooks.fetchImpl,
    };
    ctx.state.models ??= {};
    const o = await orchestrate(ctx, { forceSpark: p.forceSpark });
    const proposal = assemble(ctx);
    const cost = (await db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM proposal_steps WHERE proposal_id = ? AND name != ?').bind(p.proposalId, 'orchestrate').first<{ c: number }>())?.c ?? 0;
    await db.prepare("UPDATE proposals SET status = 'completed', title = ?, proposal_json = ?, orchestrator = ?, cost_usd = ?, updated_at = ? WHERE id = ?")
      .bind(proposal.title, JSON.stringify(proposal), o.orchestrator, cost + o.row.costUsd, new Date().toISOString(), p.proposalId).run();
  } catch (e) {
    const msg = isBudgetError(e) ? budgetMessage(e) : e instanceof Error && /_API_KEY/.test(e.message) ? 'Model access is not configured' : 'The proposal run failed; try again';
    await db.prepare("UPDATE proposals SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(msg, new Date().toISOString(), p.proposalId).run();
    if (!isBudgetError(e)) throw e;
  }
}
