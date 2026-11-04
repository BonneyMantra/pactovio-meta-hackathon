import { describe, expect, it } from 'vitest';
import { aggregateProposals, scoreProposal, type ProposalLike, type ScoreCtx } from '../src/proposal-score';

const commercials = { supply_subtotal_inr: 300000, engineering_subtotal_inr: 100000, subtotal: 400000, discount_pct: 5, discount_inr: 20000, taxable_inr: 380000, gst_pct: 18, gst_inr: 68400, total_inr: 448400 };
const base: ProposalLike = {
  solution_type: 'own_products', executive_summary: 'Kurinji Bank needs alarm panels across 40 sites.', solution_overview: 'We supply panels.',
  scope_of_supply: [
    { sku: 'RX-100', type: 'rax_product', qty: 10, unit_price_inr: 20000, amount_inr: 200000 },
    { sku: 'RX-200', type: 'rax_product', qty: 5, unit_price_inr: 20000, amount_inr: 100000 },
    { sku: 'EXT-1', type: 'external', qty: 1, unit_price_inr: 5000, amount_inr: 5000, budgetary: true },
  ],
  custom_engineering: [{ person_days: 10, rate_inr: 10000 }],
  commercials: { ...commercials, supply_subtotal_inr: 305000, subtotal: 405000, discount_inr: 20250, taxable_inr: 384750, gst_inr: 69255, total_inr: 454005 },
  evidence: [
    { claim: 'a', source: { doc: 'rfq.pdf', page: 3 } }, { claim: 'b', source: { product_sku: 'RX-100' } },
    { claim: 'c', source: { past_proposal_ref: 'RAX/PR/2024/007' } }, { claim: 'd', source: { product_sku: 'NOPE' } },
  ],
  compliance: [{ requirement: 'r1', status: 'complies' }, { requirement: 'r2', status: '' }],
  floorplan: { placements: [{ source: 'sam-3.1' }, { source: 'sam-3.1' }, { source: 'spark-vision' }] },
  learned_from: ['RAX/PR/2024/007', 'RAX/PR/1999/001'], style_applied: ['brain:payment_terms', 'default:amc_pct'], struck_claims: [{}, {}],
};
const ctx: ScoreCtx = {
  catalogue: [{ sku: 'RX-100', unit_price_minor: 2000000, currency: 'INR' }, { sku: 'RX-200', unit_price_minor: 2100000, currency: 'INR' }],
  pastProposals: [
    { ref: 'RAX/PR/2024/007', solution_type: 'own_products', total_inr: 100000 }, { ref: 'RAX/PR/2024/008', solution_type: 'own_products', total_inr: 300000 },
    { ref: 'RAX/PR/2024/009', solution_type: 'own_products', total_inr: 500000 }, { ref: 'RAX/PR/2024/010', solution_type: 'own_products', total_inr: 900000 },
  ],
  outcomes: [{ ref: 'RAX/PR/2024/007', status: 'won' }, { ref: 'RAX/PR/2024/008', status: 'won' }, { ref: 'RAX/PR/2024/009', status: 'won' }, { ref: 'RAX/PR/2024/010', status: 'lost' }],
  style: { voice_rules: [1, 2, 3], phrases: [1] },
  requirements: [{ doc: 'rfq.pdf', page: 3 }, { doc: 'rfq.pdf', page: null }, { doc: '', page: 4 }, { doc: 'rfq.pdf', page: 9 }],
  claimStats: { checked: 10, supported: 8 },
};

