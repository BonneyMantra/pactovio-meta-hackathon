import { z } from 'zod';
import { amcAnnual, computeTotals, groupInr, lineAmount } from './money';
import { DEFAULT_STYLE } from './brain';
import { ask, runStep, type RunCtx } from './ctx';
import type { Proposal } from './schema';

export const NarrativeModel = z.object({
  external_items: z.array(z.object({ sku: z.string(), description: z.string(), unit: z.string(), qty_basis: z.enum(['per_atm_site', 'per_branch_site', 'central', 'project']), qty: z.number().positive(), unit_price_inr: z.number().int().min(0) })),
  work_packages: z.array(z.object({ work_package: z.string(), description: z.string(), person_days: z.number().positive(), kind: z.enum(['firmware', 'software', 'other']) })),
  plan: z.array(z.object({ name: z.string(), weeks: z.number().int().min(1), deliverables: z.string() })).min(2),
  executive_summary: z.string(), requirement_understanding: z.array(z.string()), solution_overview: z.string(),
  assumptions: z.array(z.string()).min(3), exclusions: z.array(z.string()).min(3),
  discount_pct: z.number().min(0).max(8),
  title: z.string(),
});

export interface BomResult {
  title: string; solution_type: Proposal['solution_type'];
  scope_of_supply: Proposal['scope_of_supply']; custom_engineering: Proposal['custom_engineering']; implementation_plan: Proposal['implementation_plan'];
  commercials: Proposal['commercials']; warranty_amc: Proposal['warranty_amc'];
  executive_summary: string; requirement_understanding: string[]; solution_overview: string; assumptions: string[]; exclusions: string[];
  per_site_items: { sku: string; qty: number }[]; per_branch_items: { sku: string; qty: number }[]; style_applied: string[];
}

/** The title names the solution; the supplier and the word "proposal" are on the cover already. */
export const cleanTitle = (t: string): string => t.replace(/\s*[-–—|:]\s*[^-–—|:]*\bproposal\b[^-–—|:]*$/i, '').replace(/^(technical (and|&) commercial )?proposal (for|on)\s+/i, '').trim() || t;

export const lineType = (sku: string, inCatalogue: boolean): Proposal['scope_of_supply'][number]['type'] =>
  /^SVC-/i.test(sku) ? 'service' : /^EXT-/i.test(sku) ? 'external' : inCatalogue ? 'rax_product' : 'external';

const SYSTEM = `You write the commercial and narrative parts of a supplier's proposal in the supplier's own voice.
- external_items: bought-out items for the "external" gaps (give a plausible Indian-market budgetary unit price in INR; sku "EXT-..." in caps).
- work_packages: custom engineering for the "custom" gaps, named WP-1, WP-2 ..., with person_days (be realistic, whole or half days).
- plan: 4-6 phases with weeks; the sum of weeks is the elapsed project length. When the buyer states a timeline (survey, pilot, sign-off, rollout waves, completion), the phases follow it: the buyer's phases in the buyer's order, each ending by the buyer's week from purchase order, and the plan finishes within the buyer's completion time. Name phases the way the buyer does (e.g. "Pilot: 6 sites").
- Never state any rupee total, subtotal, GST or grand total in prose; write {{TOTAL_INR}} where the project value belongs (prices are computed by the system).
- Only mention products that appear in "Selected catalogue lines" or your external_items. Never invent certifications, client names or numbers that are not in the inputs.
- title: the solution and scope only (e.g. \"Integrated e-surveillance for 120 ATM sites and 18 branches\"), without the supplier name or the word proposal.
- Follow the supplier voice rules and fixed phrases when provided. Executive summary: 3 short paragraphs.
- Prose is for a bank's procurement committee: name products by what they are ("an 8-zone ATM alarm panel", "edge video analytics"), never by sku codes; at most one sku in any sentence. solution_overview: 2-3 short paragraphs (per ATM site, per branch, central platform), separated by a blank line.`;

