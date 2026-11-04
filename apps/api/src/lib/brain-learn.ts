import { HttpError } from '@pactovio/contracts';
import { runAction } from '@pactovio/connectors';
import { computeStats, deriveStyle, extractProposal, type Extraction } from '@pactovio/brain';
import type { StepLogger } from '@pactovio/models';
import { randomToken } from './db';
import { syncOutcomes } from './brain-outcomes';
import { addEvent, learnedDocs, saveBrain, type BrainEnv } from './brain-store';

export const MAX_FILES = 60;
export interface LearnParams { runId: string; workspaceId: string; folderId: string }
export interface DocRef { docId: string; driveFileId: string; name: string }
type Out = { ok: boolean; output?: unknown };
const details = <T>(r: Out): T => ((r.output as { details?: T }).details ?? {}) as T;
const fail = (r: Out, what: string): never => {
  const o = r.output as { code?: string };
  throw new HttpError(o?.code === 'not_connected' ? 409 : 502, o?.code === 'not_connected' ? 'Connect Google Drive first.' : `${what} failed. Try again shortly.`, o?.code === 'not_connected' ? 'not_connected' : 'provider_error');
};

export async function listFolders(env: BrainEnv, ws: string, name?: string) {
  const r = await runAction(env, ws, 'googledrive', 'list_folders', name ? { name } : {});
  if (!r.ok) fail(r, 'Listing Drive folders');
  return details<{ folders: { id: string; name: string; modified: string | null }[] }>(r).folders ?? [];
}

export async function startLearn(env: BrainEnv, ws: string, folderId: string, folderName?: string): Promise<{ run_id: string }> {
  if (!env.BRAIN) throw new HttpError(503, 'Learning is not available yet.', 'not_configured');
  const busy = await env.DB.prepare("SELECT id FROM brain_learn_runs WHERE workspace_id = ? AND status = 'running' AND started_at > ?")
    .bind(ws, new Date(Date.now() - 30 * 60_000).toISOString()).first<{ id: string }>();
  if (busy) throw new HttpError(409, 'The agent is already learning from a folder.', 'already_running');
  const runId = `brn_${randomToken(10)}`;
  await env.DB.prepare('INSERT INTO brain_learn_runs (id, workspace_id, folder_id, folder_name, started_at) VALUES (?, ?, ?, ?, ?)').bind(runId, ws, folderId, folderName ?? null, new Date().toISOString()).run();
  await env.BRAIN.create({ id: runId, params: { runId, workspaceId: ws, folderId } satisfies LearnParams });
  return { run_id: runId };
}

/** Step 1: list the folder's PDFs, register one document row each, announce the total. */
export async function listStep(env: BrainEnv, p: LearnParams): Promise<DocRef[]> {
  const r = await runAction(env, p.workspaceId, 'googledrive', 'list_files', { folder_id: p.folderId });
  if (!r.ok) fail(r, 'Listing the folder');
  const files = (details<{ files: { id: string; name: string }[] }>(r).files ?? []).slice(0, MAX_FILES);
  const at = new Date().toISOString();
  const docs: DocRef[] = files.map((f) => ({ docId: `bdoc_${randomToken(8)}`, driveFileId: f.id, name: f.name }));
  for (let i = 0; i < docs.length; i += 40) {
    await env.DB.batch(docs.slice(i, i + 40).map((d) => env.DB.prepare(`INSERT INTO brain_documents (id, workspace_id, run_id, drive_file_id, filename, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, drive_file_id) DO UPDATE SET run_id = excluded.run_id, filename = excluded.filename, error = NULL,
        status = CASE WHEN brain_documents.status = 'done' THEN 'done' ELSE 'pending' END, updated_at = excluded.updated_at`).bind(d.docId, p.workspaceId, p.runId, d.driveFileId, d.name, at)));
  }
  // The id of a re-learned file is the existing row's id.
  const rows = (await env.DB.prepare('SELECT id, drive_file_id FROM brain_documents WHERE run_id = ? AND workspace_id = ?').bind(p.runId, p.workspaceId).all<{ id: string; drive_file_id: string }>()).results;
  const idOf = new Map(rows.map((x) => [x.drive_file_id, x.id]));
  await env.DB.prepare('UPDATE brain_learn_runs SET total = ? WHERE id = ?').bind(docs.length, p.runId).run();
  await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.started', { total: docs.length, folder_id: p.folderId });
  return docs.map((d) => ({ ...d, docId: idOf.get(d.driveFileId) ?? d.docId }));
}

const facts = (e: Extraction) => {
  const p = e.proposal;
  return { ref: p.ref, title: p.title, client: p.client.name, sector: p.client.sector, city: p.client.city, solution_type: p.solution_type, total_inr: p.commercials.total_inr,
    outcome: p.outcome.status, turnaround_days: p.turnaround_days, line_items: p.scope_of_supply.length, engineering_days: p.custom_engineering.reduce((a, c) => a + c.person_days, 0),
    top_skus: [...p.scope_of_supply].sort((a, b) => b.amount_inr - a.amount_inr).slice(0, 3).map((l) => l.sku) };
};

