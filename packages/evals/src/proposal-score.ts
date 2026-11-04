/**
 * Offline proposal quality scorer. Pure and deterministic: every check is computed in code from the
 * generated proposal plus the workspace context (catalogue, learned proposals, outcomes, style, RFQ
 * requirements, claim-check counters). No model is called. A check that cannot be computed returns
 * `score: null` and is excluded from the overall mean and from aggregates.
 */

export interface CatalogueRow { sku: string; unit_price_minor: number; currency?: string }
export interface PastProposal { ref: string; solution_type?: string | null; total_inr?: number | null; outcome?: 'won' | 'lost' | 'pending' | null }
export interface OutcomeRow { ref: string; status: 'won' | 'lost' | 'pending'; amount_inr?: number | null }
export interface StyleLike { voice_rules?: unknown[]; phrases?: unknown[]; section_order?: unknown[] }
export interface RequirementLike { id?: string; doc?: string | null; page?: number | null }
export interface ScoreCtx {
  catalogue: CatalogueRow[]; pastProposals: PastProposal[]; outcomes: OutcomeRow[]; style: StyleLike | null;
  /** RFQ requirements from the run state (`state.rfq.requirements`); needed for citation_rate and compliance_coverage. */
  requirements?: RequirementLike[];
  /** Sentence counters from the claim check (`state.claims.checked` / `.supported`); needed for claim_hygiene. */
  claimStats?: { checked: number; supported: number } | null;
}

/** Loose structural view of the Proposal schema (packages/proposal/src/schema.ts); only fields the checks read. */
export interface ProposalLike {
  solution_type?: string; executive_summary?: string; solution_overview?: string;
  requirement_understanding?: string[]; assumptions?: string[]; exclusions?: string[];
  scope_of_supply?: { sku: string; type: string; qty: number; unit_price_inr: number; amount_inr: number; budgetary?: boolean }[];
  custom_engineering?: { person_days: number; rate_inr: number }[];
  commercials?: { supply_subtotal_inr: number; engineering_subtotal_inr: number; subtotal: number; discount_pct: number; discount_inr: number; taxable_inr: number; gst_pct: number; gst_inr: number; total_inr: number };
  evidence?: { claim: string; source: { doc?: string; page?: number | null; product_sku?: string; past_proposal_ref?: string } }[];
  compliance?: { requirement: string; status?: string | null }[];
  floorplan?: { placements: { source: string }[] };
  learned_from?: string[]; style_applied?: string[];
  struck_claims?: unknown[];
}

export const CHECK_NAMES = [
  'citation_rate', 'catalogue_price_fidelity', 'arithmetic_consistency', 'evidence_density', 'claim_hygiene',
  'grounding_of_learning', 'value_plausibility', 'floorplan_grounding', 'compliance_coverage',
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];
export type Detail = Record<string, number | string | boolean | null | string[]>;
export interface CheckResult { score: number | null; detail: Detail }
export interface ProposalScore { checks: Record<CheckName, CheckResult>; overall: number | null }

/**
 * Overall = weighted mean of these checks (weights renormalised over the checks that are non-null):
 * citation 0.15, catalogue price 0.20, arithmetic 0.20, evidence source resolution 0.15 (the 4b share, not density),
 * grounding of learning 0.15, floorplan grounding 0.15. claim_hygiene, value_plausibility, compliance_coverage and
 * evidence density are reported, not weighted.
 */
export const OVERALL_WEIGHTS: Partial<Record<CheckName, number>> = {
  citation_rate: 0.15, catalogue_price_fidelity: 0.2, arithmetic_consistency: 0.2, evidence_density: 0.15, grounding_of_learning: 0.15, floorplan_grounding: 0.15,
};

const share = (n: number, d: number): number | null => (d > 0 ? n / d : null);
const within = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const words = (s: string): number => (s.match(/\S+/g) ?? []).length;
const normRef = (r: string): string => r.toUpperCase().replace(/[^A-Z0-9]/g, '');
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r4 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10000) / 10000);