export const composeBom = (ctx: RunCtx): Promise<string> => runStep(ctx, 'compose_bom', () => !!ctx.state.bom, async () => {
  const { rfq, selection } = ctx.state;
  if (!rfq || !selection) throw new Error('select_solution must run before compose_bom');
  const style = { ...DEFAULT_STYLE, ...(ctx.brain.brain?.style ?? {}) };
  const cat = new Map(ctx.catalogue.map((c) => [c.sku, c]));
  const mult = (scope: string) => (scope === 'per_atm_site' ? rfq.sites.atm || 1 : scope === 'per_branch_site' ? rfq.sites.branch || 1 : 1);

  const qtyBySku = new Map<string, { qty: number; scope: string }>();
  for (const l of selection.lines) {
    const q = qtyBySku.get(l.sku);
    qtyBySku.set(l.sku, { qty: (q?.qty ?? 0) + Math.ceil(l.qty) * mult(l.scope), scope: l.scope });
  }
  const supply: BomResult['scope_of_supply'] = [...qtyBySku].map(([sku, v]) => {
    const c = cat.get(sku)!;
    return { sku, description: `${c.name}${c.description ? ` - ${c.description.slice(0, 120)}` : ''}`, type: lineType(sku, true), qty: v.qty, unit: c.unit, unit_price_inr: c.price_inr, amount_inr: lineAmount(v.qty, c.price_inr) };
  });

  const gapsTxt = selection.gaps.map((g) => `${g.kind}: ${g.item} - ${g.note} [${g.requirement_ids.join(',')}]`).join('\n') || '(none)';
  const user = `Client: ${rfq.client.name} (${rfq.client.sector}, ${rfq.client.city}, ${rfq.client.country}). RFQ ${rfq.rfq_ref}: ${rfq.title}.
Sites: ${rfq.sites.atm} ATM, ${rfq.sites.branch} branch. Summary: ${rfq.summary}
Requirements: ${rfq.requirements.slice(0, 30).map((r) => `${r.id} ${r.text}`).join(' | ')}
Buyer's timeline: ${rfq.requirements.filter((r) => r.category === 'timeline').map((r) => `${r.clause ? `${r.clause} ` : ''}${r.text}${r.page ? ` (p. ${r.page})` : ''}`).join(' | ') || 'not stated'}
Selected catalogue lines: ${selection.lines.map((l) => `${l.sku} (${cat.get(l.sku)?.name}) x${l.qty} ${l.scope}`).join('; ')}
Gaps:\n${gapsTxt}
Supplier voice rules: ${(style.voice_rules ?? []).join(' | ') || '(neutral, plain, specific)'}
Fixed phrases: ${(style.phrases ?? []).join(' | ') || '(none)'}
Discount pattern: ${style.discount_pattern ?? 'none; keep 0'}
Past work you may reference by ref only: ${selection.learned_from.join(', ') || '(none)'}`;
  const n = await ask(ctx, NarrativeModel, { purpose: 'Compose BoM and narrative', role: 'reason', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], maxTokens: 7000, name: 'bom_narrative' });

  const known = new Set(supply.map((s) => s.sku));
  const mults = { per_atm_site: rfq.sites.atm || 1, per_branch_site: rfq.sites.branch || 1, central: 1, project: 1 };
  for (const e of n.external_items) {
    const sku = cat.has(e.sku) ? e.sku : e.sku.toUpperCase();
    if (known.has(sku)) continue;
    known.add(sku);
    const qty = Math.ceil(e.qty) * mults[e.qty_basis];
    // A catalogue sku always takes the catalogue price; only genuinely external items carry a budgetary price.
    const price = cat.get(sku)?.price_inr ?? e.unit_price_inr;
    supply.push({ sku, description: e.description, type: lineType(sku, cat.has(sku)), qty, unit: e.unit, unit_price_inr: price, amount_inr: lineAmount(qty, price), ...(cat.has(sku) ? {} : { budgetary: true }) });
  }
  const rates = style.engineering_rates_inr ?? {};
  const eng: BomResult['custom_engineering'] = n.work_packages.map((w) => ({ work_package: w.work_package, description: w.description, person_days: w.person_days, rate_inr: (w.kind === 'firmware' ? rates.firmware : w.kind === 'software' ? rates.software : rates.default) ?? 12000 }));
  let start = 1;
  const plan = n.plan.map((p) => { const row = { name: p.name, start_week: start, weeks: p.weeks, deliverables: p.deliverables }; start += p.weeks; return row; });

  const domestic = /^(india|in)$/i.test(rfq.client.country.trim());
  const t = computeTotals({ supply, engineering: eng, discount_pct: n.discount_pct, gst_pct: domestic ? 18 : 0 });
  const hasExt = supply.some((s) => s.type === 'external');
  const solution_type: BomResult['solution_type'] = eng.length ? (supply.some((s) => s.type === 'rax_product') ? 'own_plus_custom_engineering' : 'fully_custom_engineered') : hasExt ? 'own_plus_external' : 'own_products';
  const hardware = supply.filter((s) => s.type === 'rax_product').reduce((a, s) => a + s.amount_inr, 0);
  const amcPct = style.amc_pct ?? 10;
  const wc = style.warranty_months_commissioning ?? 12, wd = style.warranty_months_dispatch ?? 18;
  const total = groupInr(t.total_inr);
  const fill = (s: string) => s.replaceAll('{{TOTAL_INR}}', `₹${total}`);
  const kit = (scope: string) => selection.lines.filter((l) => l.scope === scope).map((l) => ({ sku: l.sku, qty: Math.max(1, Math.ceil(l.qty)) }));
  const learned = ctx.brain.brain?.style as Record<string, unknown> | undefined;
  const applied = [...['payment_terms', 'warranty_months_commissioning', 'amc_pct', 'validity_days', 'section_order', 'phrases'].map((k) => (learned?.[k] ? `brain:${k}` : `default:${k}`)), ...(style.voice_rule_ids ?? [])];
  const assumptions = [...n.assumptions];
  if (supply.some((s) => s.budgetary)) assumptions.push('Items marked budgetary are outside our price list; their prices are indicative and subject to OEM quotation at order.');

  ctx.state.bom = {
    title: cleanTitle(n.title), solution_type, scope_of_supply: supply, custom_engineering: eng, implementation_plan: plan,
    commercials: { ...t, payment_terms: style.payment_terms, note: domestic ? 'All prices in INR, exclusive of GST; GST at 18% applied.' : 'Export: GST not applicable (zero-rated).' },
    warranty_amc: { warranty_months_from_commissioning: wc, warranty_months_from_dispatch: wd, amc_pct_of_hardware: amcPct, amc_hardware_base_inr: hardware, amc_annual_inr: amcAnnual(hardware, amcPct), text: style.warranty ?? `${wc} months from commissioning or ${wd} months from dispatch, whichever is earlier. Annual maintenance contract at ${amcPct}% of hardware value per year, optional, from warranty expiry.` },
    executive_summary: fill(n.executive_summary), requirement_understanding: n.requirement_understanding, solution_overview: fill(n.solution_overview), assumptions, exclusions: n.exclusions,
    per_site_items: kit('per_atm_site'), per_branch_items: kit('per_branch_site'), style_applied: applied,
  };
  return `${supply.length} supply lines, ${eng.length} work packages, total ₹${total}`;
});
