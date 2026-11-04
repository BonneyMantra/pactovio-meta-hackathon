import { z } from 'zod';

/** Past-proposal schema (pactovio-demo-data/rax-proposals/schema.json). Generated proposals extend it in packages/proposal. */
export const SolutionType = z.enum(['own_products', 'own_plus_external', 'own_plus_custom_engineering', 'fully_custom_engineered']);
export type SolutionType = z.infer<typeof SolutionType>;

const Node = z.object({ id: z.string(), label: z.string(), kind: z.enum(['rax_product', 'external', 'custom', 'client_system']) });
const Link = z.object({ from: z.string(), to: z.string(), label: z.string() });

export const SupplyLine = z.object({
  sku: z.string(), description: z.string(), type: z.enum(['rax_product', 'external', 'service', 'custom']),
  qty: z.number().gt(0), unit: z.string(), unit_price_inr: z.number().int().min(0), amount_inr: z.number().int().min(0),
});

export const ProposalSchema = z.object({
  ref: z.string().regex(/^RAX\/PR\/20(24|25|26)\/\d{3}$/),
  revision: z.string().regex(/^R\d+$/),
  date: z.string().regex(/^20(24|25|26)-\d{2}-\d{2}$/),
  validity_days: z.number().int().min(15).max(180),
  client: z.object({ name: z.string(), sector: z.string(), city: z.string(), country: z.string(), contact_name: z.string(), contact_title: z.string() }),
  rfq_ref: z.string(),
  title: z.string(),
  solution_type: SolutionType,
  executive_summary: z.string().min(200),
  requirement_understanding: z.array(z.string()).min(3),
  solution_overview: z.string().min(150),
  architecture: z.object({ nodes: z.array(Node).min(2), links: z.array(Link).min(1) }),
  scope_of_supply: z.array(SupplyLine).min(1),
  custom_engineering: z.array(z.object({ work_package: z.string(), description: z.string(), person_days: z.number().gt(0), rate_inr: z.number().int().min(1) })),
  implementation_plan: z.array(z.object({ name: z.string(), start_week: z.number().int().min(1).nullable(), weeks: z.number().int().min(1), deliverables: z.string() })).min(2),
  commercials: z.object({
    supply_subtotal_inr: z.number().int(), engineering_subtotal_inr: z.number().int(), subtotal: z.number().int(),
    discount_pct: z.number().min(0).max(15), discount_inr: z.number().int(), taxable_inr: z.number().int(),
    gst_pct: z.union([z.literal(0), z.literal(18)]), gst_inr: z.number().int(), total_inr: z.number().int(),
    payment_terms: z.string(), note: z.string().nullable(),
  }),
  warranty_amc: z.object({
    warranty_months_from_commissioning: z.number().int(), warranty_months_from_dispatch: z.number().int(),
    amc_pct_of_hardware: z.number(), amc_hardware_base_inr: z.number().int(), amc_annual_inr: z.number().int(), text: z.string(),
  }),
  assumptions: z.array(z.string()).min(3),
  exclusions: z.array(z.string()).min(3),
  compliance: z.array(z.object({ requirement: z.string(), status: z.enum(['complies', 'partial', 'deviation']), remark: z.string() })).min(4),
  outcome: z.object({ status: z.enum(['won', 'lost', 'pending']), decided_on: z.string().nullable(), reason: z.string() }),
  prepared_by: z.object({ name: z.string(), title: z.string() }),
  turnaround_days: z.number().int().min(1).max(60),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** What Spark returns per PDF: the structured proposal plus how the document itself is organised and written. */
export const ExtractionSchema = z.object({
  proposal: ProposalSchema,
  section_order: z.array(z.string()).describe('Top-level section headings exactly as they appear, in order'),
  voice_notes: z.array(z.string()).describe('2-4 short observations on tone, phrasing and recurring wording in this document'),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
