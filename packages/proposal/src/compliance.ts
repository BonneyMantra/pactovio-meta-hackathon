import { z } from 'zod';
import { ask, runStep, type RunCtx } from './ctx';
import type { Proposal } from './schema';

export type ComplianceRow = Proposal['compliance'][number];
export const ComplianceModel = z.object({ rows: z.array(z.object({ requirement_id: z.string(), status: z.enum(['complies', 'partial', 'deviation']), remark: z.string() })) });

/** Company facts the matrix may rely on: the saved workspace profile plus the Company Brain profile. Nothing else counts as evidence of capability. */
export async function companyFacts(ctx: RunCtx): Promise<string> {
  let profile = '';
  try {
    const r = await ctx.env.DB.prepare('SELECT profile_json FROM workspaces WHERE id = ?').bind(ctx.workspaceId).first<{ profile_json: string }>();
    if (r?.profile_json) profile = r.profile_json;
  } catch { /* no profile */ }
  const brain = ctx.brain.brain?.profile ? JSON.stringify(ctx.brain.brain.profile) : '';
  const past = ctx.brain.past.map((p) => `${p.ref} ${p.client ?? ''} ${p.title} (${p.outcome ?? ''})`).join('; ');
  return `Workspace profile: ${profile.slice(0, 3000)}\nBrain profile: ${brain}\nPast proposals: ${past.slice(0, 1500)}`;
}

const SYSTEM = `You are the compliance reviewer for a supplier's bid. For EACH requirement decide complies / partial / deviation, with a one-line remark.
Rules:
- A functional requirement "complies" when a selected catalogue item, bought-out item or listed engineering package delivers it as described (name it); "partial" only when part of it is not covered or depends on something outside the supply (OEM authorisation, client-side work); "deviation" when the offer does not meet it.
- Eligibility and commercial requirements (turnover, certifications, references, service centres, authorisations): "complies" ONLY when the company facts below state it; "partial" when the facts are silent (remark: "To confirm: <evidence to attach>"); "deviation" only when the facts or past proposals show it is not met (e.g. too few qualifying references, no presence in a required state). Never assume a qualification.
- Remarks are short, factual, no marketing language, and cite the sku or work package that delivers the item.`;

export const buildCompliance = (ctx: RunCtx): Promise<string> => runStep(ctx, 'compliance_matrix', () => !!ctx.state.compliance, async () => {
  const { rfq, bom, selection } = ctx.state;
  if (!rfq || !bom || !selection) throw new Error('compose_bom must run before compliance_matrix');
  const user = `Requirements:\n${rfq.requirements.map((r) => `${r.id} [${r.category}${r.mandatory ? ', mandatory' : ''}] ${r.text}`).join('\n')}

Supply lines: ${bom.scope_of_supply.map((s) => `${s.sku} ${s.description.slice(0, 70)}`).join('; ')}
Custom engineering: ${bom.custom_engineering.map((w) => `${w.work_package}: ${w.description.slice(0, 90)}`).join('; ') || 'none'}
Gaps noted: ${selection.gaps.map((g) => `${g.kind} ${g.item}`).join('; ') || 'none'}

Company facts:\n${await companyFacts(ctx)}`;
  const out = await ask(ctx, ComplianceModel, { purpose: 'Compliance matrix', role: 'agent', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], maxTokens: 7000, name: 'compliance' });
  const byId = new Map(rfq.requirements.map((r) => [r.id, r]));
  const rows: ComplianceRow[] = [];
  for (const r of out.rows) {
    const req = byId.get(r.requirement_id);
    if (req) rows.push({ requirement: req.text, status: r.status, remark: r.remark, page: req.page });
  }
  // Any requirement the model skipped is surfaced as a deviation to confirm, never silently dropped.
  const seen = new Set(out.rows.map((r) => r.requirement_id));
  for (const req of rfq.requirements) if (!seen.has(req.id)) rows.push({ requirement: req.text, status: 'partial', remark: 'Not assessed automatically; to be confirmed by the bid team.', page: req.page });
  ctx.state.compliance = rows;
  const n = (s: string) => rows.filter((x) => x.status === s).length;
  return `${n('complies')} complies, ${n('partial')} partial, ${n('deviation')} deviation`;
});
