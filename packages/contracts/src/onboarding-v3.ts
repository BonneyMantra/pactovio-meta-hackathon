import { z } from 'zod';

/** Onboarding v3 boundaries: translated, AI-assessed opportunities and product images. */

/** BCP 47 tag ("pl", "pl-PL", "zh-Hant-TW"). The server assesses in the primary language subtag. */
export const LangTag = z.string().trim().max(35).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, 'Use a BCP 47 language tag such as pl or en-GB');
/** TED, UK Find a Tender, UK Contracts Finder, World Bank. Only ted/fts can be saved to #/tenders until tenders.source is widened. */
export const OpportunitySource = z.enum(['ted', 'fts', 'cf', 'wb']);
export const OPPORTUNITY_REGIONS = ['europe', 'north_america', 'latin_america', 'africa', 'middle_east', 'asia', 'oceania'] as const;
export const OPPORTUNITY_DOMAINS = ['it_software', 'telecom', 'electronics_electrical', 'industrial_equipment', 'lab_medical', 'construction', 'energy_utilities',
  'transport', 'professional_services', 'facilities_services', 'goods_supplies'] as const;
/** TED publication numbers ("722700-2026") and Find a Tender notice ids ("104375-2026"). */
export const NoticeId = z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Unknown notice id');

const many = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).optional();
export const OpportunitySearchInput = z.object({
  lang: LangTag.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['relevance', 'value', 'deadline', 'newest']).default('relevance'),
  regions: many(z.enum(OPPORTUNITY_REGIONS), 7),
  countries: many(z.string().trim().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()), 60),
  domains: many(z.enum(OPPORTUNITY_DOMAINS), 11),
  min_value: z.number().nonnegative().max(1e13).optional(),
  max_value: z.number().nonnegative().max(1e13).optional(),
  /** Value filters compare amounts in this currency only (no exchange rates are invented); default EUR. */
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase()).optional(),
  deadline_within_days: z.number().int().min(1).max(365).optional(),
  offset: z.number().int().min(0).max(2000).default(0),
  limit: z.number().int().min(1).max(20).default(20),
}).strict();
export const OpportunityAssessInput = z.object({
  ids: z.array(z.string().trim().regex(/^(ted|fts|cf|wb):[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/, 'Use source:id')).min(1).max(20),
  lang: LangTag.optional(),
}).strict();
export const OpportunityDetailParams = z.object({ source: OpportunitySource, id: NoticeId }).strict();
export const OpportunityDetailQuery = z.object({ lang: LangTag.optional() }).strict();
export const OpportunitySaveInput = z.object({ source: OpportunitySource, id: NoticeId, lang: LangTag.optional() }).strict();

/** One model assessment of one notice; cached per (notice, language, profile hash). */
/** Explainable fit rubric (Muse Spark extracts requirements and evidence; the sub-scores and the weighted total are computed in code). */
const Coverage = z.enum(['full', 'partial', 'none']);
const Check = z.enum(['ok', 'risk', 'unknown']);
export const FitRubric = z.object({
  version: z.literal(2), model: z.string().max(80),
  weights: z.object({ capability: z.number(), track_record: z.number(), eligibility: z.number(), commercial: z.number() }),
  scores: z.object({ capability: z.number().int(), track_record: z.number().int(), eligibility: z.number().int(), commercial: z.number().int() }),
  weighted: z.number().int().min(0).max(100), capped: z.boolean(), overall: z.number().int().min(0).max(100),
  verdict: z.enum(['bid', 'bid_with_conditions', 'pass']), verdict_note: z.string().max(400), top_risk: z.string().max(400),
  requirements: z.array(z.object({ text: z.string().max(240), coverage: Coverage, products: z.array(z.object({ sku: z.string(), name: z.string() })).max(4) })).max(10),
  coverage_pct: z.number().int().min(0).max(100),
  past: z.array(z.object({ ref: z.string(), client: z.string(), sector: z.string(), solution_type: z.string(), total_inr: z.number(), outcome: z.string(),
    similarity: z.enum(['high', 'medium', 'low']), why: z.string().max(240) })).max(3),
  track_note: z.string().max(300),
  eligibility: z.array(z.object({ check: z.string().max(60), status: Check, note: z.string().max(240) })).max(6),
  commercial: z.object({ value_inr: z.number().nullable(), value_label: z.string().nullable(), median_inr: z.number().nullable(),
    won_min_inr: z.number().nullable(), won_max_inr: z.number().nullable(), note: z.string().max(300) }),
  read: z.object({ chars: z.number().int(), documents: z.boolean(), documents_url: z.string().nullable() }),
});
export type FitRubric = z.infer<typeof FitRubric>;

export const NoticeAssessment = z.object({
  title: z.string().trim().min(1).max(400),
  summary: z.string().trim().min(1).max(700),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
  strengths: z.array(z.string().trim().min(1).max(300)).max(4),
  risks: z.array(z.string().trim().min(1).max(300)).max(4),
  rubric: FitRubric.optional(),
});
export type NoticeAssessment = z.infer<typeof NoticeAssessment>;

export const OpportunityFit = z.object({
  method: z.enum(['ai', 'unassessed']),
  score: z.number().int().min(0).max(100).optional(),
  reasons: z.array(z.string()), strengths: z.array(z.string()), risks: z.array(z.string()),
  rubric: FitRubric.optional(),
});
export type OpportunityFit = z.infer<typeof OpportunityFit>;

export const ImageFetchInput = z.object({ url: z.string().trim().min(1).max(2048).optional() }).strict();
export const ImagesFetchMissingInput = z.object({ limit: z.number().int().min(1).max(30).optional() }).strict();
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
