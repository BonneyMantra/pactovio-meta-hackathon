import type { RunCtx } from './ctx';
import { CONCEPT_LABEL } from './visual';
import { Proposal } from './schema';
import { assetName } from './assets';

/** Build the final Proposal from run state. Pure: every figure was computed upstream in code; this only arranges and validates. */
export function assemble(ctx: RunCtx, opts: { today?: Date; preparedBy?: { name: string; title: string } } = {}): Proposal {
  const { rfq, bom, design, compliance, claims, floorplan, visual, selection } = ctx.state;
  if (!rfq || !bom || !design || !compliance || !claims || !selection) throw new Error('Run state is incomplete');
  const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
  const style = ctx.brain.brain?.style;
  const p = claims.patched;
  const fp = floorplan && 'image_ref' in floorplan ? floorplan : null;
  const proposal = {
    ref: `PR/${today.slice(0, 4)}/${ctx.proposalId.slice(-6).toUpperCase()}`, revision: 'R1', date: today, validity_days: style?.validity_days ?? 60,
    client: rfq.client, rfq_ref: rfq.rfq_ref, title: bom.title, solution_type: bom.solution_type,
    executive_summary: p.executive_summary, requirement_understanding: p.requirement_understanding, solution_overview: p.solution_overview,
    architecture: design.architecture, scope_of_supply: bom.scope_of_supply, custom_engineering: bom.custom_engineering,
    implementation_plan: bom.implementation_plan, commercials: bom.commercials, warranty_amc: bom.warranty_amc,
    assumptions: p.assumptions, exclusions: p.exclusions, compliance: p.compliance,
    outcome: { status: 'pending' as const, decided_on: null, reason: 'Awaiting buyer decision' },
    prepared_by: style?.prepared_by ?? opts.preparedBy ?? { name: 'Bid desk', title: 'Pre-sales' },
    turnaround_days: 0,
    evidence: claims.evidence,
    site_kit: { per_site_items: bom.per_site_items, per_branch_items: bom.per_branch_items, sites: rfq.sites, zone_map: design.zone_map },
    ...(fp ? { floorplan: { image_ref: assetName(fp.image_ref), placements: fp.placements } } : {}),
    ...(visual && 'image_key' in visual ? { concept_visual: { image_ref: assetName(visual.image_key), prompt: visual.prompt, label: CONCEPT_LABEL } } : {}),
    learned_from: selection.learned_from,
    style_applied: bom.style_applied,
    struck_claims: claims.struck,
  };
  return Proposal.parse(proposal);
}