describe('scoreProposal', () => {
  const s = scoreProposal(base, ctx);
  it('citation rate counts doc+page', () => expect(s.checks.citation_rate).toMatchObject({ score: 0.5, detail: { cited: 2, requirements: 4 } }));
  it('detects minor-unit scale and flags a price mismatch; labelled external is not penalised', () => {
    expect(s.checks.catalogue_price_fidelity.score).toBe(0.5);
    expect(s.checks.catalogue_price_fidelity.detail).toMatchObject({ price_scale: 100, labelled_external: 1, mismatched_skus: ['RX-200'] });
  });
  it('flags unlabelled off-catalogue lines', () => {
    const p = { ...base, scope_of_supply: [{ sku: 'GHOST', type: 'rax_product', qty: 1, unit_price_inr: 1, amount_inr: 1 }] };
    expect(scoreProposal(p, ctx).checks.catalogue_price_fidelity.score).toBe(0);
  });
  it('arithmetic: consistent totals pass, a wrong subtotal fails', () => {
    const ok = scoreProposal({ ...base, scope_of_supply: base.scope_of_supply!.slice(0, 2), commercials }, ctx).checks.arithmetic_consistency;
    expect(ok.score).toBe(1);
    const bad = scoreProposal({ ...base, scope_of_supply: base.scope_of_supply!.slice(0, 2), commercials: { ...commercials, total_inr: 500000 } }, ctx).checks.arithmetic_consistency;
    expect(bad.detail.failed).toEqual(['total']);
    expect(bad.score).toBeCloseTo(7 / 8);
  });
  it('arithmetic: a line whose amount disagrees with qty x price is caught', () => {
    const p = { ...base, scope_of_supply: [{ sku: 'RX-100', type: 'rax_product', qty: 10, unit_price_inr: 20000, amount_inr: 150000 }], commercials: { ...commercials, supply_subtotal_inr: 150000 } };
    expect(scoreProposal(p, ctx).checks.arithmetic_consistency.detail.failed).toContain('lines');
  });
  it('evidence resolution checks doc+page against RFQ docs, catalogue and learned refs', () => {
    expect(s.checks.evidence_density.score).toBe(0.75);
    expect(s.checks.evidence_density.detail).toMatchObject({ evidence_items: 4, resolved: 3 });
  });
  it('claim hygiene = struck / (struck + supported)', () => expect(s.checks.claim_hygiene.score).toBeCloseTo(0.2));
  it('grounding of learning', () => expect(s.checks.grounding_of_learning).toMatchObject({ score: 0.5, detail: { grounded: 1, style_from_brain: 1, brain_voice_rules: 3 } }));
  it('plausibility uses won pool only and reports percentile', () => {
    expect(s.checks.value_plausibility.detail).toMatchObject({ won_pool: 3, inside_p10_p90: true });
    expect(scoreProposal({ ...base, commercials: { ...commercials, total_inr: 5_000_000 } }, ctx).checks.value_plausibility.score).toBe(0);
    expect(scoreProposal(base, { ...ctx, outcomes: [] }).checks.value_plausibility.score).toBeNull();
  });
  it('floorplan grounding and compliance coverage', () => {
    expect(s.checks.floorplan_grounding.score).toBeCloseTo(2 / 3, 3);
    expect(s.checks.compliance_coverage.score).toBeCloseTo(0.5 * 0.5);
  });
  it('null checks are excluded from the overall mean', () => {
    const none = scoreProposal({ ...base, floorplan: undefined, learned_from: [] }, { ...ctx, requirements: undefined });
    expect(none.checks.floorplan_grounding.score).toBeNull();
    expect(none.checks.citation_rate.score).toBeNull();
    expect(none.overall).not.toBeNull();
  });
});

describe('aggregateProposals', () => {
  it('ignores nulls and reports n/mean/min/max', () => {
    const a = scoreProposal(base, ctx), b = scoreProposal({ ...base, floorplan: undefined }, ctx);
    const agg = aggregateProposals([a, b]);
    expect(agg.checks.floorplan_grounding).toMatchObject({ n: 1 });
    expect(agg.checks.citation_rate).toMatchObject({ n: 2, mean: 0.5, min: 0.5, max: 0.5 });
  });
});

describe('unpaginated sources', () => {
  const txt: ScoreCtx = { ...ctx, requirements: [{ doc: 'rfq-text.txt', page: null }, { doc: 'rfq-text.txt', page: null }] };
  it('citation_rate is null and a doc-only evidence item resolves for pasted text', () => {
    const p = { ...base, evidence: [{ claim: 'x', source: { doc: 'rfq-text.txt', page: null } }, { claim: 'y', source: { doc: 'Some Client', page: null } }] };
    const s = scoreProposal(p, txt);
    expect(s.checks.citation_rate.score).toBeNull();
    expect(s.checks.evidence_density.score).toBe(0.5);
  });
});
