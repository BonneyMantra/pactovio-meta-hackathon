import { DOOR_OF_KIND, mimeFor, type Classification, type InboundMessage, type IntakeJob, type MailKind } from '@pactovio/connectors';
import type { Env } from '@pactovio/contracts/env';
import { getSettings, touchChecked, type AutopilotAction } from './autopilot-store';
import { NOT_CONFIGURED, startProposalRun } from './autopilot-seams';

const PROPOSAL_KINDS: MailKind[] = ['rfq', 'rfp', 'design_request'];

/** Door -> kind for classifications that predate `kind` (keyword fallback and forced doors). */
export function kindOf(cls: Pick<Classification, 'door' | 'kind'>): MailKind {
  if (cls.kind) return cls.kind;
  return cls.door === 'tender' ? 'tender_notice' : cls.door === 'design' ? 'design_request' : cls.door === 'rfp' ? 'rfp' : 'other';
}

export function decide(kind: MailKind, confidence: number, enabled: boolean, threshold: number): AutopilotAction {
  if (kind === 'marketing' || kind === 'other') return 'ignored';
  if (!PROPOSAL_KINDS.includes(kind)) return 'needs_review';
  if (!enabled) return 'autopilot_off';
  return confidence >= threshold ? 'proposal' : 'needs_review';
}

export interface AutopilotOutcome { action: AutopilotAction; duplicate: boolean; runId: string | null; status: string | null }

/**
 * Workflow stage after `route`: record the classification once per mailbox message (idempotent on workspace + message id) and,
 * when autopilot is on and the mail is a confident RFQ/RFP/design request, start a proposal run. Mail that is not a
 * request is marked ignored with the model's reason: the intake row stays visible in the Inbox, nothing is deleted.
 */
export async function autopilotStep(env: Env, job: IntakeJob, ws: string, msg: InboundMessage, cls: Classification): Promise<AutopilotOutcome | null> {
  if (!job.provider || !job.messageId) return null; // uploads and pastes are not mailbox autopilot
  const kind = kindOf(cls);
  const settings = await getSettings(env, ws);
  const action = decide(kind, cls.confidence, settings.enabled, settings.threshold);
  const now = new Date().toISOString();
  const id = `apm_${job.intakeId.slice(4)}`;
  const ins = await env.DB.prepare(`INSERT OR IGNORE INTO autopilot_messages (id, workspace_id, message_id, intake_id, kind, confidence, reason, action, proposal_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, ws, job.messageId, job.intakeId, kind, cls.confidence, (cls.reason || 'No reason given').slice(0, 300), action, action === 'proposal' ? 'queued' : null, now, now).run();
  await env.DB.prepare("UPDATE intakes SET title = ?, sender = ? WHERE id = ? AND title = '(fetching message)'").bind((cls.subject || msg.subject || '(no subject)').slice(0, 200), msg.from.slice(0, 200), job.intakeId).run();
  await touchChecked(env, ws);
  if ((ins.meta.changes ?? 0) === 0) {
    // Seen before (workflow step retry or redelivery). Only resume a start that never got a run id.
    const prev = await env.DB.prepare('SELECT action, proposal_run_id, proposal_status FROM autopilot_messages WHERE workspace_id = ? AND message_id = ?').bind(ws, job.messageId)
      .first<{ action: AutopilotAction; proposal_run_id: string | null; proposal_status: string | null }>();
    if (!prev || prev.action !== 'proposal' || prev.proposal_run_id || prev.proposal_status !== 'queued') {
      return { action: prev?.action ?? action, duplicate: true, runId: prev?.proposal_run_id ?? null, status: prev?.proposal_status ?? null };
    }
  }
  if (action !== 'proposal') return { action, duplicate: false, runId: null, status: null };

  try {
    const files = msg.attachments.map((a) => ({ filename: a.filename, mimetype: mimeFor(a.filename), r2Key: a.r2Key }));
    const run = await startProposalRun(env, ws, { intakeId: job.intakeId, files, text: `${msg.subject}\n\n${msg.body}`.slice(0, 40_000), title: (cls.subject || msg.subject || '').slice(0, 200) || undefined });
    const status = run.status ?? 'queued';
    await env.DB.batch([
      env.DB.prepare('UPDATE autopilot_messages SET proposal_run_id = ?, proposal_id = ?, proposal_status = ?, updated_at = ? WHERE workspace_id = ? AND message_id = ?')
        .bind(run.runId, run.proposalId ?? null, status, new Date().toISOString(), ws, job.messageId),
      env.DB.prepare("UPDATE intakes SET status = ? WHERE id = ? AND workspace_id = ?").bind(status === 'ready' ? 'ready' : 'processing', job.intakeId, ws),
    ]);
    return { action, duplicate: false, runId: run.runId, status };
  } catch (e) {
    const notConfigured = e instanceof Error && e.message === NOT_CONFIGURED;
    await env.DB.prepare('UPDATE autopilot_messages SET proposal_status = ?, updated_at = ? WHERE workspace_id = ? AND message_id = ?')
      .bind(notConfigured ? 'not_configured' : 'failed', new Date().toISOString(), ws, job.messageId).run();
    return { action, duplicate: false, runId: null, status: notConfigured ? 'not_configured' : 'failed' };
  }
}

export { DOOR_OF_KIND };
