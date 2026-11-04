import { z } from 'zod';
import { SolutionType } from './schema';

export const StyleRule = z.object({ id: z.string(), text: z.string(), refs: z.array(z.string()).min(2) });
export const StylePhrase = z.object({ text: z.string(), refs: z.array(z.string()).min(2) });

/** Spark's reading of the corpus (every rule must cite >= 2 learned proposal refs). */
export const StyleDraft = z.object({
  section_order: z.array(z.string()).min(3),
  voice_rules: z.array(StyleRule).min(3),
  phrases: z.array(StylePhrase).min(3),
});

export const StyleProfile = StyleDraft.extend({
  payment_terms: z.string(),
  warranty: z.string(),
  amc_pct: z.number(),
  validity_days: z.number(),
  discount_pattern: z.string(),
});
export type StyleProfile = z.infer<typeof StyleProfile>;

const share = z.object({ count: z.number(), value_inr: z.number(), value_share: z.number() });
export const BrainStats = z.object({
  by_solution_type: z.object({ [SolutionType.options[0]]: share, [SolutionType.options[1]]: share, [SolutionType.options[2]]: share, [SolutionType.options[3]]: share }),
  value_share: z.object({ rax_products: z.number(), external: z.number(), services: z.number(), custom_engineering: z.number() }),
  win_rate: z.number().nullable(),
  won: z.number(), lost: z.number(), pending: z.number(),
  median_value_inr: z.number(),
  value_bands: z.array(z.object({ label: z.string(), min_inr: z.number(), max_inr: z.number().nullable(), count: z.number() })),
  avg_turnaround_days: z.number(),
  by_sector: z.array(z.object({ sector: z.string(), count: z.number(), value_inr: z.number(), won: z.number(), lost: z.number() })),
  by_region: z.array(z.object({ region: z.string(), count: z.number(), value_inr: z.number() })),
  top_products: z.array(z.object({ sku: z.string(), description: z.string(), qty: z.number(), value_inr: z.number(), proposals: z.number() })),
  engineering_days_total: z.number(),
  typical_margin_note: z.string(),
});
export type BrainStats = z.infer<typeof BrainStats>;

export interface CompanyBrain {
  profile: Record<string, unknown>;
  catalogue_count: number;
  proposals_learned: number;
  style: StyleProfile | null;
  stats: BrainStats | null;
  learned_at: string | null;
}

export type ProposalIndexRow = {
  ref: string; title: string; client: string; sector: string; city: string; date: string;
  solution_type: SolutionType; total_inr: number; outcome: 'won' | 'lost' | 'pending'; turnaround_days: number; source_file: string;
};
