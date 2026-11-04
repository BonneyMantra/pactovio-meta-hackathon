import { z } from 'zod';
import { ask, runStep, type RunCtx } from './ctx';
import type { Proposal } from './schema';
import { companyFacts } from './eligibility';

export type ComplianceRow = Proposal['compliance'][number];
export const ComplianceModel = z.object({ rows: z.array(z.object({ requirement_id: z.string(), status: z.enum(['complies', 'partial', 'deviation']), remark: z.string() })) });

export { companyFacts } from './eligibility';

const SYSTEM = `You are the compliance reviewer for a supplier's bid. For EACH requirement decide complies / partial / deviation, with a one-line remark.
Rules:
- A functional requirement "complies" when a selected catalogue item, bought-out item or listed engineering package delivers it as described (name it); "partial" only when part of it is not covered or depends on something outside the supply (OEM authorisation, client-side work); "deviation" when the offer does not meet it.
- Eligibility and commercial requirements (turnover, certifications, references, service centres, authorisations): "complies" ONLY when the company facts below state it; "partial" when the facts are silent (remark: "To confirm: <evidence to attach>"); "deviation" only when the facts or past proposals show it is not met (e.g. too few qualifying references, no presence in a required state). Never assume a qualification.
- Remarks are short, factual, no marketing language, and cite the sku or work package that delivers the item.`;

export const buildCompliance = (ctx: RunCtx): Promise<string> => runStep(ctx, 'compliance_matrix', () => !!ctx.state.compliance, async () => {
  const { rfq, bom, selection } = ctx.state;
  if (!rfq || !bom || !selection) throw new Error('compose_bom must run before compliance_matrix');
  // Mandatory eligibility was already judged by check_eligibility: reuse those verdicts so the two never disagree.
  const elig = new Map((ctx.state.eligibility ?? []).map((e) => [e.requirement_id, e]));
  const toJudge = rfq.requirements.filter((r) => !elig.has(r.id));
  const user = `Requirements:\n${toJudge.map((r) => `${r.id} [${r.category}${r.mandatory ? ', mandatory' : ''}] ${r.text}`).join('\n')}

Supply lines: ${bom.scope_of_supply.map((s) => `${s.sku} ${s.description.slice(0, 70)}`).join('; ')}
Custom engineering: ${bom.custom_engineering.map((w) => `${w.work_package}: ${w.description.slice(0, 90)}`).join('; ') || 'none'}
Gaps noted: ${selection.gaps.map((g) => `${g.kind} ${g.item}`).join('; ') || 'none'}

Company facts:\n${await companyFacts(ctx)}`;
  const out = !toJudge.length ? { rows: [] } : await ask(ctx, ComplianceModel, { purpose: 'Compliance matrix', role: 'agent', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], maxTokens: 7000, name: 'compliance' });
  const judged = new Map(out.rows.map((r) => [r.requirement_id, r]));
  const STATUS = { met: 'complies', to_confirm: 'partial', gap: 'deviation' } as const;
  // Rows follow the RFQ order; any requirement the model skipped is surfaced as partial, never silently dropped.
  const rows: ComplianceRow[] = rfq.requirements.map((req) => {
    const e = elig.get(req.id), r = judged.get(req.id);
    if (e) return { requirement: req.text, status: STATUS[e.status], remark: e.remark, page: req.page, clause: req.clause ?? null };
    if (r) return { requirement: req.text, status: r.status, remark: r.remark, page: req.page, clause: req.clause ?? null };
    return { requirement: req.text, status: 'partial', remark: 'Not assessed automatically; to be confirmed by the bid team.', page: req.page, clause: req.clause ?? null };
  });
  ctx.state.compliance = rows;
  const n = (s: string) => rows.filter((x) => x.status === s).length;
  return `${n('complies')} complies, ${n('partial')} partial, ${n('deviation')} deviation`;
});