/** Documents none of whose requirements carry a page (pasted text, .txt): no page can exist for them. */
function unpaginatedDocs(ctx: ScoreCtx): Set<string> {
  const byDoc = new Map<string, boolean>();
  for (const r of ctx.requirements ?? []) if (r.doc) byDoc.set(r.doc, (byDoc.get(r.doc) ?? true) && typeof r.page !== 'number');
  return new Set([...byDoc].filter(([, v]) => v).map(([d]) => d));
}

/**
 * 1. Share of extracted RFQ requirements carrying both a document name and a page number. Null when the RFQ is entirely
 * unpaginated text (no requirement can carry a page), reported as such rather than scored 0.
 */
function citationRate(ctx: ScoreCtx): CheckResult {
  const reqs = ctx.requirements ?? [];
  if (reqs.length && unpaginatedDocs(ctx).size === new Set(reqs.map((r) => r.doc).filter(Boolean)).size) return { score: null, detail: { requirements: reqs.length, reason: 'unpaginated source text' } };
  const cited = reqs.filter((r) => !!r.doc && typeof r.page === 'number').length;
  return { score: share(cited, reqs.length), detail: { requirements: reqs.length, cited } };
}

/**
 * 2. Share of BoM lines priced exactly at the workspace catalogue price (tolerance 1 minor unit). The catalogue stores
 * `unit_price_minor`; the proposal stores whole INR, so we try scale 1 and 100 and keep whichever matches more lines.
 * Lines whose SKU is not in the catalogue and that are labelled external (type external/service/custom or budgetary)
 * are counted but not penalised; an unlabelled off-catalogue line counts against the score.
 */
function priceFidelity(p: ProposalLike, ctx: ScoreCtx): CheckResult {
  const lines = p.scope_of_supply ?? [];
  const cat = new Map(ctx.catalogue.map((c) => [c.sku, c]));
  const matches = (scale: number): number => lines.filter((l) => { const c = cat.get(l.sku); return c && Math.abs(l.unit_price_inr * scale - c.unit_price_minor) <= 1; }).length;
  const scale = matches(100) > matches(1) ? 100 : 1;
  let inCat = 0, exact = 0, external = 0, unlabelled = 0;
  const off: string[] = [];
  for (const l of lines) {
    const c = cat.get(l.sku);
    if (c) { inCat++; if (Math.abs(l.unit_price_inr * scale - c.unit_price_minor) <= 1) exact++; else off.push(l.sku); continue; }
    if (l.type !== 'rax_product' || l.budgetary) external++; else { unlabelled++; off.push(l.sku); }
  }
  return { score: share(exact, inCat + unlabelled), detail: { lines: lines.length, in_catalogue: inCat, exact_price: exact, labelled_external: external, unlabelled_off_catalogue: unlabelled, price_scale: scale, mismatched_skus: off } };
}

/**
 * 3. Recomputes the money from the proposal itself. Components (each 0/1, the line check is the passing share of
 * lines): line = qty x unit (1%); supply subtotal = sum of lines (0.5%); engineering subtotal = sum(days x rate) (0.5%);
 * subtotal = supply + engineering; discount = subtotal x pct; taxable = subtotal - discount; GST = taxable x pct; total = taxable + GST.
 */
function arithmetic(p: ProposalLike): CheckResult {
  const c = p.commercials;
  if (!c) return { score: null, detail: { reason: 'no commercials' } };
  const lines = p.scope_of_supply ?? [];
  const lineOk = lines.filter((l) => within(l.amount_inr, l.qty * l.unit_price_inr, 0.01)).length;
  const sumLines = lines.reduce((a, l) => a + l.amount_inr, 0);
  const sumEng = (p.custom_engineering ?? []).reduce((a, w) => a + w.person_days * w.rate_inr, 0);
  const comps: [string, number][] = [
    ['lines', lines.length ? lineOk / lines.length : 1],
    ['supply_subtotal', within(c.supply_subtotal_inr, sumLines, 0.005) ? 1 : 0],
    ['engineering_subtotal', within(c.engineering_subtotal_inr, sumEng, 0.005) ? 1 : 0],
    ['subtotal', within(c.subtotal, c.supply_subtotal_inr + c.engineering_subtotal_inr, 0.005) ? 1 : 0],
    ['discount', within(c.discount_inr, c.subtotal * c.discount_pct / 100, 0.005) ? 1 : 0],
    ['taxable', within(c.taxable_inr, c.subtotal - c.discount_inr, 0.005) ? 1 : 0],
    ['gst', within(c.gst_inr, c.taxable_inr * c.gst_pct / 100, 0.005) ? 1 : 0],
    ['total', within(c.total_inr, c.taxable_inr + c.gst_inr, 0.005) ? 1 : 0],
  ];
  const failed = comps.filter(([, v]) => v < 1).map(([n]) => n);
  return { score: mean(comps.map(([, v]) => v)), detail: { components: comps.length, failed, lines: lines.length, lines_ok: lineOk } };
}

