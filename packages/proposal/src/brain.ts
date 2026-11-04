import type { Env } from '@pactovio/contracts/env';
import { readBrainTables } from './brain-read';

/** Company Brain as the bid engine reads it (normalised from B1's tables). All fields optional: a workspace may not have learned yet. */
export interface BrainStyle {
  section_order?: string[];
  /** Plain-text rules for prompts, e.g. "V1: Open with the client's own words". */
  voice_rules?: string[];
  /** Rule ids as the Company Brain names them (V1, V2...), echoed in `style_applied`. */
  voice_rule_ids?: string[];
  phrases?: string[];
  payment_terms?: string; warranty?: string; warranty_months_commissioning?: number; warranty_months_dispatch?: number;
  amc_pct?: number; validity_days?: number; discount_pattern?: string;
  engineering_rates_inr?: { firmware?: number; software?: number; default?: number };
  prepared_by?: { name: string; title: string };
}
export interface CompanyBrain {
  profile?: { legal_name?: string; name?: string; hq?: { city?: string; country?: string } } & Record<string, unknown>;
  catalogue_count?: number; proposals_learned?: number;
  style?: BrainStyle;
  stats?: Record<string, unknown>;
  learned_at?: string;
  /** What the company's own past proposals say about its facilities, service and people (most repeated first). */
  self_statements?: string[];
}
export interface PastProposal {
  ref: string; title: string; solution_type: string; sector?: string; client?: string; city?: string; date?: string;
  total_inr?: number; skus?: string[]; outcome?: 'won' | 'lost' | 'pending'; summary?: string;
}
export interface BrainData { brain: CompanyBrain | null; past: PastProposal[] }

/** Test seam: fixtures keyed by workspace id. Never populated in production. */
const fixtures = new Map<string, BrainData>();
export const setBrainFixture = (workspaceId: string, d: BrainData | null): void => { if (d) fixtures.set(workspaceId, d); else fixtures.delete(workspaceId); };

/**
 * Read the workspace's Company Brain from B1's tables (migration 0086): `company_brain` style/stats, the learned
 * `brain_documents` (one structured past proposal each) joined to HubSpot `brain_outcomes`, and the workspace profile.
 * Degrades to "no brain" (neutral style) when nothing has been learned yet.
 */
export async function getBrain(env: Pick<Env, 'DB'>, workspaceId: string): Promise<BrainData> {
  const fx = fixtures.get(workspaceId);
  if (fx) return fx;
  try { return await readBrainTables(env.DB, workspaceId); } catch { return { brain: null, past: [] }; }
}

export const DEFAULT_STYLE: Required<Pick<BrainStyle, 'payment_terms' | 'warranty_months_commissioning' | 'warranty_months_dispatch' | 'amc_pct' | 'validity_days'>> & BrainStyle = {
  payment_terms: '40% advance with purchase order, 50% on delivery of material at site, 10% on completion of commissioning.',
  warranty_months_commissioning: 12, warranty_months_dispatch: 18, amc_pct: 10, validity_days: 60,
  engineering_rates_inr: { firmware: 14000, software: 12000, default: 12000 },
  section_order: ['Executive summary', 'Requirement understanding', 'Solution overview', 'Architecture', 'Scope of supply', 'Custom engineering', 'Implementation plan', 'Commercials', 'Warranty and AMC', 'Compliance', 'Assumptions', 'Exclusions'],
};