/** Step 2 (one per file): download, keep the original in R2, let Spark read it natively, store the structured proposal. */
export async function readStep(env: BrainEnv, p: LearnParams, d: DocRef, index: number, total: number): Promise<{ status: 'done' | 'skipped'; ref?: string }> {
  const cur = await env.DB.prepare('SELECT status, proposal_ref FROM brain_documents WHERE id = ?').bind(d.docId).first<{ status: string; proposal_ref: string | null }>();
  if (cur?.status === 'done') { await env.DB.prepare('UPDATE brain_learn_runs SET done = done + 1 WHERE id = ?').bind(p.runId).run(); return { status: 'skipped', ref: cur.proposal_ref ?? undefined }; }
  await env.DB.prepare("UPDATE brain_documents SET status = 'reading', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), d.docId).run();
  await env.DB.prepare('UPDATE brain_learn_runs SET current_title = ? WHERE id = ?').bind(d.name, p.runId).run();
  await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.file_started', { index: index + 1, total, filename: d.name });
  const dl = await runAction(env, p.workspaceId, 'googledrive', 'download_file', { file_id: d.driveFileId });
  if (!dl.ok) throw new Error(`download failed: ${String((dl.output as { error?: string }).error ?? '').slice(0, 160)}`);
  const b64 = details<{ base64: string }>(dl).base64;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = `brain/${p.workspaceId}/${p.runId}/${d.docId}.pdf`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { workspace_id: p.workspaceId } });
  let cost = 0;
  const onStep: StepLogger = (s) => { cost += s.costUsd; };
  const { extraction, tokensIn, tokensOut } = await extractProposal(env, bytes, d.name, onStep);
  const f = facts(extraction);
  await env.DB.batch([
    env.DB.prepare(`UPDATE brain_documents SET status = 'done', r2_key = ?, proposal_ref = ?, proposal_json = ?, section_order_json = ?, voice_notes_json = ?, facts_json = ?,
      tokens_in = ?, tokens_out = ?, cost_usd = ?, error = NULL, updated_at = ? WHERE id = ?`)
      .bind(key, f.ref, JSON.stringify(extraction.proposal), JSON.stringify(extraction.section_order), JSON.stringify(extraction.voice_notes), JSON.stringify(f), tokensIn, tokensOut, cost, new Date().toISOString(), d.docId),
    env.DB.prepare('UPDATE brain_learn_runs SET done = done + 1, cost_usd = cost_usd + ? WHERE id = ?').bind(cost, p.runId),
  ]);
  await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.file_done', { index: index + 1, total, filename: d.name, facts: f, cost_usd: cost, tokens_in: tokensIn, tokens_out: tokensOut });
  return { status: 'done', ref: f.ref };
}

export async function failStep(env: BrainEnv, p: LearnParams, d: DocRef, index: number, total: number, e: unknown): Promise<void> {
  const msg = (e instanceof Error ? e.message : 'failed').slice(0, 300);
  await env.DB.batch([
    env.DB.prepare("UPDATE brain_documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(msg, new Date().toISOString(), d.docId),
    env.DB.prepare('UPDATE brain_learn_runs SET failed = failed + 1 WHERE id = ?').bind(p.runId),
  ]);
  await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.file_failed', { index: index + 1, total, filename: d.name, error: msg });
}

/** Step 3: style (Spark, grounded in refs) + stats (code) from everything this workspace has learned. */
export async function deriveStep(env: BrainEnv, p: LearnParams): Promise<{ proposals: number }> {
  await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.outcomes', { message: 'Reading deal outcomes from HubSpot' });
  try {
    const o = await syncOutcomes(env, p.workspaceId);
    await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.outcomes', { message: `Matched ${o.outcomes} deal outcomes`, ...o });
  } catch (e) {
    await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.outcomes', { message: 'HubSpot deals unavailable; keeping outcomes read from the PDFs', error: e instanceof Error ? e.message : 'failed' });
  }
  await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.deriving', {});
  const docs = await learnedDocs(env.DB, p.workspaceId);
  if (docs.length < 3) throw new Error(`Only ${docs.length} proposals could be read; at least 3 are needed to learn a style.`);
  let cost = 0;
  const style = await deriveStyle(env, docs.map((d) => ({ proposal: d.proposal, section_order: d.section_order, voice_notes: d.voice_notes })), (s) => { cost += s.costUsd; });
  const stats = computeStats(docs.map((d) => d.proposal));
  await saveBrain(env.DB, p.workspaceId, p.runId, style, stats, docs.length);
  await env.DB.prepare("UPDATE brain_learn_runs SET status = 'completed', cost_usd = cost_usd + ?, finished_at = ?, current_title = NULL WHERE id = ?").bind(cost, new Date().toISOString(), p.runId).run();
  await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.completed', { proposals: docs.length, rules: style.voice_rules.length, win_rate: stats.win_rate });
  return { proposals: docs.length };
}

export async function failRun(env: BrainEnv, p: LearnParams, e: unknown): Promise<void> {
  const msg = (e instanceof Error ? e.message : 'failed').slice(0, 300);
  await env.DB.prepare("UPDATE brain_learn_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").bind(msg, new Date().toISOString(), p.runId).run();
  await addEvent(env.DB, p.workspaceId, p.runId, 'brain.learn.failed', { error: msg }).catch(() => undefined);
}