/**
 * 4. Evidence per 1,000 words of narrative (summary, overview, requirement understanding, assumptions, exclusions), and
 * the share of evidence items whose source resolves: doc+page present (and the doc is an RFQ document when known; for an
 * unpaginated text document the doc name alone resolves),
 * SKU in the catalogue, or past-proposal ref in the learned set. `score` is the resolution share (4b).
 */
function evidence(p: ProposalLike, ctx: ScoreCtx): CheckResult {
  const ev = p.evidence ?? [];
  const text = [p.executive_summary ?? '', p.solution_overview ?? '', ...(p.requirement_understanding ?? []), ...(p.assumptions ?? []), ...(p.exclusions ?? [])].join(' ');
  const w = words(text);
  const skus = new Set(ctx.catalogue.map((c) => c.sku));
  const refs = new Set(ctx.pastProposals.map((x) => normRef(x.ref)));
  const docs = new Set((ctx.requirements ?? []).map((r) => r.doc).filter(Boolean)), unpag = unpaginatedDocs(ctx);
  const ok = ev.filter((e) => {
    const s = e.source;
    if (s.product_sku !== undefined) return skus.has(s.product_sku);
    if (s.past_proposal_ref !== undefined) return refs.has(normRef(s.past_proposal_ref));
    if (!s.doc) return false;
    if (typeof s.page !== 'number') return unpag.has(s.doc);
    return docs.size === 0 || docs.has(s.doc);
  }).length;
  return { score: share(ok, ev.length), detail: { evidence_items: ev.length, resolved: ok, narrative_words: w, per_1000_words: w ? r4(ev.length / w * 1000) : null } };
}

/** 5. struck sentences / (struck + supported). Lower is better. Supported count comes from the claim-check counters. */
function hygiene(p: ProposalLike, ctx: ScoreCtx): CheckResult {
  const struck = (p.struck_claims ?? []).length;
  const supported = ctx.claimStats?.supported;
  if (supported === undefined) return { score: null, detail: { struck, reason: 'no claim stats' } };
  return { score: share(struck, struck + supported), detail: { struck, supported, checked: ctx.claimStats?.checked ?? null, lower_is_better: true } };
}

/**
 * 6. Share of `learned_from` refs that exist among the workspace's learned proposals (score). Also reports how many
 * style_applied entries came from the brain (prefix `brain:` or a voice-rule id) versus defaults, against the brain's rule count.
 */
