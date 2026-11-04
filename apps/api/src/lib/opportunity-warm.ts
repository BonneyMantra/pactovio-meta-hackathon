import { OpportunitySearchInput } from '@pactovio/contracts';
import type { Env } from '@pactovio/contracts/env';
import { readOnboarding } from './onboarding-state';
import { searchOpportunities } from './opportunity-search';

const WARM_TTL_SECONDS = 20 * 60;
const MAX_WORKSPACES = 3;

/**
 * Eager tender assessment: for workspaces with autopilot on, the per-minute cron reads and scores the top worldwide candidates
 * (same search the Tenders screen runs) at most every 20 minutes, so the ranked list is ready before anyone opens it. Never throws.
 */
export async function warmTenders(env: Env): Promise<number> {
  const rows = (await env.DB.prepare('SELECT workspace_id FROM autopilot_settings WHERE enabled = 1 LIMIT ?').bind(MAX_WORKSPACES).all<{ workspace_id: string }>()).results;
  let warmed = 0;
  for (const { workspace_id: ws } of rows) {
    const flag = `opp:warm:v1:${ws}`;
    try {
      if (await env.CACHE.get(flag)) continue;
      await env.CACHE.put(flag, new Date().toISOString(), { expirationTtl: WARM_TTL_SECONDS });
      const state = await readOnboarding(env.DB, ws);
      if (!state.company.supplier_segment) continue;
      await searchOpportunities(env, ws, state, OpportunitySearchInput.parse({ limit: 12, sort: 'relevance' }), 'en');
      warmed++;
    } catch { /* a warm failure only means the first open does the reading */ }
  }
  return warmed;
}
