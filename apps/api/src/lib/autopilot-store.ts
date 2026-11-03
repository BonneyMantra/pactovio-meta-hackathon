import type { Env } from '@pactovio/contracts/env';
import { one, rows } from './db';
import { readProposalRun } from './autopilot-seams';

export type AutopilotAction = 'proposal' | 'ignored' | 'needs_review' | 'autopilot_off';
export const DEFAULT_THRESHOLD = 0.7;

export interface AutopilotSettings { workspace_id: string; enabled: boolean; threshold: number; cursor_ms: number | null; last_checked_at: string | null }

export async function getSettings(env: Env, ws: string): Promise<AutopilotSettings> {
  const r = await env.DB.prepare('SELECT * FROM autopilot_settings WHERE workspace_id = ?').bind(ws).first<Record<string, unknown>>();
  return { workspace_id: ws, enabled: r ? r.enabled === 1 : false, threshold: r ? Number(r.threshold) : DEFAULT_THRESHOLD,
    cursor_ms: r && r.cursor_ms !== null ? Number(r.cursor_ms) : null, last_checked_at: (r?.last_checked_at as string | null) ?? null };
}

export async function saveSettings(env: Env, ws: string, p: { enabled?: boolean; threshold?: number }): Promise<AutopilotSettings> {
  const cur = await getSettings(env, ws);
  const enabled = p.enabled ?? cur.enabled;
  // Turning autopilot on starts the cursor at "now": old mail is never back-filled into proposals.
  const cursor = enabled && (!cur.enabled || cur.cursor_ms === null) ? Date.now() : cur.cursor_ms;
  await env.DB.prepare(`INSERT INTO autopilot_settings (workspace_id, enabled, threshold, cursor_ms, last_checked_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id) DO UPDATE SET enabled = excluded.enabled, threshold = excluded.threshold, cursor_ms = excluded.cursor_ms, updated_at = excluded.updated_at`)
    .bind(ws, enabled ? 1 : 0, p.threshold ?? cur.threshold, cursor, cur.last_checked_at, new Date().toISOString()).run();
  return getSettings(env, ws);
}

export async function touchChecked(env: Env, ws: string, cursorMs?: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO autopilot_settings (workspace_id, enabled, threshold, cursor_ms, last_checked_at, updated_at) VALUES (?, 0, ?, ?, ?, ?)
    ON CONFLICT (workspace_id) DO UPDATE SET last_checked_at = excluded.last_checked_at, cursor_ms = COALESCE(?, cursor_ms)`)
    .bind(ws, DEFAULT_THRESHOLD, cursorMs ?? null, now, now, cursorMs ?? null).run();
}

export interface InboxItem {
  intake_id: string; title: string; sender: string | null; received_at: string; status: string;
  kind: string; confidence: number; reason: string; action: AutopilotAction;
  proposal: { run_id: string | null; status: string | null; proposal_id: string | null } | null;
}
interface Joined { intake_id: string; title: string; sender: string | null; received_at: string; status: string; message_id: string; kind: string; confidence: number; reason: string; action: AutopilotAction; proposal_run_id: string | null; proposal_id: string | null; proposal_status: string | null }

/** Classified mail for one workspace, newest first. Ignored mail stays listed with its reason. Refreshes runs that are still going. */
export async function listInbox(env: Env, ws: string, limit = 50): Promise<InboxItem[]> {
  const list = await rows<Joined>(env.DB, `SELECT i.id AS intake_id, i.title, i.sender, i.received_at, i.status, m.message_id, m.kind, m.confidence, m.reason, m.action,
    m.proposal_run_id, m.proposal_id, m.proposal_status FROM autopilot_messages m JOIN intakes i ON i.id = m.intake_id
    WHERE m.workspace_id = ? AND i.workspace_id = ? ORDER BY i.received_at DESC LIMIT ?`, ws, ws, limit);
  for (const r of list) {
    if (r.action !== 'proposal' || !r.proposal_run_id || (r.proposal_status !== 'queued' && r.proposal_status !== 'running')) continue;
    const live = await readProposalRun(env, ws, r.proposal_run_id).catch(() => null);
    if (!live || live.status === r.proposal_status) continue;
    r.proposal_status = live.status; r.proposal_id = live.proposalId ?? r.proposal_id;
    await env.DB.prepare('UPDATE autopilot_messages SET proposal_status = ?, proposal_id = ?, updated_at = ? WHERE workspace_id = ? AND message_id = ?')
      .bind(live.status, r.proposal_id, new Date().toISOString(), ws, r.message_id).run();
    if (live.status === 'ready') await env.DB.prepare("UPDATE intakes SET status = 'ready' WHERE id = ? AND workspace_id = ?").bind(r.intake_id, ws).run();
  }
  return list.map((r) => ({
    intake_id: r.intake_id, title: r.title, sender: r.sender, received_at: r.received_at, status: r.status, kind: r.kind,
    confidence: r.confidence, reason: r.reason, action: r.action,
    proposal: r.action === 'proposal' ? { run_id: r.proposal_run_id, status: r.proposal_status, proposal_id: r.proposal_id } : null,
  }));
}

export async function inboxCounts(env: Env, ws: string) {
  const r = await one<Record<string, number>>(env.DB, `SELECT COUNT(*) AS received,
    COALESCE(SUM(action = 'proposal'), 0) AS proposals_started, COALESCE(SUM(action = 'proposal' AND proposal_status = 'ready'), 0) AS proposals_ready,
    COALESCE(SUM(action = 'ignored'), 0) AS ignored, COALESCE(SUM(action IN ('needs_review','autopilot_off')), 0) AS needs_review
    FROM autopilot_messages WHERE workspace_id = ?`, ws);
  return { received: r?.received ?? 0, proposals_started: r?.proposals_started ?? 0, proposals_ready: r?.proposals_ready ?? 0, ignored: r?.ignored ?? 0, needs_review: r?.needs_review ?? 0 };
}
