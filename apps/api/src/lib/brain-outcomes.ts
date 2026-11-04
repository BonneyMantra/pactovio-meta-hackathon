import { runAction } from '@pactovio/connectors';
import { DEAL_PROPS, mapDeals, type DealOutcome, type HubspotDealRaw } from '@pactovio/brain';
import { HttpError } from '@pactovio/contracts';
import type { BrainEnv } from './brain-store';

/** Read deals from HubSpot and replace this workspace's stored outcomes. */
export async function syncOutcomes(env: BrainEnv, ws: string): Promise<{ deals_read: number; outcomes: number }> {
  const r = await runAction(env, ws, 'hubspot', 'list_deals', { properties: DEAL_PROPS.join(',') });
  if (!r.ok) {
    const code = (r.output as { code?: string }).code;
    throw new HttpError(code === 'not_connected' ? 409 : 502, code === 'not_connected' ? 'Connect HubSpot first.' : 'HubSpot deals could not be read. Try again shortly.', code === 'not_connected' ? 'not_connected' : 'provider_error');
  }
  const raw = ((r.output as { details?: { deals?: HubspotDealRaw[] } }).details?.deals ?? []);
  const map = mapDeals(raw), at = new Date().toISOString();
  const rows = [...map.values()].map((o) => env.DB.prepare('INSERT INTO brain_outcomes (workspace_id, ref, status, decided_on, amount_inr, deal_id, dealname, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(ws, o.ref, o.status, o.decided_on, o.amount_inr, o.deal_id, o.dealname, at));
  await env.DB.batch([env.DB.prepare('DELETE FROM brain_outcomes WHERE workspace_id = ?').bind(ws), ...rows.slice(0, 90)]);
  for (let i = 90; i < rows.length; i += 90) await env.DB.batch(rows.slice(i, i + 90));
  return { deals_read: raw.length, outcomes: map.size };
}

export async function storedOutcomes(db: D1Database, ws: string): Promise<Map<string, DealOutcome>> {
  const rows = (await db.prepare('SELECT ref, status, decided_on, amount_inr, deal_id, dealname FROM brain_outcomes WHERE workspace_id = ?').bind(ws).all<{ ref: string; status: DealOutcome['status']; decided_on: string | null; amount_inr: number | null; deal_id: string; dealname: string }>()).results;
  return new Map(rows.map((r) => [r.ref, { ref: r.ref, status: r.status, decided_on: r.decided_on, amount_inr: r.amount_inr, deal_id: r.deal_id, dealname: r.dealname }]));
}
