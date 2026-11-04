import type { Env } from '@pactovio/contracts/env';
import { inputKey } from './assets';
import { runProposal } from './run';
import { createProposal, type InputFile } from './store';

export interface StartInput {
  source: 'upload' | 'chat' | 'autopilot' | 'api';
  files?: { filename: string; mime: string; bytes: Uint8Array }[];
  text?: string;
  intakeId?: string;
  title?: string;
}

/**
 * Create a proposal row, store the RFQ files in R2 under the workspace, and start the run: the ProposalRunWorkflow when bound,
 * otherwise inline through `waitUntil` (local dev and tests). Autopilot (B3) calls this directly with the emailed RFQ attachments.
 */
export async function startProposal(env: Env, workspaceId: string, i: StartInput, waitUntil?: (p: Promise<unknown>) => void): Promise<{ proposalId: string }> {
  const files: InputFile[] = [];
  const id = await createProposal(env, workspaceId, { source: i.source, title: i.title, input: { files: [], text: i.text, intake_id: i.intakeId } });
  for (const f of i.files ?? []) {
    const key = inputKey(workspaceId, id, f.filename);
    await env.FILES.put(key, f.bytes, { httpMetadata: { contentType: f.mime } });
    files.push({ key, filename: f.filename, mime: f.mime, size: f.bytes.length });
  }
  await env.DB.prepare('UPDATE proposals SET input_json = ? WHERE id = ?').bind(JSON.stringify({ files, text: i.text, intake_id: i.intakeId }), id).run();
  const run = { proposalId: id, workspaceId };
  const wf = (env as Env & { PROPOSAL?: Workflow }).PROPOSAL;
  if (wf) await wf.create({ id, params: run });
  else if (waitUntil) waitUntil(runProposal(env, run).catch(() => undefined));
  else await runProposal(env, run).catch(() => undefined);
  return { proposalId: id };
}
