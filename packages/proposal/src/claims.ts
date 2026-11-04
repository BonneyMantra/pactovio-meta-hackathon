import { claimCheckSync, splitSentencesOf } from './claim-lib';
import { groupInr } from './money';
import { companyFacts } from './compliance';
import { runStep, type RunCtx } from './ctx';
import type { Proposal } from './schema';

export interface ClaimReport {
  evidence: Proposal['evidence'];
  struck: Proposal['struck_claims'];
  patched: { executive_summary: string; solution_overview: string; requirement_understanding: string[]; assumptions: string[]; exclusions: string[]; compliance: Proposal['compliance'] };
  checked: number; supported: number;
}

/** Every sentence of generated prose is checked in code against the evidence corpus; unsupported sentences are struck, never softened. */
export const claimCheckStep = (ctx: RunCtx): Promise<string> => runStep(ctx, 'claim_check', () => !!ctx.state.claims, async () => {
  const { rfq, bom, selection, compliance } = ctx.state;
  if (!rfq || !bom || !selection || !compliance) throw new Error('earlier steps must finish before claim_check');
  const c = bom.commercials;
  const calc = [
    `Project value ₹${groupInr(c.total_inr)} subtotal ₹${groupInr(c.subtotal)} GST ${c.gst_pct}% ₹${groupInr(c.gst_inr)}.`,
    `Sites: ${rfq.sites.atm} ATM and ${rfq.sites.branch} branch sites, ${rfq.sites.atm + rfq.sites.branch} sites in total.`,
    `Delivery ${bom.implementation_plan.reduce((a, p) => a + p.weeks, 0)} weeks: ${bom.implementation_plan.map((p) => `${p.name} ${p.weeks} weeks`).join('; ')}.`,
    `Warranty ${bom.warranty_amc.warranty_months_from_commissioning} months from commissioning or ${bom.warranty_amc.warranty_months_from_dispatch} months from dispatch. AMC ${bom.warranty_amc.amc_pct_of_hardware}%.`,
    `Validity ${ctx.brain.brain?.style?.validity_days ?? 60} days.`,
    ...bom.scope_of_supply.map((s) => `${s.qty} ${s.unit} ${s.sku}.`),
    ...bom.custom_engineering.map((w) => `${w.work_package} ${w.person_days} person-days.`),
  ].join(' ');
  const corpus = [
    ...rfq.requirements.map((r) => ({ id: `rfq:${r.doc}:${r.page ?? 0}:${r.id}`, title: r.doc, text: r.text })),
    { id: 'rfq:summary', title: rfq.client.name, text: `${rfq.title}. ${rfq.summary} ${rfq.client.name} ${rfq.client.city} ${rfq.client.country} ${rfq.rfq_ref} ${rfq.due_date ?? ''}` },
    ...ctx.catalogue.filter((p) => bom.scope_of_supply.some((s) => s.sku === p.sku)).map((p) => ({ id: `sku:${p.sku}`, title: p.name, text: `${p.sku} ${p.name} ${p.family} ${p.description}` })),
    ...bom.scope_of_supply.map((s) => ({ id: `sku:${s.sku}`, title: s.sku, text: s.description })),
    ...ctx.brain.past.filter((p) => selection.learned_from.includes(p.ref)).map((p) => ({ id: `past:${p.ref}`, title: p.title, text: `${p.title} ${p.client ?? ''} ${p.summary ?? ''}` })),
    { id: 'company', title: 'Company profile', text: await companyFacts(ctx) },
    { id: 'calc', title: 'Computed commercials', text: calc },
    ...selection.gaps.map((g, i) => ({ id: `gap:${i}`, title: g.item, text: `${g.item} ${g.note}` })),
    ...bom.custom_engineering.map((w) => ({ id: `wp:${w.work_package}`, title: w.work_package, text: `${w.work_package} ${w.description}` })),
  ];
  const allow = [rfq.client.name, ctx.brain.brain?.profile?.legal_name ?? ''].filter(Boolean);
  const struck: ClaimReport['struck'] = [];
  const used = new Map<string, Proposal['evidence'][number]>();
  let checked = 0, supported = 0;
  const clean = (text: string): string => {
    const claims = claimCheckSync(text, corpus, allow);
    const bad = new Set(claims.filter((x) => !x.supported).map((x) => x.text));
    for (const cl of claims) {
      checked++;
      if (!cl.supported) { struck.push({ text: cl.text, reason: 'No supporting figure, name or standard in the RFQ, catalogue, past proposals or company profile' }); continue; }
      supported++;
      for (const id of cl.evidence_ids.slice(0, 2)) {
        const src = sourceOf(id, ctx);
        if (src && used.size < 80) used.set(`${id}|${cl.text.slice(0, 40)}`, { claim: cl.text.slice(0, 220), source: src });
      }
    }
    return splitSentencesOf(text).filter((s) => !bad.has(s)).join(' ');
  };
  const patched: ClaimReport['patched'] = {
    executive_summary: text3(bom.executive_summary, clean),
    solution_overview: text3(bom.solution_overview, clean),
    requirement_understanding: bom.requirement_understanding.map(clean).filter(Boolean),
    assumptions: bom.assumptions.map(clean).filter(Boolean),
    exclusions: bom.exclusions.map(clean).filter(Boolean),
    compliance: compliance.map((r) => ({ ...r, remark: clean(r.remark) || 'See supply and engineering lines.' })),
  };
  // Every priced line is traceable to the catalogue or flagged as an external estimate.
  for (const s of bom.scope_of_supply) if (s.type === 'rax_product') used.set(`sku|${s.sku}`, { claim: `${s.sku} at ₹${groupInr(s.unit_price_inr)} per ${s.unit}`, source: { product_sku: s.sku } });
  for (const r of rfq.requirements.slice(0, 40)) used.set(`req|${r.id}`, { claim: r.text.slice(0, 220), source: { doc: r.doc, page: r.page } });
  for (const ref of selection.learned_from) used.set(`past|${ref}`, { claim: `Structure and scope informed by past proposal ${ref}`, source: { past_proposal_ref: ref } });
  ctx.state.claims = { evidence: [...used.values()], struck, patched, checked, supported };
  return `${supported}/${checked} sentences supported, ${struck.length} struck`;
});

/** Keep paragraph breaks: check paragraph by paragraph. */
function text3(text: string, clean: (t: string) => string): string {
  return text.split(/\n{2,}/).map(clean).filter(Boolean).join('\n\n');
}

function sourceOf(id: string, ctx: RunCtx): Proposal['evidence'][number]['source'] | null {
  if (id.startsWith('rfq:') && id !== 'rfq:summary') { const [, doc, page] = id.split(':'); return { doc: doc ?? '', page: Number(page) || null }; }
  if (id === 'rfq:summary') return { doc: ctx.state.rfq?.client.name ?? 'RFQ', page: null };
  if (id.startsWith('sku:')) return { product_sku: id.slice(4) };
  if (id.startsWith('past:')) return { past_proposal_ref: id.slice(5) };
  return null;
}