function grounding(p: ProposalLike, ctx: ScoreCtx): CheckResult {
  const lf = p.learned_from ?? [];
  const known = new Set(ctx.pastProposals.map((x) => normRef(x.ref)));
  const ok = lf.filter((r) => known.has(normRef(r))).length;
  const sa = p.style_applied ?? [];
  const fromBrain = sa.filter((s) => !s.startsWith('default:')).length;
  return { score: share(ok, lf.length), detail: { learned_from: lf.length, grounded: ok, learned_pool: known.size, style_applied: sa.length, style_from_brain: fromBrain, brain_voice_rules: ctx.style?.voice_rules?.length ?? 0, brain_phrases: ctx.style?.phrases?.length ?? 0 } };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * 7. Proposal total vs the totals of WON past proposals of the same solution_type (all won if fewer than 3 of that type;
 * null if fewer than 3 won overall). Won = brain_outcomes status (by ref) else the past proposal's own outcome. All values
 * are INR (schema fields are `*_inr`). Score is 1 inside [P10, P90], else 0; the percentile is reported.
 */
function plausibility(p: ProposalLike, ctx: ScoreCtx): CheckResult {
  const total = p.commercials?.total_inr;
  if (total === undefined) return { score: null, detail: { reason: 'no total' } };
  const oc = new Map(ctx.outcomes.map((o) => [normRef(o.ref), o]));
  const won = ctx.pastProposals.filter((x) => (oc.get(normRef(x.ref))?.status ?? x.outcome) === 'won')
    .map((x) => ({ t: x.total_inr ?? oc.get(normRef(x.ref))?.amount_inr ?? null, type: x.solution_type })).filter((x): x is { t: number; type: string | null | undefined } => typeof x.t === 'number' && x.t > 0);
  const same = won.filter((x) => x.type === p.solution_type);
  const pool = (same.length >= 3 ? same : won).map((x) => x.t).sort((a, b) => a - b);
  if (pool.length < 3) return { score: null, detail: { total_inr: total, won_pool: pool.length, reason: 'fewer than 3 won proposals' } };
  const p10 = quantile(pool, 0.1), p90 = quantile(pool, 0.9), inside = total >= p10 && total <= p90;
  return { score: inside ? 1 : 0, detail: { total_inr: total, won_pool: pool.length, same_type_pool: same.length >= 3, p10: Math.round(p10), p90: Math.round(p90), percentile: r4(pool.filter((t) => t <= total).length / pool.length), inside_p10_p90: inside } };
}

/** 8. Share of floor-plan placements located by SAM 3.1 (the rest were estimated by the vision model). Null without placements. */
function floorplan(p: ProposalLike): CheckResult {
  const pl = p.floorplan?.placements ?? [];
  const sam = pl.filter((x) => x.source === 'sam-3.1').length;
  return { score: share(sam, pl.length), detail: { placements: pl.length, sam_3_1: sam, spark_vision: pl.length - sam } };
}

/** 9. Compliance rows per requirement (capped at 1) x share of rows with a non-empty status. */
function compliance(p: ProposalLike, ctx: ScoreCtx): CheckResult {
  const rows = p.compliance ?? [], n = ctx.requirements?.length ?? 0;
  if (!n) return { score: null, detail: { rows: rows.length, reason: 'no requirements' } };
  const withStatus = rows.filter((r) => !!r.status && r.status.trim() !== '').length;
  const cov = rows.length / n;
  return { score: rows.length ? Math.min(1, cov) * (withStatus / rows.length) : 0, detail: { rows: rows.length, requirements: n, coverage_ratio: r4(cov), with_status: withStatus } };
}

export function scoreProposal(p: ProposalLike, ctx: ScoreCtx): ProposalScore {
  const checks: Record<CheckName, CheckResult> = {
    citation_rate: citationRate(ctx), catalogue_price_fidelity: priceFidelity(p, ctx), arithmetic_consistency: arithmetic(p),
    evidence_density: evidence(p, ctx), claim_hygiene: hygiene(p, ctx), grounding_of_learning: grounding(p, ctx),
    value_plausibility: plausibility(p, ctx), floorplan_grounding: floorplan(p), compliance_coverage: compliance(p, ctx),
  };
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(OVERALL_WEIGHTS) as [CheckName, number][]) {
    const s = checks[k].score;
    if (s !== null) { num += s * w; den += w; }
  }
  for (const c of Object.values(checks)) c.score = r4(c.score);
  return { checks, overall: den ? r4(num / den) : null };
}

export interface Stat { n: number; mean: number | null; min: number | null; max: number | null }
const stat = (xs: (number | null)[]): Stat => {
  const v = xs.filter((x): x is number => x !== null);
  return { n: v.length, mean: r4(mean(v)), min: v.length ? r4(Math.min(...v)) : null, max: v.length ? r4(Math.max(...v)) : null };
};

/** Per-check and overall mean/min/max across proposals, ignoring nulls (n says how many proposals contributed). */
export function aggregateProposals(scores: ProposalScore[]): { overall: Stat; checks: Record<CheckName, Stat> } {
  const checks = Object.fromEntries(CHECK_NAMES.map((k) => [k, stat(scores.map((s) => s.checks[k].score))])) as Record<CheckName, Stat>;
  return { overall: stat(scores.map((s) => s.overall)), checks };
}
