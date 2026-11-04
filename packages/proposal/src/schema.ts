import { z } from 'zod';

/** Proposal schema: the Rax past-proposal schema (rax-proposals/schema.json) plus the Meta-build extensions. `ref` is free-form per tenant. */
const Inr = z.number().int().min(0);
export const SolutionType = z.enum(['own_products', 'own_plus_external', 'own_plus_custom_engineering', 'fully_custom_engineered']);
export const LineType = z.enum(['rax_product', 'external', 'service', 'custom']);

export const EvidenceSource = z.union([
  z.object({ doc: z.string(), page: z.number().int().nullable() }),
  z.object({ product_sku: z.string() }),
  z.object({ past_proposal_ref: z.string() }),
]);
export const EvidenceItem = z.object({ claim: z.string(), source: EvidenceSource });

export const Placement = z.object({
  device_sku: z.string(), label: z.string(),
  box: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  /** sam-3.1: box derived from a SAM-detected object; spark-vision: estimated by the vision model where SAM found no object. */
  source: z.enum(['sam-3.1', 'spark-vision']),
  anchor: z.string().optional(),
});

export const GoNoGo = z.object({
  decision: z.enum(['go', 'conditional', 'no_go']), confidence: z.number().min(0).max(1), reasons: z.array(z.string()),
  basis: z.object({ coverage: z.number(), similar_won: z.number(), similar_decided: z.number(), eligibility_gaps: z.number(), eligibility_to_confirm: z.number(), days_left: z.number().nullable() }),
});
export type GoNoGo = z.infer<typeof GoNoGo>;

export const Proposal = z.object({
  ref: z.string().min(1), revision: z.string(), date: z.string(), validity_days: z.number().int().min(1).max(365),
  client: z.object({ name: z.string(), sector: z.string(), city: z.string(), country: z.string(), contact_name: z.string(), contact_title: z.string() }),
  rfq_ref: z.string(), title: z.string(), solution_type: SolutionType,
  executive_summary: z.string(), requirement_understanding: z.array(z.string()), solution_overview: z.string(),
  architecture: z.object({
    nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(['rax_product', 'external', 'custom', 'client_system']) })),
    links: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })),
  }),
  scope_of_supply: z.array(z.object({ sku: z.string(), description: z.string(), type: LineType, qty: z.number().positive(), unit: z.string(), unit_price_inr: Inr, amount_inr: Inr, budgetary: z.boolean().optional() })),
  custom_engineering: z.array(z.object({ work_package: z.string(), description: z.string(), person_days: z.number().positive(), rate_inr: z.number().int().min(1) })),
  implementation_plan: z.array(z.object({ name: z.string(), start_week: z.number().int().min(1).optional(), weeks: z.number().int().min(1), deliverables: z.string() })),
  commercials: z.object({
    supply_subtotal_inr: z.number().int(), engineering_subtotal_inr: z.number().int(), subtotal: z.number().int(),
    discount_pct: z.number().min(0).max(15), discount_inr: z.number().int(), taxable_inr: z.number().int(),
    gst_pct: z.union([z.literal(0), z.literal(18)]), gst_inr: z.number().int(), total_inr: z.number().int(), payment_terms: z.string(), note: z.string().optional(),
  }),
  warranty_amc: z.object({
    warranty_months_from_commissioning: z.number().int(), warranty_months_from_dispatch: z.number().int(),
    amc_pct_of_hardware: z.number(), amc_hardware_base_inr: z.number().int(), amc_annual_inr: z.number().int(), text: z.string(),
  }),
  assumptions: z.array(z.string()), exclusions: z.array(z.string()),
  compliance: z.array(z.object({ requirement: z.string(), status: z.enum(['complies', 'partial', 'deviation']), remark: z.string(), page: z.number().int().nullable().optional(), clause: z.string().nullable().optional() })),
  outcome: z.object({ status: z.enum(['won', 'lost', 'pending']), decided_on: z.string().nullable(), reason: z.string() }),
  prepared_by: z.object({ name: z.string(), title: z.string() }),
  turnaround_days: z.number().int().min(0).max(60),
  // Extensions
  evidence: z.array(EvidenceItem).default([]),
  site_kit: z.object({
    per_site_items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })),
    per_branch_items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })).optional(),
    sites: z.object({ atm: z.number().int().min(0), branch: z.number().int().min(0) }),
    zone_map: z.array(z.object({ zone: z.string(), device_sku: z.string(), input: z.string(), wiring: z.string(), site: z.enum(['atm', 'branch', 'site']).optional() })),
  }).optional(),
  floorplan: z.object({
    image_ref: z.string(), placements: z.array(Placement),
    /** Objects SAM 3.1 segmented on the drawing, as the vision model named them. */
    objects: z.array(z.object({ id: z.string(), what: z.string(), box: z.array(z.number()) })).optional(),
    sam_calls: z.number().int().optional(),
  }).optional(),
  go_no_go: GoNoGo.optional(),
  concept_visual: z.object({
    image_ref: z.string(), prompt: z.string(), label: z.literal('Concept visual — generated, not a product photo'),
    /** Typical-site device placement on the visual: SAM 3.1 objects + anchored devices. */
    site: z.string().optional(), placements: z.array(Placement).optional(),
    objects: z.array(z.object({ id: z.string(), what: z.string(), box: z.array(z.number()) })).optional(),
  }).optional(),
  learned_from: z.array(z.string()).default([]),
  style_applied: z.array(z.string()).default([]),
  struck_claims: z.array(z.object({ text: z.string(), reason: z.string() })).default([]),
});
export type Proposal = z.infer<typeof Proposal>;

export const Requirement = z.object({
  id: z.string(), text: z.string(),
  category: z.enum(['functional', 'commercial', 'eligibility', 'sla', 'timeline', 'integration', 'other']),
  mandatory: z.boolean(), page: z.number().int().nullable(), doc: z.string(),
  /** The buyer's own clause or section id ("E7", "4.2.1"), so citations read the way the RFP does. */
  clause: z.string().nullable(),
});
export type Requirement = z.infer<typeof Requirement>;

export const RfqRead = z.object({
  rfq_ref: z.string(), title: z.string(), summary: z.string(), due_date: z.string().nullable(),
  /** Filename of an attached floor-plan / site drawing image, if one was provided. */
  floorplan_file: z.string().nullable(),
  client: Proposal.shape.client,
  sites: z.object({ atm: z.number().int().min(0), branch: z.number().int().min(0) }),
  requirements: z.array(Requirement).min(1),
});
export type RfqRead = z.infer<typeof RfqRead>;

export const STEP_NAMES = ['read_rfq', 'check_eligibility', 'select_solution', 'compose_bom', 'design_architecture', 'floor_plan', 'compliance_matrix', 'concept_visual', 'claim_check'] as const;
export type StepName = (typeof STEP_NAMES)[number];
