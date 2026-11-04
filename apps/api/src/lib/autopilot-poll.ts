import { newId } from '@pactovio/contracts';
import { getConnector, isLive, runAction, type Deps, type IntakeJob } from '@pactovio/connectors';
import type { Env } from '@pactovio/contracts/env';
import { emit } from '@pactovio/events';
import { touchChecked } from './autopilot-store';

export const POLL_CRON = '* * * * *';
/** How far back every poll looks. Mail that lands late, or is moved out of Spam hours after it arrived, keeps its original
 * receive time, so a moving cursor would skip it. The window is floored at the moment autopilot was switched on (cursor_ms),
 * so mail from before that is never back-filled; the ledger + KV key make re-listing the same message free. */
export const LOOKBACK_MS = 72 * 3_600_000;
const SLACK_MS = 120_000; // clock skew between Gmail's receive time and ours
const MAX_WORKSPACES = 20;
const MAX_LIST = 50;

/** Gmail `after:` bound for this poll, in Unix seconds. `since` is when autopilot was switched on. */
export function pollAfterSeconds(since: number | null, now: number): number {
  return Math.floor((Math.max(since ?? now - 5 * 60_000, now - LOOKBACK_MS) - SLACK_MS) / 1000);
}

/**
 * Polling fallback for the Composio Gmail trigger. For every workspace with autopilot on and a live Gmail connection, list inbox
 * messages in the look-back window and open an intake + IntakeWorkflow for each unseen one. It shares the webhook's dedupe key
 * (`cx:msg:<account>:<message>`) and the per-message ledger, so trigger and poll never double-process a message.
 */
export async function pollAutopilot(env: Env, deps: Deps = {}): Promise<{ workspaces: number; started: number }> {
  const list = (await env.DB.prepare('SELECT workspace_id, cursor_ms FROM autopilot_settings WHERE enabled = 1 LIMIT ?').bind(MAX_WORKSPACES).all<{ workspace_id: string; cursor_ms: number | null }>()).results;
  let started = 0;
  for (const s of list) {
    const row = await getConnector(env, s.workspace_id, 'gmail');
    if (!isLive(row)) continue;
    const res = await runAction(env, s.workspace_id, 'gmail', 'list_new', { after_seconds: pollAfterSeconds(s.cursor_ms, Date.now()), limit: MAX_LIST }, deps);
    if (!res.ok) continue; // the next tick retries the same window
    const ids = ((res.output as { details?: { ids?: string[] } } | undefined)?.details?.ids ?? []);
    for (const messageId of await unseen(env, s.workspace_id, ids)) {
      if (await openIntake(env, s.workspace_id, row!.external_account_id!, messageId)) started++;
    }
    await touchChecked(env, s.workspace_id);
  }
  return { workspaces: list.length, started };
}

/** One ledger query per poll, so re-listing the whole window every minute costs nothing per already-handled message. */
export async function unseen(env: Env, ws: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const done = new Set((await env.DB.prepare(`SELECT message_id FROM autopilot_messages WHERE workspace_id = ? AND message_id IN (${marks})`)
    .bind(ws, ...ids).all<{ message_id: string }>()).results.map((r) => r.message_id));
  return ids.filter((id) => !done.has(id));
}

async function openIntake(env: Env, ws: string, account: string, messageId: string): Promise<boolean> {
  const key = `cx:msg:${account}:${messageId}`;
  if (await env.CACHE.get(key)) return false;
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
