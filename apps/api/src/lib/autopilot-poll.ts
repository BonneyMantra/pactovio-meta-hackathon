import { newId } from '@pactovio/contracts';
import { getConnector, isLive, runAction, type Deps, type IntakeJob } from '@pactovio/connectors';
import type { Env } from '@pactovio/contracts/env';
import { emit } from '@pactovio/events';
import { touchChecked } from './autopilot-store';

export const POLL_CRON = '* * * * *';
const OVERLAP_MS = 120_000;
const MAX_WORKSPACES = 20;

/**
 * Polling fallback for the Composio Gmail trigger. For every workspace with autopilot on and a live Gmail connection, list inbox
 * messages newer than the cursor and open an intake + IntakeWorkflow for each unseen one. It shares the webhook's dedupe key
 * (`cx:msg:<account>:<message>`) and the per-message ledger, so trigger and poll never double-process a message.
 */
export async function pollAutopilot(env: Env, deps: Deps = {}): Promise<{ workspaces: number; started: number }> {
  const list = (await env.DB.prepare('SELECT workspace_id, cursor_ms FROM autopilot_settings WHERE enabled = 1 LIMIT ?').bind(MAX_WORKSPACES).all<{ workspace_id: string; cursor_ms: number | null }>()).results;
  let started = 0;
  for (const s of list) {
    const row = await getConnector(env, s.workspace_id, 'gmail');
    if (!isLive(row)) continue;
    const polledAt = Date.now();
    const cursor = s.cursor_ms ?? polledAt - 5 * 60_000;
    const res = await runAction(env, s.workspace_id, 'gmail', 'list_new', { after_seconds: Math.floor((cursor - OVERLAP_MS) / 1000) }, deps);
    if (!res.ok) continue; // the cursor stays: the next tick retries the same window
    const ids = ((res.output as { details?: { ids?: string[] } } | undefined)?.details?.ids ?? []);
    for (const messageId of ids) {
      if (await openIntake(env, s.workspace_id, row!.external_account_id!, messageId)) started++;
    }
    await touchChecked(env, s.workspace_id, polledAt);
  }
  return { workspaces: list.length, started };
}

async function openIntake(env: Env, ws: string, account: string, messageId: string): Promise<boolean> {
  const key = `cx:msg:${account}:${messageId}`;
  if (await env.CACHE.get(key)) return false;
  const seen = await env.DB.prepare('SELECT 1 AS x FROM autopilot_messages WHERE workspace_id = ? AND message_id = ?').bind(ws, messageId).first();
  if (seen) return false;
  const intakeId = newId('intake');
  const received = new Date().toISOString();
  await env.DB.prepare("INSERT INTO intakes (id, workspace_id, door, source, title, sender, received_at, status) VALUES (?, ?, 'rfp', 'gmail', ?, NULL, ?, 'new')")
    .bind(intakeId, ws, '(fetching message)', received).run();
  const job: IntakeJob = { intakeId, workspaceId: ws, source: 'gmail', provider: 'gmail', messageId, candidates: [ws] };
  try {
    await env.INTAKE.create({ id: intakeId, params: job });
  } catch (e) {
    await env.DB.prepare("UPDATE intakes SET status = 'ignored' WHERE id = ?").bind(intakeId).run();
    return false;
  }
  await env.CACHE.put(key, intakeId, { expirationTtl: 7 * 86_400 });
  await emit(env, ws, 'intake.received', { intake_id: intakeId, source: 'gmail', title: null, sender: null });
  return true;
}
