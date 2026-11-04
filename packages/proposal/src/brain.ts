import type { Env } from '@pactovio/contracts/env';

/** Company Brain as B1 builds it (subset the bid engine reads). All fields optional: a workspace may not have learned yet. */
export interface BrainStyle {
  section_order?: string[]; voice_rules?: string[]; phrases?: string[];
  payment_terms?: string; warranty?: string; warranty_months_commissioning?: number; warranty_months_dispatch?: number;
  amc_pct?: number; validity_days?: number; discount_pattern?: string;
  engineering_rates_inr?: { firmware?: number; software?: number; default?: number };
  prepared_by?: { name: string; title: string };
}
export interface CompanyBrain {
  profile?: { legal_name?: string; hq?: { city?: string; country?: string } };
  catalogue_count?: number; proposals_learned?: number;
  style?: BrainStyle;
  stats?: Record<string, unknown>;
  learned_at?: string;
}
export interface PastProposal {
  ref: string; title: string; solution_type: string; sector?: string; client?: string;
  total_inr?: number; skus?: string[]; outcome?: 'won' | 'lost' | 'pending'; summary?: string;
}
export interface BrainData { brain: CompanyBrain | null; past: PastProposal[] }

/** Test seam: fixtures keyed by workspace id, used when the brain tables are absent. Never populated in production. */
const fixtures = new Map<string, BrainData>();
export const setBrainFixture = (workspaceId: string, d: BrainData | null): void => { if (d) fixtures.set(workspaceId, d); else fixtures.delete(workspaceId); };

/**
 * Read the workspace's Company Brain from D1. B1 owns the tables; this reads `company_brain(workspace_id, brain_json)` and
 * `brain_proposals(workspace_id, ref, data_json)` when they exist and degrades to "no brain" (neutral style) when they do not.
 */
export async function getBrain(env: Pick<Env, 'DB'>, workspaceId: string): Promise<BrainData> {
  const fx = fixtures.get(workspaceId);
  if (fx) return fx;
  let brain: CompanyBrain | null = null;
  let past: PastProposal[] = [];
  try {
    const r = await env.DB.prepare('SELECT brain_json FROM company_brain WHERE workspace_id = ?').bind(workspaceId).first<{ brain_json: string }>();
    if (r?.brain_json) brain = JSON.parse(r.brain_json) as CompanyBrain;
  } catch { /* table not migrated yet */ }
  try {
    const rs = await env.DB.prepare('SELECT data_json FROM brain_proposals WHERE workspace_id = ? LIMIT 200').bind(workspaceId).all<{ data_json: string }>();
    past = rs.results.map((x) => JSON.parse(x.data_json) as PastProposal);
  } catch { /* table not migrated yet */ }
  return { brain, past };
}

export const DEFAULT_STYLE: Required<Pick<BrainStyle, 'payment_terms' | 'warranty_months_commissioning' | 'warranty_months_dispatch' | 'amc_pct' | 'validity_days'>> & BrainStyle = {
  payment_terms: '40% advance with purchase order, 50% on delivery of material at site, 10% on completion of commissioning.',
  warranty_months_commissioning: 12, warranty_months_dispatch: 18, amc_pct: 10, validity_days: 60,
  engineering_rates_inr: { firmware: 14000, software: 12000, default: 12000 },
  section_order: ['Executive summary', 'Requirement understanding', 'Solution overview', 'Architecture', 'Scope of supply', 'Custom engineering', 'Implementation plan', 'Commercials', 'Warranty and AMC', 'Compliance', 'Assumptions', 'Exclusions'],
};
