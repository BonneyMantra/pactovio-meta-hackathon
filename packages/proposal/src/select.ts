import { z } from 'zod';
import { lexicalScores } from '@pactovio/quote';
import { shortlist } from './catalogue';
import { ask, runStep, type RunCtx } from './ctx';
import type { PastProposal } from './brain';

export const Scope = z.enum(['per_atm_site', 'per_branch_site', 'central', 'project']);
export const SelectionModel = z.object({
  lines: z.array(z.object({ sku: z.string(), scope: Scope, qty: z.number().positive(), requirement_ids: z.array(z.string()), rationale: z.string() })),
  gaps: z.array(z.object({ requirement_ids: z.array(z.string()), kind: z.enum(['external', 'custom']), item: z.string(), note: z.string() })),
  similar_used: z.array(z.string()),
});
export interface Selection { lines: z.infer<typeof SelectionModel>['lines']; gaps: z.infer<typeof SelectionModel>['gaps']; learned_from: string[]; shortlist_size: number }

/** Past proposals most similar to this RFQ (lexical over title, sector, summary); the model sees at most five. */
export function similarPast(past: PastProposal[], query: string, k = 5): PastProposal[] {
  const docs = past.map((p) => ({ text: `${p.title} ${p.sector ?? ''} ${p.client ?? ''} ${p.summary ?? ''} ${p.solution_type}`, p }));
  return lexicalScores(query, docs, k).map((r) => r.item.p);
}

const SYSTEM = `You are a pre-sales solution engineer. Map the buyer's requirements onto the supplier's catalogue.
Rules:
- Use ONLY skus from the catalogue shortlist; never invent a sku. Items sold as bought-out parts (sku starting EXT-) or services (SVC-) are allowed when listed.
- Give each line a scope: per_atm_site / per_branch_site (kit repeated at every such site), central (once for the platform), or project (once, e.g. survey, training).
- qty is per unit of scope (for per_*_site: devices per site).
- Anything the catalogue cannot meet goes in gaps: kind "external" (a third-party item the supplier would source) or "custom" (engineering work), with what is needed.
- similar_used: refs of past proposals (from the list) whose structure you reused. Do not copy their prices.`;

export const selectSolution = (ctx: RunCtx): Promise<string> => runStep(ctx, 'select_solution', () => !!ctx.state.selection, async () => {
  const rfq = ctx.state.rfq;
  if (!rfq) throw new Error('read_rfq must run before select_solution');
  const fn = rfq.requirements.filter((r) => r.category !== 'eligibility' && r.category !== 'commercial');
  const short = shortlist(ctx.catalogue, [rfq.title, ...fn.map((r) => r.text)], 6, 45);
  const past = similarPast(ctx.brain.past, `${rfq.title} ${rfq.summary} ${rfq.client.sector}`);
  const user = `RFQ: ${rfq.title} (${rfq.client.name}). Sites: ${rfq.sites.atm} ATM, ${rfq.sites.branch} branch.
Requirements:
${fn.map((r) => `${r.id}: ${r.text}`).join('\n')}

Catalogue shortlist (sku | name | family | INR | description):
${short.map((c) => `${c.sku} | ${c.name} | ${c.family} | ${c.price_inr} | ${c.description.slice(0, 160)}`).join('\n')}

Similar past proposals:
${past.length ? past.map((p) => `${p.ref} | ${p.title} | ${p.solution_type} | skus: ${(p.skus ?? []).slice(0, 12).join(', ')}`).join('\n') : '(none learned yet)'}`;
  const out = await ask(ctx, SelectionModel, { purpose: 'Select solution from catalogue', role: 'reason', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], maxTokens: 5000, name: 'selection' });
  const have = new Map(ctx.catalogue.map((c) => [c.sku, c]));
  const lines = out.lines.filter((l) => have.has(l.sku));
  const refs = new Set(past.map((p) => p.ref));
  ctx.state.selection = { lines, gaps: out.gaps, learned_from: out.similar_used.filter((r) => refs.has(r)), shortlist_size: short.length };
  return `${lines.length} catalogue lines, ${out.gaps.length} gaps, ${ctx.state.selection.learned_from.length} past proposals used`;
});
