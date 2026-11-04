import { z } from 'zod';
import { ask, runStep, type RunCtx } from './ctx';
import type { Requirement } from './schema';

/**
 * Eligibility first: right after the RFQ is read, every mandatory eligibility / commercial condition is checked against
 * the company's own facts, so the bid desk sees what it cannot meet before any pricing is done.
 */
export const EligibilityModel = z.object({ rows: z.array(z.object({ requirement_id: z.string(), status: z.enum(['met', 'to_confirm', 'gap']), remark: z.string() })) });
export interface EligibilityRow { requirement_id: string; clause: string | null; text: string; page: number | null; status: 'met' | 'to_confirm' | 'gap'; remark: string }

export const isEligibility = (r: Requirement) => r.mandatory && (r.category === 'eligibility' || r.category === 'commercial');

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

const SYSTEM = `You check a supplier's eligibility for a tender against the supplier's own facts. For EACH condition decide:
- "met" ONLY when the company facts state it (cite the fact in the remark).
- "gap" when the facts or the past proposals show it is NOT met: e.g. no office, service centre or staff in a state the buyer requires, fewer qualifying references than required, a certificate the facts show is missing. Name what is missing.
- "to_confirm" when the facts are silent; remark "To confirm: <evidence to attach>".
Never assume a qualification. Remarks are one short factual line, no marketing language.`;

export const checkEligibility = (ctx: RunCtx): Promise<string> => runStep(ctx, 'check_eligibility', () => !!ctx.state.eligibility, async () => {
  const rfq = ctx.state.rfq;
  if (!rfq) throw new Error('read_rfq must run before check_eligibility');
  const reqs = rfq.requirements.filter(isEligibility);
  if (!reqs.length) { ctx.state.eligibility = []; return 'No mandatory eligibility conditions in the RFQ'; }
  const user = `Conditions:\n${reqs.map((r) => `${r.id} ${r.clause ? `(${r.clause}) ` : ''}${r.text}`).join('\n')}\n\nCompany facts:\n${await companyFacts(ctx)}`;
  const out = await ask(ctx, EligibilityModel, { purpose: 'Eligibility check', role: 'agent', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], maxTokens: 3000, name: 'eligibility' });
  const verdict = new Map(out.rows.map((r) => [r.requirement_id, r]));
  const rows: EligibilityRow[] = reqs.map((r) => {
    const v = verdict.get(r.id);
    return { requirement_id: r.id, clause: r.clause ?? null, text: r.text, page: r.page, status: v?.status ?? 'to_confirm', remark: v?.remark ?? 'To confirm: not assessed automatically.' };
  });
  ctx.state.eligibility = rows;
  const gaps = rows.filter((r) => r.status === 'gap'), confirm = rows.filter((r) => r.status === 'to_confirm').length;
  const cite = (r: EligibilityRow) => `${r.clause ?? r.requirement_id}${r.page ? ` p. ${r.page}` : ''}`;
  return `${rows.length} eligibility conditions: ${gaps.length ? `${gaps.length} gap${gaps.length > 1 ? 's' : ''} (${gaps.map(cite).join(', ')})` : 'no gaps'}${confirm ? `, ${confirm} to confirm` : ''}`;
});
